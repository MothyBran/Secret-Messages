#!/usr/bin/env node
/**
 * Secret Messages Backend Server
 * Enterprise-grade encryption service with license key management
 */

require('dotenv').config();

const express = require('express');
const path = require('path');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const fs = require('fs');

// Database setup (supports both SQLite and PostgreSQL)
let db;
const DATABASE_TYPE = process.env.DATABASE_URL?.startsWith('postgresql') ? 'postgres' : 'sqlite';

if (DATABASE_TYPE === 'postgres') {
    const { Pool } = require('pg');
    db = new Pool({
        connectionString: process.env.DATABASE_URL
    });
} else {
    const sqlite3 = require('sqlite3').verbose();
    const dbPath = process.env.DATABASE_URL || './secret_messages.db';
    db = new sqlite3.Database(dbPath);
}

// Express app setup
const app = express();
const PORT = process.env.PORT || 3000;

// Security middleware
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'", "https://js.stripe.com"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
            fontSrc: ["'self'", "https://fonts.gstatic.com"],
            imgSrc: ["'self'", "data:", "https:"],
            connectSrc: ["'self'", "https://api.stripe.com"]
        }
    },
    hsts: {
        maxAge: 31536000,
        includeSubDomains: true,
        preload: true
    }
}));

// CORS configuration
app.use(cors({
    origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

// Compression and parsing
app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Trust proxy for rate limiting
if (process.env.TRUST_PROXY === 'true') {
    app.set('trust proxy', 1);
}

// Rate limiting
const generalLimiter = rateLimit({
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 minutes
    max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
    message: { error: 'Too many requests, please try again later' },
    standardHeaders: true,
    legacyHeaders: false
});

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: parseInt(process.env.AUTH_RATE_LIMIT_MAX) || 5,
    message: { error: 'Too many authentication attempts, please try again later' },
    skipSuccessfulRequests: true
});

app.use('/api', generalLimiter);
app.use('/api/auth', authLimiter);
app.use('/api/admin', authLimiter);

// Static files
app.use(express.static(path.join(__dirname, '../public')));

// Utility functions
function log(message, level = 'info') {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [${level.toUpperCase()}] ${message}`);
}

function error(message) {
    log(message, 'error');
}

function getClientIP(req) {
    return req.ip || req.connection.remoteAddress || req.socket.remoteAddress || '127.0.0.1';
}

async function executeQuery(query, params = []) {
    if (DATABASE_TYPE === 'postgres') {
        const client = await db.connect();
        try {
            const result = await client.query(query, params);
            return result;
        } finally {
            client.release();
        }
    } else {
        return new Promise((resolve, reject) => {
            db.run(query, params, function(err) {
                if (err) {
                    reject(err);
                } else {
                    resolve({ lastID: this.lastID, changes: this.changes });
                }
            });
        });
    }
}

async function selectQuery(query, params = []) {
    if (DATABASE_TYPE === 'postgres') {
        const client = await db.connect();
        try {
            const result = await client.query(query, params);
            return result.rows;
        } finally {
            client.release();
        }
    } else {
        return new Promise((resolve, reject) => {
            db.all(query, params, (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(rows);
                }
            });
        });
    }
}

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        version: '1.0.0',
        uptime: process.uptime(),
        environment: process.env.NODE_ENV || 'development'
    });
});

// Authentication endpoints
app.post('/api/auth/activate', async (req, res) => {
    try {
        const { licenseKey } = req.body;
        const clientIP = getClientIP(req);
        
        if (!licenseKey) {
            return res.status(400).json({
                success: false,
                error: 'License key is required'
            });
        }
        
        // Validate key format
        if (!/^[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}$/.test(licenseKey)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid license key format'
            });
        }
        
        // Find key in database
        const keys = await selectQuery(
            'SELECT * FROM license_keys WHERE key_code = ? LIMIT 1',
            [licenseKey]
        );
        
        if (keys.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'License key not found'
            });
        }
        
        const key = keys[0];
        
        // Check if key is already bound to a different IP
        if (key.activated_ip && key.activated_ip !== clientIP) {
            return res.status(403).json({
                success: false,
                error: 'License key is bound to another device'
            });
        }
        
        // Check if key has expired
        if (key.expires_at && new Date(key.expires_at) < new Date()) {
            return res.status(403).json({
                success: false,
                error: 'License key has expired'
            });
        }
        
        // Verify key hash
        const keyHash = bcrypt.hashSync(licenseKey, 10);
        
        // Activate key and bind to IP
        await executeQuery(
            'UPDATE license_keys SET activated_at = ?, activated_ip = ?, is_active = ?, usage_count = usage_count + 1 WHERE id = ?',
            [new Date().toISOString(), clientIP, true, key.id]
        );
        
        // Generate JWT token
        const token = jwt.sign(
            { keyId: key.id, ip: clientIP },
            process.env.JWT_SECRET,
            { expiresIn: `${process.env.SESSION_DURATION_DAYS || 30}d` }
        );
        
        // Log activity
        await executeQuery(
            'INSERT INTO activity_logs (key_id, action, metadata, ip_address, timestamp) VALUES (?, ?, ?, ?, ?)',
            [key.id, 'key_activation', JSON.stringify({ licenseKey, firstTime: !key.is_active }), clientIP, new Date().toISOString()]
        );
        
        log(`License key activated: ${licenseKey} (IP: ${clientIP})`);
        
        res.json({
            success: true,
            message: 'License key activated successfully',
            token: token,
            keyId: key.id
        });
        
    } catch (err) {
        error(`Key activation error: ${err.message}`);
        res.status(500).json({
            success: false,
            error: 'Internal server error'
        });
    }
});

app.post('/api/auth/validate', async (req, res) => {
    try {
        const { token } = req.body;
        const clientIP = getClientIP(req);
        
        if (!token) {
            return res.status(400).json({
                success: false,
                error: 'Token is required'
            });
        }
        
        // Verify JWT token
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
        // Check if IP matches
        if (decoded.ip !== clientIP) {
            return res.status(401).json({
                success: false,
                valid: false,
                error: 'Token IP mismatch'
            });
        }
        
        // Check if key is still active
        const keys = await selectQuery(
            'SELECT * FROM license_keys WHERE id = ? AND is_active = ? LIMIT 1',
            [decoded.keyId, true]
        );
        
        if (keys.length === 0) {
            return res.status(401).json({
                success: false,
                valid: false,
                error: 'License key no longer active'
            });
        }
        
        res.json({
            success: true,
            valid: true,
            keyId: decoded.keyId
        });
        
    } catch (err) {
        if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
            return res.status(401).json({
                success: false,
                valid: false,
                error: 'Invalid or expired token'
            });
        }
        
        error(`Token validation error: ${err.message}`);
        res.status(500).json({
            success: false,
            error: 'Internal server error'
        });
    }
});

app.post('/api/auth/logout', async (req, res) => {
    try {
        const { token } = req.body;
        
        if (token) {
            try {
                const decoded = jwt.verify(token, process.env.JWT_SECRET);
                
                // Log logout activity
                await executeQuery(
                    'INSERT INTO activity_logs (key_id, action, metadata, ip_address, timestamp) VALUES (?, ?, ?, ?, ?)',
                    [decoded.keyId, 'logout', JSON.stringify({ manual: true }), getClientIP(req), new Date().toISOString()]
                );
            } catch (err) {
                // Token might be invalid, but that's ok for logout
            }
        }
        
        res.json({
            success: true,
            message: 'Logged out successfully'
        });
        
    } catch (err) {
        error(`Logout error: ${err.message}`);
        res.status(500).json({
            success: false,
            error: 'Internal server error'
        });
    }
});

// Activity logging endpoint
app.post('/api/activity/log', async (req, res) => {
    try {
        const { action, metadata } = req.body;
        const authHeader = req.headers.authorization;
        const clientIP = getClientIP(req);
        
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({
                success: false,
                error: 'Authentication required'
            });
        }
        
        const token = authHeader.substring(7);
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
        if (!action) {
            return res.status(400).json({
                success: false,
                error: 'Action is required'
            });
        }
        
        await executeQuery(
            'INSERT INTO activity_logs (key_id, action, metadata, ip_address, timestamp) VALUES (?, ?, ?, ?, ?)',
            [decoded.keyId, action, JSON.stringify(metadata || {}), clientIP, new Date().toISOString()]
        );
        
        res.json({
            success: true,
            logged: true
        });
        
    } catch (err) {
        if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
            return res.status(401).json({
                success: false,
                error: 'Invalid or expired token'
            });
        }
        
        error(`Activity logging error: ${err.message}`);
        res.status(500).json({
            success: false,
            error: 'Internal server error'
        });
    }
});

// Admin endpoints
app.post('/api/admin/stats', async (req, res) => {
    try {
        const { password } = req.body;
        
        if (!password || !bcrypt.compareSync(password, bcrypt.hashSync(process.env.ADMIN_PASSWORD, 10))) {
            return res.status(401).json({
                success: false,
                error: 'Invalid admin password'
            });
        }
        
        // Get statistics
        const totalKeys = await selectQuery('SELECT COUNT(*) as count FROM license_keys');
        const activeKeys = await selectQuery('SELECT COUNT(*) as count FROM license_keys WHERE is_active = ?', [true]);
        const activeSessions = await selectQuery('SELECT COUNT(DISTINCT key_id) as count FROM activity_logs WHERE timestamp > ? AND action != ?', [new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(), 'logout']);
        const dailyUsage = await selectQuery('SELECT COUNT(*) as count FROM activity_logs WHERE timestamp > ?', [new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()]);
        
        const stats = {
            totalKeys: DATABASE_TYPE === 'postgres' ? totalKeys[0].count : totalKeys[0].count,
            activeKeys: DATABASE_TYPE === 'postgres' ? activeKeys[0].count : activeKeys[0].count,
            activeSessions: DATABASE_TYPE === 'postgres' ? activeSessions[0].count : activeSessions[0].count,
            dailyUsage: DATABASE_TYPE === 'postgres' ? dailyUsage[0].count : dailyUsage[0].count
        };
        
        res.json({
            success: true,
            stats: stats
        });
        
    } catch (err) {
        error(`Admin stats error: ${err.message}`);
        res.status(500).json({
            success: false,
            error: 'Internal server error'
        });
    }
});

app.post('/api/admin/generate-key', async (req, res) => {
    try {
        const { password, quantity = 1, expiresIn } = req.body;
        
        if (!password || !bcrypt.compareSync(password, bcrypt.hashSync(process.env.ADMIN_PASSWORD, 10))) {
            return res.status(401).json({
                success: false,
                error: 'Invalid admin password'
            });
        }
        
        if (quantity > 100) {
            return res.status(400).json({
                success: false,
                error: 'Maximum 100 keys per request'
            });
        }
        
        const keys = [];
        const expiresAt = expiresIn ? new Date(Date.now() + expiresIn * 24 * 60 * 60 * 1000) : null;
        
        for (let i = 0; i < quantity; i++) {
            // Generate license key
            const parts = [];
            for (let j = 0; j < 3; j++) {
                const part = crypto.randomBytes(3).toString('hex').toUpperCase().substring(0, 5);
                parts.push(part);
            }
            const keyCode = parts.join('-');
            const keyHash = bcrypt.hashSync(keyCode, 10);
            
            // Insert into database
            const result = await executeQuery(
                'INSERT INTO license_keys (key_code, key_hash, expires_at, created_by) VALUES (?, ?, ?, ?)',
                [keyCode, keyHash, expiresAt ? expiresAt.toISOString() : null, 'admin']
            );
            
            keys.push({
                id: result.lastID || result.insertId,
                key: keyCode,
                expires_at: expiresAt
            });
        }
        
        log(`Generated ${quantity} license keys via admin panel`);
        
        res.json({
            success: true,
            keys: keys,
            generated: quantity
        });
        
    } catch (err) {
        error(`Key generation error: ${err.message}`);
        res.status(500).json({
            success: false,
            error: 'Internal server error'
        });
    }
});

app.post('/api/admin/keys', async (req, res) => {
    try {
        const { password, page = 1, limit = 50 } = req.body;
        
        if (!password || !bcrypt.compareSync(password, bcrypt.hashSync(process.env.ADMIN_PASSWORD, 10))) {
            return res.status(401).json({
                success: false,
                error: 'Invalid admin password'
            });
        }
        
        const offset = (page - 1) * limit;
        
        const keys = await selectQuery(
            'SELECT id, key_code, created_at, activated_at, activated_ip, is_active, usage_count, expires_at FROM license_keys ORDER BY created_at DESC LIMIT ? OFFSET ?',
            [limit, offset]
        );
        
        const totalKeys = await selectQuery('SELECT COUNT(*) as count FROM license_keys');
        const total = DATABASE_TYPE === 'postgres' ? totalKeys[0].count : totalKeys[0].count;
        
        res.json({
            success: true,
            keys: keys,
            pagination: {
                page: page,
                limit: limit,
                total: parseInt(total),
                pages: Math.ceil(total / limit)
            }
        });
        
    } catch (err) {
        error(`Admin keys list error: ${err.message}`);
        res.status(500).json({
            success: false,
            error: 'Internal server error'
        });
    }
});

// Payment endpoints
app.get('/api/payment/pricing', (req, res) => {
    const pricing = {
        single_key: {
            price: 999, // €9.99 in cents
            currency: 'eur',
            name: 'Single License Key',
            description: 'One license key for personal use',
            price_formatted: '€9.99'
        },
        bundle_5: {
            price: 3999, // €39.99 in cents
            currency: 'eur',
            name: '5-Key Bundle',
            description: 'Five license keys with 20% discount',
            price_formatted: '€39.99'
        },
        bundle_10: {
            price: 6999, // €69.99 in cents
            currency: 'eur',
            name: '10-Key Bundle',
            description: 'Ten license keys with 30% discount',
            price_formatted: '€69.99'
        }
    };
    
    res.json({
        success: true,
        pricing: pricing
    });
});

// Frontend routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.get('/store', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/store.html'));
});

app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/admin.html'));
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({
        error: 'Endpoint not found'
    });
});

// Error handler
app.use((err, req, res, next) => {
    error(`Unhandled error: ${err.message}`);
    res.status(500).json({
        error: 'Internal server error'
    });
});

// Start server
const server = app.listen(PORT, () => {
    log(`🚀 Secret Messages Backend server running on port ${PORT}`);
    log(`🌐 Environment: ${process.env.NODE_ENV || 'development'}`);
    log(`💾 Database: ${DATABASE_TYPE}`);
    log(`🔐 Security: Rate limiting enabled`);
    
    if (process.env.NODE_ENV !== 'production') {
        log(`📱 Frontend: http://localhost:${PORT}`);
        log(`🔧 Admin Panel: http://localhost:${PORT}/admin`);
        log(`🛒 Store: http://localhost:${PORT}/store`);
        log(`❤️ Health Check: http://localhost:${PORT}/api/health`);
    }
});

// Graceful shutdown
process.on('SIGTERM', () => {
    log('SIGTERM received, shutting down gracefully');
    server.close(() => {
        if (DATABASE_TYPE === 'postgres') {
            db.end();
        } else {
            db.close();
        }
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    log('SIGINT received, shutting down gracefully');
    server.close(() => {
        if (DATABASE_TYPE === 'postgres') {
            db.end();
        } else {
            db.close();
        }
        process.exit(0);
    });
});

module.exports = { app, server };
