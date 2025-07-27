// server.js - Secret Messages Backend with User Authentication
const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
app.set('trust proxy', 1);

// Environment Variables
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const DATABASE_URL = process.env.DATABASE_URL;

// Database Setup
let db, isPostgreSQL = false;

// Middleware
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
            fontSrc: ["'self'", "https://fonts.gstatic.com"],
            scriptSrc: ["'self'"],
            imgSrc: ["'self'", "data:", "https:"],
            connectSrc: ["'self'"]
        }
    }
}));
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Rate Limiting
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    message: 'Zu viele Login-Versuche. Bitte versuchen Sie es später erneut.'
});

const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100
});

app.use('/api/', apiLimiter);
app.use('/api/auth/login', loginLimiter);
app.use('/api/auth/activate', loginLimiter);

// Database initialization
const initializeDatabase = async () => {
    console.log('🔧 Initializing Database...');
    
    if (DATABASE_URL && DATABASE_URL.includes('postgresql')) {
        console.log('📡 PostgreSQL detected');
        isPostgreSQL = true;
        
        try {
            const { Pool } = require('pg');
            db = new Pool({
                connectionString: DATABASE_URL,
                ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
            });
            
            await db.query('SELECT NOW()');
            console.log('✅ PostgreSQL connection successful!');
            
            await createPostgreSQLTables();
            await insertDemoKeys();
            
        } catch (error) {
            console.error('❌ PostgreSQL failed:', error.message);
            console.log('📁 Falling back to SQLite...');
            setupSQLiteDatabase();
        }
    } else {
        console.log('📁 Using SQLite (local)');
        setupSQLiteDatabase();
    }
};

