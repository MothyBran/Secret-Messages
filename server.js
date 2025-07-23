// server.js - Secret Messages Backend
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const cors = require('cors');
const crypto = require('crypto');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-in-production';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

app.set('trust proxy', 1); // Trust first proxy (Railway)

// Middleware
app.use(helmet());
app.use(cors({
    origin: process.env.FRONTEND_URL || '*',
    credentials: true
}));
app.use(express.json());
app.use(express.static('public'));

// Rate Limiting - DISABLED for Railway deployment
/*
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: 'Too many requests from this IP'
});
app.use(limiter);

// Auth rate limiting also disabled temporarily
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    message: 'Too many authentication attempts'
});
*/

// Database Setup
const db = new sqlite3.Database('./secret_messages.db');

// Initialize Database Tables
db.serialize(() => {
    // License Keys Table
    db.run(`CREATE TABLE IF NOT EXISTS license_keys (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key_code TEXT UNIQUE NOT NULL,
        key_hash TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        activated_at DATETIME NULL,
        activated_ip TEXT NULL,
        device_fingerprint TEXT NULL,
        is_active BOOLEAN DEFAULT 0,
        usage_count INTEGER DEFAULT 0,
        max_usage INTEGER DEFAULT 1,
        expires_at DATETIME NULL,
        metadata TEXT NULL
    )`);

    // Authentication Sessions Table
    db.run(`CREATE TABLE IF NOT EXISTS auth_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_token TEXT UNIQUE NOT NULL,
        key_id INTEGER NOT NULL,
        ip_address TEXT NOT NULL,
        device_fingerprint TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_activity DATETIME DEFAULT CURRENT_TIMESTAMP,
        expires_at DATETIME NOT NULL,
        is_active BOOLEAN DEFAULT 1,
        FOREIGN KEY (key_id) REFERENCES license_keys (id)
    )`);

    // Usage Logs Table
    db.run(`CREATE TABLE IF NOT EXISTS usage_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key_id INTEGER NOT NULL,
        session_id INTEGER NOT NULL,
        action TEXT NOT NULL,
        ip_address TEXT NOT NULL,
        user_agent TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        metadata TEXT NULL,
        FOREIGN KEY (key_id) REFERENCES license_keys (id),
        FOREIGN KEY (session_id) REFERENCES auth_sessions (id)
    )`);

    // Payment Records Table (für zukünftige Integration)
    db.run(`CREATE TABLE IF NOT EXISTS payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        payment_id TEXT UNIQUE NOT NULL,
        key_id INTEGER NOT NULL,
        amount DECIMAL(10,2) NOT NULL,
        currency TEXT DEFAULT 'EUR',
        status TEXT NOT NULL,
        payment_method TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        completed_at DATETIME NULL,
        metadata TEXT NULL,
        FOREIGN KEY (key_id) REFERENCES license_keys (id)
    )`);
});

// Utility Functions
function generateLicenseKey() {
    const parts = [];
    for (let i = 0; i < 3; i++) {
        const part = crypto.randomBytes(3).toString('hex').toUpperCase().substring(0, 5);
        parts.push(part);
    }
    return parts.join('-');
}

function hashKey(key) {
    return bcrypt.hashSync(key, 10);
}

function generateDeviceFingerprint(req) {
    const userAgent = req.headers['user-agent'] || '';
    const acceptLanguage = req.headers['accept-language'] || '';
    const acceptEncoding = req.headers['accept-encoding'] || '';
    
    const fingerprint = crypto.createHash('sha256')
        .update(userAgent + acceptLanguage + acceptEncoding)
        .digest('hex');
    
    return fingerprint;
}

function getClientIP(req) {
    return req.headers['x-forwarded-for'] || 
           req.headers['x-real-ip'] || 
           req.connection.remoteAddress || 
           req.socket.remoteAddress ||
           (req.connection.socket ? req.connection.socket.remoteAddress : null) ||
           '0.0.0.0';
}

// Middleware for authentication
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Access token required' });
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ error: 'Invalid or expired token' });
        }
        req.user = user;
        next();
    });
}

// Admin middleware
function authenticateAdmin(req, res, next) {
    const { password } = req.body;
    if (password !== ADMIN_PASSWORD) {
        return res.status(401).json({ error: 'Admin authentication failed' });
    }
    next();
}

// API Endpoints

// Health Check
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        timestamp: new Date().toISOString(),
        version: '1.0.0'
    });
});

