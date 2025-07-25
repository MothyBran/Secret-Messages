// ================================================================
// FIXED SERVER.JS FÜR RAILWAY DEPLOYMENT
// ================================================================

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

// FLEXIBLES BCRYPT - Versucht bcryptjs, dann bcrypt
let bcrypt;
try {
    bcrypt = require('bcryptjs');
    console.log('✅ Using bcryptjs');
} catch (error) {
    try {
        bcrypt = require('bcrypt');
        console.log('✅ Using bcrypt');
    } catch (error2) {
        console.error('❌ Neither bcryptjs nor bcrypt available');
        process.exit(1);
    }
}

const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Environment variables
const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-jwt-key-min-32-characters';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'SecureAdmin123!';
const DATABASE_URL = process.env.DATABASE_URL;

// ================================================================
// RAILWAY DATABASE SETUP - NUR POSTGRESQL
// ================================================================

let db;
if (!DATABASE_URL) {
    console.error('❌ DATABASE_URL environment variable is required');
    process.exit(1);
}

if (DATABASE_URL.startsWith('postgresql') || DATABASE_URL.startsWith('postgres')) {
    const { Pool } = require('pg');
    db = new Pool({
        connectionString: DATABASE_URL,
        ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
        max: 20,
        min: 5,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 10000
    });
    console.log('✅ PostgreSQL database configured');
} else {
    console.error('❌ Only PostgreSQL supported on Railway');
    console.error('Current DATABASE_URL:', DATABASE_URL?.substring(0, 20) + '...');
    process.exit(1);
}

// ================================================================
// MIDDLEWARE
// ================================================================

app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            scriptSrc: ["'self'", "'unsafe-inline'"],
            scriptSrcAttr: ["'unsafe-inline'"],
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
    crossOriginEmbedderPolicy: false,
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
        bcrypt_library: bcrypt.name || 'bcrypt',
        node_version: process.version,
        environment: process.env.NODE_ENV || 'development'
    });
});

// License Key Activation
app.post('/api/auth/activate', async (req, res) => {
    const { licenseKey } = req.body;
    const clientIP = getClientIP(req);
    const deviceFingerprint = generateDeviceFingerprint(req);

    console.log(`🔑 License activation attempt: ${licenseKey} from IP: ${clientIP}`);

    if (!licenseKey || licenseKey.length !== 17) {
        return res.status(400).json({ error: 'Invalid license key format' });
    }

    try {
        const result = await db.query(
            'SELECT * FROM license_keys WHERE key_code = $1',
            [licenseKey]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'License key not found' });
        }
        
        const key = result.rows[0];
        
        if (!bcrypt.compareSync(licenseKey, key.key_hash)) {
            return res.status(401).json({ error: 'Invalid license key' });
        }
        
        if (key.is_active && key.activated_ip !== clientIP) {
            return res.status(409).json({ error: 'License key already activated on different device' });
        }
        
        if (key.expires_at && new Date(key.expires_at) < new Date()) {
            return res.status(410).json({ error: 'License key has expired' });
        }
        
        // Activate the key
        await db.query(
            'UPDATE license_keys SET is_active = TRUE, activated_at = CURRENT_TIMESTAMP, activated_ip = $1, device_fingerprint = $2 WHERE id = $3',
            [clientIP, deviceFingerprint, key.id]
        );
        
        // Generate JWT token
        const token = jwt.sign(
            { keyId: key.id, keyCode: licenseKey },
            JWT_SECRET,
            { expiresIn: '24h' }
        );
        
        await logActivity(key.id, 'license_activated', { ip: clientIP, deviceFingerprint });
        
        console.log(`✅ License activated: ${licenseKey}`);
        
        res.json({
            success: true,
            token,
            message: 'License key activated successfully',
            keyInfo: {
                keyCode: key.key_code,
                activatedAt: new Date().toISOString(),
                usageCount: key.usage_count || 0
            }
        });
        
    } catch (error) {
        console.error('❌ License activation error:', error);
        res.status(500).json({ error: 'Activation failed', message: error.message });
    }
});

// Generate demo license key
app.post('/api/demo/generate', async (req, res) => {
    try {
        const demoKey = generateLicenseKey();
        const hashedKey = hashKey(demoKey);
        
        await db.query(
            'INSERT INTO license_keys (key_code, key_hash, created_by) VALUES ($1, $2, $3)',
            [demoKey, hashedKey, 'demo']
        );
        
        console.log(`🎯 Demo key generated: ${demoKey}`);
        
        res.json({
            success: true,
            licenseKey: demoKey,
            message: 'Demo license key generated'
        });
        
    } catch (error) {
        console.error('❌ Demo key generation error:', error);
        res.status(500).json({ error: 'Failed to generate demo key' });
    }
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
        // Test connection
        await db.query('SELECT NOW()');
        console.log('✅ Database connection successful');
        
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
        throw error;
    }
}

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

// ================================================================
// SERVER STARTUP - RAILWAY FIX
// ================================================================

