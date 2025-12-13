// ==================================================================
// SERVER.JS - FINAL FIXED VERSION (CSP, AUTH, ADMIN, PAYMENTS)
// ==================================================================

const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
require('dotenv').config();

// Payment Routes importieren (Stellt sicher, dass payment.js existiert!)
const paymentRoutes = require('./payment.js');

const app = express();
app.set('trust proxy', 1);

// ==================================================================
// 1. MIDDLEWARE (MIT CSP FIX FÜR ADMIN PANEL)
// ==================================================================

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      
      // WICHTIG: 'unsafe-inline' erlaubt die onclick-Buttons im Admin Panel
      scriptSrc: [
          "'self'", 
          "'unsafe-inline'",
          "https://js.stripe.com", 
          "https://cdnjs.cloudflare.com", 
          "https://unpkg.com"
      ],
      // Speziell für Event-Handler Attribute (onclick, etc.)
      scriptSrcAttr: ["'unsafe-inline'"],
      
      scriptSrcElem: [
          "'self'", 
          "'unsafe-inline'",
          "https://js.stripe.com", 
          "https://cdnjs.cloudflare.com", 
          "https://unpkg.com"
      ],
      
      frameSrc: ["'self'", "https://js.stripe.com"],
      connectSrc: ["'self'", "https://api.stripe.com", "https://js.stripe.com"],
      imgSrc: ["'self'", "data:", "https:"]
    }
  }
}));

app.use(cors());

// Rate Limiter
const rateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 Minuten
    max: 100,
    message: { error: "Zu viele Anfragen, bitte versuchen Sie es später erneut." }
});

// Raw Body für Stripe Webhooks, JSON für alles andere
app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));

app.use(express.static('public'));

// Environment Variables
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'change_this_secret';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const DATABASE_URL = process.env.DATABASE_URL;

// ==================================================================
// 2. DATABASE SETUP (PostgreSQL + SQLite Fallback)
// ==================================================================

let db, isPostgreSQL = false;
let dbQuery;

const initializeDatabase = async () => {
    console.log('🔧 Initializing Database...');
    
    if (DATABASE_URL && DATABASE_URL.includes('postgresql')) {
        console.log('📡 PostgreSQL detected');
        isPostgreSQL = true;
        const { Pool } = require('pg');
        db = new Pool({
            connectionString: DATABASE_URL,
            ssl: { rejectUnauthorized: false }
        });
        dbQuery = async (text, params) => await db.query(text, params);
        await createTables();
    } else {
        console.log('📁 Using SQLite (local)');
        const sqlite3 = require('sqlite3').verbose();
        db = new sqlite3.Database('./secret_messages.db');
        
        dbQuery = (text, params = []) => {
            return new Promise((resolve, reject) => {
                const sql = text.replace(/\$\d+/g, '?');
                if (text.trim().toUpperCase().startsWith('SELECT')) {
                    db.all(sql, params, (err, rows) => {
                        if (err) reject(err); else resolve({ rows: rows, rowCount: rows.length });
                    });
                } else {
                    db.run(sql, params, function(err) {
                        if (err) reject(err); else resolve({ rows: [], rowCount: this.changes, lastID: this.lastID });
                    });
                }
            });
        };
        createTables();
    }
};

const createTables = async () => {
    try {
        await dbQuery(`CREATE TABLE IF NOT EXISTS users (
            id ${isPostgreSQL ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT'},
            username VARCHAR(50) UNIQUE,
            access_code_hash TEXT,
            license_key_id INTEGER,
            allowed_device_id TEXT,
            registered_at ${isPostgreSQL ? 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP' : 'DATETIME DEFAULT CURRENT_TIMESTAMP'},
            last_login ${isPostgreSQL ? 'TIMESTAMP' : 'DATETIME'},
            is_blocked ${isPostgreSQL ? 'BOOLEAN DEFAULT FALSE' : 'INTEGER DEFAULT 0'},
            is_online ${isPostgreSQL ? 'BOOLEAN DEFAULT FALSE' : 'INTEGER DEFAULT 0'}
        )`);

        await dbQuery(`CREATE TABLE IF NOT EXISTS license_keys (
            id ${isPostgreSQL ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT'},
            key_code VARCHAR(17) UNIQUE NOT NULL,
            key_hash TEXT NOT NULL,
            product_code VARCHAR(10), 
            created_at ${isPostgreSQL ? 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP' : 'DATETIME DEFAULT CURRENT_TIMESTAMP'},
            activated_at ${isPostgreSQL ? 'TIMESTAMP' : 'DATETIME'},
            expires_at ${isPostgreSQL ? 'TIMESTAMP' : 'DATETIME'}, 
            is_active ${isPostgreSQL ? 'BOOLEAN DEFAULT FALSE' : 'INTEGER DEFAULT 0'},
            username VARCHAR(50), 
            activated_ip VARCHAR(50) 
        )`);

        await dbQuery(`CREATE TABLE IF NOT EXISTS payments (
            id ${isPostgreSQL ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT'},
            payment_id VARCHAR(100),
            amount INTEGER,
            currency VARCHAR(10),
            status VARCHAR(20),
            payment_method VARCHAR(50),
            completed_at ${isPostgreSQL ? 'TIMESTAMP' : 'DATETIME'},
            metadata TEXT
        )`);
        console.log('✅ Tables checked/created');
    } catch (e) {
        console.error("Table creation error:", e);
    }
};

