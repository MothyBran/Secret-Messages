// server.js - Secret Messages Backend (Unified Version)

const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
require('dotenv').config();

// Payment Routes
const paymentRoutes = require('./payment.js');

const app = express();
app.set('trust proxy', 1);

// ==================================================================
// 1. MIDDLEWARE
// ==================================================================

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://js.stripe.com", "https://cdnjs.cloudflare.com", "https://unpkg.com"],
      scriptSrcElem: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://js.stripe.com", "https://cdnjs.cloudflare.com", "https://unpkg.com"],
      scriptSrcAttr: ["'self'", "'unsafe-inline'"],
      frameSrc: ["'self'", "https://js.stripe.com"],
      connectSrc: ["'self'", "https://api.stripe.com", "https://js.stripe.com"],
      imgSrc: ["'self'", "data:", "https:"]
    }
  }
}));

app.use(cors());

const rateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: { error: "Zu viele Anfragen, bitte versuchen Sie es später erneut." }
});

app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));

app.use(express.static('public', { index: false }));

app.use((req, res, next) => {
    next();
});

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'secret_fallback_key';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const DATABASE_URL = process.env.DATABASE_URL;

// ==================================================================
// 2. DATABASE SETUP
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

        await dbQuery(`CREATE TABLE IF NOT EXISTS account_deletions (
            id ${isPostgreSQL ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT'},
            username VARCHAR(50),
            license_key_code VARCHAR(50),
            reason TEXT,
            deleted_at ${isPostgreSQL ? 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP' : 'DATETIME DEFAULT CURRENT_TIMESTAMP'}
        )`);

        console.log('✅ Tables checked/created');
    } catch (e) { console.error("Table creation error:", e); }
};

initializeDatabase();

// ==================================================================
// 3. AUTHENTICATION & APP ROUTES
// ==================================================================

async function authenticateUser(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Kein Token' });

    jwt.verify(token, JWT_SECRET, async (err, user) => {
        if (err) return res.status(403).json({ error: 'Token ungültig' });
        try {
            const userResult = await dbQuery("SELECT is_blocked FROM users WHERE id = $1", [user.id]);
            const dbUser = userResult.rows[0];
            const blocked = dbUser ? (isPostgreSQL ? dbUser.is_blocked : (dbUser.is_blocked === 1)) : false;

            if (!dbUser || blocked) {
                return res.status(403).json({ error: "Konto gesperrt." });
            }
            req.user = user;
            next();
        } catch (dbError) {
            return res.status(500).json({ error: 'Auth Error' });
        }
    });
}

app.post('/api/auth/login', rateLimiter, async (req, res) => {
    try {
        const { username, accessCode, deviceId } = req.body;
        const userRes = await dbQuery(`
            SELECT u.*, l.expires_at 
            FROM users u
            LEFT JOIN license_keys l ON u.license_key_id = l.id
            WHERE u.username = $1
        `, [username]);

        if (userRes.rows.length === 0) return res.status(401).json({ success: false, error: "Benutzer nicht gefunden" });
        const user = userRes.rows[0];

        const match = await bcrypt.compare(accessCode, user.access_code_hash);
        if (!match) return res.status(401).json({ success: false, error: "Falscher Zugangscode" });

        // HARD LOGIN BLOCK
        const isBlocked = isPostgreSQL ? user.is_blocked : (user.is_blocked === 1);
        if (isBlocked) {
            return res.status(403).json({ success: false, error: "ACCOUNT_BLOCKED" });
        }

        // LICENSE CHECK REMOVED from strict block.
        // User is allowed to get token, but frontend will handle "no license" state.

        if (user.allowed_device_id && user.allowed_device_id !== deviceId) {
            return res.status(403).json({ success: false, error: "Gerät nicht autorisiert." });
        }
        if (!user.allowed_device_id) {
            await dbQuery("UPDATE users SET allowed_device_id = $1 WHERE id = $2", [deviceId, user.id]);
        }

        const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '24h' });
        await dbQuery("UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = $1", [user.id]);

        res.json({
            success: true,
            token,
            username: user.username,
            expiresAt: user.expires_at || 'lifetime',
            hasLicense: !!user.license_key_id
        });
    } catch (err) { res.status(500).json({ success: false, error: "Serverfehler" }); }
});

