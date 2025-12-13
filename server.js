// ==================================================================
// SERVER.JS - SECRET MESSAGES BACKEND (FIXED MIDDLEWARE)
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

// STRIPE INIT
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const app = express();
app.set('trust proxy', 1);

// VARIABLES
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const isPostgreSQL = Boolean(process.env.DATABASE_URL);

// ==================================================================
// 1. DATENBANK SETUP
// ==================================================================
let dbQuery;

if (isPostgreSQL) {
    const { Pool } = require('pg');
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
    dbQuery = async (text, params) => pool.query(text, params);
} else {
    const sqlite3 = require('sqlite3').verbose();
    const db = new sqlite3.Database('./database.sqlite');
    db.serialize(() => {
        db.run(`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE, access_code_hash TEXT, license_key_id INTEGER, is_blocked BOOLEAN DEFAULT 0, allowed_device_id TEXT, registered_at DATETIME DEFAULT CURRENT_TIMESTAMP, last_login DATETIME)`);
        db.run(`CREATE TABLE IF NOT EXISTS license_keys (id INTEGER PRIMARY KEY AUTOINCREMENT, key_code TEXT UNIQUE, key_hash TEXT, product_code TEXT, is_active BOOLEAN DEFAULT 1, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, activated_at DATETIME, expires_at DATETIME, username TEXT)`);
        db.run(`CREATE TABLE IF NOT EXISTS payments (id INTEGER PRIMARY KEY AUTOINCREMENT, payment_id TEXT, amount INTEGER, currency TEXT, status TEXT, metadata TEXT, completed_at DATETIME DEFAULT CURRENT_TIMESTAMP, stripe_session_id TEXT)`);
    });
    dbQuery = (text, params = []) => {
        return new Promise((resolve, reject) => {
            if (text.trim().toUpperCase().startsWith('SELECT')) {
                db.all(text, params, (err, rows) => { if (err) reject(err); else resolve({ rows }); });
            } else {
                db.run(text, params, function (err) { if (err) reject(err); else resolve({ rows: [], lastID: this.lastID, changes: this.changes }); });
            }
        });
    };
}

// ==================================================================
// 2. MIDDLEWARE (DEIN ORIGINAL CODE - WIEDERHERGESTELLT)
// ==================================================================

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      
      // WICHTIG: Hier müssen die QR-Code Bibliotheken erlaubt werden!
      scriptSrc: [
          "'self'", 
          "https://js.stripe.com", 
          "https://cdnjs.cloudflare.com", 
          "https://unpkg.com"
      ],
      scriptSrcElem: [
          "'self'", 
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

// RATE LIMITER DEFINITION
const rateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 Minuten
    max: 100, // Maximal 100 Anfragen pro IP
    message: { error: "Zu viele Anfragen, bitte versuchen Sie es später erneut." }
});

// WICHTIG: Raw Body für Stripe Webhooks, JSON für alles andere
app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));

app.use(express.static('public'));

// Logging Middleware (Hilft uns beim Debuggen)
app.use((req, res, next) => {
    // console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
});

// ==================================================================
// 3. AUTH ROUTEN (LOGIN mit AUTO-DEVICE-FIX)
// ==================================================================

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

        const isBlocked = (user.is_blocked === true || user.is_blocked === 1);
        if (isBlocked) return res.status(403).json({ success: false, error: "Account ist gesperrt." });

        // --- DEVICE ID FIX (Damit du wieder reinkommst) ---
        if (user.allowed_device_id && user.allowed_device_id !== deviceId) {
            console.log(`⚠️ Neues Gerät erkannt. Aktualisiere Bindung für ${username}...`);
            await dbQuery("UPDATE users SET allowed_device_id = $1 WHERE id = $2", [deviceId, user.id]);
        } else if (!user.allowed_device_id) {
            await dbQuery("UPDATE users SET allowed_device_id = $1 WHERE id = $2", [deviceId, user.id]);
        }

        const token = jwt.sign({ id: user.id, username: user.username }, process.env.JWT_SECRET || 'secret', { expiresIn: '24h' });
        const updateSql = isPostgreSQL ? "UPDATE users SET last_login = NOW() WHERE id = $1" : "UPDATE users SET last_login = datetime('now') WHERE id = $1";
        await dbQuery(updateSql, [user.id]);

        res.json({ success: true, token, username: user.username, expiresAt: user.expires_at });

    } catch (err) {
        console.error("Login Error:", err);
        res.status(500).json({ success: false, error: "Serverfehler beim Login" });
    }
});

