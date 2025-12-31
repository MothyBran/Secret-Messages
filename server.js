// server.js - Secret Messages Backend (Unified Version)

const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
let Resend;
try {
    const resendModule = require('resend');
    Resend = resendModule.Resend;
} catch (e) {
    console.warn("Resend module not found or failed to load:", e.message);
    Resend = class { emails = { send: async () => ({ id: 'mock' }) } };
}
const speakeasy = require('speakeasy');
const QRCode = require('qrcode');
require('dotenv').config();

// ENTERPRISE SWITCH
const IS_ENTERPRISE = process.env.APP_MODE === 'ENTERPRISE';
let enterpriseManager, socketServer;

if (IS_ENTERPRISE) {
    console.log("🏢 ENTERPRISE MODE ACTIVE");
    enterpriseManager = require('./enterprise/manager');
    socketServer = require('./enterprise/socketServer');
    // Initialize discovery ONLY if Activated (Hub Mode)
    // We check activation status async or via config load
    enterpriseManager.init().then(config => {
        if(config.activated) {
            require('./enterprise/discovery').start(process.env.PORT || 3000);
        }
    });
}

// MOCK CLOUD SERVICES IF ENTERPRISE
const resend = (!IS_ENTERPRISE && process.env.RESEND_API_KEY)
    ? new Resend(process.env.RESEND_API_KEY)
    : { emails: { send: async () => { console.log(">> MOCK MAIL SENT (Enterprise/No Key)"); return { id: 'mock' }; } } };

// Payment Routes (Mock if Enterprise)
const paymentRoutes = IS_ENTERPRISE ? (req, res, next) => next() : require('./payment.js');

const app = express();
app.set('trust proxy', 1);

// ==================================================================
// 1. MIDDLEWARE
// ==================================================================

// SSL & Canonical Redirect (WWW + HTTPS)
app.use((req, res, next) => {
    // Skip localhost (Development)
    if (req.hostname === 'localhost' || req.hostname === '127.0.0.1') return next();

    const isHttps = req.headers['x-forwarded-proto'] === 'https';
    const isRoot = req.hostname === 'secure-msg.app';

    // 1. Optimize: Redirect Root directly to WWW HTTPS (Avoids double redirect)
    if (isRoot) {
        return res.redirect(301, `https://www.secure-msg.app${req.url}`);
    }

    // 2. Force HTTPS for everything else (e.g. www)
    if (!isHttps) {
        return res.redirect(301, `https://${req.headers.host}${req.url}`);
    }

    next();
});

// MAINTENANCE MODE MIDDLEWARE
app.use(async (req, res, next) => {
    // 1. Exclude Admin, Auth, API (except specific checks if needed), and Static Files
    if (req.path.startsWith('/admin') ||
        req.path.startsWith('/api/admin') ||
        req.path.startsWith('/api/auth/login') ||
        req.path === '/maintenance' ||
        req.path.match(/\.(css|js|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot|json)$/)) {
        return next();
    }

    try {
        if (!dbQuery) return next(); // Database not ready

        const resSettings = await dbQuery("SELECT value FROM settings WHERE key = 'maintenance_mode'");
        const isMaintenance = resSettings.rows.length > 0 && resSettings.rows[0].value === 'true';

        if (isMaintenance) {
            // Check if it's an API request -> return 503
            if (req.path.startsWith('/api')) {
                return res.status(503).json({ error: 'MAINTENANCE_MODE' });
            }
            // Otherwise redirect to maintenance page
            return res.redirect('/maintenance');
        }
    } catch (e) {
        console.error("Maintenance Check Error:", e);
    }

    next();
});

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

app.use(cors({
    origin: ['https://secure-msg.app', 'https://www.secure-msg.app', 'http://localhost:3000'],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
    credentials: true
}));

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
    
    if (!IS_ENTERPRISE && DATABASE_URL && DATABASE_URL.includes('postgresql')) {
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

        await dbQuery(`CREATE TABLE IF NOT EXISTS settings (
            key VARCHAR(50) PRIMARY KEY,
            value TEXT
        )`);

        await dbQuery(`CREATE TABLE IF NOT EXISTS license_bundles (
            id ${isPostgreSQL ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT'},
            name VARCHAR(100),
            order_number VARCHAR(50),
            total_keys INTEGER DEFAULT 0,
            expires_at ${isPostgreSQL ? 'TIMESTAMP' : 'DATETIME'},
            created_at ${isPostgreSQL ? 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP' : 'DATETIME DEFAULT CURRENT_TIMESTAMP'}
        )`);

        await dbQuery(`CREATE TABLE IF NOT EXISTS messages (
            id ${isPostgreSQL ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT'},
            recipient_id INTEGER,
            subject VARCHAR(255),
            body TEXT,
            is_read ${isPostgreSQL ? 'BOOLEAN DEFAULT FALSE' : 'INTEGER DEFAULT 0'},
            type VARCHAR(50),
            created_at ${isPostgreSQL ? 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP' : 'DATETIME DEFAULT CURRENT_TIMESTAMP'},
            expires_at ${isPostgreSQL ? 'TIMESTAMP' : 'DATETIME'}
        )`);

        await dbQuery(`CREATE TABLE IF NOT EXISTS support_tickets (
            id ${isPostgreSQL ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT'},
            ticket_id VARCHAR(50),
            username VARCHAR(50),
            email VARCHAR(100),
            subject VARCHAR(255),
            message TEXT,
            created_at ${isPostgreSQL ? 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP' : 'DATETIME DEFAULT CURRENT_TIMESTAMP'},
            status VARCHAR(20) DEFAULT 'open'
        )`);

        // Add columns to license_keys if missing (Schema Migration)
        try { await dbQuery(`ALTER TABLE license_keys ADD COLUMN bundle_id INTEGER`); } catch (e) { }
        try { await dbQuery(`ALTER TABLE license_keys ADD COLUMN assigned_user_id VARCHAR(50)`); } catch (e) { }
        try { await dbQuery(`ALTER TABLE license_keys ADD COLUMN client_name VARCHAR(100)`); } catch (e) { }
        try { await dbQuery(`ALTER TABLE license_keys ADD COLUMN max_users INTEGER DEFAULT 1`); } catch (e) { }
        try { await dbQuery(`ALTER TABLE license_keys ADD COLUMN is_blocked ${isPostgreSQL ? 'BOOLEAN DEFAULT FALSE' : 'INTEGER DEFAULT 0'}`); } catch (e) { }

        // Add columns to messages for Ticket System
        try { await dbQuery(`ALTER TABLE messages ADD COLUMN status VARCHAR(20) DEFAULT 'open'`); } catch (e) { }
        try { await dbQuery(`ALTER TABLE messages ADD COLUMN ticket_id VARCHAR(50)`); } catch (e) { }

        // Initialize Settings Defaults
        try {
            const mCheck = await dbQuery("SELECT value FROM settings WHERE key = 'maintenance_mode'");
            if (mCheck.rows.length === 0) {
                await dbQuery("INSERT INTO settings (key, value) VALUES ('maintenance_mode', 'false')");
            }
            const sCheck = await dbQuery("SELECT value FROM settings WHERE key = 'shop_active'");
            if (sCheck.rows.length === 0) {
                await dbQuery("INSERT INTO settings (key, value) VALUES ('shop_active', 'true')");
            }
            // Template for Ticket Replies
            const tCheck = await dbQuery("SELECT value FROM settings WHERE key = 'ticket_reply_template'");
            if (tCheck.rows.length === 0) {
                const defaultTemplate = "Hallo {username},\n\n[TEXT]\n\nMit freundlichen Grüßen,\nIhr Support-Team";
                await dbQuery("INSERT INTO settings (key, value) VALUES ('ticket_reply_template', $1)", [defaultTemplate]);
            }
        } catch (e) { console.warn("Settings init warning:", e.message); }

        console.log('✅ Tables checked/created');
    } catch (e) { console.error("Table creation error:", e); }
};