app.post('/api/auth/logout', authenticateUser, async (req, res) => {
    try {
        await dbQuery('UPDATE users SET is_online = $1 WHERE id = $2', [(isPostgreSQL ? false : 0), req.user.id]);
        res.json({ success: true });
    } catch(e) { res.status(500).json({ error: 'Logout Fehler' }); }
});

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

        // CALCULATE EXPIRATION based on product_code
        let expiresAt = null;
        const now = new Date();
        const pc = (key.product_code || '').toLowerCase();

        if (pc === '1m') {
            now.setMonth(now.getMonth() + 1);
            expiresAt = now.toISOString();
        } else if (pc === '3m') {
            now.setMonth(now.getMonth() + 3);
            expiresAt = now.toISOString();
        } else if (pc === '12m') {
            now.setFullYear(now.getFullYear() + 1);
            expiresAt = now.toISOString();
        } else {
            // 'unlimited' or unknown -> null (Lifetime)
            expiresAt = null;
        }

        const hash = await bcrypt.hash(accessCode, 10);

        // 1. Insert User
        let insertSql = 'INSERT INTO users (username, access_code_hash, license_key_id, allowed_device_id, registered_at) VALUES ($1, $2, $3, $4, $5)';
        if (isPostgreSQL) {
            insertSql += ' RETURNING id';
        }

        const insertUser = await dbQuery(
            insertSql,
            [username, hash, key.id, deviceId, new Date().toISOString()]
        );
        
        // Handle different return types (SQLite vs PG)
        let newUserId = null;
        if(insertUser.rows && insertUser.rows.length > 0) {
            newUserId = insertUser.rows[0].id; // PG
        } else if (insertUser.lastID) {
            newUserId = insertUser.lastID; // SQLite
        }

        // 2. Update License Key
        await dbQuery(
            'UPDATE license_keys SET is_active = $1, activated_at = $2, expires_at = $3 WHERE id = $4',
            [(isPostgreSQL ? true : 1), new Date().toISOString(), expiresAt, key.id]
        );

        res.json({ success: true });
    } catch (e) {
        console.error("Activation Error:", e);
        res.status(500).json({ error: 'Aktivierung fehlgeschlagen: ' + e.message });
    }
});

app.get('/api/checkAccess', authenticateUser, async (req, res) => {
    try {
        const userRes = await dbQuery('SELECT * FROM users WHERE id = $1', [req.user.id]);
        const user = userRes.rows[0];
        if (!user) return res.json({ status: 'banned' });

        const blocked = isPostgreSQL ? user.is_blocked : (user.is_blocked === 1);
        if (blocked) return res.json({ status: 'banned' });

        const keyRes = await dbQuery('SELECT * FROM license_keys WHERE id = $1', [user.license_key_id]);
        const key = keyRes.rows[0];
        if (key && key.expires_at) {
            if (new Date(key.expires_at) < new Date()) return res.json({ status: 'expired' });
        }
        res.json({ status: 'active' });
    } catch (e) { res.status(500).json({ error: 'Error' }); }
});

app.post('/api/users/exists', authenticateUser, async (req, res) => {
    try {
        const { targetUsername } = req.body;
        if (!targetUsername) return res.json({ exists: false });
        const result = await dbQuery(`SELECT id, is_blocked FROM users WHERE username = $1`, [targetUsername.trim()]);
        if (result.rows.length === 0) return res.json({ exists: false });
        
        const user = result.rows[0];
        const isBlocked = (isPostgreSQL ? user.is_blocked : (user.is_blocked === 1));
        if (isBlocked) return res.json({ exists: false });
        res.json({ exists: true });
    } catch (e) { res.status(500).json({ error: "Serverfehler" }); }
});

app.delete('/api/auth/delete-account', authenticateUser, async (req, res) => {
    try {
        // 1. User Info & License ID
        const userRes = await dbQuery('SELECT username, license_key_id FROM users WHERE id = $1', [req.user.id]);
        if (userRes.rows.length === 0) return res.status(404).json({ error: "User nicht gefunden" });
        const user = userRes.rows[0];

        // 2. Get License Code
        let licenseCode = 'UNKNOWN';
        if (user.license_key_id) {
            const keyRes = await dbQuery('SELECT key_code FROM license_keys WHERE id = $1', [user.license_key_id]);
            if (keyRes.rows.length > 0) licenseCode = keyRes.rows[0].key_code;
        }

        // 3. Archive
        await dbQuery('INSERT INTO account_deletions (username, license_key_code, reason, deleted_at) VALUES ($1, $2, $3, $4)',
            [user.username, licenseCode, 'user_request', new Date().toISOString()]);

        // 4. Delete User
        await dbQuery('DELETE FROM users WHERE id = $1', [req.user.id]);

        // 5. Delete License Key
        if (user.license_key_id) {
            await dbQuery('DELETE FROM license_keys WHERE id = $1', [user.license_key_id]);
        }

        res.json({ success: true });
    } catch (e) {
        console.error("Delete Account Error:", e);
        res.status(500).json({ error: 'Fehler beim Löschen des Accounts.' });
    }
});