initializeDatabase();

// ==================================================================
// 3. AUTHENTICATION & APP ROUTES
// ==================================================================

// Middleware: Token Check
async function authenticateUser(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Kein Token' });

    jwt.verify(token, JWT_SECRET, async (err, user) => {
        if (err) return res.status(403).json({ error: 'Token ungültig' });
        try {
            const userResult = await dbQuery("SELECT is_blocked FROM users WHERE id = $1", [user.id]);
            const dbUser = userResult.rows[0];
            if (!dbUser || dbUser.is_blocked) {
                return res.status(403).json({ error: "Konto gesperrt." });
            }
            req.user = user;
            next();
        } catch (dbError) {
            return res.status(500).json({ error: 'Auth Fehler.' });
        }
    });
}

// Login Route
app.post('/api/auth/login', rateLimiter, async (req, res) => {
    try {
        const { username, accessCode, deviceId } = req.body;
        const userRes = await dbQuery(`SELECT u.*, l.expires_at FROM users u LEFT JOIN license_keys l ON u.license_key_id = l.id WHERE u.username = $1`, [username]);

        if (userRes.rows.length === 0) return res.status(401).json({ success: false, error: "Benutzer nicht gefunden" });

        const user = userRes.rows[0];
        const match = await bcrypt.compare(accessCode, user.access_code_hash);
        if (!match) return res.status(401).json({ success: false, error: "Falscher Zugangscode" });

        if (user.allowed_device_id && user.allowed_device_id !== deviceId) {
            return res.status(403).json({ success: false, error: "Gerät nicht autorisiert." });
        }
        if (!user.allowed_device_id) {
            await dbQuery("UPDATE users SET allowed_device_id = $1 WHERE id = $2", [deviceId, user.id]);
        }

        const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '24h' });
        await dbQuery("UPDATE users SET last_login = NOW() WHERE id = $1", [user.id]);

        res.json({ success: true, token, username: user.username, expiresAt: user.expires_at || 'lifetime' });
    } catch (err) {
        console.error("Login Error:", err);
        res.status(500).json({ success: false, error: "Serverfehler" });
    }
});

// Logout
app.post('/api/auth/logout', authenticateUser, async (req, res) => {
    try {
        await dbQuery('UPDATE users SET is_online = $1 WHERE id = $2', [(isPostgreSQL ? false : 0), req.user.id]);
        res.json({ success: true });
    } catch(e) { res.status(500).json({ error: 'Logout Fehler' }); }
});

// Activate License (Register)
app.post('/api/auth/activate', async (req, res) => {
    const { licenseKey, username, accessCode, deviceId } = req.body;
    if (!deviceId) return res.status(400).json({ error: 'Geräte-ID fehlt.' });
    
    try {
        const keyRes = await dbQuery('SELECT * FROM license_keys WHERE key_code = $1', [licenseKey]);
        const key = keyRes.rows[0];
        if (!key) return res.status(404).json({ error: 'Key nicht gefunden' });
        if (key.activated_at) return res.status(403).json({ error: 'Key bereits benutzt' });
        
        const userRes = await dbQuery('SELECT id FROM users WHERE username = $1', [username]);
        if (userRes.rows.length > 0) return res.status(409).json({ error: 'Username vergeben' });

        const hash = await bcrypt.hash(accessCode, 10);
        await dbQuery(
            'INSERT INTO users (username, access_code_hash, license_key_id, allowed_device_id, registered_at) VALUES ($1, $2, $3, $4, $5)',
            [username, hash, key.id, deviceId, new Date().toISOString()]
        );
        
        await dbQuery(
            'UPDATE license_keys SET is_active = $1, activated_at = $2, username = $3 WHERE id = $4',
            [(isPostgreSQL ? true : 1), new Date().toISOString(), username, key.id]
        );
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: 'Aktivierung fehlgeschlagen' });
    }
});