initializeDatabase();

// ==================================================================
// 3. AUTHENTICATION & APP ROUTES
// ==================================================================

app.get('/api/ping', (req, res) => res.json({ status: 'ok' }));

app.get('/api/shop-status', async (req, res) => {
    try {
        const result = await dbQuery("SELECT value FROM settings WHERE key = 'shop_active'");
        const active = result.rows.length > 0 && result.rows[0].value === 'true';
        res.json({ active });
    } catch (e) { res.status(500).json({ error: 'DB Error' }); }
});

// SUPPORT ENDPOINT
app.post('/api/support', rateLimiter, async (req, res) => {
    console.log(`>> Anfrage erhalten für: ${req.body.username || req.body.email}`);
    const { username, subject, email, message } = req.body;

    if ((!email && !username) || !message || !subject) {
        return res.status(400).json({ success: false, error: 'Bitte Pflichtfelder ausfüllen.' });
    }

    // 1. Ticket-Nummer generieren
    const ticketId = 'TIC-' + crypto.randomBytes(3).toString('hex').toUpperCase();
    const createdAt = new Date().toISOString();

    try {
        // DB SAVE
        await dbQuery(
            `INSERT INTO support_tickets (ticket_id, username, email, subject, message, created_at, status) VALUES ($1, $2, $3, $4, $5, $6, 'open')`,
            [ticketId, username || null, email || null, subject, message, createdAt]
        );

        // --- NEW: Copy to User Inbox if registered ---
        if (username) {
            try {
                const userRes = await dbQuery('SELECT id FROM users WHERE username = $1', [username]);
                if (userRes.rows.length > 0) {
                    const userId = userRes.rows[0].id;
                    await dbQuery(
                        `INSERT INTO messages (recipient_id, subject, body, type, is_read, created_at, status, ticket_id)
                         VALUES ($1, $2, $3, 'ticket', ${isPostgreSQL ? 'true' : '1'}, $4, 'open', $5)`,
                        [userId, `[Ticket: ${ticketId}] ${subject}`, message, createdAt, ticketId]
                    );
                }
            } catch (err) {
                console.warn(">> Could not save copy to user inbox:", err.message);
            }
        }
        // ---------------------------------------------

        console.log(`>> Sende Support-Email via Resend (Ticket: ${ticketId})...`);

        const receiver = process.env.EMAIL_RECEIVER || 'support@secure-msg.app';
        const sender = 'support@secure-msg.app';

        // 1. Email an Support-Team
        const replyTo = email || 'no-reply@secure-msg.app';

        const { error: errorTeam } = await resend.emails.send({
            from: sender,
            to: receiver,
            reply_to: replyTo,
            subject: `[SUPPORT] ${subject} [${ticketId}]`,
            text: `Neue Support-Anfrage [${ticketId}]\n\nVon: ${username || 'Gast'}\nEmail: ${email || 'Keine (Interner Support)'}\nBetreff: ${subject}\n\nNachricht:\n${message}`,
            html: `
                <h3>Neue Support-Anfrage <span style="color:#00BFFF;">${ticketId}</span></h3>
                <p><strong>Von:</strong> ${username || 'Gast'}</p>
                <p><strong>Email:</strong> ${email || 'Keine (Interner Support)'}</p>
                <p><strong>Betreff:</strong> ${subject}</p>
                <hr>
                <p style="white-space: pre-wrap;">${message}</p>
                ${username ? '<p style="color:green; font-weight:bold;">Interne ID vorhanden: ' + username + '</p>' : ''}
            `
        });

        if (errorTeam) {
            console.error('>> Resend API Error (Team):', errorTeam);
        }

        // 2. Bestätigung an Kunden (Auto-Reply) NUR wenn Email vorhanden
        if (email) {
            const { error: errorClient } = await resend.emails.send({
                from: sender,
                to: email,
                subject: `Bestätigung Ihrer Support-Anfrage [Ticket-Nr: ${ticketId}]`,
                html: `
                    <div style="font-family: Arial, sans-serif; color: #333; line-height: 1.6;">
                        <h3 style="color: #00BFFF;">Vielen Dank für Ihre Anfrage!</h3>
                        <p>Hallo ${username || 'Nutzer'},</p>
                        <p>Ihre Nachricht ist bei uns eingegangen. Unser Support-Team wird sich schnellstmöglich bei Ihnen melden.</p>
                        <p><strong>Ihre Ticket-Nummer:</strong> ${ticketId}</p>
                        <div style="background-color: #f4f4f4; padding: 15px; border-left: 4px solid #00BFFF; margin: 20px 0; color: #555;">
                            <strong>Ihre Nachricht:</strong><br><br>
                            ${message.replace(/\n/g, '<br>')}
                        </div>
                        <br>
                        <hr style="border: 0; border-top: 1px solid #ddd;">
                        <div style="font-size: 12px; color: #777;">
                            <p><strong>Secure Message Support Team</strong></p>
                        </div>
                    </div>
                `
            });

            if (errorClient) {
                console.warn('>> Warnung: Bestätigungsmail konnte nicht gesendet werden:', errorClient);
            }
        }

        console.log(`>> Support-Vorgang erfolgreich. Ticket: ${ticketId}`);
        return res.status(200).json({ success: true, ticketId });

    } catch (error) {
        console.error(`>> Unerwarteter Fehler: ${error.message}`);
        console.error(error);
        return res.status(500).json({ success: false, error: "Versand fehlgeschlagen: " + error.message });
    }
});

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
            SELECT u.*, l.expires_at, l.is_blocked as key_blocked
            FROM users u
            LEFT JOIN license_keys l ON u.license_key_id = l.id
            WHERE u.username = $1
        `, [username]);

        if (userRes.rows.length === 0) return res.status(401).json({ success: false, error: "Benutzer nicht gefunden" });
        const user = userRes.rows[0];

        // CHECK IF LICENSE IS BLOCKED (Enterprise/Admin Block)
        const isKeyBlocked = isPostgreSQL ? user.key_blocked : (user.key_blocked === 1);
        if (isKeyBlocked) {
            return res.status(403).json({ success: false, error: "LIZENZ GESPERRT" });
        }

        const match = await bcrypt.compare(accessCode, user.access_code_hash);
        if (!match) return res.status(401).json({ success: false, error: "Falscher Zugangscode" });

        // HARD LOGIN BLOCK
        const isBlocked = isPostgreSQL ? user.is_blocked : (user.is_blocked === 1);
        if (isBlocked) {
            return res.status(403).json({ success: false, error: "ACCOUNT_BLOCKED" });
        }

        if (user.allowed_device_id && user.allowed_device_id !== deviceId) {
            // STRICT HARDWARE BINDING - BLOCK ACCESS
            return res.status(403).json({ success: false, error: "DEVICE_NOT_AUTHORIZED" });
        }
        if (!user.allowed_device_id) {
            const sanitizedDeviceId = deviceId.replace(/[^a-zA-Z0-9-]/g, '').substring(0, 50);
            await dbQuery("UPDATE users SET allowed_device_id = $1 WHERE id = $2", [deviceId, user.id]);

            const msgSubject = "Sicherheits-Info: Neues Gerät verknüpft";
            const msgBody = `Ihr Account wurde erfolgreich mit diesem Gerät verknüpft.\nGerät-ID: ${sanitizedDeviceId}`;

            await dbQuery("INSERT INTO messages (recipient_id, subject, body, type, is_read, created_at) VALUES ($1, $2, $3, $4, $5, $6)",
                [user.id, msgSubject, msgBody, 'automated', (isPostgreSQL ? false : 0), new Date().toISOString()]);
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

        const isBlocked = isPostgreSQL ? key.is_blocked : (key.is_blocked === 1);
        if (isBlocked) return res.status(403).json({ error: 'Lizenz gesperrt' });

        if (key.activated_at) return res.status(403).json({ error: 'Key bereits benutzt' });

        // CHECK ASSIGNED ID
        if (key.assigned_user_id) {
            if (key.assigned_user_id !== username) {
                return res.status(403).json({ error: 'Dieser Key ist für eine andere ID reserviert.' });
            }
        }

        const userRes = await dbQuery('SELECT id FROM users WHERE username = $1', [username]);
        if (userRes.rows.length > 0) return res.status(409).json({ error: 'Username vergeben' });

        // CALCULATE EXPIRATION
        let expiresAt = null;
        const now = new Date();
        const pc = (key.product_code || '').toLowerCase();

        if (pc === '1m') { now.setMonth(now.getMonth() + 1); expiresAt = now.toISOString(); }
        else if (pc === '3m') { now.setMonth(now.getMonth() + 3); expiresAt = now.toISOString(); }
        else if (pc === '6m') { now.setMonth(now.getMonth() + 6); expiresAt = now.toISOString(); }
        else if (pc === '1j' || pc === '12m') { now.setFullYear(now.getFullYear() + 1); expiresAt = now.toISOString(); }
        else if (pc === 'unl' || pc === 'unlimited') { expiresAt = null; }
        else { expiresAt = null; }

        const hash = await bcrypt.hash(accessCode, 10);

        let insertSql = 'INSERT INTO users (username, access_code_hash, license_key_id, allowed_device_id, registered_at) VALUES ($1, $2, $3, $4, $5)';
        if (isPostgreSQL) { insertSql += ' RETURNING id'; }

        const insertUser = await dbQuery(insertSql, [username, hash, key.id, deviceId, new Date().toISOString()]);

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

app.post('/api/auth/check-license', async (req, res) => {
    try {
        const { licenseKey } = req.body;
        if (!licenseKey) return res.status(400).json({ error: "Kein Key" });
        const keyRes = await dbQuery('SELECT assigned_user_id, is_active, is_blocked FROM license_keys WHERE key_code = $1', [licenseKey]);
        if (keyRes.rows.length === 0) return res.json({ isValid: false });

        const key = keyRes.rows[0];

        const isBlocked = isPostgreSQL ? key.is_blocked : (key.is_blocked === 1);
        if (isBlocked) return res.json({ isValid: false, error: 'Lizenz gesperrt' });

        const isActive = isPostgreSQL ? key.is_active : (key.is_active === 1);
        if (isActive) return res.json({ isValid: false, error: 'Bereits benutzt' });

        res.json({ isValid: true, assignedUserId: key.assigned_user_id || null });
    } catch (e) { res.status(500).json({ error: 'Serverfehler' }); }
});

app.post('/api/auth/change-code', authenticateUser, async (req, res) => {
    try {
        const { newAccessCode } = req.body;
        const hash = await bcrypt.hash(newAccessCode, 10);
        await dbQuery("UPDATE users SET access_code_hash = $1 WHERE id = $2", [hash, req.user.id]);
        res.json({ success: true });
    } catch(e) { res.status(500).json({ error: "Fehler beim Ändern." }); }
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
        const userRes = await dbQuery('SELECT username, license_key_id FROM users WHERE id = $1', [req.user.id]);
        if (userRes.rows.length === 0) return res.status(404).json({ error: "User nicht gefunden" });
        const user = userRes.rows[0];
        let licenseCode = 'UNKNOWN';
        if (user.license_key_id) {
            const keyRes = await dbQuery('SELECT key_code FROM license_keys WHERE id = $1', [user.license_key_id]);
            if (keyRes.rows.length > 0) licenseCode = keyRes.rows[0].key_code;
        }
        await dbQuery('INSERT INTO account_deletions (username, license_key_code, reason, deleted_at) VALUES ($1, $2, $3, $4)',
            [user.username, licenseCode, 'user_request', new Date().toISOString()]);
        await dbQuery('DELETE FROM users WHERE id = $1', [req.user.id]);
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
        const userRes = await dbQuery(`SELECT u.*, l.expires_at, l.is_blocked as key_blocked FROM users u LEFT JOIN license_keys l ON u.license_key_id = l.id WHERE u.id = $1`, [decoded.id]);

        if (userRes.rows.length > 0) {
            const user = userRes.rows[0];
            const isBlocked = isPostgreSQL ? user.is_blocked : (user.is_blocked === 1);
            if (isBlocked) return res.json({ valid: false, reason: 'blocked' });

            const isKeyBlocked = isPostgreSQL ? user.key_blocked : (user.key_blocked === 1);
            if (isKeyBlocked) return res.json({ valid: false, reason: 'license_blocked' });
            if (!user.license_key_id) return res.json({ valid: false, reason: 'no_license' });
            let isExpired = false;
            if (user.expires_at) {
                const expDate = new Date(user.expires_at);
                if (expDate < new Date()) isExpired = true;
            }
            if (isExpired) return res.json({ valid: false, reason: 'expired', expiresAt: user.expires_at });
            res.json({ valid: true, username: user.username, expiresAt: user.expires_at });
        } else {
            res.json({ valid: false, reason: 'user_not_found' });
        }
    } catch (e) { res.json({ valid: false, reason: 'invalid_token' }); }
});

// ==================================================================
// 4. ADMIN DASHBOARD ROUTES
// ==================================================================

const requireAdmin = async (req, res, next) => {
    // 1. Check for Bearer Token (JWT)
    const authHeader = req.headers['authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.split(' ')[1];
        try {
            const decoded = jwt.verify(token, JWT_SECRET);
            if (decoded.role === 'admin') {
                return next();
            }
        } catch (e) { }
    }

    // 2. Fallback: Check for x-admin-password (LEGACY, only allowed if 2FA is DISABLED)
    // IMPORTANT: If 2FA is enabled, we REQUIRE JWT flow (which proves 2FA was passed)
    const sentPassword = req.headers['x-admin-password'] || req.body.password;
    if (sentPassword === ADMIN_PASSWORD) {
        // Check if 2FA is enabled globally
        if (dbQuery) { // Defensive check if db is ready
            const resSettings = await dbQuery("SELECT value FROM settings WHERE key = 'admin_2fa_enabled'");
            const is2FA = resSettings.rows.length > 0 && resSettings.rows[0].value === 'true';

            if (is2FA) {
                // Deny access if trying to bypass 2FA with just password
                console.warn('Blocked Admin Access: 2FA is enabled but not provided.');
                return res.status(403).json({ success: false, error: '2FA required. Please login.' });
            }
        }
        return next();
    }

    return res.status(403).json({ success: false, error: 'Admin Auth Failed' });
};

// ADMIN LOGIN ENDPOINT
app.post('/api/admin/auth', async (req, res) => {
    const { password } = req.body;
    // Check header for token as requested
    const token = req.headers['x-admin-2fa-token'] || req.body.token;

    if (password !== ADMIN_PASSWORD) {
        return res.status(403).json({ success: false, error: 'Falsches Passwort' });
    }

    try {
        // Check if 2FA secret exists (implies enabled)
        const resSecret = await dbQuery("SELECT value FROM settings WHERE key = 'admin_2fa_secret'");
        const hasSecret = resSecret.rows.length > 0 && resSecret.rows[0].value;

        if (hasSecret) {
            if (!token) return res.json({ success: false, error: '2FA Token erforderlich' });

            const secret = resSecret.rows[0].value;
            const verified = speakeasy.totp.verify({
                secret: secret,
                encoding: 'base32',
                token: token
            });

            if (!verified) return res.json({ success: false, error: 'Ungültiger 2FA Code' });
        }

        // Generate Admin JWT
        const jwtToken = jwt.sign({ role: 'admin' }, JWT_SECRET, { expiresIn: '4h' });
        res.json({ success: true, token: jwtToken });

    } catch (e) {
        console.error(e);
        res.status(500).json({ success: false, error: 'Auth Error' });
    }
});

// 2FA SETUP ENDPOINTS
app.get('/api/admin/2fa-setup', requireAdmin, async (req, res) => {
    try {
        // console.log('2FA Setup requested');
        const secret = speakeasy.generateSecret({ name: "SecureMsg Admin" });
        // Return secret and QR code data URL
        QRCode.toDataURL(secret.otpauth_url, async (err, data_url) => {
            if (err) return res.status(500).json({ success: false, error: 'QR Gen Error' });
            res.json({ success: true, secret: secret.base32, qrCode: data_url });
        });
    } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

// Legacy POST for compatibility if needed, but primary is GET now
app.post('/api/admin/2fa/setup', requireAdmin, async (req, res) => {
    // Redirect to GET logic or duplicate
    res.redirect(307, '/api/admin/2fa-setup');
});

app.post('/api/admin/2fa/verify', requireAdmin, async (req, res) => {
    const { token, secret } = req.body;
    try {
        const verified = speakeasy.totp.verify({
            secret: secret,
            encoding: 'base32',
            token: token
        });

        if (verified) {
            // Save secret and enable 2FA
            await dbQuery("INSERT INTO settings (key, value) VALUES ('admin_2fa_secret', $1) ON CONFLICT(key) DO UPDATE SET value = $1", [secret]);
            await dbQuery("INSERT INTO settings (key, value) VALUES ('admin_2fa_enabled', 'true') ON CONFLICT(key) DO UPDATE SET value = 'true'");
            res.json({ success: true });
        } else {
            res.json({ success: false, error: 'Ungültiger Code' });
        }
    } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post('/api/admin/2fa/disable', requireAdmin, async (req, res) => {
    try {
        await dbQuery("UPDATE settings SET value = 'false' WHERE key = 'admin_2fa_enabled'");
        res.json({ success: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/stats', requireAdmin, async (req, res) => {
    try {
        const now = isPostgreSQL ? 'NOW()' : 'DATETIME("now")';
        const activeUsers = await dbQuery(`SELECT COUNT(*) as c FROM users WHERE is_blocked = ${isPostgreSQL ? 'false' : '0'}`);
        const blockedUsers = await dbQuery(`SELECT COUNT(*) as c FROM users WHERE is_blocked = ${isPostgreSQL ? 'true' : '1'}`);
        const activeKeys = await dbQuery(`SELECT COUNT(*) as c FROM license_keys WHERE is_active = ${isPostgreSQL ? 'true' : '1'}`);
        const expiredKeys = await dbQuery(`SELECT COUNT(*) as c FROM license_keys WHERE expires_at IS NOT NULL AND expires_at <= ${now}`);
        const totalPurchases = await dbQuery(`SELECT COUNT(*) as c FROM payments WHERE status = 'completed'`);
        const totalRevenue = await dbQuery(`SELECT SUM(amount) as s FROM payments WHERE status = 'completed'`);
        const totalBundles = await dbQuery(`SELECT COUNT(*) as c FROM license_bundles`);
        const unassignedBundleKeys = await dbQuery(`SELECT COUNT(*) as c FROM license_keys WHERE bundle_id IS NOT NULL AND is_active = ${isPostgreSQL ? 'false' : '0'}`);

        res.json({
            success: true,
            stats: {
                users_active: activeUsers.rows[0].c,
                users_blocked: blockedUsers.rows[0].c,
                keys_active: activeKeys.rows[0].c,
                keys_expired: expiredKeys.rows[0].c,
                purchases_count: totalPurchases.rows[0].c,
                revenue_total: (totalRevenue.rows[0].s || 0),
                bundles_active: totalBundles.rows[0].c,
                bundle_keys_unassigned: unassignedBundleKeys.rows[0].c
            }
        });
    } catch (e) { res.json({ success: false, error: 'DB Error' }); }
});

app.get('/api/admin/keys', requireAdmin, async (req, res) => {
    try {
        const sql = `SELECT k.*, u.username, u.id as user_id
                     FROM license_keys k
                     LEFT JOIN users u ON u.license_key_id = k.id
                     WHERE (k.product_code != 'ENTERPRISE' OR k.product_code IS NULL)
                     ORDER BY k.created_at DESC LIMIT 200`;
        const result = await dbQuery(sql);
        const keys = result.rows.map(r => ({ ...r, is_active: isPostgreSQL ? r.is_active : (r.is_active === 1) }));
        res.json(keys);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/admin/keys/:id', requireAdmin, async (req, res) => {
    const keyId = req.params.id;
    const { expires_at, user_id, product_code } = req.body;
    try {
        let updateSql = `UPDATE license_keys SET expires_at = $1`;
        const params = [expires_at || null];
        let pIndex = 2;

        if (product_code) { updateSql += `, product_code = $${pIndex}`; params.push(product_code); pIndex++; }
        updateSql += ` WHERE id = $${pIndex}`; params.push(keyId);
        await dbQuery(updateSql, params);

        await dbQuery(`UPDATE users SET license_key_id = NULL WHERE license_key_id = $1`, [keyId]);
        if (user_id) {
            const userCheck = await dbQuery(`SELECT id FROM users WHERE id = $1`, [user_id]);
            if (userCheck.rows.length > 0) {
                await dbQuery(`UPDATE users SET license_key_id = $1 WHERE id = $2`, [keyId, user_id]);
                const now = new Date().toISOString();
                await dbQuery(`UPDATE license_keys SET is_active = ${isPostgreSQL ? 'true' : '1'}, activated_at = COALESCE(activated_at, $2) WHERE id = $1`, [keyId, now]);
            }
        }
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.delete('/api/admin/keys/:id', requireAdmin, async (req, res) => {
    const keyId = req.params.id;
    try {
        await dbQuery('UPDATE users SET license_key_id = NULL WHERE license_key_id = $1', [keyId]);
        await dbQuery('DELETE FROM license_keys WHERE id = $1', [keyId]);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, error: "Löschen fehlgeschlagen: " + e.message }); }
});

// ENTERPRISE MANAGEMENT
app.post('/api/admin/generate-enterprise', requireAdmin, async (req, res) => {
    try {
        const { clientName, quota, expiresAt } = req.body;

        // Generate Unique Master Key (Max 17 chars DB limit: ENT-XXXXX-XXXXX = 15 chars)
        const rand = crypto.randomBytes(5).toString('hex').toUpperCase(); // 10 chars
        const keyRaw = 'ENT-' + rand.substring(0, 5) + '-' + rand.substring(5, 10);
        const keyHash = crypto.createHash('sha256').update(keyRaw).digest('hex');

        const quotaInt = parseInt(quota) || 5;

        // Insert
        let insertSql = `INSERT INTO license_keys (key_code, key_hash, product_code, client_name, max_users, expires_at, is_active)
                         VALUES ($1, $2, 'ENTERPRISE', $3, $4, $5, ${isPostgreSQL ? 'false' : '0'})`;

        await dbQuery(insertSql, [keyRaw, keyHash, clientName, quotaInt, expiresAt || null]);

        res.json({ success: true, key: keyRaw });
    } catch (e) { res.status(500).json({ error: "Fehler: " + e.message }); }
});

app.get('/api/admin/enterprise-keys', requireAdmin, async (req, res) => {
    try {
        // Fetch Enterprise keys (Privacy Update: No usage tracking from Global Server)
        const sql = `
            SELECT k.*
            FROM license_keys k
            WHERE k.product_code = 'ENTERPRISE'
            ORDER BY k.created_at DESC
        `;
        const result = await dbQuery(sql);
        const keys = result.rows.map(r => ({
            ...r,
            is_active: isPostgreSQL ? r.is_active : (r.is_active === 1),
            is_blocked: isPostgreSQL ? r.is_blocked : (r.is_blocked === 1)
        }));
        res.json(keys);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/enterprise-keys/:id/toggle-block', requireAdmin, async (req, res) => {
    try {
        const { blocked } = req.body;
        const val = isPostgreSQL ? blocked : (blocked ? 1 : 0);
        await dbQuery(`UPDATE license_keys SET is_blocked = $1 WHERE id = $2`, [val, req.params.id]);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/admin/enterprise-keys/:id/quota', requireAdmin, async (req, res) => {
    try {
        const { quota } = req.body;
        await dbQuery(`UPDATE license_keys SET max_users = $1 WHERE id = $2`, [quota, req.params.id]);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/admin/enterprise-keys/:id', requireAdmin, async (req, res) => {
    try {
        const keyId = req.params.id;
        // Unlink users first
        await dbQuery('UPDATE users SET license_key_id = NULL WHERE license_key_id = $1', [keyId]);
        // Delete key
        await dbQuery('DELETE FROM license_keys WHERE id = $1', [keyId]);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/generate-keys', requireAdmin, async (req, res) => {
    try {
        const { productCode, count } = req.body;
        const amount = parseInt(count) || 1;
        const newKeys = [];
        for(let i=0; i < amount; i++) {
            const keyRaw = crypto.randomBytes(6).toString('hex').toUpperCase().match(/.{1,4}/g).join('-');
            const keyHash = crypto.createHash('sha256').update(keyRaw).digest('hex');
            await dbQuery(`INSERT INTO license_keys (key_code, key_hash, product_code, is_active) VALUES ($1, $2, $3, $4)`,
                [keyRaw, keyHash, productCode, (isPostgreSQL ? false : 0)]);
            newKeys.push(keyRaw);
        }
        res.json({ success: true, keys: newKeys });
    } catch (e) { res.status(500).json({ error: "Fehler beim Generieren: " + e.message }); }
});

app.post('/api/admin/generate-bundle', requireAdmin, async (req, res) => {
    try {
        const { name, count, productCode, idStem, startNumber } = req.body;
        const amount = parseInt(count) || 1;
        const start = parseInt(startNumber) || 1;
        const orderNum = 'ORD-' + crypto.randomBytes(4).toString('hex').toUpperCase();

        let insertBundle = await dbQuery(
            `INSERT INTO license_bundles (name, order_number, total_keys, created_at) VALUES ($1, $2, $3, $4) ${isPostgreSQL ? 'RETURNING id' : ''}`,
            [name, orderNum, amount, new Date().toISOString()]
        );
        let bundleId = isPostgreSQL ? insertBundle.rows[0].id : insertBundle.lastID;
        const newKeys = [];
        for(let i = 0; i < amount; i++) {
            const seqNum = start + i;
            const assignedId = `${idStem}${String(seqNum).padStart(3, '0')}`;
            const keyRaw = crypto.randomBytes(6).toString('hex').toUpperCase().match(/.{1,4}/g).join('-');
            const keyHash = crypto.createHash('sha256').update(keyRaw).digest('hex');
            await dbQuery(
                `INSERT INTO license_keys (key_code, key_hash, product_code, is_active, bundle_id, assigned_user_id) VALUES ($1, $2, $3, $4, $5, $6)`,
                [keyRaw, keyHash, productCode, (isPostgreSQL ? false : 0), bundleId, assignedId]
            );
            newKeys.push({ key: keyRaw, assignedId });
        }
        res.json({ success: true, bundleId, keys: newKeys });
    } catch(e) { res.status(500).json({ error: "Bundle Fehler: " + e.message }); }
});

app.get('/api/admin/bundles', requireAdmin, async (req, res) => {
    try {
        const sql = `
            SELECT b.*,
            (SELECT COUNT(*) FROM license_keys k WHERE k.bundle_id = b.id AND k.is_active = ${isPostgreSQL ? 'TRUE' : '1'}) as active_count
            FROM license_bundles b ORDER BY b.created_at DESC
        `;
        const result = await dbQuery(sql);
        res.json(result.rows);
    } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/bundles/:id/keys', requireAdmin, async (req, res) => {
    try {
        const sql = `SELECT key_code, assigned_user_id, is_active, expires_at FROM license_keys WHERE bundle_id = $1 ORDER BY assigned_user_id ASC`;
        const result = await dbQuery(sql, [req.params.id]);
        const keys = result.rows.map(r => ({ ...r, is_active: isPostgreSQL ? r.is_active : (r.is_active === 1) }));
        res.json(keys);
    } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/admin/bundles/:id/extend', requireAdmin, async (req, res) => {
    try {
        const { expires_at } = req.body;
        await dbQuery(`UPDATE license_keys SET expires_at = $1 WHERE bundle_id = $2`, [expires_at, req.params.id]);
        await dbQuery(`UPDATE license_bundles SET expires_at = $1 WHERE id = $2`, [expires_at, req.params.id]);
        res.json({ success: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/admin/bundles/:id', requireAdmin, async (req, res) => {
    try {
        const bundleId = req.params.id;
        // 1. Unlink Users assigned to keys in this bundle
        await dbQuery(`
            UPDATE users SET license_key_id = NULL
            WHERE license_key_id IN (SELECT id FROM license_keys WHERE bundle_id = $1)
        `, [bundleId]);

        // 2. Delete Keys
        await dbQuery(`DELETE FROM license_keys WHERE bundle_id = $1`, [bundleId]);

        // 3. Delete Bundle
        await dbQuery(`DELETE FROM license_bundles WHERE id = $1`, [bundleId]);

        res.json({ success: true });
    } catch(e) { res.status(500).json({ error: "Fehler beim Löschen: " + e.message }); }
});

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

app.post('/api/admin/block-user/:id', requireAdmin, async (req, res) => {
    try {
        await dbQuery("UPDATE users SET is_blocked = TRUE WHERE id = $1", [req.params.id]);
        await dbQuery("DELETE FROM user_sessions WHERE user_id = $1", [req.params.id]);
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

app.get('/api/admin/purchases', requireAdmin, async (req, res) => {
    try {
        const sql = `SELECT * FROM payments ORDER BY completed_at DESC LIMIT 100`;
        const result = await dbQuery(sql);
        const purchases = result.rows.map(r => {
            let meta = {};
            try { meta = (typeof r.metadata === 'string') ? JSON.parse(r.metadata) : r.metadata || {}; } catch(e){}
            const email = meta.email || meta.customer_email || meta.customerEmail || '?';
            return {
                id: r.payment_id,
                email: email,
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

// SUPPORT TICKETS (ADMIN)
app.get('/api/admin/support-tickets', requireAdmin, async (req, res) => {
    try {
        const result = await dbQuery(`SELECT * FROM support_tickets ORDER BY created_at DESC`);
        res.json(result.rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Update Ticket Status (Viewed/Open)
app.put('/api/admin/support-tickets/:id/status', requireAdmin, async (req, res) => {
    const { status } = req.body; // 'in_progress', 'closed'
    const ticketId = req.params.id; // Database ID (INT)
    try {
        // Get Ticket Details to find real ticket_id (String)
        const ticketRes = await dbQuery("SELECT ticket_id, username FROM support_tickets WHERE id = $1", [ticketId]);
        if (ticketRes.rows.length === 0) return res.status(404).json({ error: "Ticket not found" });
        const { ticket_id, username } = ticketRes.rows[0];

        // Update Ticket Status
        await dbQuery("UPDATE support_tickets SET status = $1 WHERE id = $2", [status, ticketId]);

        // Update Linked Message Status (if exists)
        if (ticket_id) {
            await dbQuery("UPDATE messages SET status = $1 WHERE ticket_id = $2", [status, ticket_id]);
        }

        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// NEW: Manual Status Update (Requested PATCH /messages/:id/status)
app.patch('/api/admin/messages/:id/status', requireAdmin, async (req, res) => {
    const { status } = req.body; // 'closed'
    const ticketId = req.params.id;
    try {
        const ticketRes = await dbQuery("SELECT ticket_id FROM support_tickets WHERE id = $1", [ticketId]);
        if (ticketRes.rows.length === 0) return res.status(404).json({ error: "Ticket not found" });
        const { ticket_id } = ticketRes.rows[0];

        await dbQuery("UPDATE support_tickets SET status = $1 WHERE id = $2", [status, ticketId]);

        if (ticket_id) {
            await dbQuery("UPDATE messages SET status = $1 WHERE ticket_id = $2", [status, ticket_id]);
        }
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// NEW: Delete Ticket Message (Requested DELETE /messages/:id)
app.delete('/api/admin/messages/:id', requireAdmin, async (req, res) => {
    const ticketId = req.params.id;
    try {
        // Get ticket details to clean up linked messages
        const ticketRes = await dbQuery("SELECT ticket_id FROM support_tickets WHERE id = $1", [ticketId]);

        if (ticketRes.rows.length > 0) {
            const { ticket_id } = ticketRes.rows[0];
            // Delete from messages if linked
            if (ticket_id) {
                await dbQuery("DELETE FROM messages WHERE ticket_id = $1", [ticket_id]);
            }
        }

        await dbQuery("DELETE FROM support_tickets WHERE id = $1", [ticketId]);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// Reply to Ticket
app.post('/api/admin/support-tickets/:id/reply', requireAdmin, async (req, res) => {
    const ticketDbId = req.params.id;
    const { message, username } = req.body;

    if (!message || !username) return res.status(400).json({ error: "Missing data" });

    try {
        // 1. Get Ticket Details
        const ticketRes = await dbQuery("SELECT ticket_id, subject FROM support_tickets WHERE id = $1", [ticketDbId]);
        if (ticketRes.rows.length === 0) return res.status(404).json({ error: "Ticket not found" });
        const { ticket_id, subject } = ticketRes.rows[0];

        // 2. Find User ID
        const userRes = await dbQuery("SELECT id FROM users WHERE username = $1", [username]);
        if (userRes.rows.length === 0) return res.status(404).json({ error: "User not found" });
        const userId = userRes.rows[0].id;

        // 3. Send Reply Message
        const replySubject = `RE: ${subject} - Ticket: #${ticket_id}`;
        await dbQuery(
            `INSERT INTO messages (recipient_id, subject, body, type, is_read, created_at)
             VALUES ($1, $2, $3, 'ticket_reply', ${isPostgreSQL ? 'false' : '0'}, $4)`,
            [userId, replySubject, message, new Date().toISOString()]
        );

        // 4. Close Ticket
        await dbQuery("UPDATE support_tickets SET status = 'closed' WHERE id = $1", [ticketDbId]);

        // 5. Close User's Original Ticket Message (Unlocks Delete)
        if (ticket_id) {
            await dbQuery("UPDATE messages SET status = 'closed' WHERE ticket_id = $1", [ticket_id]);
        }

        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/admin/support-tickets/:id', requireAdmin, async (req, res) => {
    try {
        await dbQuery(`DELETE FROM support_tickets WHERE id = $1`, [req.params.id]);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// Get/Set Settings (for Templates)
app.get('/api/admin/settings/:key', requireAdmin, async (req, res) => {
    try {
        const result = await dbQuery("SELECT value FROM settings WHERE key = $1", [req.params.key]);
        const val = result.rows.length > 0 ? result.rows[0].value : null;
        res.json({ success: true, value: val });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/settings', requireAdmin, async (req, res) => {
    try {
        const { key, value } = req.body;
        // Upsert logic (simplistic)
        const check = await dbQuery("SELECT key FROM settings WHERE key = $1", [key]);
        if (check.rows.length > 0) {
            await dbQuery("UPDATE settings SET value = $1 WHERE key = $2", [value, key]);
        } else {
            await dbQuery("INSERT INTO settings (key, value) VALUES ($1, $2)", [key, value]);
        }
        res.json({ success: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/maintenance-status', requireAdmin, async (req, res) => {
    try {
        const result = await dbQuery("SELECT value FROM settings WHERE key = 'maintenance_mode'");
        const isActive = result.rows.length > 0 && result.rows[0].value === 'true';
        res.json({ success: true, maintenance: isActive });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

app.post('/api/admin/toggle-maintenance', requireAdmin, async (req, res) => {
    try {
        const { active } = req.body;
        const val = active ? 'true' : 'false';
        await dbQuery("UPDATE settings SET value = $1 WHERE key = 'maintenance_mode'", [val]);
        res.json({ success: true, maintenance: active });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

app.get('/api/admin/shop-status', requireAdmin, async (req, res) => {
    try {
        const result = await dbQuery("SELECT value FROM settings WHERE key = 'shop_active'");
        const active = result.rows.length > 0 && result.rows[0].value === 'true';
        res.json({ success: true, active });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post('/api/admin/toggle-shop', requireAdmin, async (req, res) => {
    try {
        const { active } = req.body;
        const val = active ? 'true' : 'false';
        await dbQuery("UPDATE settings SET value = $1 WHERE key = 'shop_active'", [val]);
        res.json({ success: true, active });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get('/api/admin/system-status', requireAdmin, async (req, res) => {
    try {
        const dbRes = await dbQuery('SELECT 1');
        res.json({
            success: true,
            status: {
                serverTime: new Date().toISOString(),
                dbConnection: dbRes ? 'OK' : 'ERROR',
                platform: process.platform,
                uptime: process.uptime()
            }
        });
    } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

// ==================================================================
// MESSAGING SYSTEM
// ==================================================================

// GET MESSAGES
app.get('/api/messages', authenticateUser, async (req, res) => {
    try {
        const userId = req.user.id;
        const now = new Date().toISOString();

        // UPDATED LOGIC:
        // 1. Personal messages that are unread OR Type='ticket' (always show tickets)
        // 2. Broadcasts (recipient=NULL) that are not expired
        const sql = `
            SELECT * FROM messages
            WHERE (recipient_id = $1 AND (is_read = ${isPostgreSQL ? 'false' : '0'} OR type = 'ticket'))
            OR (recipient_id IS NULL AND (expires_at IS NULL OR expires_at > $2))
            ORDER BY created_at DESC
        `;

        const result = await dbQuery(sql, [userId, now]);
        const msgs = result.rows.map(r => ({
            ...r,
            is_read: isPostgreSQL ? r.is_read : (r.is_read === 1)
        }));

        res.json(msgs);
    } catch(e) { res.status(500).json({ error: e.message }); }
});

// MARK READ
app.patch('/api/messages/:id/read', authenticateUser, async (req, res) => {
    try {
        const msgId = req.params.id;
        await dbQuery(`UPDATE messages SET is_read = ${isPostgreSQL ? 'true' : '1'} WHERE id = $1 AND recipient_id = $2`, [msgId, req.user.id]);
        res.json({ success: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

// DELETE MESSAGE (USER)
app.delete('/api/messages/:id', authenticateUser, async (req, res) => {
    try {
        const msgId = req.params.id;
        // User can only delete their own messages
        // Also check if it's a TICKET and if it is OPEN (which shouldn't be deleted)
        // But the frontend already locks it. Server side validation is good too.

        // 1. Check status if ticket
        const msgRes = await dbQuery("SELECT type, status FROM messages WHERE id = $1 AND recipient_id = $2", [msgId, req.user.id]);
        if(msgRes.rows.length === 0) return res.status(404).json({ error: "Nachricht nicht gefunden" });

        const msg = msgRes.rows[0];
        if (msg.type === 'ticket' && msg.status !== 'closed') {
            return res.status(403).json({ error: "Ticket noch offen. Löschen nicht erlaubt." });
        }

        await dbQuery(`DELETE FROM messages WHERE id = $1 AND recipient_id = $2`, [msgId, req.user.id]);
        res.json({ success: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

// ADMIN SEND
app.post('/api/admin/send-message', requireAdmin, async (req, res) => {
    try {
        const { recipientId, subject, body, type, expiresAt } = req.body;

        await dbQuery(
            `INSERT INTO messages (recipient_id, subject, body, type, expires_at, created_at, is_read) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [recipientId || null, subject, body, type || 'general', expiresAt || null, new Date().toISOString(), (isPostgreSQL ? false : 0)]
        );

        res.json({ success: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

// SCHEDULER (License Expiry)
const checkLicenseExpiries = async () => {
    try {
        if (!dbQuery) return;

        const now = new Date();
        const thresholds = [30, 10, 3]; // Days

        // Fetch active keys with users
        const sql = `
            SELECT u.id as user_id, l.expires_at
            FROM users u
            JOIN license_keys l ON u.license_key_id = l.id
            WHERE l.expires_at IS NOT NULL AND l.is_active = ${isPostgreSQL ? 'true' : '1'}
        `;

        const result = await dbQuery(sql);

        for (const row of result.rows) {
            const expDate = new Date(row.expires_at);
            const diffTime = expDate - now;
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

            if (thresholds.includes(diffDays)) {
                const subject = `Lizenz läuft ab in ${diffDays} Tagen`;

                // Avoid duplicates (check last 24h)
                const existing = await dbQuery(`
                    SELECT id FROM messages
                    WHERE recipient_id = $1 AND subject = $2 AND created_at > $3
                `, [row.user_id, subject, new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString()]);

                if (existing.rows.length === 0) {
                    await dbQuery(`
                        INSERT INTO messages (recipient_id, subject, body, type, is_read, created_at)
                        VALUES ($1, $2, $3, 'automated', ${isPostgreSQL ? 'false' : '0'}, $4)
                    `, [
                        row.user_id,
                        subject,
                        `Ihre Lizenz läuft am ${expDate.toLocaleDateString('de-DE')} ab. Bitte verlängern Sie rechtzeitig.`,
                        new Date().toISOString()
                    ]);
                }
            }
        }
    } catch(e) { console.error("Scheduler Error:", e); }
};

// Run Scheduler every 12 hours
setInterval(checkLicenseExpiries, 12 * 60 * 60 * 1000);
// Run once on start (delayed)
setTimeout(checkLicenseExpiries, 10000);

// ==================================================================
// 5. START
// ==================================================================

// ENTERPRISE ROUTES
if (IS_ENTERPRISE) {
    app.get('/api/config', async (req, res) => {
        const stats = await enterpriseManager.init();
        res.json({
            mode: 'ENTERPRISE',
            activated: stats.activated,
            stats: enterpriseManager.getStats()
        });
    });

    app.post('/api/enterprise/activate', async (req, res) => {
        try {
            const { key } = req.body;
            const result = await enterpriseManager.activate(key);
            res.json(result);
        } catch(e) { res.status(400).json({ error: e.message }); }
    });

    app.post('/api/enterprise/users', async (req, res) => {
        try {
            const { username, openRecipient } = req.body;
            const result = await enterpriseManager.createUser(username, openRecipient);
            res.json(result);
        } catch(e) { res.status(400).json({ error: e.message }); }
    });

    app.get('/api/enterprise/users', async (req, res) => {
        res.json(enterpriseManager.getUsers());
    });

    // Enterprise Admin Messages (Support Inbox)
    app.get('/api/enterprise/admin/messages', async (req, res) => {
        try {
            // Fetch messages addressed to Admin or System Support
            // In socketServer we emit "admin_support_alert".
            // We need to query `enterprise_messages` where recipient is NULL (Broadcast) or specifically Admin?
            // "Support-Anfragen ... als Nachrichten mit dem Typ SYSTEM_SUPPORT direkt in das Admin-Postfach"
            // Let's assume we filter by type='support' or similar.
            // In socketServer we didn't explicitly implement `send_support` saving to DB?
            // We implemented `send_message`.
            // Support messages usually go to the Admin.
            // Let's query all messages for now to see what's happening.
            if(dbQuery) {
                const r = await dbQuery("SELECT * FROM enterprise_messages ORDER BY created_at DESC");
                // Map to ticket format for frontend compatibility
                const tickets = r.rows.map(m => ({
                    id: m.id,
                    ticket_id: m.id, // Use msg ID as ticket ID
                    username: m.sender_id,
                    subject: m.subject,
                    message: m.body,
                    created_at: m.created_at,
                    status: m.is_read ? 'closed' : 'open', // Simplistic status
                    email: ''
                }));
                res.json(tickets);
            } else {
                res.json([]);
            }
        } catch(e) { res.status(500).json({ error: e.message }); }
    });

} else {
    // Cloud Config
    app.get('/api/config', (req, res) => {
        res.json({ mode: 'CLOUD' });
    });
}

app.use('/api', paymentRoutes);

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'landing.html')));
app.get('/app', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/shop', (req, res) => res.sendFile(path.join(__dirname, 'public', 'store.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/maintenance', (req, res) => res.sendFile(path.join(__dirname, 'public', 'maintenance.html')));

app.get('*', (req, res) => {
    if (req.path.startsWith('/api') || req.path.match(/\.[0-9a-z]+$/i)) {
        res.status(404).send('Not Found');
    } else {
        res.redirect('/');
    }
});

const httpServer = app.listen(PORT, () => {
    console.log(`🚀 Server running on Port ${PORT}`);
    if (IS_ENTERPRISE) {
        // Init extra table for Enterprise Messages
        if(!isPostgreSQL) {
            db.run(`CREATE TABLE IF NOT EXISTS enterprise_messages (
                id TEXT PRIMARY KEY,
                sender_id TEXT,
                recipient_id TEXT,
                subject TEXT,
                body TEXT,
                attachment TEXT,
                is_read INTEGER DEFAULT 0,
                created_at DATETIME
            )`, (err) => {
                if(err) console.error("EntDB Error", err);
            });
        }

        socketServer.attach(httpServer, dbQuery);
        enterpriseManager.init();
    }
});
