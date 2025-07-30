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
app.use((req, res, next) => {
    console.log("Client-IP:", req.ip);
    next();
});

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
    message: 'Zu viele Login-Versuche. Bitte versuchen Sie es später erneut.',
    keyGenerator: (req) => req.headers['x-forwarded-for'] || req.ip
});

const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    keyGenerator: (req) => req.headers['x-forwarded-for'] || req.ip
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
        await db.query("ALTER TABLE license_keys ADD COLUMN IF NOT EXISTS product_code VARCHAR(16) NULL");
        
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
        
        try { db.run(`ALTER TABLE license_keys ADD COLUMN product_code TEXT NULL`); } catch(_) {}
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
    
    if (!/^[A-Z0-9_-]{5}-[A-Z0-9_-]{5}-[A-Z0-9_-]{5}$/.test(licenseKey)) {
        return res.status(400).json({ 
            success: false, 
            error: 'Ungültiges License-Key Format' 
        });
    }
    
    if (!/^[a-zA-Z0-9._-]{3,20}$/.test(username)) {
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

// Aktivitäts-Logging
app.post('/api/activity/log', (req, res) => {
    const { user, action } = req.body;
    console.log(`[Aktivität] ${user || 'Unbekannt'} hat Aktion ausgeführt: ${action}`);
    res.status(200).json({ message: 'Aktivität protokolliert.' });
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

// Admin purchases
app.post('/api/admin/purchases', async (req, res) => {
  const { password } = req.body;

  if (password !== ADMIN_PASSWORD) {
    return res.status(403).json({ success: false, error: "Zugriff verweigert" });
  }

  try {
    const result = await dbQuery("SELECT buyer, license, price, date FROM purchases ORDER BY date DESC LIMIT 100");
    res.json({ success: true, purchases: result.rows });
  } catch (err) {
    console.error("Fehler bei /purchases:", err);
    res.status(500).json({ success: false, error: "Datenbankfehler" });
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
            const keyPart = () => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-';
    let part = '';
    for (let j = 0; j < 5; j++) {
        part += chars[Math.floor(Math.random() * chars.length)];
    }
    return part;
};
const keyCode = `${keyPart()}-${keyPart()}-${keyPart()}`;
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


// ===== Admin: USERS (only registered) =====

app.post('/api/admin/users', async (req, res) => {
  const { password, page = 1, limit = 50 } = req.body || {};
  if (password !== ADMIN_PASSWORD) {
    return res.status(403).json({ success: false, error: 'Ungültiges Admin-Passwort' });
  }
  try {
    const pageNum = Math.max(1, Number(page));
    const limitNum = Math.max(1, Number(limit));
    const offset = (pageNum - 1) * limitNum;

    // Robust query: LEFT JOIN user_sessions, aggregate last_login with MAX()
    const sql = isPostgreSQL
      ? `SELECT lk.id,
                 lk.key_code,
                 lk.username,
                 lk.is_active,
                 lk.activated_at,
                 lk.last_used_at,
                 MAX(us.last_activity) AS last_login
          FROM license_keys lk
          LEFT JOIN user_sessions us
            ON us.license_key_id = lk.id
           AND us.is_active = TRUE
          WHERE lk.username IS NOT NULL
            AND COALESCE(TRIM(lk.username), '') <> ''
          GROUP BY lk.id, lk.key_code, lk.username, lk.is_active, lk.activated_at, lk.last_used_at
          ORDER BY COALESCE(MAX(us.last_activity), lk.activated_at, lk.created_at) DESC
          LIMIT $1 OFFSET $2`
      : `SELECT lk.id,
                 lk.key_code,
                 lk.username,
                 lk.is_active,
                 lk.activated_at,
                 lk.last_used_at,
                 MAX(us.last_activity) AS last_login
          FROM license_keys lk
          LEFT JOIN user_sessions us
            ON us.license_key_id = lk.id
           AND us.is_active = 1
          WHERE lk.username IS NOT NULL
            AND TRIM(lk.username) <> ''
          GROUP BY lk.id, lk.key_code, lk.username, lk.is_active, lk.activated_at, lk.last_used_at
          ORDER BY datetime(COALESCE(MAX(us.last_activity), lk.activated_at, lk.created_at)) DESC
          LIMIT ? OFFSET ?`;

    const result = await dbQuery(sql, [limitNum, offset]);
    res.json({ success: true, users: result.rows || [] });
  } catch (error) {
    console.error('List users error:', error);
    res.status(500).json({ success: false, error: 'Serverfehler' });
  }
});

// ===== Admin: LICENSE KEYS (status + filter + product_code) =====
app.post('/api/admin/license-keys', async (req, res) => {
  try {
    const { password, page = 1, limit = 100, status = 'all' } = req.body || {};
    if (password !== ADMIN_PASSWORD) {
      return res.status(403).json({ success: false, error: 'Ungültiges Admin-Passwort' });
    }

    const pageNum = Math.max(1, Number(page));
    const limitNum = Math.max(1, Number(limit));
    const offset = (pageNum - 1) * limitNum;

    const selectSql = isPostgreSQL
      ? `SELECT id, key_code, created_at, activated_at, expires_at, is_active, username, product_code
         FROM license_keys
         ORDER BY created_at DESC
         LIMIT $1 OFFSET $2`
      : `SELECT id, key_code, created_at, activated_at, expires_at, is_active, username, product_code
         FROM license_keys
         ORDER BY datetime(created_at) DESC
         LIMIT ? OFFSET ?`;

    const result = await dbQuery(selectSql, [limitNum, offset]);
    const rows = result.rows || [];

    const toIso = (v) => {
      if (!v) return null;
      const d = (v instanceof Date) ? v : new Date(v);
      return isNaN(d.getTime()) ? null : d.toISOString();
    };
    const nowMs = Date.now();

    let keys = rows.map(r => {
      const createdAt = toIso(r.created_at);
      const expiresAt = toIso(r.expires_at);
      const activatedAt = toIso(r.activated_at);
      const isActive = !!(isPostgreSQL ? r.is_active : Number(r.is_active) === 1);

      let st = 'active';
      if (expiresAt && new Date(expiresAt).getTime() <= nowMs) st = 'expired';
      else if (!isActive && activatedAt) st = 'blocked';
      else if (!activatedAt) st = 'inactive';

      let remaining_days = '—';
      if (expiresAt) {
        const diffDays = Math.ceil((new Date(expiresAt).getTime() - nowMs) / (1000 * 60 * 60 * 24));
        remaining_days = (diffDays >= 0) ? `${diffDays} Tage` : '0 Tage';
      }

      return {
        id: r.id,
        key_code: r.key_code,
        created_at: createdAt,
        expires_at: expiresAt,
        activated_at: activatedAt,
        is_active: isActive,
        username: r.username || null,
        product_code: r.product_code || null,
        status: st,
        remaining_days
      };
    });

    // Filter
    keys = keys.filter(k => {
      if (status === 'active') return k.status === 'active';
      if (status === 'expired') return k.status === 'expired';
      if (status === 'inactive') return k.status === 'inactive';
      if (status === 'blocked') return k.status === 'blocked';
      return true;
    });

    res.json({ success: true, keys });
  } catch (err) {
    console.error('/api/admin/license-keys error:', err);
    res.status(500).json({ success: false, error: 'Serverfehler beim Laden der Lizenz-Keys' });
  }
});

// ===== Admin: Key sperren/aktivieren/aktivieren mit Laufzeit =====
app.post('/api/admin/keys/:id/disable', async (req, res) => {
  try {
    const { password } = req.body || {};
    if (password !== ADMIN_PASSWORD) {
      return res.status(403).json({ success: false, error: 'Ungültiges Admin-Passwort' });
    }
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ success: false, error: 'Ungültige ID' });

    const sql = isPostgreSQL
      ? 'UPDATE license_keys SET is_active = false WHERE id = $1'
      : 'UPDATE license_keys SET is_active = 0 WHERE id = ?';

    await dbQuery(sql, [id]);
    res.json({ success: true });
  } catch (e) {
    console.error('/api/admin/keys/:id/disable error', e);
    res.status(500).json({ success: false, error: 'Serverfehler' });
  }
});

app.post('/api/admin/keys/:id/enable', async (req, res) => {
  try {
    const { password } = req.body || {};
    if (password !== ADMIN_PASSWORD) {
      return res.status(403).json({ success: false, error: 'Ungültiges Admin-Passwort' });
    }
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ success: false, error: 'Ungültige ID' });

    const sql = isPostgreSQL
      ? 'UPDATE license_keys SET is_active = true WHERE id = $1'
      : 'UPDATE license_keys SET is_active = 1 WHERE id = ?';

    await dbQuery(sql, [id]);
    res.json({ success: true });
  } catch (e) {
    console.error('/api/admin/keys/:id/enable error', e);
    res.status(500).json({ success: false, error: 'Serverfehler' });
  }
});

app.post('/api/admin/keys/:id/activate', async (req, res) => {
  try {
    const { password, product_code } = req.body || {};
    if (password !== ADMIN_PASSWORD) {
      return res.status(403).json({ success: false, error: 'Ungültiges Admin-Passwort' });
    }
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ success: false, error: 'Ungültige ID' });

    const code = String(product_code || '').toLowerCase();
    const map = { '1m':30, '3m':90, '6m':180, '12m':360, '1y':360, 'unl':null, 'unlimited':null };
    if (!(code in map)) return res.status(400).json({ success: false, error: 'Ungültiger Produkt-Code' });

    const now = new Date();
    const nowIso = now.toISOString();
    let expiresAt = null;
    if (map[code] !== null) {
      const d = new Date(now);
      d.setUTCDate(d.getUTCDate() + map[code]);
      expiresAt = d.toISOString();
    }

    const sql = isPostgreSQL
      ? `UPDATE license_keys
           SET is_active = true,
               activated_at = COALESCE(activated_at, $1),
               expires_at = $2,
               product_code = $3
         WHERE id = $4`
      : `UPDATE license_keys
           SET is_active = 1,
               activated_at = COALESCE(activated_at, ?),
               expires_at = ?,
               product_code = ?
         WHERE id = ?`;

    await dbQuery(sql, [nowIso, expiresAt, code, id]);
    res.json({ success: true, expires_at: expiresAt, product_code: code });
  } catch (e) {
    console.error('/api/admin/keys/:id/activate error', e);
    res.status(500).json({ success: false, error: 'Serverfehler' });
  }
});