// Generate new license key (Admin only)
app.post('/api/admin/generate-key', authenticateAdmin, (req, res) => {
    const { quantity = 1, expiresIn = null } = req.body;
    
    if (quantity > 100) {
        return res.status(400).json({ error: 'Maximum 100 keys per request' });
    }

    const keys = [];
    let completed = 0;

    for (let i = 0; i < quantity; i++) {
        const keyCode = generateLicenseKey();
        const keyHash = hashKey(keyCode);
        const expiresAt = expiresIn ? new Date(Date.now() + expiresIn * 24 * 60 * 60 * 1000) : null;

        db.run(
            `INSERT INTO license_keys (key_code, key_hash, expires_at) VALUES (?, ?, ?)`,
            [keyCode, keyHash, expiresAt],
            function(err) {
                if (err) {
                    console.error('Error generating key:', err);
                    return;
                }
                
                keys.push({
                    id: this.lastID,
                    key: keyCode,
                    expires_at: expiresAt
                });
                
                completed++;
                if (completed === quantity) {
                    res.json({ 
                        success: true, 
                        keys: keys,
                        generated: quantity 
                    });
                }
            }
        );
    }
});

// Validate and activate license key (Rate limiter removed)
app.post('/api/auth/activate', (req, res) => {
    const { licenseKey } = req.body;
    const clientIP = getClientIP(req);
    const deviceFingerprint = generateDeviceFingerprint(req);

    if (!licenseKey || !/^[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}$/.test(licenseKey)) {
        return res.status(400).json({ error: 'Invalid license key format' });
    }

    // Find the key in database
    db.get(
        `SELECT * FROM license_keys WHERE key_code = ?`,
        [licenseKey],
        (err, keyData) => {
            if (err) {
                console.error('Database error:', err);
                return res.status(500).json({ error: 'Internal server error' });
            }

            if (!keyData) {
                return res.status(404).json({ error: 'License key not found' });
            }

            // Check if key is already activated
            if (keyData.is_active) {
                // Check if same device/IP
                if (keyData.activated_ip === clientIP && keyData.device_fingerprint === deviceFingerprint) {
                    // Generate new session token
                    const sessionToken = jwt.sign(
                        { 
                            keyId: keyData.id, 
                            ip: clientIP, 
                            fingerprint: deviceFingerprint 
                        },
                        JWT_SECRET,
                        { expiresIn: '30d' }
                    );

                    // Create session record
                    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
                    
                    db.run(
                        `INSERT INTO auth_sessions (session_token, key_id, ip_address, device_fingerprint, expires_at) 
                         VALUES (?, ?, ?, ?, ?)`,
                        [sessionToken, keyData.id, clientIP, deviceFingerprint, expiresAt],
                        function(err) {
                            if (err) {
                                console.error('Session creation error:', err);
                                return res.status(500).json({ error: 'Session creation failed' });
                            }

                            res.json({
                                success: true,
                                message: 'Welcome back! Access granted.',
                                token: sessionToken,
                                keyId: keyData.id
                            });
                        }
                    );
                } else {
                    return res.status(403).json({ 
                        error: 'This license key is already bound to another device.' 
                    });
                }
            } else {
                // Check if key has expired
                if (keyData.expires_at && new Date() > new Date(keyData.expires_at)) {
                    return res.status(410).json({ error: 'License key has expired' });
                }

                // Activate the key
                db.run(
                    `UPDATE license_keys 
                     SET is_active = 1, activated_at = CURRENT_TIMESTAMP, activated_ip = ?, 
                         device_fingerprint = ?, usage_count = usage_count + 1 
                     WHERE id = ?`,
                    [clientIP, deviceFingerprint, keyData.id],
                    function(err) {
                        if (err) {
                            console.error('Key activation error:', err);
                            return res.status(500).json({ error: 'Key activation failed' });
                        }

                        // Generate session token
                        const sessionToken = jwt.sign(
                            { 
                                keyId: keyData.id, 
                                ip: clientIP, 
                                fingerprint: deviceFingerprint 
                            },
                            JWT_SECRET,
                            { expiresIn: '30d' }
                        );

                        // Create session record
                        const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
                        
                        db.run(
                            `INSERT INTO auth_sessions (session_token, key_id, ip_address, device_fingerprint, expires_at) 
                             VALUES (?, ?, ?, ?, ?)`,
                            [sessionToken, keyData.id, clientIP, deviceFingerprint, expiresAt],
                            function(err) {
                                if (err) {
                                    console.error('Session creation error:', err);
                                    return res.status(500).json({ error: 'Session creation failed' });
                                }

                                res.json({
                                    success: true,
                                    message: 'License key activated successfully! Access granted.',
                                    token: sessionToken,
                                    keyId: keyData.id
                                });
                            }
                        );
                    }
                );
            }
        }
    );
});