app.post('/api/auth/validate', async (req, res) => {
    const { token } = req.body;
    if (!token) return res.json({ valid: false });
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const userRes = await dbQuery(`SELECT u.*, l.expires_at FROM users u LEFT JOIN license_keys l ON u.license_key_id = l.id WHERE u.id = $1`, [decoded.id]);

        if (userRes.rows.length > 0) {
            const user = userRes.rows[0];
            const isBlocked = isPostgreSQL ? user.is_blocked : (user.is_blocked === 1);

            if (isBlocked) {
                return res.json({ valid: false, reason: 'blocked' });
            }

            // LICENSE CHECK (Security Fix)
            if (!user.license_key_id) {
                return res.json({ valid: false, reason: 'no_license' });
            }

            // Check Expiration
            let isExpired = false;
            if (user.expires_at) {
                const expDate = new Date(user.expires_at);
                if (expDate < new Date()) isExpired = true;
            }

            if (isExpired) {
                return res.json({ valid: false, reason: 'expired', expiresAt: user.expires_at });
            }

            res.json({ valid: true, username: user.username, expiresAt: user.expires_at });
        } else {
            res.json({ valid: false, reason: 'user_not_found' });
        }
    } catch (e) { res.json({ valid: false, reason: 'invalid_token' }); }
});

// ==================================================================
// 4. ADMIN DASHBOARD ROUTES
// ==================================================================

// Unified Admin Middleware
const requireAdmin = (req, res, next) => {
    const sentPassword = req.headers['x-admin-password'] || req.body.password;
    if (sentPassword !== ADMIN_PASSWORD) {
        return res.status(403).json({ success: false, error: 'Admin Auth Failed' });
    }
    next();
};

// STATS
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

// KEYS
app.get('/api/admin/keys', requireAdmin, async (req, res) => {
    try {
        const sql = `SELECT k.*, u.username, u.id as user_id FROM license_keys k LEFT JOIN users u ON u.license_key_id = k.id ORDER BY k.created_at DESC LIMIT 200`;
        const result = await dbQuery(sql);
        const keys = result.rows.map(r => ({
            ...r,
            is_active: isPostgreSQL ? r.is_active : (r.is_active === 1)
        }));
        res.json(keys);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/admin/keys/:id', requireAdmin, async (req, res) => {
    const keyId = req.params.id;
    const { expires_at, user_id, product_code } = req.body;
    try {
        // 1. Basic Key Update (Expiry, Product Code) - NO USERNAME, NO USER_ID (Schema relies on users table for link)
        // Note: product_code defaults to existing if not provided, or can be updated if sent.
        // If product_code is sent, update it. If not, keep it (by not setting it? or coalesce).
        // Since SQL requires values, and we don't know current value easily without fetch,
        // we assume if it's undefined we shouldn't overwrite it OR we set it to 'man' as logic before?
        // Original code had `product_code = 'man'` hardcoded.
        // User instruction: "product_code (falls gesendet)".

        let updateSql = `UPDATE license_keys SET expires_at = $1`;
        const params = [expires_at || null];
        let pIndex = 2;

        if (product_code) {
            updateSql += `, product_code = $${pIndex}`;
            params.push(product_code);
            pIndex++;
        }

        updateSql += ` WHERE id = $${pIndex}`;
        params.push(keyId);

        await dbQuery(updateSql, params);

        // 2. Clear old link in USERS (where license_key_id = keyId)
        await dbQuery(`UPDATE users SET license_key_id = NULL WHERE license_key_id = $1`, [keyId]);

        if (user_id) {
            const userCheck = await dbQuery(`SELECT id FROM users WHERE id = $1`, [user_id]);
            if (userCheck.rows.length > 0) {
                // Link new user
                await dbQuery(`UPDATE users SET license_key_id = $1 WHERE id = $2`, [keyId, user_id]);

                // Update KEY active state (NO username update)
                const now = new Date().toISOString();
                await dbQuery(`UPDATE license_keys SET is_active = ${isPostgreSQL ? 'true' : '1'}, activated_at = COALESCE(activated_at, $2) WHERE id = $1`, [keyId, now]);
            }
        }
        // Note: No else block needed to set username=NULL since we don't use username column anymore.

        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.delete('/api/admin/keys/:id', requireAdmin, async (req, res) => {
    const keyId = req.params.id;
    try {
        // 1. Verknüpfung bei Usern lösen, die diesen Key nutzen
        await dbQuery('UPDATE users SET license_key_id = NULL WHERE license_key_id = $1', [keyId]);
        // 2. Key löschen
        await dbQuery('DELETE FROM license_keys WHERE id = $1', [keyId]);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, error: "Löschen fehlgeschlagen: " + e.message });
    }
});

app.post('/api/admin/generate-keys', requireAdmin, async (req, res) => {
    try {
        const { productCode, count } = req.body;
        const amount = parseInt(count) || 1;
        const newKeys = [];
        for(let i=0; i < amount; i++) {
            // Generate 6 bytes = 12 hex chars -> "XXXX-XXXX-XXXX" (14 chars)
            const keyRaw = crypto.randomBytes(6).toString('hex').toUpperCase().match(/.{1,4}/g).join('-');
            const keyHash = crypto.createHash('sha256').update(keyRaw).digest('hex');
            // FIX: Use parameter for boolean to support SQLite (no literal 'true') and set default to false/inactive
            await dbQuery(`INSERT INTO license_keys (key_code, key_hash, product_code, is_active) VALUES ($1, $2, $3, $4)`,
                [keyRaw, keyHash, productCode, (isPostgreSQL ? false : 0)]);
            newKeys.push(keyRaw);
        }
        res.json({ success: true, keys: newKeys });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: "Fehler beim Generieren: " + e.message });
    }
});

