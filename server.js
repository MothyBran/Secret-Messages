// ================================================================
// SECRET MESSAGES - SERVER.JS MIT KORRIGIERTER CSP
// Behebt CSP-Probleme für inline Event Handler
// ================================================================

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const bcryptjs = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Environment variables
const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-jwt-key-min-32-characters';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'SecureAdmin123!';
const DATABASE_URL = process.env.DATABASE_URL || './secret_messages.db';

// Database setup
let db;
if (DATABASE_URL.startsWith('postgresql') || DATABASE_URL.startsWith('postgres')) {
    const { Pool } = require('pg');
    db = new Pool({
        connectionString: DATABASE_URL,
        ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
    });
    console.log('📊 Using PostgreSQL database');
} else {
    console.error('❌ Only PostgreSQL supported in Railway');
    process.exit(1);
}

// ================================================================
// MIDDLEWARE MIT KORRIGIERTER CSP
// ================================================================

// KORRIGIERTE Security headers - erlaubt inline event handlers
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"], // Erlaubt inline CSS
            scriptSrc: ["'self'", "'unsafe-inline'"], // Erlaubt inline JS
            scriptSrcAttr: ["'unsafe-inline'"], // WICHTIG: Erlaubt onclick="" etc.
            imgSrc: ["'self'", "data:", "https:"],
            fontSrc: ["'self'", "https:", "data:"],
            connectSrc: ["'self'"],
            mediaSrc: ["'self'"],
            objectSrc: ["'none'"],
            childSrc: ["'self'"],
            frameAncestors: ["'none'"],
            formAction: ["'self'"],
            baseUri: ["'self'"]
        },
    },
    crossOriginEmbedderPolicy: false, // Für bessere Kompatibilität
}));

app.use(cors({
    origin: process.env.FRONTEND_URL || '*',
    credentials: true
}));

const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100
});
app.use('/api/', limiter);

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10
});
app.use('/api/auth/', authLimiter);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static('public'));

// ================================================================
// UTILITY FUNCTIONS
// ================================================================

function generateLicenseKey() {
    const parts = [];
    for (let i = 0; i < 3; i++) {
        const part = crypto.randomBytes(3).toString('hex').toUpperCase().substring(0, 5);
        parts.push(part);
    }
    return parts.join('-');
}

function hashKey(key) {
    return bcryptjs.hashSync(key, 10);
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
           '0.0.0.0';
}

async function logActivity(keyId, action, metadata = {}) {
    try {
        const timestamp = new Date().toISOString();
        const metadataString = JSON.stringify({
            ...metadata,
            timestamp: timestamp
        });
        
        await db.query(
            'INSERT INTO activity_logs (key_id, action, metadata, timestamp) VALUES ($1, $2, $3, $4)',
            [keyId, action, metadataString, timestamp]
        );
    } catch (error) {
        console.warn('Activity logging failed:', error.message);
    }
}

// ================================================================
// AUTHENTICATION MIDDLEWARE
// ================================================================

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

function authenticateAdmin(req, res, next) {
    const { password } = req.body;
    if (password !== ADMIN_PASSWORD) {
        return res.status(401).json({ error: 'Admin authentication failed' });
    }
    next();
}

// ================================================================
// API ENDPOINTS
// ================================================================

app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        timestamp: new Date().toISOString(),
        version: '1.0.0',
        database: 'PostgreSQL',
        node_version: process.version
    });
});

