// server.js - Secret Messages Backend (Complete Clean Version)
const express = require('express');
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

// Database Setup - RAILWAY POSTGRESQL FIX
let db;
let isPostgreSQL = false;

const initializeDatabase = async () => {
    console.log('🔧 Initializing Database...');
    
    if (process.env.DATABASE_URL && process.env.DATABASE_URL.includes('postgresql')) {
        console.log('📡 Railway PostgreSQL detected');
        isPostgreSQL = true;
        
        try {
            const { Pool } = require('pg');
            db = new Pool({
                connectionString: process.env.DATABASE_URL,
                ssl: { rejectUnauthorized: false }
            });
            
            await db.query('SELECT NOW()');
            console.log('✅ PostgreSQL connection successful!');
            
            await createPostgreSQLTables();
            await insertDemoKeys();
            
            console.log('🎉 PostgreSQL setup completed!');
            
        } catch (error) {
            console.error('❌ PostgreSQL failed:', error.message);
            setupSQLiteDatabase();
        }
    } else {
        console.log('📁 Using SQLite (local)');
        setupSQLiteDatabase();
    }
};

// DATABASE SCHEMA UPDATE für server.js
// Fügen Sie das in die createPostgreSQLTables() Funktion ein:

const createPostgreSQLTables = async () => {
    await db.query(`
        CREATE TABLE IF NOT EXISTS license_keys (
            id SERIAL PRIMARY KEY,
            key_code VARCHAR(17) UNIQUE NOT NULL,
            key_hash TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            activated_at TIMESTAMP NULL,
            activated_ip VARCHAR(45) NULL,
            device_fingerprint VARCHAR(255) NULL,
            is_active BOOLEAN DEFAULT FALSE,
            usage_count INTEGER DEFAULT 0,
            expires_at TIMESTAMP NULL,
            created_by VARCHAR(100) DEFAULT 'system',
            destroyed_at TIMESTAMP NULL,
            destroyed_by_ip VARCHAR(45) NULL,
            metadata TEXT NULL
        )
    `);
    
    // Add missing columns if they don't exist (for existing databases)
    try {
        await db.query(`
            ALTER TABLE license_keys 
            ADD COLUMN IF NOT EXISTS destroyed_at TIMESTAMP NULL,
            ADD COLUMN IF NOT EXISTS destroyed_by_ip VARCHAR(45) NULL
        `);
        console.log('✅ License keys table updated with destroy columns');
    } catch (error) {
        console.log('Destroy columns may already exist:', error.message);
    }
    
    await db.query(`
        CREATE TABLE IF NOT EXISTS auth_sessions (
            id SERIAL PRIMARY KEY,
            session_token VARCHAR(500) UNIQUE NOT NULL,
            key_id INTEGER REFERENCES license_keys(id),
            ip_address VARCHAR(45) NOT NULL,
            device_fingerprint VARCHAR(255),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            expires_at TIMESTAMP NOT NULL,
            is_active BOOLEAN DEFAULT TRUE,
            logout_reason VARCHAR(50) NULL
        )
    `);
    
    await db.query('CREATE INDEX IF NOT EXISTS idx_license_keys_code ON license_keys(key_code)');
    await db.query('CREATE INDEX IF NOT EXISTS idx_license_keys_destroyed ON license_keys(destroyed_at)');
    console.log('✅ PostgreSQL tables created');
};

const insertDemoKeys = async () => {
    try {
        const result = await db.query('SELECT COUNT(*) FROM license_keys');
        if (result.rows[0].count == 0) {
            const demoKeys = [
                ['SM001-ALPHA-BETA1', '$2b$10$E1l7eU5lGGn6c6KJxL0pAeJQKqFhGjWKz8YvI0pUfBdMjFsU2xMzm'],
                ['SM002-GAMMA-DELT2', '$2b$10$F2m8fV6mHHo7d7LKyM1qBfKRLrGiHkXLz9ZwJ1qVgCeNkGtV3yN0n'],
                ['SM003-ECHO-FOXTR3', '$2b$10$G3n9gW7nIIp8e8MLzN2rCgLSMsHjIlYMz0AxK2rWhDfOlHuW4zO1o']
            ];
            
            for (const [keyCode, keyHash] of demoKeys) {
                await db.query(
                    'INSERT INTO license_keys (key_code, key_hash, created_by) VALUES ($1, $2, $3)',
                    [keyCode, keyHash, 'demo']
                );
            }
            console.log('✅ Demo keys inserted');
        }
    } catch (error) {
        console.log('Demo keys info:', error.message);
    }
};

