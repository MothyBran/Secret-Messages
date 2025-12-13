// ==================================================================
// SERVER.JS - FINAL FULL VERSION (All-in-One)
// Enthält: Auth, Admin Dashboard, Stripe Payments, Database
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

// Initialisierung
const app = express();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
app.set('trust proxy', 1);

// Umgebungsvariablen
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'secret_fallback_key';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const DATABASE_URL = process.env.DATABASE_URL;

// ==================================================================
// 1. MIDDLEWARE & SECURITY
// ==================================================================

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      // WICHTIG: 'unsafe-inline' erlaubt Buttons im Admin Panel
      scriptSrc: ["'self'", "'unsafe-inline'", "https://js.stripe.com", "https://cdnjs.cloudflare.com", "https://unpkg.com"],
      scriptSrcAttr: ["'unsafe-inline'"], 
      scriptSrcElem: ["'self'", "'unsafe-inline'", "https://js.stripe.com", "https://cdnjs.cloudflare.com", "https://unpkg.com"],
      frameSrc: ["'self'", "https://js.stripe.com"],
      connectSrc: ["'self'", "https://api.stripe.com", "https://js.stripe.com"],
      imgSrc: ["'self'", "data:", "https:"]
    }
  }
}));

app.use(cors());

// Rate Limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, 
    max: 100, 
    message: { error: "Zu viele Anfragen." }
});

// JSON Parser mit Raw Body für Stripe Webhooks
app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));

app.use(express.static('public'));

// ==================================================================
// 2. DATENBANK (PostgreSQL & SQLite Support)
// ==================================================================

let dbQuery;
let isPostgreSQL = false;

if (DATABASE_URL && DATABASE_URL.includes('postgresql')) {
    console.log('📡 Using PostgreSQL');
    isPostgreSQL = true;
    const { Pool } = require('pg');
    const pool = new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
    dbQuery = async (text, params) => pool.query(text, params);
} else {
    console.log('📁 Using SQLite (Local)');
    const sqlite3 = require('sqlite3').verbose();
    const db = new sqlite3.Database('./database.sqlite');
    
    // Tabellen erstellen
    db.serialize(() => {
        db.run(`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE, access_code_hash TEXT, license_key_id INTEGER, is_blocked BOOLEAN DEFAULT 0, allowed_device_id TEXT, registered_at DATETIME DEFAULT CURRENT_TIMESTAMP, last_login DATETIME, is_online BOOLEAN DEFAULT 0)`);
        db.run(`CREATE TABLE IF NOT EXISTS license_keys (id INTEGER PRIMARY KEY AUTOINCREMENT, key_code TEXT UNIQUE, key_hash TEXT, product_code TEXT, is_active BOOLEAN DEFAULT 1, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, activated_at DATETIME, expires_at DATETIME, username TEXT)`);
        db.run(`CREATE TABLE IF NOT EXISTS payments (id INTEGER PRIMARY KEY AUTOINCREMENT, payment_id TEXT, amount INTEGER, currency TEXT, status TEXT, metadata TEXT, completed_at DATETIME DEFAULT CURRENT_TIMESTAMP, stripe_session_id TEXT)`);
    });

    dbQuery = (text, params = []) => {
        return new Promise((resolve, reject) => {
            const sql = text.replace(/\$\d+/g, '?'); // Postgres ($1) zu SQLite (?) Konvertierung
            if (text.trim().toUpperCase().startsWith('SELECT')) {
                db.all(sql, params, (err, rows) => { if (err) reject(err); else resolve({ rows }); });
            } else {
                db.run(sql, params, function(err) { if (err) reject(err); else resolve({ rows: [], lastID: this.lastID, changes: this.changes }); });
            }
        });
    };
}

// ==================================================================
// 3. AUTH ROUTES (Login, Register, Validate)
// ==================================================================