// License Key Activation
app.post('/api/auth/activate', async (req, res) => {
    const { licenseKey } = req.body;
    const clientIP = getClientIP(req);
    const deviceFingerprint = generateDeviceFingerprint(req);

    console.log(`🔑 License activation attempt: ${licenseKey} from IP: ${clientIP}`);

    if (!licenseKey || !/^[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}$/.test(licenseKey)) {
        return res.status(400).json({ error: 'Invalid license key format' });
    }

    try {
        const result = await db.query('SELECT * FROM license_keys WHERE key_code = $1', [licenseKey]);
        const keyData = result.rows[0];

        if (!keyData) {
            console.log(`❌ License key not found: ${licenseKey}`);
            return res.status(404).json({ error: 'License key not found' });
        }

        if (keyData.expires_at && new Date(keyData.expires_at) < new Date()) {
            console.log(`❌ License key expired: ${licenseKey}`);
            return res.status(403).json({ error: 'License key has expired' });
        }

        if (keyData.is_active) {
            if (keyData.activated_ip === clientIP && keyData.device_fingerprint === deviceFingerprint) {
                const sessionToken = jwt.sign(
                    { 
                        keyId: keyData.id, 
                        ip: clientIP, 
                        fingerprint: deviceFingerprint,
                        keyCode: licenseKey
                    },
                    JWT_SECRET,
                    { expiresIn: '30d' }
                );

                await logActivity(keyData.id, 'auto_login_success', {
                    ip: clientIP,
                    deviceFingerprint: deviceFingerprint
                });

                console.log(`✅ Returning user auto-login: ${licenseKey}`);
                return res.json({
                    success: true,
                    message: 'Welcome back! Automatic login successful.',
                    token: sessionToken,
                    keyId: keyData.id,
                    autoLogin: true
                });
            } else {
                console.log(`❌ Device binding violation: ${licenseKey} - IP: ${clientIP} vs ${keyData.activated_ip}`);
                return res.status(403).json({ 
                    error: 'This license key is already bound to another device.' 
                });
            }
        }

        const sessionToken = jwt.sign(
            { 
                keyId: keyData.id, 
                ip: clientIP, 
                fingerprint: deviceFingerprint,
                keyCode: licenseKey
            },
            JWT_SECRET,
            { expiresIn: '30d' }
        );

        await db.query(
            'UPDATE license_keys SET is_active = true, activated_at = NOW(), activated_ip = $1, device_fingerprint = $2, usage_count = usage_count + 1 WHERE id = $3',
            [clientIP, deviceFingerprint, keyData.id]
        );

        await logActivity(keyData.id, 'license_activated', {
            ip: clientIP,
            deviceFingerprint: deviceFingerprint,
            firstActivation: true
        });

        console.log(`✅ New license activation successful: ${licenseKey}`);
        res.json({
            success: true,
            message: 'License key activated successfully! Device registered.',
            token: sessionToken,
            keyId: keyData.id,
            autoLogin: false
        });

    } catch (error) {
        console.error('❌ Activation error:', error);
        res.status(500).json({ error: 'Internal server error during activation' });
    }
});

// Token Validation
app.post('/api/auth/validate', async (req, res) => {
    const { token } = req.body;
    
    console.log(`🔍 Token validation request received`);

    if (!token) {
        return res.status(400).json({ 
            success: false, 
            valid: false, 
            error: 'Token required' 
        });
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        console.log(`🔍 JWT decoded successfully for keyId: ${decoded.keyId}`);

        const result = await db.query(
            'SELECT * FROM license_keys WHERE id = $1 AND is_active = true',
            [decoded.keyId]
        );
        const keyData = result.rows[0];

        if (!keyData) {
            console.log(`❌ Key no longer active for keyId: ${decoded.keyId}`);
            return res.status(403).json({ 
                success: false, 
                valid: false, 
                error: 'License key no longer active' 
            });
        }

        if (keyData.expires_at && new Date(keyData.expires_at) < new Date()) {
            console.log(`❌ Key expired for keyId: ${decoded.keyId}`);
            return res.status(403).json({ 
                success: false, 
                valid: false, 
                error: 'License key expired' 
            });
        }

        await logActivity(decoded.keyId, 'session_validated', {
            ip: getClientIP(req),
            timestamp: new Date().toISOString()
        });

        console.log(`✅ Token validation successful for keyId: ${decoded.keyId}`);
        res.json({
            success: true,
            valid: true,
            keyId: decoded.keyId,
            keyCode: keyData.key_code,
            expiresAt: keyData.expires_at
        });

    } catch (error) {
        if (error.name === 'JsonWebTokenError') {
            console.log(`❌ Invalid JWT token: ${error.message}`);
            return res.status(403).json({ 
                success: false, 
                valid: false, 
                error: 'Invalid token' 
            });
        } else if (error.name === 'TokenExpiredError') {
            console.log(`❌ Expired JWT token: ${error.message}`);
            return res.status(403).json({ 
                success: false, 
                valid: false, 
                error: 'Token expired' 
            });
        } else {
            console.error(`❌ Token validation error:`, error);
            return res.status(500).json({ 
                success: false, 
                valid: false, 
                error: 'Internal server error' 
            });
        }
    }
});