const setupSQLiteDatabase = () => {
    isPostgreSQL = false;
    const sqlite3 = require('sqlite3').verbose();
    db = new sqlite3.Database('./secret_messages.db');
    
    db.serialize(() => {
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
            expires_at DATETIME NULL
        )`);
        
        db.run(`CREATE TABLE IF NOT EXISTS auth_sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_token TEXT UNIQUE NOT NULL,
            key_id INTEGER NOT NULL,
            ip_address TEXT NOT NULL,
            device_fingerprint TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            expires_at DATETIME NOT NULL,
            is_active BOOLEAN DEFAULT 1,
            FOREIGN KEY (key_id) REFERENCES license_keys (id)
        )`);
        
        const demoKeys = ['SM001-ALPHA-BETA1', 'SM002-GAMMA-DELT2', 'SM003-ECHO-FOXTR3'];
        demoKeys.forEach(key => {
            const hash = bcrypt.hashSync(key.split('-')[2], 10);
            db.run('INSERT OR IGNORE INTO license_keys (key_code, key_hash) VALUES (?, ?)', [key, hash]);
        });
        
        console.log('✅ SQLite setup completed');
    });
};

// Initialize database
initializeDatabase();

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
           '0.0.0.0';
}

// Database query helper
const dbQuery = async (query, params = []) => {
    if (isPostgreSQL) {
        return await db.query(query, params);
    } else {
        return new Promise((resolve, reject) => {
            if (query.toLowerCase().includes('select')) {
                db.get(query, params, (err, row) => {
                    if (err) reject(err);
                    else resolve({ rows: row ? [row] : [] });
                });
            } else {
                db.run(query, params, function(err) {
                    if (err) reject(err);
                    else resolve({ lastID: this.lastID, changes: this.changes });
                });
            }
        });
    }
};

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
        version: '1.0.0',
        database: isPostgreSQL ? 'PostgreSQL' : 'SQLite'
    });
});

// Generate new license key (Admin only)
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

            if (isPostgreSQL) {
                const result = await db.query(
                    'INSERT INTO license_keys (key_code, key_hash, expires_at) VALUES ($1, $2, $3) RETURNING id',
                    [keyCode, keyHash, expiresAt]
                );
                keys.push({
                    id: result.rows[0].id,
                    key: keyCode,
                    expires_at: expiresAt
                });
            } else {
                const result = await dbQuery(
                    'INSERT INTO license_keys (key_code, key_hash, expires_at) VALUES (?, ?, ?)',
                    [keyCode, keyHash, expiresAt]
                );
                keys.push({
                    id: result.lastID,
                    key: keyCode,
                    expires_at: expiresAt
                });
            }
        }
        
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

// Validate and activate license key
app.post('/api/auth/activate', async (req, res) => {
    const { licenseKey } = req.body;
    const clientIP = getClientIP(req);
    const deviceFingerprint = generateDeviceFingerprint(req);

    if (!licenseKey || !/^[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}$/.test(licenseKey)) {
        return res.status(400).json({ error: 'Invalid license key format' });
    }

    try {
        // Find the key in database
        let keyData;
        if (isPostgreSQL) {
            const result = await db.query('SELECT * FROM license_keys WHERE key_code = $1', [licenseKey]);
            keyData = result.rows[0];
        } else {
            const result = await dbQuery('SELECT * FROM license_keys WHERE key_code = ?', [licenseKey]);
            keyData = result.rows[0];
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

                return res.json({
                    success: true,
                    message: 'Welcome back! Access granted.',
                    token: sessionToken,
                    keyId: keyData.id
                });
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
            if (isPostgreSQL) {
                await db.query(
                    'UPDATE license_keys SET is_active = true, activated_at = NOW(), activated_ip = $1, device_fingerprint = $2, usage_count = usage_count + 1 WHERE id = $3',
                    [clientIP, deviceFingerprint, keyData.id]
                );
            } else {
                await dbQuery(
                    'UPDATE license_keys SET is_active = 1, activated_at = CURRENT_TIMESTAMP, activated_ip = ?, device_fingerprint = ?, usage_count = usage_count + 1 WHERE id = ?',
                    [clientIP, deviceFingerprint, keyData.id]
                );
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
            
            if (isPostgreSQL) {
                await db.query(
                    'INSERT INTO auth_sessions (session_token, key_id, ip_address, device_fingerprint, expires_at) VALUES ($1, $2, $3, $4, $5)',
                    [sessionToken, keyData.id, clientIP, deviceFingerprint, expiresAt]
                );
            } else {
                await dbQuery(
                    'INSERT INTO auth_sessions (session_token, key_id, ip_address, device_fingerprint, expires_at) VALUES (?, ?, ?, ?, ?)',
                    [sessionToken, keyData.id, clientIP, deviceFingerprint, expiresAt.toISOString()]
                );
            }

            res.json({
                success: true,
                message: 'License key activated successfully! Welcome to Secret Messages.',
                token: sessionToken,
                keyId: keyData.id
            });
        }
    } catch (error) {
        console.error('Activation error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Validate session token
app.post('/api/auth/validate', async (req, res) => {
    const { token } = req.body;
    
    if (!token) {
        return res.status(400).json({ error: 'Token required' });
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        
        // Check if session exists and is active
        let sessionData;
        if (isPostgreSQL) {
            const result = await db.query(
                'SELECT * FROM auth_sessions WHERE session_token = $1 AND is_active = true AND expires_at > NOW()',
                [token]
            );
            sessionData = result.rows[0];
        } else {
            const result = await dbQuery(
                'SELECT * FROM auth_sessions WHERE session_token = ? AND is_active = 1 AND expires_at > datetime("now")',
                [token]
            );
            sessionData = result.rows[0];
        }

        if (!sessionData) {
            return res.status(403).json({ error: 'Invalid or expired session' });
        }

        res.json({
            success: true,
            valid: true,
            keyId: decoded.keyId
        });
    } catch (error) {
        res.status(403).json({ error: 'Invalid token' });
    }
});

// Admin stats
app.post('/api/admin/stats', authenticateAdmin, async (req, res) => {
    try {
        let totalKeys, activeKeys, activeSessions;
        
        if (isPostgreSQL) {
            const totalResult = await db.query('SELECT COUNT(*) as count FROM license_keys');
            const activeResult = await db.query('SELECT COUNT(*) as count FROM license_keys WHERE is_active = true');
            const sessionsResult = await db.query('SELECT COUNT(*) as count FROM auth_sessions WHERE is_active = true AND expires_at > NOW()');
            
            totalKeys = totalResult.rows[0].count;
            activeKeys = activeResult.rows[0].count;
            activeSessions = sessionsResult.rows[0].count;
        } else {
            const totalResult = await dbQuery('SELECT COUNT(*) as count FROM license_keys');
            const activeResult = await dbQuery('SELECT COUNT(*) as count FROM license_keys WHERE is_active = 1');
            const sessionsResult = await dbQuery('SELECT COUNT(*) as count FROM auth_sessions WHERE is_active = 1 AND expires_at > datetime("now")');
            
            totalKeys = totalResult.rows[0].count;
            activeKeys = activeResult.rows[0].count;
            activeSessions = sessionsResult.rows[0].count;
        }

        res.json({
            success: true,
            stats: {
                totalKeys: parseInt(totalKeys),
                activeKeys: parseInt(activeKeys),
                activeSessions: parseInt(activeSessions),
                dailyUsage: 0 // Placeholder
            }
        });
    } catch (error) {
        console.error('Stats error:', error);
        res.status(500).json({ error: 'Failed to fetch stats' });
    }
});

// BACKEND ERGÄNZUNG für server.js
// Fügen Sie diese neuen Endpoints NACH den bestehenden API-Routes ein:

// Unwiderruflich Key vernichten
app.post('/api/auth/destroy-key', async (req, res) => {
    const { token } = req.body;
    const clientIP = getClientIP(req);
    const deviceFingerprint = generateDeviceFingerprint(req);
    
    if (!token) {
        return res.status(400).json({ error: 'Token required' });
    }

    try {
        // Token validieren
        const decoded = jwt.verify(token, JWT_SECRET);
        const keyId = decoded.keyId;
        
        console.log(`🗑️ Key destruction request - KeyID: ${keyId}, IP: ${clientIP}`);
        
        // Prüfen ob Key zu diesem Gerät gehört
        let keyData;
        if (isPostgreSQL) {
            const result = await db.query(
                'SELECT * FROM license_keys WHERE id = $1 AND activated_ip = $2 AND device_fingerprint = $3 AND is_active = true',
                [keyId, clientIP, deviceFingerprint]
            );
            keyData = result.rows[0];
        } else {
            const result = await dbQuery(
                'SELECT * FROM license_keys WHERE id = ? AND activated_ip = ? AND device_fingerprint = ? AND is_active = 1',
                [keyId, clientIP, deviceFingerprint]
            );
            keyData = result.rows[0];
        }

        if (!keyData) {
            return res.status(403).json({ 
                error: 'Key nicht gefunden oder gehört nicht zu diesem Gerät' 
            });
        }

        // Beginne Transaktion für atomare Operation
        if (isPostgreSQL) {
            await db.query('BEGIN');
            
            try {
                // 1. Key als "destroyed" markieren und deaktivieren
                await db.query(`
                    UPDATE license_keys 
                    SET is_active = false, 
                        destroyed_at = NOW(), 
                        destroyed_by_ip = $1,
                        metadata = COALESCE(metadata, '') || ' | DESTROYED_BY_USER' 
                    WHERE id = $2
                `, [clientIP, keyId]);
                
                // 2. Alle Sessions für diesen Key deaktivieren
                await db.query(`
                    UPDATE auth_sessions 
                    SET is_active = false, 
                        logout_reason = 'KEY_DESTROYED'
                    WHERE key_id = $1
                `, [keyId]);
                
                // 3. Log-Eintrag für die Vernichtung
                await db.query(`
                    INSERT INTO usage_logs (key_id, action, ip_address, user_agent, metadata) 
                    VALUES ($1, $2, $3, $4, $5)
                `, [
                    keyId, 
                    'KEY_DESTROYED', 
                    clientIP, 
                    req.headers['user-agent'] || 'Unknown',
                    JSON.stringify({
                        timestamp: new Date().toISOString(),
                        device_fingerprint: deviceFingerprint,
                        reason: 'USER_REQUESTED_DESTRUCTION'
                    })
                ]);
                
                await db.query('COMMIT');
                console.log(`✅ Key ${keyData.key_code} successfully destroyed`);
                
            } catch (error) {
                await db.query('ROLLBACK');
                throw error;
            }
            
        } else {
            // SQLite Version
            await dbQuery(`
                UPDATE license_keys 
                SET is_active = 0, 
                    metadata = COALESCE(metadata, '') || ' | DESTROYED_' || datetime('now') 
                WHERE id = ?
            `, [keyId]);
            
            await dbQuery(`
                UPDATE auth_sessions 
                SET is_active = 0 
                WHERE key_id = ?
            `, [keyId]);
        }

        res.json({
            success: true,
            message: 'Zugang unwiderruflich gelöscht',
            destroyed_key: keyData.key_code.substring(0, 8) + '***', // Nur erste 8 Zeichen zeigen
            warning: 'Dieser Lizenz-Key kann nie wieder verwendet werden.'
        });

    } catch (error) {
        console.error('Key destruction error:', error);
        
        if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
            return res.status(403).json({ error: 'Ungültiger oder abgelaufener Token' });
        }
        
        return res.status(500).json({ error: 'Fehler beim Löschen des Zugangs' });
    }
});

// Admin-Endpoint: Gelöschte Keys anzeigen
app.post('/api/admin/destroyed-keys', authenticateAdmin, async (req, res) => {
    try {
        let destroyedKeys;
        
        if (isPostgreSQL) {
            const result = await db.query(`
                SELECT 
                    key_code,
                    activated_at,
                    destroyed_at,
                    activated_ip,
                    destroyed_by_ip,
                    usage_count
                FROM license_keys 
                WHERE destroyed_at IS NOT NULL 
                ORDER BY destroyed_at DESC 
                LIMIT 50
            `);
            destroyedKeys = result.rows;
        } else {
            const result = await dbQuery(`
                SELECT 
                    key_code,
                    activated_at,
                    usage_count,
                    metadata
                FROM license_keys 
                WHERE metadata LIKE '%DESTROYED%' 
                ORDER BY id DESC 
                LIMIT 50
            `);
            destroyedKeys = result.rows;
        }

        res.json({
            success: true,
            destroyed_keys: destroyedKeys,
            count: destroyedKeys.length
        });

    } catch (error) {
        console.error('Destroyed keys fetch error:', error);
        res.status(500).json({ error: 'Fehler beim Abrufen der gelöschten Keys' });
    }
});

// Statistiken um vernichtete Keys erweitern
app.post('/api/admin/enhanced-stats', authenticateAdmin, async (req, res) => {
    try {
        let stats = {};
        
        if (isPostgreSQL) {
            const queries = await Promise.all([
                db.query('SELECT COUNT(*) as count FROM license_keys'),
                db.query('SELECT COUNT(*) as count FROM license_keys WHERE is_active = true'),
                db.query('SELECT COUNT(*) as count FROM license_keys WHERE destroyed_at IS NOT NULL'),
                db.query('SELECT COUNT(*) as count FROM auth_sessions WHERE is_active = true AND expires_at > NOW()'),
                db.query('SELECT COUNT(*) as count FROM usage_logs WHERE action = \'KEY_DESTROYED\' AND timestamp > NOW() - INTERVAL \'24 hours\'')
            ]);
            
            stats = {
                totalKeys: parseInt(queries[0].rows[0].count),
                activeKeys: parseInt(queries[1].rows[0].count),
                destroyedKeys: parseInt(queries[2].rows[0].count),
                activeSessions: parseInt(queries[3].rows[0].count),
                dailyDestructions: parseInt(queries[4].rows[0].count)
            };
        } else {
            const queries = await Promise.all([
                dbQuery('SELECT COUNT(*) as count FROM license_keys'),
                dbQuery('SELECT COUNT(*) as count FROM license_keys WHERE is_active = 1'),
                dbQuery('SELECT COUNT(*) as count FROM license_keys WHERE metadata LIKE \'%DESTROYED%\''),
                dbQuery('SELECT COUNT(*) as count FROM auth_sessions WHERE is_active = 1')
            ]);
            
            stats = {
                totalKeys: queries[0].rows[0].count,
                activeKeys: queries[1].rows[0].count,
                destroyedKeys: queries[2].rows[0].count,
                activeSessions: queries[3].rows[0].count,
                dailyDestructions: 0 // SQLite limitation
            };
        }

        res.json({
            success: true,
            stats: stats
        });

    } catch (error) {
        console.error('Enhanced stats error:', error);
        res.status(500).json({ error: 'Fehler beim Abrufen der Statistiken' });
    }
});

// Serve static files
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'Frontend.html'));
});

app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Start server
const server = app.listen(PORT, () => {
    console.log(`🚀 Secret Messages Server running on port ${PORT}`);
    console.log(`📱 Frontend: http://localhost:${PORT}`);
    console.log(`🔧 Admin Panel: http://localhost:${PORT}/admin`);
    console.log(`🔑 Test Key: SM001-ALPHA-BETA1`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('🛑 SIGTERM received, shutting down gracefully');
    server.close(() => {
        console.log('💤 Process terminated');
    });
});

module.exports = { app, server };