// Validate Token
app.post('/api/auth/validate', async (req, res) => {
    const { token } = req.body;
    if (!token) return res.json({ valid: false });
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const userRes = await dbQuery(`SELECT u.*, l.expires_at FROM users u LEFT JOIN license_keys l ON u.license_key_id = l.id WHERE u.id = $1`, [decoded.id]);
        
        if (userRes.rows.length > 0) {
            res.json({ valid: true, username: userRes.rows[0].username, expiresAt: userRes.rows[0].expires_at });
        } else {
            res.json({ valid: false });
        }
    } catch (e) { res.json({ valid: false }); }
});

// Delete Account
app.delete('/api/auth/delete-account', authenticateUser, async (req, res) => {
    try {
        await dbQuery('UPDATE license_keys SET is_active = $1, username = NULL WHERE id = (SELECT license_key_id FROM users WHERE id = $2)', [(isPostgreSQL ? false : 0), req.user.id]);
        await dbQuery('DELETE FROM users WHERE id = $1', [req.user.id]);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: 'Fehler beim Löschen' }); }
});

// ==================================================================
// 4. ADMIN DASHBOARD ROUTES
// ==================================================================

// Middleware für Admin Routes
const requireAdmin = (req, res, next) => {
    const { password } = req.headers['x-admin-password'];
    const pass = password || req.body.password || req.headers['x-admin-password'];
    
    if (pass !== ADMIN_PASSWORD) return res.status(403).json({ success: false, error: 'Admin Auth Failed' });
    next();
};

// A) EXTENDED STATS
app.get('/api/admin/stats', requireAdmin, async (req, res) => {
    try {
        const now = isPostgreSQL ? 'NOW()' : 'DATETIME("now")';
        const activeUsers = await dbQuery(`SELECT COUNT(*) as c FROM users WHERE is_blocked = ${isPostgreSQL ? 'false' : '0'}`);
        const blockedUsers = await dbQuery(`SELECT COUNT(*) as c FROM users WHERE is_blocked = ${isPostgreSQL ? 'true' : '1'}`);
        const activeKeys = await dbQuery(`SELECT COUNT(*) as c FROM license_keys WHERE is_active = ${isPostgreSQL ? 'true' : '1'} AND (expires_at IS NULL OR expires_at > ${now})`);
        const expiredKeys = await dbQuery(`SELECT COUNT(*) as c FROM license_keys WHERE expires_at IS NOT NULL AND expires_at <= ${now}`);
        const totalPurchases = await dbQuery(`SELECT COUNT(*) as c FROM payments WHERE status = 'completed'`);
        const totalRevenue = await dbQuery(`SELECT SUM(amount) as s FROM payments WHERE status = 'completed'`);
        
        res.json({
            success: true,
            stats: {
                users_active: activeUsers.rows[0].c,
                users_blocked: blockedUsers.rows[0].c,
                keys_active: activeKeys.rows[0].c,
                keys_expired: expiredKeys.rows[0].c,
                purchases_count: totalPurchases.rows[0].c,
                revenue_total: (totalRevenue.rows[0].s || 0)
            }
        });
    } catch (e) { res.json({ success: false, error: 'DB Error' }); }
});