// Admin stats
app.post('/api/admin/stats', authenticateAdmin, async (req, res) => {
    try {
        const totalResult = await db.query('SELECT COUNT(*) as count FROM license_keys');
        const activeResult = await db.query('SELECT COUNT(*) as count FROM license_keys WHERE is_active = true');
        const sessionsResult = await db.query('SELECT COUNT(*) as count FROM license_keys WHERE is_active = true AND (expires_at IS NULL OR expires_at > NOW())');
        
        const totalKeys = totalResult.rows[0].count;
        const activeKeys = activeResult.rows[0].count;
        const activeSessions = sessionsResult.rows[0].count;

        res.json({
            success: true,
            stats: {
                totalKeys: parseInt(totalKeys),
                activeKeys: parseInt(activeKeys),
                activeSessions: parseInt(activeSessions),
                dailyUsage: 0
            }
        });
    } catch (error) {
        console.error('Stats error:', error);
        res.status(500).json({ error: 'Failed to fetch stats' });
    }
});

// Generate new license keys
app.post('/api/admin/generate-key', authenticateAdmin, async (req, res) => {
    const { quantity = 1, expiresIn = null } = req.body;
    
    if (quantity > 100) {
        return res.status(400).json({ error: 'Maximum 100 keys per request' });
    }

    const keys = [];
    
    try {
        for (let i = 0; i < quantity; i++) {
            const keyCode = generateLicenseKey();
            const keyHash = hashKey(keyCode);
            const expiresAt = expiresIn ? new Date(Date.now() + expiresIn * 24 * 60 * 60 * 1000) : null;

            const result = await db.query(
                'INSERT INTO license_keys (key_code, key_hash, expires_at, created_by) VALUES ($1, $2, $3, $4) RETURNING id',
                [keyCode, keyHash, expiresAt, 'admin']
            );
            
            keys.push({
                id: result.rows[0].id,
                key: keyCode,
                expires_at: expiresAt
            });
        }
        
        console.log(`✅ Generated ${quantity} new license keys`);
        res.json({ 
            success: true, 
            keys: keys,
            generated: quantity 
        });
    } catch (error) {
        console.error('Key generation error:', error);
        res.status(500).json({ error: 'Key generation failed' });
    }
});

// List license keys with pagination
app.post('/api/admin/keys', authenticateAdmin, async (req, res) => {
    const { page = 1, limit = 50 } = req.body;
    
    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
    const offset = (pageNum - 1) * limitNum;
    
    try {
        const keysResult = await db.query(`
            SELECT id, key_code, created_at, activated_at, activated_ip,
                   device_fingerprint, is_active, usage_count, expires_at,
                   created_by, updated_at
            FROM license_keys 
            ORDER BY created_at DESC 
            LIMIT $1 OFFSET $2
        `, [limitNum, offset]);
        
        const countResult = await db.query('SELECT COUNT(*) as count FROM license_keys');
        
        const keys = keysResult.rows;
        const totalCount = parseInt(countResult.rows[0].count);
        
        const totalPages = Math.ceil(totalCount / limitNum);
        
        res.json({
            success: true,
            keys: keys.map(key => ({
                id: key.id,
                key_code: key.key_code,
                created_at: key.created_at,
                activated_at: key.activated_at || null,
                activated_ip: key.activated_ip || null,
                device_fingerprint: key.device_fingerprint || null,
                is_active: key.is_active ? true : false,
                usage_count: key.usage_count || 0,
                expires_at: key.expires_at || null,
                created_by: key.created_by || 'system',
                updated_at: key.updated_at || key.created_at,
                metadata: null,
                max_usage: null
            })),
            pagination: {
                page: pageNum,
                limit: limitNum,
                total: totalCount,
                pages: totalPages,
                hasNext: pageNum < totalPages,
                hasPrev: pageNum > 1
            }
        });
        
    } catch (error) {
        console.error('❌ Keys listing error:', error);
        res.status(500).json({ 
            error: 'Failed to fetch keys',
            message: error.message
        });
    }
});