// USERS
app.get('/api/admin/users', requireAdmin, async (req, res) => {
    try {
        const sql = `SELECT u.*, k.key_code FROM users u LEFT JOIN license_keys k ON u.license_key_id = k.id ORDER BY u.registered_at DESC LIMIT 100`;
        const result = await dbQuery(sql);
        const users = result.rows.map(r => ({
            ...r,
            is_blocked: isPostgreSQL ? r.is_blocked : (r.is_blocked === 1),
            is_online: isPostgreSQL ? r.is_online : (r.is_online === 1)
        }));
        res.json(users);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ACTIONS
app.post('/api/admin/block-user/:id', requireAdmin, async (req, res) => {
    try {
        await dbQuery("UPDATE users SET is_blocked = TRUE WHERE id = $1", [req.params.id]);
        await dbQuery("DELETE FROM user_sessions WHERE user_id = $1", [req.params.id]); // Optional session table
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false }); }
});

app.post('/api/admin/unblock-user/:id', requireAdmin, async (req, res) => {
    await dbQuery(`UPDATE users SET is_blocked = ${isPostgreSQL ? 'false' : '0'} WHERE id = $1`, [req.params.id]);
    res.json({ success: true });
});

app.post('/api/admin/reset-device/:id', requireAdmin, async (req, res) => {
    try {
        await dbQuery("UPDATE users SET allowed_device_id = NULL WHERE id = $1", [req.params.id]);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false }); }
});

// PURCHASES
app.get('/api/admin/purchases', requireAdmin, async (req, res) => {
    try {
        const sql = `SELECT * FROM payments ORDER BY completed_at DESC LIMIT 100`;
        const result = await dbQuery(sql);
        const purchases = result.rows.map(r => {
            let meta = {};
            try { meta = (typeof r.metadata === 'string') ? JSON.parse(r.metadata) : r.metadata; } catch(e){}
            return {
                id: r.payment_id,
                email: meta.customer_email || meta.email || '?',
                product: meta.product_type || '?',
                amount: r.amount,
                currency: r.currency,
                date: r.completed_at,
                status: r.status
            };
        });
        res.json(purchases);
    } catch (e) { res.json([]); }
});

// ==================================================================
// 5. START
// ==================================================================

app.use('/api', paymentRoutes);

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'landing.html')));
app.get('/app', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/shop', (req, res) => res.sendFile(path.join(__dirname, 'public', 'store.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

app.get('*', (req, res) => {
    if (req.path.startsWith('/api') || req.path.match(/\.[0-9a-z]+$/i)) {
        res.status(404).send('Not Found');
    } else {
        res.redirect('/');
    }
});

app.listen(PORT, () => {
    console.log(`🚀 Server running on Port ${PORT}`);
});