app.post('/api/auth/login', limiter, async (req, res) => {
    try {
        const { username, accessCode, deviceId } = req.body;
        // User & Lizenz laden
        const userRes = await dbQuery(`SELECT u.*, l.expires_at FROM users u LEFT JOIN license_keys l ON u.license_key_id = l.id WHERE u.username = $1`, [username]);

        if (userRes.rows.length === 0) return res.status(401).json({ success: false, error: "Benutzer nicht gefunden" });
        const user = userRes.rows[0];

        // Passwort Check
        const match = await bcrypt.compare(accessCode, user.access_code_hash);
        if (!match) return res.status(401).json({ success: false, error: "Falscher Code" });

        // Status Check
        const isBlocked = (user.is_blocked === true || user.is_blocked === 1);
        if (isBlocked) return res.status(403).json({ success: false, error: "Account gesperrt." });

        // Device Binding (Auto-Update Logik für Usability)
        if (deviceId) {
            if (!user.allowed_device_id || user.allowed_device_id !== deviceId) {
                await dbQuery("UPDATE users SET allowed_device_id = $1 WHERE id = $2", [deviceId, user.id]);
            }
        }

        // Token
        const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '24h' });
        
        // Login Zeit updaten
        const nowSql = isPostgreSQL ? 'NOW()' : "datetime('now')";
        await dbQuery(`UPDATE users SET last_login = ${nowSql} WHERE id = $1`, [user.id]);

        res.json({ success: true, token, username: user.username, expiresAt: user.expires_at || 'lifetime' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, error: "Serverfehler" });
    }
});

app.post('/api/auth/validate', async (req, res) => {
    const { token } = req.body;
    if (!token) return res.json({ valid: false });
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const userRes = await dbQuery(`SELECT u.*, l.expires_at FROM users u LEFT JOIN license_keys l ON u.license_key_id = l.id WHERE u.id = $1`, [decoded.id]);
        if (userRes.rows.length > 0) {
            const u = userRes.rows[0];
            const isBlocked = (u.is_blocked === true || u.is_blocked === 1);
            if(isBlocked) return res.json({ valid: false });
            res.json({ valid: true, username: u.username, expiresAt: u.expires_at });
        } else { res.json({ valid: false }); }
    } catch (e) { res.json({ valid: false }); }
});

app.post('/api/auth/activate', async (req, res) => {
    const { licenseKey, username, accessCode, deviceId } = req.body;
    try {
        // Key prüfen
        const keyRes = await dbQuery('SELECT * FROM license_keys WHERE key_code = $1', [licenseKey]);
        if (keyRes.rows.length === 0) return res.status(404).json({ error: 'Key ungültig' });
        const key = keyRes.rows[0];
        if (key.activated_at) return res.status(403).json({ error: 'Key bereits benutzt' });
        
        // User anlegen
        const hash = await bcrypt.hash(accessCode, 10);
        const nowSql = isPostgreSQL ? 'NOW()' : "datetime('now')";
        
        // 1. User Insert
        await dbQuery('INSERT INTO users (username, access_code_hash, license_key_id, allowed_device_id, registered_at) VALUES ($1, $2, $3, $4, '+nowSql+')', [username, hash, key.id, deviceId]);
        
        // 2. Key Update
        const trueVal = isPostgreSQL ? 'true' : '1';
        await dbQuery(`UPDATE license_keys SET is_active = ${trueVal}, activated_at = ${nowSql}, username = $1 WHERE id = $2`, [username, key.id]);
        
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: 'Fehler bei Aktivierung' }); }
});

// ==================================================================
// 4. ADMIN DASHBOARD ROUTES
// ==================================================================

const requireAdmin = (req, res, next) => {
    const pass = req.headers['x-admin-password'] || req.body.password;
    if (pass !== ADMIN_PASSWORD) return res.status(403).json({ success: false, error: 'Auth Failed' });
    next();
};

app.get('/api/admin/stats', requireAdmin, async (req, res) => {
    try {
        const now = isPostgreSQL ? 'NOW()' : 'DATETIME("now")';
        const trueVal = isPostgreSQL ? 'true' : '1';
        const falseVal = isPostgreSQL ? 'false' : '0';

        const activeUsers = await dbQuery(`SELECT COUNT(*) as c FROM users WHERE is_blocked = ${falseVal}`);
        const blockedUsers = await dbQuery(`SELECT COUNT(*) as c FROM users WHERE is_blocked = ${trueVal}`);
        const activeKeys = await dbQuery(`SELECT COUNT(*) as c FROM license_keys WHERE is_active = ${trueVal}`);
        const expiredKeys = await dbQuery(`SELECT COUNT(*) as c FROM license_keys WHERE expires_at IS NOT NULL AND expires_at <= ${now}`);
        const purchases = await dbQuery(`SELECT COUNT(*) as c FROM payments WHERE status = 'completed'`);
        const revenue = await dbQuery(`SELECT SUM(amount) as s FROM payments WHERE status = 'completed'`);
        
        res.json({
            success: true,
            stats: {
                users_active: activeUsers.rows[0].c,
                users_blocked: blockedUsers.rows[0].c,
                keys_active: activeKeys.rows[0].c,
                keys_expired: expiredKeys.rows[0].c,
                purchases_count: purchases.rows[0].c,
                revenue_total: (revenue.rows[0].s || 0)
            }
        });
    } catch (e) { res.json({ success: false }); }
});