// Activity logging endpoint
app.post('/api/activity/log', authenticateToken, async (req, res) => {
    const { action, metadata = {} } = req.body;
    const keyId = req.user.keyId;
    
    try {
        await logActivity(keyId, action, {
            ...metadata,
            ip: getClientIP(req),
            userAgent: req.headers['user-agent']
        });
        
        res.json({
            success: true,
            logged: true
        });
    } catch (error) {
        console.error('Activity logging error:', error);
        res.status(500).json({ error: 'Failed to log activity' });
    }
});

// Logout endpoint
app.post('/api/auth/logout', async (req, res) => {
    const { token } = req.body;
    
    if (token) {
        try {
            const decoded = jwt.verify(token, JWT_SECRET);
            await logActivity(decoded.keyId, 'user_logout', {
                ip: getClientIP(req),
                timestamp: new Date().toISOString()
            });
            console.log(`👋 User logout: keyId ${decoded.keyId}`);
        } catch (error) {
            // Token invalid, but logout anyway
        }
    }
    
    res.json({
        success: true,
        message: 'Logged out successfully'
    });
});

// Error handling
app.use((err, req, res, next) => {
    console.error('Global error:', err);
    res.status(500).json({ 
        error: 'Internal server error',
        message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
    });
});

app.use((req, res) => {
    res.status(404).json({ error: 'Endpoint not found' });
});

// Static file serving
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'Frontend.html'));
});

app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Database initialization
async function initializeDatabase() {
    console.log('🔧 Initializing PostgreSQL database...');
    
    try {
        await db.query(`
            CREATE TABLE IF NOT EXISTS license_keys (
                id SERIAL PRIMARY KEY,
                key_code VARCHAR(17) UNIQUE NOT NULL,
                key_hash VARCHAR(255) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                activated_at TIMESTAMP NULL,
                activated_ip VARCHAR(45) NULL,
                device_fingerprint TEXT NULL,
                is_active BOOLEAN DEFAULT FALSE,
                usage_count INTEGER DEFAULT 0,
                expires_at TIMESTAMP NULL,
                created_by VARCHAR(50) DEFAULT 'system',
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        await db.query(`
            CREATE TABLE IF NOT EXISTS activity_logs (
                id SERIAL PRIMARY KEY,
                key_id INTEGER REFERENCES license_keys(id),
                action VARCHAR(100) NOT NULL,
                metadata JSONB,
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        console.log('✅ PostgreSQL tables ready');
    } catch (error) {
        console.error('❌ PostgreSQL initialization failed:', error);
    }
}

// Server startup
async function startServer() {
    try {
        await initializeDatabase();
        
        const server = app.listen(PORT, () => {
            console.log('🚀 Secret Messages Server running on port ' + PORT);
            console.log('📊 Using PostgreSQL database');
            console.log('🔧 CSP configured for inline event handlers');
            console.log('📱 Frontend: https://' + (process.env.DOMAIN || 'localhost:' + PORT));
            console.log('🔧 Admin Panel: https://' + (process.env.DOMAIN || 'localhost:' + PORT) + '/admin');
        });

        process.on('SIGTERM', () => {
            console.log('🛑 SIGTERM received, shutting down gracefully');
            server.close(() => {
                console.log('💤 Process terminated');
            });
        });

        return server;
    } catch (error) {
        console.error('❌ Server startup failed:', error);
        process.exit(1);
    }
}

startServer();

module.exports = { app };