// B) KEYS (GET)
app.get('/api/admin/keys', requireAdmin, async (req, res) => {
    try {
        const sql = `SELECT k.id, k.key_code, k.product_code, k.is_active, k.created_at, k.expires_at, u.username, u.id as user_id FROM license_keys k LEFT JOIN users u ON u.license_key_id = k.id ORDER BY k.created_at DESC LIMIT 200`;
        const result = await dbQuery(sql);
        const keys = result.rows.map(r => ({
            id: r.id, key_code: r.key_code, product_code: r.product_code, is_active: isPostgreSQL ? r.is_active : (r.is_active === 1), 
            username: r.username, user_id: r.user_id, created_at: r.created_at, expires_at: r.expires_at
        }));
        res.json(keys);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// C) KEY UPDATE (Edit Mode)
app.put('/api/admin/keys/:id', requireAdmin, async (req, res) => {
    const keyId = req.params.id;
    const { expires_at, user_id } = req.body;
    try {
        await dbQuery(`UPDATE license_keys SET expires_at = $1 WHERE id = $2`, [expires_at || null, keyId]);
        await dbQuery(`UPDATE users SET license_key_id = NULL WHERE license_key_id = $1`, [keyId]);
        
        if (user_id) {
            const userCheck = await dbQuery(`SELECT id, username FROM users WHERE id = $1`, [user_id]);
            if (userCheck.rows.length > 0) {
                await dbQuery(`UPDATE users SET license_key_id = $1 WHERE id = $2`, [keyId, user_id]);
                await dbQuery(`UPDATE license_keys SET username = $1, is_active = ${isPostgreSQL ? 'true' : '1'} WHERE id = $2`, [userCheck.rows[0].username, keyId]);
            }
        }
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// D) GENERATE KEYS (Vom alten Abschnitt 5 integriert & gefixt!)
app.post('/api/admin/generate-keys', requireAdmin, async (req, res) => {
    try {
        // Frontend sendet manchmal 'product' oder 'productCode'
        const { product, productCode, count } = req.body; 
        const finalProduct = product || productCode || '1m';
        const amount = parseInt(count) || 1;
        const newKeys = [];

        for(let i=0; i < amount; i++) {
            const keyRaw = crypto.randomBytes(8).toString('hex').toUpperCase().match(/.{1,4}/g).join('-');
            const keyHash = await bcrypt.hash(keyRaw, 10);
            
            await dbQuery(`INSERT INTO license_keys (key_code, key_hash, product_code, is_active) VALUES ($1, $2, $3, true)`, [keyRaw, keyHash, finalProduct]);
            newKeys.push(keyRaw);
        }
        res.json({ success: true, keys: newKeys });
    } catch (e) {
        console.error("Generator Error:", e);
        res.status(500).json({ error: "Fehler beim Generieren" });
    }
});

// E) USERS
app.get('/api/admin/users', requireAdmin, async (req, res) => {
    try {
        const sql = `SELECT u.*, k.key_code FROM users u LEFT JOIN license_keys k ON u.license_key_id = k.id ORDER BY u.registered_at DESC LIMIT 100`;
        const result = await dbQuery(sql);
        const users = result.rows.map(r => ({
            ...r, is_blocked: isPostgreSQL ? r.is_blocked : (r.is_blocked === 1), is_online: isPostgreSQL ? r.is_online : (r.is_online === 1)
        }));
        res.json(users);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// F) PURCHASES (Reading from Metadata for better details)
app.get('/api/admin/purchases', requireAdmin, async (req, res) => {
    try {
        const sql = `SELECT payment_id, amount, currency, status, completed_at, metadata FROM payments ORDER BY completed_at DESC LIMIT 100`;
        const result = await dbQuery(sql);
        
        const purchases = result.rows.map(r => {
            let meta = {};
            try { meta = (typeof r.metadata === 'string') ? JSON.parse(r.metadata) : r.metadata; } catch(e){}
            return {
                id: r.payment_id, email: meta.email || meta.customer_email || '?', product: meta.product_type || '?',
                amount: r.amount, currency: r.currency, date: r.completed_at, status: r.status
            };
        });
        res.json(purchases);
    } catch (e) { res.json([]); }
});

// ACTIONS: Block/Unblock/Reset
app.post('/api/admin/block-user/:id', requireAdmin, async (req, res) => {
    try {
        await dbQuery("UPDATE users SET is_blocked = $1 WHERE id = $2", [isPostgreSQL ? 'true' : 1, req.params.id]);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false }); }
});

app.post('/api/admin/unblock-user/:id', requireAdmin, async (req, res) => {
    try {
        await dbQuery("UPDATE users SET is_blocked = $1 WHERE id = $2", [isPostgreSQL ? 'false' : 0, req.params.id]);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false }); }
});

app.post('/api/admin/reset-device/:id', requireAdmin, async (req, res) => {
    try {
        await dbQuery("UPDATE users SET allowed_device_id = NULL WHERE id = $1", [req.params.id]);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false }); }
});

// ==================================================================
// 5. PAYMENTS STRIPE
// ==================================================================

// Nutzt das externe payment.js File (WICHTIG: Das File muss im selben Ordner liegen!)
app.use('/api', paymentRoutes);

// ==================================================================
// 6. START
// ==================================================================

app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => {
    console.log(`🚀 Server running on Port ${PORT}`);
});