app.post('/api/auth/validate', async (req, res) => {
    const { token } = req.body;
    if (!token) return res.json({ valid: false });
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret');
        const userRes = await dbQuery(`SELECT u.*, l.expires_at FROM users u LEFT JOIN license_keys l ON u.license_key_id = l.id WHERE u.id = $1`, [decoded.id]);
        if (userRes.rows.length > 0) {
            const u = userRes.rows[0];
            if((u.is_blocked===1 || u.is_blocked===true)) return res.json({ valid: false });
            res.json({ valid: true, username: u.username, expiresAt: u.expires_at });
        } else { res.json({ valid: false }); }
    } catch (e) { res.json({ valid: false }); }
});

app.delete('/api/auth/delete-account', async (req, res) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if(!token) return res.status(401).json({error: "No Token"});
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret');
        await dbQuery("DELETE FROM users WHERE id = $1", [decoded.id]);
        res.json({ success: true });
    } catch(e) { res.status(500).json({ success: false }); }
});

// ==================================================================
// 4. ADMIN DASHBOARD ROUTEN
// ==================================================================

const requireAdmin = (req, res, next) => {
    const pass = req.headers['x-admin-password'] || req.body.password;
    
    // DEBUGGING LOG (Damit wir sehen was ankommt)
    console.log(`[ADMIN LOGIN] Input: "${pass}" | Soll: "${ADMIN_PASSWORD}"`);

    if (pass !== ADMIN_PASSWORD) return res.status(403).json({ success: false, error: 'Admin Auth Failed' });
    next();
};

app.get('/api/admin/stats', requireAdmin, async (req, res) => {
    try {
        const now = isPostgreSQL ? 'NOW()' : 'DATETIME("now")';
        const activeUsers = await dbQuery(`SELECT COUNT(*) as c FROM users WHERE is_blocked = 0 OR is_blocked = false`);
        const blockedUsers = await dbQuery(`SELECT COUNT(*) as c FROM users WHERE is_blocked = 1 OR is_blocked = true`);
        const activeKeys = await dbQuery(`SELECT COUNT(*) as c FROM license_keys WHERE is_active = 1 OR is_active = true`);
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
    } catch (e) { res.json({ success: false }); }
});