app.get('/api/admin/users', requireAdmin, async (req, res) => {
    try {
        const resDb = await dbQuery(`SELECT u.*, k.key_code FROM users u LEFT JOIN license_keys k ON u.license_key_id = k.id ORDER BY u.registered_at DESC LIMIT 100`);
        const users = resDb.rows.map(u => ({ ...u, is_blocked: (u.is_blocked===1 || u.is_blocked===true) }));
        res.json(users);
    } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/keys', requireAdmin, async (req, res) => {
    try {
        const resDb = await dbQuery(`SELECT k.*, u.id as user_id FROM license_keys k LEFT JOIN users u ON u.license_key_id = k.id ORDER BY k.created_at DESC LIMIT 200`);
        const keys = resDb.rows.map(k => ({ ...k, is_active: (k.is_active===1 || k.is_active===true) }));
        res.json(keys);
    } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/purchases', requireAdmin, async (req, res) => {
    try {
        const resDb = await dbQuery(`SELECT * FROM payments ORDER BY completed_at DESC LIMIT 100`);
        const purchases = resDb.rows.map(r => {
            let meta = {};
            try { meta = JSON.parse(r.metadata || '{}'); } catch(e){}
            return {
                id: r.payment_id,
                email: meta.customer_email || '?',
                product: meta.product_type || '?',
                amount: r.amount, currency: r.currency, date: r.completed_at, status: r.status
            };
        });
        res.json(purchases);
    } catch(e) { res.json([]); }
});

// ADMIN ACTIONS
app.post('/api/admin/block-user/:id', requireAdmin, async (req, res) => {
    const val = isPostgreSQL ? 'true' : '1';
    await dbQuery(`UPDATE users SET is_blocked = ${val} WHERE id = $1`, [req.params.id]);
    res.json({ success: true });
});

app.post('/api/admin/unblock-user/:id', requireAdmin, async (req, res) => {
    const val = isPostgreSQL ? 'false' : '0';
    await dbQuery(`UPDATE users SET is_blocked = ${val} WHERE id = $1`, [req.params.id]);
    res.json({ success: true });
});

app.post('/api/admin/reset-device/:id', requireAdmin, async (req, res) => {
    await dbQuery(`UPDATE users SET allowed_device_id = NULL WHERE id = $1`, [req.params.id]);
    res.json({ success: true });
});

app.put('/api/admin/keys/:id', requireAdmin, async (req, res) => {
    const { expires_at, user_id } = req.body;
    try {
        await dbQuery(`UPDATE license_keys SET expires_at = $1 WHERE id = $2`, [expires_at || null, req.params.id]);
        if(user_id) {
            // Umhängen des Keys
            await dbQuery(`UPDATE users SET license_key_id = NULL WHERE license_key_id = $1`, [req.params.id]);
            await dbQuery(`UPDATE users SET license_key_id = $1 WHERE id = $2`, [req.params.id, user_id]);
        }
        res.json({ success: true });
    } catch(e) { res.status(500).json({ success: false }); }
});