// PostgreSQL table creation
const createPostgreSQLTables = async () => {
    console.log('📊 Creating PostgreSQL tables...');
    
    try {
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
                max_usage INTEGER DEFAULT NULL,
                expires_at TIMESTAMP NULL,
                created_by VARCHAR(100) DEFAULT 'system',
                username VARCHAR(50) UNIQUE,
                access_code_hash VARCHAR(255),
                user_created_at TIMESTAMP,
                last_used_at TIMESTAMP,
                last_used_ip VARCHAR(45)
            )
        `);
        
        await db.query(`
            CREATE TABLE IF NOT EXISTS user_sessions (
                id SERIAL PRIMARY KEY,
                session_token VARCHAR(500) UNIQUE NOT NULL,
                username VARCHAR(50),
                license_key_id INTEGER REFERENCES license_keys(id) ON DELETE CASCADE,
                ip_address VARCHAR(45) NOT NULL,
                user_agent TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                last_activity TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                expires_at TIMESTAMP NOT NULL,
                is_active BOOLEAN DEFAULT TRUE
            )
        `);
        
        await db.query(`
            CREATE TABLE IF NOT EXISTS account_deletions (
                id SERIAL PRIMARY KEY,
                username VARCHAR(50) NOT NULL,
                license_key_code VARCHAR(17) NOT NULL,
                deleted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                deletion_ip VARCHAR(45),
                reason VARCHAR(255) DEFAULT 'user_requested'
            )
        `);
        
        await db.query('CREATE INDEX IF NOT EXISTS idx_license_keys_code ON license_keys(key_code)');
        await db.query('CREATE INDEX IF NOT EXISTS idx_license_keys_username ON license_keys(username)');
        
        console.log('✅ PostgreSQL tables created successfully');
    } catch (error) {
        console.error('❌ Error creating tables:', error);
    }
};

// SQLite setup
const setupSQLiteDatabase = () => {
    isPostgreSQL = false;
    const sqlite3 = require('sqlite3').verbose();
    db = new sqlite3.Database('./secret_messages.db');
    
    db.serialize(() => {
        db.run(`
            CREATE TABLE IF NOT EXISTS license_keys (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                key_code VARCHAR(17) UNIQUE NOT NULL,
                key_hash TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                activated_at DATETIME NULL,
                activated_ip VARCHAR(45) NULL,
                device_fingerprint VARCHAR(255) NULL,
                is_active BOOLEAN DEFAULT 0,
                usage_count INTEGER DEFAULT 0,
                max_usage INTEGER DEFAULT NULL,
                expires_at DATETIME NULL,
                created_by VARCHAR(100) DEFAULT 'system',
                username VARCHAR(50) UNIQUE,
                access_code_hash VARCHAR(255),
                user_created_at DATETIME,
                last_used_at DATETIME,
                last_used_ip VARCHAR(45)
            )
        `);
        
        db.run(`
            CREATE TABLE IF NOT EXISTS user_sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_token VARCHAR(500) UNIQUE NOT NULL,
                username VARCHAR(50),
                license_key_id INTEGER REFERENCES license_keys(id) ON DELETE CASCADE,
                ip_address VARCHAR(45) NOT NULL,
                user_agent TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                last_activity DATETIME DEFAULT CURRENT_TIMESTAMP,
                expires_at DATETIME NOT NULL,
                is_active BOOLEAN DEFAULT 1
            )
        `);
        
        db.run(`
            CREATE TABLE IF NOT EXISTS account_deletions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username VARCHAR(50) NOT NULL,
                license_key_code VARCHAR(17) NOT NULL,
                deleted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                deletion_ip VARCHAR(45),
                reason VARCHAR(255) DEFAULT 'user_requested'
            )
        `);
        
        console.log('✅ SQLite tables created');
    });
};

// Insert demo keys
const insertDemoKeys = async () => {
    try {
        const demoKeys = [
            ['SM001-ALPHA-BETA1', '$2b$10$E1l7eU5lGGn6c6KJxL0pAeJQKqFhGjWKz8YvI0pUfBdMjFsU2xMzm'],
            ['SM002-GAMMA-DELT2', '$2b$10$F2m8fV6mHHo7d7LKyM1qBfKRLrGiHkXLz9ZwJ1qVgCeNkGtV3yN0n'],
            ['SM003-ECHO-FOXTR3', '$2b$10$G3n9gW7nIIp8e8MLzN2rCgLSMsHjIlYMz0AxK2rWhDfOlHuW4zO1o']
        ];
        
        for (const [keyCode, keyHash] of demoKeys) {
            if (isPostgreSQL) {
                await db.query(
                    'INSERT INTO license_keys (key_code, key_hash, created_by) VALUES ($1, $2, $3) ON CONFLICT (key_code) DO NOTHING',
                    [keyCode, keyHash, 'demo']
                );
            }
        }
        console.log('✅ Demo keys inserted');
    } catch (error) {
        console.log('Demo keys might already exist');
    }
};

// Database query helper
const dbQuery = (query, params = []) => {
    if (isPostgreSQL) {
        return db.query(query, params);
    } else {
        return new Promise((resolve, reject) => {
            if (query.toLowerCase().startsWith('select')) {
                db.all(query, params, (err, rows) => {
                    if (err) reject(err);
                    else resolve({ rows });
                });
            } else {
                db.run(query, params, function(err) {
                    if (err) reject(err);
                    else resolve({ rows: [{ id: this.lastID }] });
                });
            }
        });
    }
};

// Initialize database
initializeDatabase();

// ====================================
// API ENDPOINTS
// ====================================

// Health check
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        version: '2.0.0',
        uptime: process.uptime(),
        environment: process.env.NODE_ENV || 'development'
    });
});

// User Login
app.post('/api/auth/login', async (req, res) => {
    const { username, accessCode } = req.body;
    const clientIP = req.ip;
    
    if (!username || !accessCode) {
        return res.status(400).json({ 
            success: false, 
            error: 'Benutzername und Zugangscode erforderlich' 
        });
    }
    
    if (!/^\d{5}$/.test(accessCode)) {
        return res.status(400).json({ 
            success: false, 
            error: 'Zugangscode muss 5 Ziffern enthalten' 
        });
    }
    
    try {
        const userQuery = isPostgreSQL
            ? 'SELECT * FROM license_keys WHERE username = $1 AND is_active = true'
            : 'SELECT * FROM license_keys WHERE username = ? AND is_active = 1';
            
        const result = await dbQuery(userQuery, [username]);
        const user = result.rows[0];
        
        if (!user || !user.access_code_hash) {
            return res.status(401).json({ 
                success: false, 
                error: 'Ungültiger Benutzername oder Zugangscode' 
            });
        }
        
        const isValidCode = await bcrypt.compare(accessCode, user.access_code_hash);
        
        if (!isValidCode) {
            return res.status(401).json({ 
                success: false, 
                error: 'Ungültiger Benutzername oder Zugangscode' 
            });
        }
        
        const token = jwt.sign(
            { 
                username: user.username,
                keyId: user.id,
                licenseKey: user.key_code
            },
            JWT_SECRET,
            { expiresIn: '30d' }
        );
        
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 30);
        
        const sessionQuery = isPostgreSQL
            ? `INSERT INTO user_sessions 
               (session_token, username, license_key_id, ip_address, user_agent, expires_at) 
               VALUES ($1, $2, $3, $4, $5, $6)`
            : `INSERT INTO user_sessions 
               (session_token, username, license_key_id, ip_address, user_agent, expires_at) 
               VALUES (?, ?, ?, ?, ?, ?)`;
               
        await dbQuery(sessionQuery, [
            token,
            username,
            user.id,
            clientIP,
            req.headers['user-agent'] || 'Unknown',
            expiresAt.toISOString()
        ]);
        
        res.json({
            success: true,
            message: 'Anmeldung erfolgreich',
            token,
            username: user.username
        });
        
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Interner Serverfehler' 
        });
    }
});

// License Key Activation
app.post('/api/auth/activate', async (req, res) => {
    const { licenseKey, username, accessCode } = req.body;
    const clientIP = req.ip;
    
    if (!licenseKey || !username || !accessCode) {
        return res.status(400).json({ 
            success: false, 
            error: 'Alle Felder sind erforderlich' 
        });
    }
    
    if (!/^[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}$/.test(licenseKey)) {
        return res.status(400).json({ 
            success: false, 
            error: 'Ungültiges License-Key Format' 
        });
    }
    
    if (!/^[a-zA-Z0-9_-]+$/.test(username) || username.length < 3 || username.length > 20) {
        return res.status(400).json({ 
            success: false, 
            error: 'Benutzername muss 3-20 Zeichen lang sein' 
        });
    }
    
    if (!/^\d{5}$/.test(accessCode)) {
        return res.status(400).json({ 
            success: false, 
            error: 'Zugangscode muss genau 5 Ziffern enthalten' 
        });
    }
    
    try {
        const usernameCheck = await dbQuery(
            isPostgreSQL
                ? 'SELECT id FROM license_keys WHERE username = $1'
                : 'SELECT id FROM license_keys WHERE username = ?',
            [username]
        );
        
        if (usernameCheck.rows && usernameCheck.rows.length > 0) {
            return res.status(409).json({ 
                success: false, 
                error: 'Benutzername bereits vergeben' 
            });
        }
        
        const keyQuery = isPostgreSQL
            ? 'SELECT * FROM license_keys WHERE key_code = $1'
            : 'SELECT * FROM license_keys WHERE key_code = ?';
            
        const result = await dbQuery(keyQuery, [licenseKey]);
        const keyData = result.rows[0];
        
        if (!keyData) {
            return res.status(404).json({ 
                success: false, 
                error: 'License-Key nicht gefunden' 
            });
        }
        
        if (keyData.is_active || keyData.username) {
            return res.status(403).json({ 
                success: false, 
                error: 'License-Key wurde bereits aktiviert' 
            });
        }
        
        const accessCodeHash = await bcrypt.hash(accessCode, 10);
        
        const activateQuery = isPostgreSQL
            ? `UPDATE license_keys 
               SET username = $1, 
                   access_code_hash = $2, 
                   is_active = true, 
                   activated_at = CURRENT_TIMESTAMP,
                   activated_ip = $3,
                   user_created_at = CURRENT_TIMESTAMP
               WHERE id = $4`
            : `UPDATE license_keys 
               SET username = ?, 
                   access_code_hash = ?, 
                   is_active = 1, 
                   activated_at = CURRENT_TIMESTAMP,
                   activated_ip = ?,
                   user_created_at = CURRENT_TIMESTAMP
               WHERE id = ?`;
               
        await dbQuery(activateQuery, [username, accessCodeHash, clientIP, keyData.id]);
        
        res.json({
            success: true,
            message: 'Zugang erfolgreich erstellt!',
            username
        });
        
    } catch (error) {
        console.error('Activation error:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Interner Serverfehler' 
        });
    }
});

// Validate Token
app.post('/api/auth/validate', async (req, res) => {
    const token = req.headers.authorization?.replace('Bearer ', '') || req.body.token;
    
    if (!token) {
        return res.status(401).json({ 
            success: false, 
            valid: false, 
            error: 'Token erforderlich' 
        });
    }
    
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        res.json({
            success: true,
            valid: true,
            username: decoded.username
        });
    } catch (error) {
        res.json({ 
            success: false, 
            valid: false, 
            error: 'Ungültiger Token' 
        });
    }
});

// Logout
app.post('/api/auth/logout', async (req, res) => {
    res.json({ success: true, message: 'Erfolgreich abgemeldet' });
});

// Delete Account
app.delete('/api/auth/delete-account', async (req, res) => {
    const token = req.headers.authorization?.replace('Bearer ', '');
    
    if (!token) {
        return res.status(401).json({ 
            success: false, 
            error: 'Nicht autorisiert' 
        });
    }
    
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const { keyId } = decoded;
        
        const deleteQuery = isPostgreSQL
            ? 'DELETE FROM license_keys WHERE id = $1'
            : 'DELETE FROM license_keys WHERE id = ?';
            
        await dbQuery(deleteQuery, [keyId]);
        
        res.json({
            success: true,
            message: 'Account erfolgreich gelöscht'
        });
        
    } catch (error) {
        console.error('Delete account error:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Fehler beim Löschen des Accounts' 
        });
    }
});

// Admin Stats
app.post('/api/admin/stats', async (req, res) => {
    const { password } = req.body;
    
    if (password !== ADMIN_PASSWORD) {
        return res.status(403).json({ 
            success: false, 
            error: 'Ungültiges Admin-Passwort' 
        });
    }
    
    try {
        const stats = {};
        
        const totalKeys = await dbQuery('SELECT COUNT(*) as count FROM license_keys');
        stats.totalKeys = parseInt(totalKeys.rows[0].count);
        
        const activeUsers = await dbQuery(
            isPostgreSQL
                ? 'SELECT COUNT(*) as count FROM license_keys WHERE is_active = true'
                : 'SELECT COUNT(*) as count FROM license_keys WHERE is_active = 1'
        );
        stats.activeUsers = parseInt(activeUsers.rows[0].count);
        
        stats.activeSessions = 0;
        stats.recentRegistrations = 0;
        
        res.json({ success: true, stats });
        
    } catch (error) {
        console.error('Stats error:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Fehler beim Abrufen der Statistiken' 
        });
    }
});

// List Users
app.post('/api/admin/users', async (req, res) => {
    const { password } = req.body;
    
    if (password !== ADMIN_PASSWORD) {
        return res.status(403).json({ 
            success: false, 
            error: 'Ungültiges Admin-Passwort' 
        });
    }
    
    try {
        const query = isPostgreSQL
            ? 'SELECT key_code, username, is_active, created_at, activated_at FROM license_keys ORDER BY created_at DESC LIMIT 50'
            : 'SELECT key_code, username, is_active, created_at, activated_at FROM license_keys ORDER BY created_at DESC LIMIT 50';
               
        const result = await dbQuery(query);
        
        res.json({
            success: true,
            users: result.rows || []
        });
        
    } catch (error) {
        console.error('List users error:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Fehler beim Abrufen der Benutzerliste' 
        });
    }
});

// Generate Keys
app.post('/api/admin/generate-key', async (req, res) => {
    const { password, quantity = 1 } = req.body;
    
    if (password !== ADMIN_PASSWORD) {
        return res.status(403).json({ 
            success: false, 
            error: 'Ungültiges Admin-Passwort' 
        });
    }
    
    if (quantity > 100) {
        return res.status(400).json({ 
            success: false,
            error: 'Maximum 100 Keys pro Anfrage' 
        });
    }
    
    const keys = [];
    
    try {
        for (let i = 0; i < quantity; i++) {
            const keyPart = () => Math.random().toString(36).substring(2, 7).toUpperCase();
            const keyCode = `SM${i+100}-${keyPart()}-${keyPart()}`;
            const keyHash = await bcrypt.hash(keyCode, 10);
            
            const insertQuery = isPostgreSQL
                ? 'INSERT INTO license_keys (key_code, key_hash, created_by) VALUES ($1, $2, $3)'
                : 'INSERT INTO license_keys (key_code, key_hash, created_by) VALUES (?, ?, ?)';
                
            await dbQuery(insertQuery, [keyCode, keyHash, 'admin']);
            keys.push(keyCode);
        }
        
        res.json({
            success: true,
            keys: keys,
            count: keys.length
        });
        
    } catch (error) {
        console.error('Key generation error:', error);
        res.status(500).json({ 
            success: false,
            error: 'Fehler beim Generieren der Keys' 
        });
    }
});

// Static file serving
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Start server
app.listen(PORT, () => {
    console.log(`🚀 Server läuft auf Port ${PORT}`);
    console.log(`🔐 Admin Panel: http://localhost:${PORT}/admin`);
    console.log(`🏠 Hauptseite: http://localhost:${PORT}`);
});