app.get('/api/admin/keys', requireAdmin, async (req, res) => {
    try {
        const result = await dbQuery(`SELECT k.*, u.id as user_id FROM license_keys k LEFT JOIN users u ON u.license_key_id = k.id ORDER BY k.created_at DESC LIMIT 200`);
        res.json(result.rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/users', requireAdmin, async (req, res) => {
    try {
        const result = await dbQuery(`SELECT u.*, k.key_code FROM users u LEFT JOIN license_keys k ON u.license_key_id = k.id ORDER BY u.registered_at DESC LIMIT 100`);
        const users = result.rows.map(u => ({...u, is_blocked: (u.is_blocked===1 || u.is_blocked===true)}));
        res.json(users);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/admin/keys/:id', requireAdmin, async (req, res) => {
    const keyId = req.params.id;
    const { expires_at, user_id } = req.body;
    try {
        await dbQuery("UPDATE license_keys SET expires_at = $1 WHERE id = $2", [expires_at || null, keyId]);
        await dbQuery("UPDATE users SET license_key_id = NULL WHERE license_key_id = $1", [keyId]);
        if (user_id) await dbQuery("UPDATE users SET license_key_id = $1 WHERE id = $2", [keyId, user_id]);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false }); }
});

app.post('/api/admin/generate-keys', requireAdmin, async (req, res) => {
    try {
        const { product, count } = req.body;
        const newKeys = [];
        for(let i=0; i<(count || 1); i++) {
            const keyRaw = crypto.randomBytes(16).toString('hex').toUpperCase().match(/.{4}/g).join('-');
            const keyHash = await bcrypt.hash(keyRaw, 10);
            await dbQuery("INSERT INTO license_keys (key_code, key_hash, product_code, is_active) VALUES ($1, $2, $3, true)", [keyRaw, keyHash, product]);
            newKeys.push(keyRaw);
        }
        res.json({ success: true, keys: newKeys });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

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

app.get('/api/admin/purchases', requireAdmin, async (req, res) => {
    try {
        const result = await dbQuery("SELECT * FROM payments ORDER BY completed_at DESC LIMIT 100");
        const purchases = result.rows.map(r => {
            let meta = {};
            try { meta = JSON.parse(r.metadata); } catch(e){}
            return { id: r.payment_id, email: meta.customer_email || '?', product: meta.product_type || '?', amount: r.amount, currency: r.currency, date: r.completed_at, status: r.status };
        });
        res.json(purchases);
    } catch (e) { res.json([]); }
});

// ==================================================================
// 5. PAYMENT & RENEWAL ROUTES
// ==================================================================

app.post('/api/create-checkout-session', async (req, res) => {
    try {
        const { product_type, customer_email, is_renewal } = req.body;
        const prices = { '1m': 199, '3m': 449, '12m': 1499, 'unlimited': 4999, 'bundle_1m_2': 379, 'bundle_3m_2': 799, 'bundle_3m_5': 1999, 'bundle_1y_10': 12999 };
        const price = prices[product_type];
        if (!price) return res.status(400).json({ error: 'Produkt ungültig' });

        let metadata = { product_type, type: 'new_license' };

        if (is_renewal) {
            const authHeader = req.headers['authorization'];
            const token = authHeader && authHeader.split(' ')[1];
            if (!token) return res.status(401).json({ error: 'Auth erforderlich' });
            try {
                const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret');
                const userRes = await dbQuery("SELECT license_key_id FROM users WHERE id = $1", [decoded.id]);
                if (userRes.rows.length === 0 || !userRes.rows[0].license_key_id) return res.status(400).json({ error: 'Keine Lizenz zum Verlängern' });
                metadata.type = 'renewal';
                metadata.license_key_id = userRes.rows[0].license_key_id;
            } catch(e) { return res.status(403).json({error:"Token invalid"}); }
        } else {
            metadata.customer_email = customer_email;
        }

        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: [{ price_data: { currency: 'eur', product_data: { name: is_renewal ? `Verlängerung (${product_type})` : `Lizenz (${product_type})` }, unit_amount: price }, quantity: 1 }],
            mode: 'payment',
            metadata: metadata,
            success_url: `${req.protocol}://${req.get('host')}/store.html?session_id={CHECKOUT_SESSION_ID}&success=true`,
            cancel_url: `${req.protocol}://${req.get('host')}/store.html?canceled=true`,
        });
        res.json({ success: true, checkout_url: session.url });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/order-status', async (req, res) => {
    const { session_id } = req.query;
    if (!session_id) return res.json({ success: false });
    try {
        const session = await stripe.checkout.sessions.retrieve(session_id);
        if (session.payment_status === 'paid') {
            const check = await dbQuery("SELECT id FROM payments WHERE stripe_session_id = $1", [session_id]);
            if (check.rows.length > 0) return res.json({ success: true, status: 'completed', message: 'Already processed' });

            const meta = session.metadata || {};
            await dbQuery("INSERT INTO payments (stripe_session_id, amount, currency, status, metadata) VALUES ($1, $2, $3, $4, $5)", [session.id, session.amount_total, session.currency, 'completed', JSON.stringify(meta)]);

            if (meta.type === 'renewal' && meta.license_key_id) {
                const map = { '1m': 1, '3m': 3, '12m': 12, 'unlimited': 999 };
                const months = map[meta.product_type] || 1;
                const updateSQL = isPostgreSQL 
                    ? `UPDATE license_keys SET expires_at = (CASE WHEN expires_at > NOW() THEN expires_at ELSE NOW() END) + interval '${months} month', is_active = true WHERE id = $1`
                    : `UPDATE license_keys SET expires_at = datetime((CASE WHEN expires_at > datetime('now') THEN expires_at ELSE datetime('now') END), '+${months} months'), is_active = 1 WHERE id = $1`;
                await dbQuery(updateSQL, [meta.license_key_id]);
                return res.json({ success: true, status: 'completed', renewed: true });
            } else {
                const countMap = { 'bundle_1m_2': 2, 'bundle_3m_2': 2, 'bundle_3m_5': 5, 'bundle_1y_10': 10 };
                const count = countMap[meta.product_type] || 1;
                const newKeys = [];
                for(let i=0; i<count; i++) {
                     const keyRaw = crypto.randomBytes(16).toString('hex').toUpperCase().match(/.{4}/g).join('-');
                     const keyHash = await bcrypt.hash(keyRaw, 10);
                     await dbQuery("INSERT INTO license_keys (key_code, key_hash, product_code, is_active) VALUES ($1, $2, $3, true)", [keyRaw, keyHash, meta.product_type]);
                     newKeys.push(keyRaw);
                }
                return res.json({ success: true, status: 'completed', keys: newKeys });
            }
        }
        res.json({ success: true, status: session.payment_status });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ==================================================================
// 6. START
// ==================================================================

app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => {
    console.log(`🚀 Server running on Port ${PORT}`);
});