app.post('/api/admin/generate-keys', requireAdmin, async (req, res) => {
    try {
        const { product, count } = req.body;
        const amount = parseInt(count) || 1;
        const newKeys = [];
        const trueVal = isPostgreSQL ? 'true' : '1';

        for(let i=0; i<amount; i++) {
            const keyRaw = crypto.randomBytes(8).toString('hex').toUpperCase().match(/.{4}/g).join('-');
            const keyHash = await bcrypt.hash(keyRaw, 10);
            await dbQuery(`INSERT INTO license_keys (key_code, key_hash, product_code, is_active) VALUES ($1, $2, $3, ${trueVal})`, [keyRaw, keyHash, product]);
            newKeys.push(keyRaw);
        }
        res.json({ success: true, keys: newKeys });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

// ==================================================================
// 5. PAYMENT ROUTES (STRIPE) - DIRECTLY INTEGRATED
// ==================================================================

app.post('/api/create-checkout-session', async (req, res) => {
    try {
        const { product_type, customer_email, is_renewal } = req.body;
        
        // Preise in Cent (Beispielwerte)
        const prices = {
            '1m': 199, '3m': 449, '12m': 1499, 'unlimited': 4999,
            'bundle_1m_2': 379, 'bundle_3m_2': 799, 'bundle_3m_5': 1999, 'bundle_1y_10': 12999
        };
        const price = prices[product_type];
        if (!price) return res.status(400).json({ error: 'Ungültiges Produkt' });

        let metadata = { product_type, type: 'new_license' };

        // Renewal Logik
        if (is_renewal) {
            const authHeader = req.headers['authorization'];
            const token = authHeader && authHeader.split(' ')[1];
            if (!token) return res.status(401).json({ error: 'Auth erforderlich' });
            
            try {
                const decoded = jwt.verify(token, JWT_SECRET);
                const userRes = await dbQuery("SELECT license_key_id FROM users WHERE id = $1", [decoded.id]);
                if (userRes.rows.length === 0 || !userRes.rows[0].license_key_id) return res.status(400).json({ error: 'Keine Lizenz' });
                metadata.type = 'renewal';
                metadata.license_key_id = userRes.rows[0].license_key_id;
            } catch(e) { return res.status(403).json({error: "Token invalid"}); }
        } else {
            metadata.customer_email = customer_email;
        }

        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: [{
                price_data: {
                    currency: 'eur',
                    product_data: { name: is_renewal ? `Verlängerung (${product_type})` : `Lizenz (${product_type})` },
                    unit_amount: price,
                },
                quantity: 1,
            }],
            mode: 'payment',
            metadata: metadata,
            success_url: `${req.protocol}://${req.get('host')}/store.html?session_id={CHECKOUT_SESSION_ID}&success=true`,
            cancel_url: `${req.protocol}://${req.get('host')}/store.html?canceled=true`,
        });

        res.json({ success: true, checkout_url: session.url });
    } catch (e) {
        console.error("Stripe Error:", e);
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/order-status', async (req, res) => {
    const { session_id } = req.query;
    if (!session_id) return res.json({ success: false });

    try {
        const session = await stripe.checkout.sessions.retrieve(session_id);
        
        if (session.payment_status === 'paid') {
            // Check ob schon bearbeitet
            const check = await dbQuery("SELECT id FROM payments WHERE stripe_session_id = $1", [session_id]);
            if (check.rows.length > 0) return res.json({ success: true, status: 'completed', message: "Already processed" });

            // Zahlung speichern
            const meta = session.metadata || {};
            const nowSql = isPostgreSQL ? 'NOW()' : "datetime('now')";
            await dbQuery(`INSERT INTO payments (stripe_session_id, amount, currency, status, metadata, completed_at) VALUES ($1, $2, $3, $4, $5, ${nowSql})`, 
                [session.id, session.amount_total, session.currency, 'completed', JSON.stringify(meta)]);

            const trueVal = isPostgreSQL ? 'true' : '1';

            // A) RENEWAL
            if (meta.type === 'renewal' && meta.license_key_id) {
                const map = { '1m': 1, '3m': 3, '12m': 12, 'unlimited': 999 };
                const months = map[meta.product_type] || 1;
                
                const updateSQL = isPostgreSQL 
                    ? `UPDATE license_keys SET expires_at = (CASE WHEN expires_at > NOW() THEN expires_at ELSE NOW() END) + interval '${months} month', is_active = true WHERE id = $1`
                    : `UPDATE license_keys SET expires_at = datetime((CASE WHEN expires_at > datetime('now') THEN expires_at ELSE datetime('now') END), '+${months} months'), is_active = 1 WHERE id = $1`;

                await dbQuery(updateSQL, [meta.license_key_id]);
                return res.json({ success: true, status: 'completed', renewed: true });

            } else {
                // B) NEW KEYS
                const countMap = { 'bundle_1m_2': 2, 'bundle_3m_2': 2, 'bundle_3m_5': 5, 'bundle_1y_10': 10 };
                const count = countMap[meta.product_type] || 1;
                const newKeys = [];

                for(let i=0; i<count; i++) {
                     const keyRaw = crypto.randomBytes(8).toString('hex').toUpperCase().match(/.{4}/g).join('-');
                     const keyHash = await bcrypt.hash(keyRaw, 10);
                     await dbQuery(`INSERT INTO license_keys (key_code, key_hash, product_code, is_active) VALUES ($1, $2, $3, ${trueVal})`, [keyRaw, keyHash, meta.product_type]);
                     newKeys.push(keyRaw);
                }
                return res.json({ success: true, status: 'completed', keys: newKeys });
            }
        }
        res.json({ success: true, status: session.payment_status });

    } catch (e) { res.status(500).json({ error: e.message }); }
});

// START
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => {
    console.log(`🚀 Server running on Port ${PORT}`);
});