async function startServer() {
    try {
        await initializeDatabase();
        
        // WICHTIG: Railway benötigt '0.0.0.0' als Host
        const server = app.listen(PORT, '0.0.0.0', () => {
            console.log('🚀 Secret Messages Server running on port ' + PORT);
            console.log('🌐 Server listening on 0.0.0.0:' + PORT);
            console.log('📊 Using PostgreSQL database');
            console.log('🔐 Using bcrypt library:', bcrypt.name || 'bcrypt');
            console.log('🌍 Environment:', process.env.NODE_ENV || 'development');
            console.log('📱 Frontend: https://' + (process.env.RAILWAY_PUBLIC_DOMAIN || 'localhost:' + PORT));
            console.log('🔧 Admin Panel: https://' + (process.env.RAILWAY_PUBLIC_DOMAIN || 'localhost:' + PORT) + '/admin');
        });

        // Graceful shutdown
        process.on('SIGTERM', () => {
            console.log('🛑 SIGTERM received, shutting down gracefully');
            server.close(() => {
                console.log('💤 Process terminated');
                process.exit(0);
            });
        });

        process.on('SIGINT', () => {
            console.log('🛑 SIGINT received, shutting down gracefully');
            server.close(() => {
                console.log('💤 Process terminated');
                process.exit(0);
            });
        });

        return server;
    } catch (error) {
        console.error('❌ Server startup failed:', error);
        process.exit(1);
    }
}

// Unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    process.exit(1);
});

// Uncaught exceptions
process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    process.exit(1);
});

startServer();

// ====== TEMPORÄRER SETUP ENDPOINT - NACH SETUP ENTFERNEN! ======
app.get('/api/emergency-setup', async (req, res) => {
    try {
        console.log('🚨 Emergency Database Setup gestartet...');
        
        // Demo Keys erstellen
        const demoKeys = [
            'SM001-ALPHA-BETA1',
            'SM002-GAMMA-DELT2', 
            'SM003-ECHO-FOXTR3',
            'SM004-HOTEL-INDI4',
            'SM005-JULIET-KILO5'
        ];

        let createdKeys = 0;
        for (const keyCode of demoKeys) {
            const keyHash = hashKey(keyCode);
            
            try {
                await db.query(`
                    INSERT INTO license_keys (key_code, key_hash, created_by, is_active) 
                    VALUES ($1, $2, 'emergency-setup', false)
                    ON CONFLICT (key_code) DO NOTHING
                `, [keyCode, keyHash]);
                createdKeys++;
            } catch (error) {
                // Key bereits vorhanden
            }
        }

        // System Settings Tabelle erstellen falls nicht vorhanden
        try {
            await db.query(`
                CREATE TABLE IF NOT EXISTS system_settings (
                    id SERIAL PRIMARY KEY,
                    key_name VARCHAR(100) UNIQUE NOT NULL,
                    key_value TEXT,
                    description TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            `);
        } catch (error) {
            // Tabelle bereits vorhanden
        }

        // Admin Settings mit korrektem Passwort
        const adminPassword = 'SecretMsg2024Admin987'; // Ihr gesetztes Passwort
        const adminHash = bcrypt.hashSync(adminPassword, 10);
        
        await db.query(`
            INSERT INTO system_settings (key_name, key_value, description) 
            VALUES ('admin_password_hash', $1, 'Admin panel password hash')
            ON CONFLICT (key_name) DO UPDATE SET 
                key_value = EXCLUDED.key_value,
                updated_at = CURRENT_TIMESTAMP
        `, [adminHash]);

        await db.query(`
            INSERT INTO system_settings (key_name, key_value, description) 
            VALUES ('setup_completed', $1, 'Emergency setup completion')
            ON CONFLICT (key_name) DO UPDATE SET 
                key_value = EXCLUDED.key_value,
                updated_at = CURRENT_TIMESTAMP
        `, [new Date().toISOString()]);

        // Verifikation
        const keyCount = await db.query('SELECT COUNT(*) as count FROM license_keys');
        const settingsCount = await db.query('SELECT COUNT(*) as count FROM system_settings');

        res.json({
            success: true,
            message: 'Emergency Database Setup erfolgreich!',
            data: {
                totalKeys: keyCount.rows[0].count,
                newKeysCreated: createdKeys,
                settingsCount: settingsCount.rows[0].count,
                adminPassword: adminPassword,
                demoKeys: demoKeys,
                nextSteps: [
                    'Testen Sie Demo Key: SM001-ALPHA-BETA1',
                    'Admin Panel: /admin',
                    'WICHTIG: Entfernen Sie /api/emergency-setup nach dem Test!'
                ]
            }
        });

        console.log('✅ Emergency Setup erfolgreich abgeschlossen');

    } catch (error) {
        console.error('❌ Emergency Setup fehlgeschlagen:', error);
        res.status(500).json({
            success: false,
            error: 'Emergency Setup fehlgeschlagen',
            details: error.message
        });
    }
});
// ====== ENDE TEMPORÄRER ENDPOINT ======

module.exports = { app };