// Validate existing session
app.post('/api/auth/validate', (req, res) => {
    const { token } = req.body;
    const clientIP = getClientIP(req);
    const deviceFingerprint = generateDeviceFingerprint(req);

    if (!token) {
        return res.status(400).json({ error: 'Token required' });
    }

    jwt.verify(token, JWT_SECRET, (err, decoded) => {
        if (err) {
            return res.status(401).json({ error: 'Invalid or expired token' });
        }

        // Verify IP and device fingerprint
        if (decoded.ip !== clientIP || decoded.fingerprint !== deviceFingerprint) {
            return res.status(403).json({ error: 'Device or location changed. Please re-authenticate.' });
        }

        // Check if session exists and is active
        db.get(
            `SELECT s.*, k.key_code FROM auth_sessions s 
             JOIN license_keys k ON s.key_id = k.id 
             WHERE s.session_token = ? AND s.is_active = 1 AND s.expires_at > CURRENT_TIMESTAMP`,
            [token],
            (err, session) => {
                if (err) {
                    console.error('Session validation error:', err);
                    return res.status(500).json({ error: 'Session validation failed' });
                }

                if (!session) {
                    return res.status(401).json({ error: 'Session not found or expired' });
                }

                // Update last activity
                db.run(
                    `UPDATE auth_sessions SET last_activity = CURRENT_TIMESTAMP WHERE id = ?`,
                    [session.id]
                );

                res.json({
                    success: true,
                    valid: true,
                    keyId: session.key_id
                });
            }
        );
    });
});

// Log usage activity
app.post('/api/activity/log', authenticateToken, (req, res) => {
    const { action, metadata } = req.body;
    const clientIP = getClientIP(req);
    const userAgent = req.headers['user-agent'];

    db.run(
        `INSERT INTO usage_logs (key_id, session_id, action, ip_address, user_agent, metadata) 
         VALUES (?, ?, ?, ?, ?, ?)`,
        [req.user.keyId, 1, action, clientIP, userAgent, JSON.stringify(metadata || {})],
        function(err) {
            if (err) {
                console.error('Logging error:', err);
                return res.status(500).json({ error: 'Logging failed' });
            }

            res.json({ success: true, logged: true });
        }
    );
});

// Logout
app.post('/api/auth/logout', (req, res) => {
    const { token } = req.body;

    if (!token) {
        return res.status(400).json({ error: 'Token required' });
    }

    db.run(
        `UPDATE auth_sessions SET is_active = 0 WHERE session_token = ?`,
        [token],
        function(err) {
            if (err) {
                console.error('Logout error:', err);
                return res.status(500).json({ error: 'Logout failed' });
            }

            res.json({ success: true, message: 'Logged out successfully' });
        }
    );
});

// Admin: Get statistics
app.post('/api/admin/stats', authenticateAdmin, (req, res) => {
    const queries = [
        'SELECT COUNT(*) as total_keys FROM license_keys',
        'SELECT COUNT(*) as active_keys FROM license_keys WHERE is_active = 1',
        'SELECT COUNT(*) as active_sessions FROM auth_sessions WHERE is_active = 1 AND expires_at > CURRENT_TIMESTAMP',
        'SELECT COUNT(*) as total_usage FROM usage_logs WHERE timestamp > datetime("now", "-24 hours")'
    ];

    Promise.all(queries.map(query => 
        new Promise((resolve, reject) => {
            db.get(query, (err, result) => {
                if (err) reject(err);
                else resolve(result);
            });
        })
    )).then(results => {
        res.json({
            success: true,
            stats: {
                totalKeys: results[0].total_keys,
                activeKeys: results[1].active_keys,
                activeSessions: results[2].active_sessions,
                dailyUsage: results[3].total_usage
            }
        });
    }).catch(err => {
        console.error('Stats error:', err);
        res.status(500).json({ error: 'Failed to fetch statistics' });
    });
});

// Admin: List keys
app.post('/api/admin/keys', authenticateAdmin, (req, res) => {
    const { page = 1, limit = 50 } = req.body;
    const offset = (page - 1) * limit;

    db.all(
        `SELECT id, key_code, created_at, activated_at, activated_ip, is_active, usage_count, expires_at 
         FROM license_keys 
         ORDER BY created_at DESC 
         LIMIT ? OFFSET ?`,
        [limit, offset],
        (err, keys) => {
            if (err) {
                console.error('Keys listing error:', err);
                return res.status(500).json({ error: 'Failed to fetch keys' });
            }

            db.get('SELECT COUNT(*) as total FROM license_keys', (err, count) => {
                if (err) {
                    console.error('Count error:', err);
                    return res.status(500).json({ error: 'Failed to count keys' });
                }

                res.json({
                    success: true,
                    keys: keys,
                    pagination: {
                        page: page,
                        limit: limit,
                        total: count.total,
                        pages: Math.ceil(count.total / limit)
                    }
                });
            });
        }
    );
});

// Serve frontend
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Error handling
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: 'Something went wrong!' });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({ error: 'Endpoint not found' });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Secret Messages Backend running on port ${PORT}`);
    console.log(`📊 Admin Panel: http://localhost:${PORT}/admin`);
    console.log(`🔐 API Base: http://localhost:${PORT}/api`);
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down gracefully...');
    db.close((err) => {
        if (err) {
            console.error('Error closing database:', err);
        } else {
            console.log('✅ Database closed.');
        }
        process.exit(0);
    });
});