// ===== Admin: Stats korrekt =====
app.post('/api/admin/stats', async (req, res) => {
  const { password } = req.body || {};
  if (password !== ADMIN_PASSWORD) {
    return res.status(403).json({ success: false, error: 'Ungültiges Admin-Passwort' });
  }
  try {
    const stats = {};

    const totalKeys = await dbQuery('SELECT COUNT(*) AS count FROM license_keys');
    stats.totalKeys = parseInt(totalKeys.rows[0].count || 0);

    const activeUsers = await dbQuery(
      isPostgreSQL
        ? "SELECT COUNT(*) AS count FROM license_keys WHERE is_active = true"
        : "SELECT COUNT(*) AS count FROM license_keys WHERE is_active = 1"
    );
    stats.activeUsers = parseInt(activeUsers.rows[0].count || 0);

    const activeSessions = await dbQuery(
      isPostgreSQL
        ? "SELECT COUNT(*) AS count FROM user_sessions WHERE is_active = true AND expires_at > NOW()"
        : "SELECT COUNT(*) AS count FROM user_sessions WHERE is_active = 1 AND datetime(expires_at) > datetime('now')"
    );
    stats.activeSessions = parseInt(activeSessions.rows[0].count || 0);

    const recentRegs = await dbQuery(
      isPostgreSQL
        ? "SELECT COUNT(*) AS count FROM license_keys WHERE username IS NOT NULL AND user_created_at >= NOW() - INTERVAL '7 days'"
        : "SELECT COUNT(*) AS count FROM license_keys WHERE username IS NOT NULL AND datetime(user_created_at) >= datetime('now', '-7 days')"
    );
    stats.recentRegistrations = parseInt(recentRegs.rows[0].count || 0);

    res.json({ success: true, stats });
  } catch (err) {
    console.error('stats error:', err);
    res.status(500).json({ success: false, error: 'Serverfehler' });
  }
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
