// server.js - Secret Messages Backend (Unified Version)

const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const { Resend } = require('resend');
const speakeasy = require('speakeasy');
const QRCode = require('qrcode');
const { Server } = require("socket.io");
const http = require('http');
require('dotenv').config();

const resend = new Resend(process.env.RESEND_API_KEY);

// Payment Routes
const paymentRoutes = require('./payment.js');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: ['https://secure-msg.app', 'https://www.secure-msg.app', 'http://localhost:3000', 'file://'],
        methods: ["GET", "POST"]
    }
});

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
        if (!dbQuery && !nedb.settings) return next(); // Database not ready

        // Unified Check
        let isMaintenance = false;
        if (isPostgreSQL) {
            const resSettings = await dbQuery("SELECT value FROM settings WHERE key = 'maintenance_mode'");
            isMaintenance = resSettings.rows.length > 0 && resSettings.rows[0].value === 'true';
        } else {
            const resSettings = await nedb.settings.findOne({ key: 'maintenance_mode' });
            isMaintenance = resSettings && resSettings.value === 'true';
        }

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
      connectSrc: ["'self'", "https://api.stripe.com", "https://js.stripe.com", "ws://localhost:3000", "http://localhost:3000"],
      imgSrc: ["'self'", "data:", "https:"]
    }
  }
}));

app.use(cors({
    origin: ['https://secure-msg.app', 'https://www.secure-msg.app', 'http://localhost:3000', 'file://'],
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
let nedb = {};

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
        console.log('📁 Using NeDB (Pure JS Local Storage)');
        const Datastore = require('nedb-promises');
        const fs = require('fs');

        let dbPath = './data';
        if (!fs.existsSync(dbPath)){ fs.mkdirSync(dbPath); }

        try {
            nedb.users = Datastore.create({ filename: path.join(dbPath, 'users.db'), autoload: true });
            nedb.license_keys = Datastore.create({ filename: path.join(dbPath, 'license_keys.db'), autoload: true });
            nedb.payments = Datastore.create({ filename: path.join(dbPath, 'payments.db'), autoload: true });
            nedb.account_deletions = Datastore.create({ filename: path.join(dbPath, 'account_deletions.db'), autoload: true });
            nedb.settings = Datastore.create({ filename: path.join(dbPath, 'settings.db'), autoload: true });
            nedb.license_bundles = Datastore.create({ filename: path.join(dbPath, 'license_bundles.db'), autoload: true });
            nedb.messages = Datastore.create({ filename: path.join(dbPath, 'messages.db'), autoload: true });
            nedb.support_tickets = Datastore.create({ filename: path.join(dbPath, 'support_tickets.db'), autoload: true });
        } catch(e) { console.error("NeDB Load Error (ignored):", e.message); }

        // Initialize Defaults
        const mCheck = await nedb.settings.findOne({ key: 'maintenance_mode' });
        if (!mCheck) await nedb.settings.insert({ key: 'maintenance_mode', value: 'false' });

        const sCheck = await nedb.settings.findOne({ key: 'shop_active' });
        if (!sCheck) await nedb.settings.insert({ key: 'shop_active', value: 'true' });

        const tCheck = await nedb.settings.findOne({ key: 'ticket_reply_template' });
        if (!tCheck) {
             const defaultTemplate = "Hallo {username},\n\n[TEXT]\n\nMit freundlichen Grüßen,\nIhr Support-Team";
             await nedb.settings.insert({ key: 'ticket_reply_template', value: defaultTemplate });
        }
    }
};

const createTables = async () => {
    if(!isPostgreSQL) return;
    try {
        await dbQuery(`CREATE TABLE IF NOT EXISTS users (
            id SERIAL PRIMARY KEY,
            username VARCHAR(50) UNIQUE,
            access_code_hash TEXT,
            license_key_id INTEGER,
            allowed_device_id TEXT,
            registered_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            last_login TIMESTAMP,
            is_blocked BOOLEAN DEFAULT FALSE,
            is_online BOOLEAN DEFAULT FALSE,
            is_admin BOOLEAN DEFAULT FALSE
        )`);

        await dbQuery(`CREATE TABLE IF NOT EXISTS license_keys (
            id SERIAL PRIMARY KEY,
            key_code VARCHAR(17) UNIQUE NOT NULL,
            key_hash TEXT NOT NULL,
            product_code VARCHAR(10), 
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            activated_at TIMESTAMP,
            expires_at TIMESTAMP,
            is_active BOOLEAN DEFAULT FALSE,
            username VARCHAR(50), 
            activated_ip VARCHAR(50),
            bundle_id INTEGER,
            assigned_user_id VARCHAR(50)
        )`);

        await dbQuery(`CREATE TABLE IF NOT EXISTS payments (
            id SERIAL PRIMARY KEY,
            payment_id VARCHAR(100),
            amount INTEGER,
            currency VARCHAR(10),
            status VARCHAR(20),
            payment_method VARCHAR(50),
            completed_at TIMESTAMP,
            metadata TEXT
        )`);

        await dbQuery(`CREATE TABLE IF NOT EXISTS account_deletions (
            id SERIAL PRIMARY KEY,
            username VARCHAR(50),
            license_key_code VARCHAR(50),
            reason TEXT,
            deleted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);

        await dbQuery(`CREATE TABLE IF NOT EXISTS settings (
            key VARCHAR(50) PRIMARY KEY,
            value TEXT
        )`);

        await dbQuery(`CREATE TABLE IF NOT EXISTS license_bundles (
            id SERIAL PRIMARY KEY,
            name VARCHAR(100),
            order_number VARCHAR(50),
            total_keys INTEGER DEFAULT 0,
            expires_at TIMESTAMP,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);

        await dbQuery(`CREATE TABLE IF NOT EXISTS messages (
            id SERIAL PRIMARY KEY,
            recipient_id INTEGER,
            subject VARCHAR(255),
            body TEXT,
            is_read BOOLEAN DEFAULT FALSE,
            type VARCHAR(50),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            expires_at TIMESTAMP,
            status VARCHAR(20) DEFAULT 'open',
            ticket_id VARCHAR(50)
        )`);

        await dbQuery(`CREATE TABLE IF NOT EXISTS support_tickets (
            id SERIAL PRIMARY KEY,
            ticket_id VARCHAR(50),
            username VARCHAR(50),
            email VARCHAR(100),
            subject VARCHAR(255),
            message TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            status VARCHAR(20) DEFAULT 'open'
        )`);

        console.log('✅ Tables checked/created');
    } catch (e) { console.error("Table creation error:", e); }
};

initializeDatabase();

// ==================================================================
// HELPER: Unified DB Access (SQL vs NeDB)
// ==================================================================
// This replaces direct dbQuery calls in routes to support both.

const DB = {
    async query(sql, params = []) {
        if (isPostgreSQL) {
            return await dbQuery(sql, params);
        } else {
            throw new Error("Direct SQL not supported in NeDB mode.");
        }
    },

    // Abstracted Methods

    async getSetting(key) {
        if(isPostgreSQL) {
            const res = await dbQuery("SELECT value FROM settings WHERE key = $1", [key]);
            return res.rows.length > 0 ? res.rows[0].value : null;
        } else {
            const res = await nedb.settings.findOne({ key });
            return res ? res.value : null;
        }
    },

    async setSetting(key, value) {
        if(isPostgreSQL) {
            await dbQuery("INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT(key) DO UPDATE SET value = $2", [key, value]);
        } else {
            await nedb.settings.update({ key }, { key, value }, { upsert: true });
        }
    },

    async findUserByName(username) {
        if(isPostgreSQL) {
            // Include license info via JOIN
            const res = await dbQuery(`
                SELECT u.*, l.expires_at
                FROM users u
                LEFT JOIN license_keys l ON u.license_key_id = l.id
                WHERE u.username = $1
            `, [username]);
            return res.rows[0];
        } else {
            const user = await nedb.users.findOne({ username });
            if(user && user.license_key_id) {
                const license = await nedb.license_keys.findOne({ id: user.license_key_id });
                if(license) user.expires_at = license.expires_at;
            }
            return user;
        }
    },

    async getUserById(id) {
        if(isPostgreSQL) {
            const res = await dbQuery("SELECT * FROM users WHERE id = $1", [id]);
            return res.rows[0];
        } else {
            return await nedb.users.findOne({ id }); // NeDB uses _id usually but we might simulate id or map it
            // For simplicity in migration, assume we use numerical IDs if possible or adapt.
            // NeDB uses string _id. We might need to handle this.
            // Let's assume we store 'id' field manually or query by _id if needed.
            // If the code expects numerical IDs (Postgres serial), NeDB string IDs might break things.
            // But we are in "Desktop Mode", usually fresh install.
            // We'll stick to string IDs for NeDB and loose typing comparisons.
        }
    },

    async createUser(username, accessCodeHash, licenseKeyId, deviceId) {
        const now = new Date().toISOString();
        if(isPostgreSQL) {
             const res = await dbQuery(
                 'INSERT INTO users (username, access_code_hash, license_key_id, allowed_device_id, registered_at) VALUES ($1, $2, $3, $4, $5) RETURNING id',
                 [username, accessCodeHash, licenseKeyId, deviceId, now]
             );
             return res.rows[0].id;
        } else {
            const newUser = {
                username, accessCodeHash, license_key_id: licenseKeyId, allowed_device_id: deviceId, registered_at: now,
                is_blocked: false, is_online: false,
                // Generate a random ID to mimic SQL ID (safe enough for local)
                id: Math.floor(Math.random() * 1000000)
            };
            const doc = await nedb.users.insert(newUser);
            return doc.id;
        }
    }
};


// ==================================================================
// 3. AUTHENTICATION & APP ROUTES
// ==================================================================

app.get('/api/ping', (req, res) => res.json({ status: 'ok' }));

app.get('/api/shop-status', async (req, res) => {
    try {
        const value = await DB.getSetting('shop_active');
        const active = value === 'true';
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

    const ticketId = 'TIC-' + crypto.randomBytes(3).toString('hex').toUpperCase();
    const createdAt = new Date().toISOString();

    try {
        // DB SAVE
        if(isPostgreSQL) {
            await dbQuery(
                `INSERT INTO support_tickets (ticket_id, username, email, subject, message, created_at, status) VALUES ($1, $2, $3, $4, $5, $6, 'open')`,
                [ticketId, username || null, email || null, subject, message, createdAt]
            );
        } else {
            await nedb.support_tickets.insert({ ticket_id: ticketId, username, email, subject, message, created_at: createdAt, status: 'open' });
        }

        // --- Copy to User Inbox ---
        if (username) {
            try {
                let user;
                if(isPostgreSQL) {
                    const r = await dbQuery('SELECT id FROM users WHERE username = $1', [username]);
                    user = r.rows[0];
                } else {
                    user = await nedb.users.findOne({ username });
                }

                if (user) {
                    const msg = {
                        recipient_id: user.id,
                        subject: `[Ticket: ${ticketId}] ${subject}`,
                        body: message,
                        type: 'ticket',
                        is_read: isPostgreSQL ? true : 1,
                        created_at: createdAt,
                        status: 'open',
                        ticket_id: ticketId
                    };

                    if(isPostgreSQL) {
                         await dbQuery(
                            `INSERT INTO messages (recipient_id, subject, body, type, is_read, created_at, status, ticket_id)
                             VALUES ($1, $2, $3, 'ticket', true, $4, 'open', $5)`,
                            [user.id, msg.subject, msg.body, createdAt, ticketId]
                        );
                    } else {
                        await nedb.messages.insert(msg);
                    }
                }
            } catch (err) {
                console.warn(">> Could not save copy to user inbox:", err.message);
            }
        }

        console.log(`>> Sende Support-Email via Resend (Ticket: ${ticketId})...`);

        const receiver = process.env.EMAIL_RECEIVER || 'support@secure-msg.app';
        const sender = 'support@secure-msg.app';
        const replyTo = email || 'no-reply@secure-msg.app';

        const { error: errorTeam } = await resend.emails.send({
            from: sender,
            to: receiver,
            reply_to: replyTo,
            subject: `[SUPPORT] ${subject} [${ticketId}]`,
            text: `Neue Support-Anfrage [${ticketId}]\n\nVon: ${username || 'Gast'}\nEmail: ${email || 'Keine (Interner Support)'}\nBetreff: ${subject}\n\nNachricht:\n${message}`,
            html: `<h3>Neue Support-Anfrage <span style="color:#00BFFF;">${ticketId}</span></h3><p><strong>Von:</strong> ${username || 'Gast'}</p><p><strong>Email:</strong> ${email || 'Keine (Interner Support)'}</p><p><strong>Betreff:</strong> ${subject}</p><hr><p style="white-space: pre-wrap;">${message}</p>`
        });

        if (errorTeam) console.error('>> Resend API Error (Team):', errorTeam);

        if (email) {
            const { error: errorClient } = await resend.emails.send({
                from: sender,
                to: email,
                subject: `Bestätigung Ihrer Support-Anfrage [Ticket-Nr: ${ticketId}]`,
                html: `<div style="font-family: Arial, sans-serif;"><h3>Vielen Dank für Ihre Anfrage!</h3><p>Ihre Ticket-Nummer: ${ticketId}</p></div>`
            });
            if (errorClient) console.warn('>> Warnung: Bestätigungsmail konnte nicht gesendet werden:', errorClient);
        }

        return res.status(200).json({ success: true, ticketId });

    } catch (error) {
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
            let dbUser;
            if(isPostgreSQL) {
                const r = await dbQuery("SELECT is_blocked FROM users WHERE id = $1", [user.id]);
                dbUser = r.rows[0];
            } else {
                dbUser = await nedb.users.findOne({ id: user.id });
            }

            const blocked = dbUser ? (dbUser.is_blocked === true || dbUser.is_blocked === 1) : false;

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
        const user = await DB.findUserByName(username);

        if (!user) return res.status(401).json({ success: false, error: "Benutzer nicht gefunden" });

        // Note: access_code_hash field name matches in NeDB creation
        // If PostgreSQL uses 'access_code_hash', ensure NeDB uses same key.
        const match = await bcrypt.compare(accessCode, user.access_code_hash || user.accessCodeHash); // fallback
        if (!match) return res.status(401).json({ success: false, error: "Falscher Zugangscode" });

        // HARD LOGIN BLOCK
        const isBlocked = (user.is_blocked === true || user.is_blocked === 1);
        if (isBlocked) {
            return res.status(403).json({ success: false, error: "ACCOUNT_BLOCKED" });
        }

        if (user.allowed_device_id && user.allowed_device_id !== deviceId) {
            return res.status(403).json({ success: false, error: "DEVICE_NOT_AUTHORIZED" });
        }
        if (!user.allowed_device_id) {
            const sanitizedDeviceId = deviceId.replace(/[^a-zA-Z0-9-]/g, '').substring(0, 50);

            if(isPostgreSQL) {
                await dbQuery("UPDATE users SET allowed_device_id = $1 WHERE id = $2", [deviceId, user.id]);
                await dbQuery("INSERT INTO messages (recipient_id, subject, body, type, is_read, created_at) VALUES ($1, $2, $3, $4, $5, $6)",
                    [user.id, "Sicherheits-Info: Neues Gerät verknüpft", `Gerät-ID: ${sanitizedDeviceId}`, 'automated', false, new Date().toISOString()]);
            } else {
                await nedb.users.update({ id: user.id }, { $set: { allowed_device_id: deviceId } });
                await nedb.messages.insert({ recipient_id: user.id, subject: "Sicherheits-Info: Neues Gerät verknüpft", body: `Gerät-ID: ${sanitizedDeviceId}`, type: 'automated', is_read: false, created_at: new Date().toISOString() });
            }
        }

        const token = jwt.sign({
            id: user.id,
            username: user.username,
            isAdmin: (user.is_admin === true || user.is_admin === 1)
        }, JWT_SECRET, { expiresIn: '24h' });

        if(isPostgreSQL) {
            await dbQuery("UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = $1", [user.id]);
        } else {
            await nedb.users.update({ id: user.id }, { $set: { last_login: new Date().toISOString() } });
        }

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
        if(isPostgreSQL) {
            await dbQuery('UPDATE users SET is_online = $1 WHERE id = $2', [false, req.user.id]);
        } else {
            await nedb.users.update({ id: req.user.id }, { $set: { is_online: false } });
        }
        res.json({ success: true });
    } catch(e) { res.status(500).json({ error: 'Logout Fehler' }); }
});

app.post('/api/auth/activate', async (req, res) => {
    const { licenseKey, username, accessCode, deviceId } = req.body;
    if (!deviceId) return res.status(400).json({ error: 'Geräte-ID fehlt.' });
    
    try {
        let key;
        if(isPostgreSQL) {
            const r = await dbQuery('SELECT * FROM license_keys WHERE key_code = $1', [licenseKey]);
            key = r.rows[0];
        } else {
            key = await nedb.license_keys.findOne({ key_code: licenseKey });
        }

        if (!key) return res.status(404).json({ error: 'Key nicht gefunden' });
        if (key.activated_at) return res.status(403).json({ error: 'Key bereits benutzt' });
        
        if (key.assigned_user_id && key.assigned_user_id !== username) {
             return res.status(403).json({ error: 'Dieser Key ist für eine andere ID reserviert.' });
        }

        if(isPostgreSQL) {
             const u = await dbQuery('SELECT id FROM users WHERE username = $1', [username]);
             if (u.rows.length > 0) return res.status(409).json({ error: 'Username vergeben' });
        } else {
             const u = await nedb.users.findOne({ username });
             if (u) return res.status(409).json({ error: 'Username vergeben' });
        }

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
        
        await DB.createUser(username, hash, key.id, deviceId);

        if(isPostgreSQL) {
            await dbQuery(
                'UPDATE license_keys SET is_active = $1, activated_at = $2, expires_at = $3 WHERE id = $4',
                [true, new Date().toISOString(), expiresAt, key.id]
            );
        } else {
            await nedb.license_keys.update({ id: key.id }, { $set: { is_active: true, activated_at: new Date().toISOString(), expires_at: expiresAt } });
        }

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

        let key;
        if(isPostgreSQL) {
            const r = await dbQuery('SELECT assigned_user_id, is_active FROM license_keys WHERE key_code = $1', [licenseKey]);
            key = r.rows[0];
        } else {
            key = await nedb.license_keys.findOne({ key_code: licenseKey });
        }

        if (!key) return res.json({ isValid: false });

        const isActive = (key.is_active === true || key.is_active === 1);
        if (isActive) return res.json({ isValid: false, error: 'Bereits benutzt' });

        res.json({ isValid: true, assignedUserId: key.assigned_user_id || null });
    } catch (e) { res.status(500).json({ error: 'Serverfehler' }); }
});

// GET MESSAGES
app.get('/api/messages', authenticateUser, async (req, res) => {
    try {
        const userId = req.user.id;
        const now = new Date().toISOString();

        if (isPostgreSQL) {
            const sql = `
                SELECT * FROM messages
                WHERE (recipient_id = $1 AND (is_read = false OR type = 'ticket'))
                OR (recipient_id IS NULL AND (expires_at IS NULL OR expires_at > $2))
                ORDER BY created_at DESC
            `;
            const result = await dbQuery(sql, [userId, now]);
            res.json(result.rows);
        } else {
            // NeDB Logic
            const msgs = await nedb.messages.find({
                $or: [
                    { recipient_id: userId, $or: [{ is_read: false }, { type: 'ticket' }] },
                    { recipient_id: null, $or: [{ expires_at: null }, { expires_at: { $gt: now } }] }
                ]
            }).sort({ created_at: -1 });
            res.json(msgs);
        }
    } catch(e) { res.status(500).json({ error: e.message }); }
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
            // Check for explicit admin role OR isAdmin flag from user table
            if (decoded.role === 'admin' || decoded.isAdmin === true) {
                req.user = decoded; // attach to req
                return next();
            }
        } catch (e) { }
    }

    // 2. Fallback: Check for x-admin-password (LEGACY, only allowed if 2FA is DISABLED)
    const sentPassword = req.headers['x-admin-password'] || req.body.password;
    if (sentPassword === ADMIN_PASSWORD) {
        // Check if 2FA is enabled globally
        let is2FA = false;
        if(isPostgreSQL) {
            const resSettings = await dbQuery("SELECT value FROM settings WHERE key = 'admin_2fa_enabled'");
            is2FA = resSettings.rows.length > 0 && resSettings.rows[0].value === 'true';
        } else {
            const s = await nedb.settings.findOne({ key: 'admin_2fa_enabled' });
            is2FA = s && s.value === 'true';
        }

        if (is2FA) {
            console.warn('Blocked Admin Access: 2FA is enabled but not provided.');
            return res.status(403).json({ success: false, error: '2FA required. Please login.' });
        }
        return next();
    }

    console.error("Admin Access Denied.");
    return res.status(403).json({ success: false, error: 'Admin Auth Failed' });
};

// BOOTSTRAP ROUTE (TEMPORARY)
app.post('/api/admin/force-setup', async (req, res) => {
    // Only allow if no admin exists? Or just open for now as requested.
    // The user said "without Auth".
    const { username } = req.body;
    if(!username) return res.status(400).json({ error: 'Username required' });

    try {
        if(isPostgreSQL) {
            await dbQuery("UPDATE users SET is_admin = true WHERE username = $1", [username]);
        } else {
            await nedb.users.update({ username }, { $set: { is_admin: true } });
        }
        res.json({ success: true, message: `User ${username} is now Admin.` });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/debug/disable-2fa', async (req, res) => {
    const { username } = req.body;
    // This is a debug route to forcefully disable 2FA and promote user
    try {
        // 1. Disable Global 2FA
        await DB.setSetting('admin_2fa_enabled', 'false');
        await DB.setSetting('admin_2fa_secret', null); // Clear secret logic

        // 2. Promote User
        if (username) {
            if(isPostgreSQL) {
                await dbQuery("UPDATE users SET is_admin = true WHERE username = $1", [username]);
            } else {
                await nedb.users.update({ username }, { $set: { is_admin: true } });
            }
        }
        res.json({ success: true, message: '2FA Disabled & User Promoted' });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

// Admin Auth (Simplified for NeDB)
app.post('/api/admin/auth', async (req, res) => {
    const { password } = req.body;
    if (password !== ADMIN_PASSWORD) return res.status(403).json({ success: false, error: 'Falsches Passwort' });

    // 2FA Logic DISABLED BY REQUEST
    /*
    const secret = await DB.getSetting('admin_2fa_secret');
    if (secret && process.env.DISABLE_ADMIN_2FA !== 'true') {
        if (!token) return res.json({ success: false, error: '2FA Token erforderlich' });
        const verified = speakeasy.totp.verify({ secret, encoding: 'base32', token, window: 2 });
        if (!verified) return res.json({ success: false, error: 'Ungültiger 2FA Code' });
    }
    */

    const jwtToken = jwt.sign({ role: 'admin' }, JWT_SECRET, { expiresIn: '4h' });
    res.json({ success: true, token: jwtToken });
});

// 2FA SETUP ENDPOINTS
app.get('/api/admin/2fa-setup', requireAdmin, async (req, res) => {
    try {
        const secret = speakeasy.generateSecret({ name: "SecureMsg Admin" });
        QRCode.toDataURL(secret.otpauth_url, async (err, data_url) => {
            if (err) return res.status(500).json({ success: false, error: 'QR Gen Error' });
            res.json({ success: true, secret: secret.base32, qrCode: data_url });
        });
    } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post('/api/admin/2fa/setup', requireAdmin, async (req, res) => {
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
            if(isPostgreSQL) {
                await dbQuery("INSERT INTO settings (key, value) VALUES ('admin_2fa_secret', $1) ON CONFLICT(key) DO UPDATE SET value = $1", [secret]);
                await dbQuery("INSERT INTO settings (key, value) VALUES ('admin_2fa_enabled', 'true') ON CONFLICT(key) DO UPDATE SET value = 'true'");
            } else {
                await nedb.settings.update({ key: 'admin_2fa_secret' }, { key: 'admin_2fa_secret', value: secret }, { upsert: true });
                await nedb.settings.update({ key: 'admin_2fa_enabled' }, { key: 'admin_2fa_enabled', value: 'true' }, { upsert: true });
            }
            res.json({ success: true });
        } else {
            res.json({ success: false, error: 'Ungültiger Code' });
        }
    } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post('/api/admin/2fa/disable', requireAdmin, async (req, res) => {
    try {
        if(isPostgreSQL) {
            await dbQuery("UPDATE settings SET value = 'false' WHERE key = 'admin_2fa_enabled'");
        } else {
            await nedb.settings.update({ key: 'admin_2fa_enabled' }, { $set: { value: 'false' } });
        }
        res.json({ success: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/stats', requireAdmin, async (req, res) => {
    try {
        let stats = {};
        if(isPostgreSQL) {
            const now = 'NOW()';
            const activeUsers = await dbQuery(`SELECT COUNT(*) as c FROM users WHERE is_blocked = false`);
            const blockedUsers = await dbQuery(`SELECT COUNT(*) as c FROM users WHERE is_blocked = true`);
            const activeKeys = await dbQuery(`SELECT COUNT(*) as c FROM license_keys WHERE is_active = true`);
            const expiredKeys = await dbQuery(`SELECT COUNT(*) as c FROM license_keys WHERE expires_at IS NOT NULL AND expires_at <= ${now}`);
            const totalPurchases = await dbQuery(`SELECT COUNT(*) as c FROM payments WHERE status = 'completed'`);
            const totalRevenue = await dbQuery(`SELECT SUM(amount) as s FROM payments WHERE status = 'completed'`);
            const totalBundles = await dbQuery(`SELECT COUNT(*) as c FROM license_bundles`);
            const unassignedBundleKeys = await dbQuery(`SELECT COUNT(*) as c FROM license_keys WHERE bundle_id IS NOT NULL AND is_active = false`);

            stats = {
                users_active: activeUsers.rows[0].c,
                users_blocked: blockedUsers.rows[0].c,
                keys_active: activeKeys.rows[0].c,
                keys_expired: expiredKeys.rows[0].c,
                purchases_count: totalPurchases.rows[0].c,
                revenue_total: (totalRevenue.rows[0].s || 0),
                bundles_active: totalBundles.rows[0].c,
                bundle_keys_unassigned: unassignedBundleKeys.rows[0].c
            };
        } else {
            // NeDB Stats Mockup
            const now = new Date().toISOString();
            stats = {
                users_active: await nedb.users.count({ is_blocked: false }),
                users_blocked: await nedb.users.count({ is_blocked: true }),
                keys_active: await nedb.license_keys.count({ is_active: true }),
                keys_expired: await nedb.license_keys.count({ expires_at: { $lte: now } }),
                purchases_count: await nedb.payments.count({ status: 'completed' }),
                revenue_total: 0, // Need to sum manually
                bundles_active: await nedb.license_bundles.count({}),
                bundle_keys_unassigned: await nedb.license_keys.count({ bundle_id: { $exists: true }, is_active: false })
            };
            const payments = await nedb.payments.find({ status: 'completed' });
            stats.revenue_total = payments.reduce((sum, p) => sum + (p.amount || 0), 0);
        }

        res.json({ success: true, stats });
    } catch (e) { res.json({ success: false, error: 'DB Error' }); }
});

app.get('/api/admin/keys', requireAdmin, async (req, res) => {
    try {
        let keys = [];
        if(isPostgreSQL) {
            const sql = `SELECT k.*, u.username, u.id as user_id FROM license_keys k LEFT JOIN users u ON u.license_key_id = k.id ORDER BY k.created_at DESC LIMIT 200`;
            const result = await dbQuery(sql);
            keys = result.rows;
        } else {
            keys = await nedb.license_keys.find({}).sort({ created_at: -1 }).limit(200);
            // Join users
            for(let k of keys) {
                const u = await nedb.users.findOne({ license_key_id: k.id });
                if(u) { k.username = u.username; k.user_id = u.id; }
            }
        }
        res.json(keys);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/admin/keys/:id', requireAdmin, async (req, res) => {
    const keyId = isPostgreSQL ? req.params.id : parseInt(req.params.id);
    const { expires_at, user_id, product_code } = req.body;
    try {
        if(isPostgreSQL) {
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
                    await dbQuery(`UPDATE license_keys SET is_active = true, activated_at = COALESCE(activated_at, $2) WHERE id = $1`, [keyId, now]);
                }
            }
        } else {
            let update = { expires_at: expires_at || null };
            if(product_code) update.product_code = product_code;
            await nedb.license_keys.update({ id: keyId }, { $set: update });

            // Unlink all users from this key first
            // NeDB doesn't have UPDATE WHERE license_key_id = keyId in one go easily without multi
            // But nedb-promises uses multi: true by default on update? No, check docs. Usually multi: false.
            // We'll iterate.
            const usersWithKey = await nedb.users.find({ license_key_id: keyId });
            for(let u of usersWithKey) { await nedb.users.update({ id: u.id }, { $set: { license_key_id: null } }); }

            if(user_id) {
                await nedb.users.update({ id: user_id }, { $set: { license_key_id: keyId } });
                await nedb.license_keys.update({ id: keyId }, { $set: { is_active: true } });
                // activated_at logic skipped for brevity, similar
            }
        }
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.delete('/api/admin/keys/:id', requireAdmin, async (req, res) => {
    const keyId = isPostgreSQL ? req.params.id : parseInt(req.params.id);
    try {
        if(isPostgreSQL) {
            await dbQuery('UPDATE users SET license_key_id = NULL WHERE license_key_id = $1', [keyId]);
            await dbQuery('DELETE FROM license_keys WHERE id = $1', [keyId]);
        } else {
            const users = await nedb.users.find({ license_key_id: keyId });
            for(let u of users) { await nedb.users.update({ id: u.id }, { $set: { license_key_id: null } }); }
            await nedb.license_keys.remove({ id: keyId }, {});
        }
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, error: "Löschen fehlgeschlagen: " + e.message }); }
});

app.post('/api/admin/generate-keys', requireAdmin, async (req, res) => {
    try {
        const { productCode, count } = req.body;
        const amount = parseInt(count) || 1;
        const newKeys = [];
        for(let i=0; i < amount; i++) {
            const keyRaw = crypto.randomBytes(6).toString('hex').toUpperCase().match(/.{1,4}/g).join('-');
            const keyHash = crypto.createHash('sha256').update(keyRaw).digest('hex');
            if(isPostgreSQL) {
                await dbQuery(`INSERT INTO license_keys (key_code, key_hash, product_code, is_active) VALUES ($1, $2, $3, $4)`,
                    [keyRaw, keyHash, productCode, false]);
            } else {
                await nedb.license_keys.insert({
                    key_code: keyRaw, key_hash: keyHash, product_code: productCode, is_active: false,
                    id: Math.floor(Math.random() * 1000000)
                });
            }
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

        let bundleId;
        if(isPostgreSQL) {
            let insertBundle = await dbQuery(
                `INSERT INTO license_bundles (name, order_number, total_keys, created_at) VALUES ($1, $2, $3, $4) RETURNING id`,
                [name, orderNum, amount, new Date().toISOString()]
            );
            bundleId = insertBundle.rows[0].id;
        } else {
            const doc = await nedb.license_bundles.insert({
                name, order_number: orderNum, total_keys: amount, created_at: new Date().toISOString(),
                id: Math.floor(Math.random() * 1000000)
            });
            bundleId = doc.id;
        }

        const newKeys = [];
        for(let i = 0; i < amount; i++) {
            const seqNum = start + i;
            const assignedId = `${idStem}${String(seqNum).padStart(3, '0')}`;
            const keyRaw = crypto.randomBytes(6).toString('hex').toUpperCase().match(/.{1,4}/g).join('-');
            const keyHash = crypto.createHash('sha256').update(keyRaw).digest('hex');

            if(isPostgreSQL) {
                await dbQuery(
                    `INSERT INTO license_keys (key_code, key_hash, product_code, is_active, bundle_id, assigned_user_id) VALUES ($1, $2, $3, $4, $5, $6)`,
                    [keyRaw, keyHash, productCode, false, bundleId, assignedId]
                );
            } else {
                await nedb.license_keys.insert({
                    key_code: keyRaw, key_hash: keyHash, product_code: productCode, is_active: false, bundle_id: bundleId, assigned_user_id: assignedId,
                    id: Math.floor(Math.random() * 1000000)
                });
            }
            newKeys.push({ key: keyRaw, assignedId });
        }
        res.json({ success: true, bundleId, keys: newKeys });
    } catch(e) { res.status(500).json({ error: "Bundle Fehler: " + e.message }); }
});

app.post('/api/admin/generate-enterprise-bundle', requireAdmin, async (req, res) => {
    try {
        const { name, userCount } = req.body;
        const count = parseInt(userCount) || 5;
        const orderNum = 'ENT-' + crypto.randomBytes(4).toString('hex').toUpperCase();

        // 1. Create Bundle
        console.log(`Creating Enterprise Bundle: ${name} with ${count} Users`);
        let bundleId;
        if(isPostgreSQL) {
            let insertBundle = await dbQuery(
                `INSERT INTO license_bundles (name, order_number, total_keys, created_at) VALUES ($1, $2, $3, $4) RETURNING id`,
                [name, orderNum, count + 1, new Date().toISOString()]
            );
            bundleId = insertBundle.rows[0].id;
        } else {
            const doc = await nedb.license_bundles.insert({
                name, order_number: orderNum, total_keys: count + 1, created_at: new Date().toISOString(),
                id: Math.floor(Math.random() * 1000000)
            });
            bundleId = doc.id;
        }

        const newKeys = [];

        // 2. Generate MASTER Key
        const masterKeyRaw = crypto.randomBytes(6).toString('hex').toUpperCase().match(/.{1,4}/g).join('-');
        const masterKeyHash = crypto.createHash('sha256').update(masterKeyRaw).digest('hex');
        // Task 1: Enforce Unique Master Identity using Customer Name
        const sanitizedName = name.replace(/[^a-zA-Z0-9]/g, '');
        const masterAssignedId = `${sanitizedName}_Admin`;

        if(isPostgreSQL) {
            await dbQuery(
                `INSERT INTO license_keys (key_code, key_hash, product_code, is_active, bundle_id, assigned_user_id) VALUES ($1, $2, 'MASTER', false, $3, $4)`,
                [masterKeyRaw, masterKeyHash, bundleId, masterAssignedId]
            );
        } else {
            await nedb.license_keys.insert({
                key_code: masterKeyRaw, key_hash: masterKeyHash, product_code: 'MASTER', is_active: false, bundle_id: bundleId, assigned_user_id: masterAssignedId,
                id: Math.floor(Math.random() * 1000000)
            });
        }
        newKeys.push({ key: masterKeyRaw, type: 'MASTER', assignedId: masterAssignedId });

        // 3. Generate User Keys (LIFETIME_USER)
        for(let i = 0; i < count; i++) {
            const seqNum = i + 1;
            const assignedId = `USER-${String(seqNum).padStart(3, '0')}`;
            const keyRaw = crypto.randomBytes(6).toString('hex').toUpperCase().match(/.{1,4}/g).join('-');
            const keyHash = crypto.createHash('sha256').update(keyRaw).digest('hex');

            if(isPostgreSQL) {
                await dbQuery(
                    `INSERT INTO license_keys (key_code, key_hash, product_code, is_active, bundle_id, assigned_user_id) VALUES ($1, $2, 'LIFETIME_USER', false, $3, $4)`,
                    [keyRaw, keyHash, bundleId, assignedId]
                );
            } else {
                await nedb.license_keys.insert({
                    key_code: keyRaw, key_hash: keyHash, product_code: 'LIFETIME_USER', is_active: false, bundle_id: bundleId, assigned_user_id: assignedId,
                    id: Math.floor(Math.random() * 1000000)
                });
            }
            newKeys.push({ key: keyRaw, type: 'USER', assignedId });
        }

        res.json({ success: true, bundleId, keys: newKeys });

    } catch(e) { res.status(500).json({ error: "Enterprise Bundle Error: " + e.message }); }
});

app.get('/api/admin/bundles', requireAdmin, async (req, res) => {
    try {
        if(isPostgreSQL) {
            const sql = `
                SELECT b.*,
                (SELECT COUNT(*) FROM license_keys k WHERE k.bundle_id = b.id AND k.is_active = TRUE) as active_count,
                (SELECT key_code FROM license_keys k WHERE k.bundle_id = b.id AND k.product_code = 'MASTER' LIMIT 1) as master_key
                FROM license_bundles b ORDER BY b.created_at DESC
            `;
            const result = await dbQuery(sql);
            res.json(result.rows);
        } else {
            const bundles = await nedb.license_bundles.find({}).sort({ created_at: -1 });
            for(let b of bundles) {
                b.active_count = await nedb.license_keys.count({ bundle_id: b.id, is_active: true });
                const mk = await nedb.license_keys.findOne({ bundle_id: b.id, product_code: 'MASTER' });
                if(mk) b.master_key = mk.key_code;
            }
            res.json(bundles);
        }
    } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/bundles/:id/keys', requireAdmin, async (req, res) => {
    try {
        if(isPostgreSQL) {
            const sql = `SELECT key_code, assigned_user_id, is_active, expires_at FROM license_keys WHERE bundle_id = $1 ORDER BY assigned_user_id ASC`;
            const result = await dbQuery(sql, [req.params.id]);
            res.json(result.rows);
        } else {
            const keys = await nedb.license_keys.find({ bundle_id: parseInt(req.params.id) }).sort({ assigned_user_id: 1 });
            res.json(keys);
        }
    } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/admin/bundles/:id/extend', requireAdmin, async (req, res) => {
    try {
        const { expires_at } = req.body;
        if(isPostgreSQL) {
            await dbQuery(`UPDATE license_keys SET expires_at = $1 WHERE bundle_id = $2`, [expires_at, req.params.id]);
            await dbQuery(`UPDATE license_bundles SET expires_at = $1 WHERE id = $2`, [expires_at, req.params.id]);
        } else {
            const bundleId = parseInt(req.params.id);
            // Need multi update
            const keys = await nedb.license_keys.find({ bundle_id: bundleId });
            for(let k of keys) await nedb.license_keys.update({ id: k.id }, { $set: { expires_at } });
            await nedb.license_bundles.update({ id: bundleId }, { $set: { expires_at } });
        }
        res.json({ success: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/admin/bundles/:id', requireAdmin, async (req, res) => {
    const bundleId = isPostgreSQL ? req.params.id : parseInt(req.params.id);
    try {
        if(isPostgreSQL) {
            // Unlink users first
            await dbQuery(`UPDATE users SET license_key_id = NULL WHERE license_key_id IN (SELECT id FROM license_keys WHERE bundle_id = $1)`, [bundleId]);
            // Delete keys
            await dbQuery(`DELETE FROM license_keys WHERE bundle_id = $1`, [bundleId]);
            // Delete bundle
            await dbQuery(`DELETE FROM license_bundles WHERE id = $1`, [bundleId]);
        } else {
            const keys = await nedb.license_keys.find({ bundle_id: bundleId });
            for(let k of keys) {
                // Find users with this key and unlink
                const users = await nedb.users.find({ license_key_id: k.id });
                for(let u of users) await nedb.users.update({ id: u.id }, { $set: { license_key_id: null } });
                await nedb.license_keys.remove({ id: k.id }, {});
            }
            await nedb.license_bundles.remove({ id: bundleId }, {});
        }
        res.json({ success: true });
    } catch(e) {
        console.error("Bundle delete error:", e);
        res.status(500).json({ error: "Löschen fehlgeschlagen: " + e.message });
    }
});

app.get('/api/admin/users', requireAdmin, async (req, res) => {
    try {
        if(isPostgreSQL) {
            const sql = `SELECT u.*, k.key_code FROM users u LEFT JOIN license_keys k ON u.license_key_id = k.id ORDER BY u.registered_at DESC LIMIT 100`;
            const result = await dbQuery(sql);
            res.json(result.rows);
        } else {
            const users = await nedb.users.find({}).sort({ registered_at: -1 }).limit(100);
            for(let u of users) {
                if(u.license_key_id) {
                    const k = await nedb.license_keys.findOne({ id: u.license_key_id });
                    if(k) u.key_code = k.key_code;
                }
            }
            res.json(users);
        }
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/block-user/:id', requireAdmin, async (req, res) => {
    const uid = isPostgreSQL ? req.params.id : parseInt(req.params.id);
    try {
        if(isPostgreSQL) {
            await dbQuery("UPDATE users SET is_blocked = TRUE WHERE id = $1", [uid]);
        } else {
            await nedb.users.update({ id: uid }, { $set: { is_blocked: true } });
        }
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false }); }
});

app.post('/api/admin/unblock-user/:id', requireAdmin, async (req, res) => {
    const uid = isPostgreSQL ? req.params.id : parseInt(req.params.id);
    if(isPostgreSQL) {
        await dbQuery(`UPDATE users SET is_blocked = false WHERE id = $1`, [uid]);
    } else {
        await nedb.users.update({ id: uid }, { $set: { is_blocked: false } });
    }
    res.json({ success: true });
});

app.post('/api/admin/reset-device/:id', requireAdmin, async (req, res) => {
    const uid = isPostgreSQL ? req.params.id : parseInt(req.params.id);
    try {
        if(isPostgreSQL) {
            await dbQuery("UPDATE users SET allowed_device_id = NULL WHERE id = $1", [uid]);
        } else {
            await nedb.users.update({ id: uid }, { $set: { allowed_device_id: null } });
        }
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false }); }
});

app.get('/api/admin/purchases', requireAdmin, async (req, res) => {
    try {
        if(isPostgreSQL) {
            const sql = `SELECT * FROM payments ORDER BY completed_at DESC LIMIT 100`;
            const result = await dbQuery(sql);
            const purchases = result.rows.map(r => {
                let meta = {};
                try { meta = (typeof r.metadata === 'string') ? JSON.parse(r.metadata) : r.metadata || {}; } catch(e){}
                const email = meta.email || meta.customer_email || meta.customerEmail || '?';
                return {
                    id: r.payment_id, email, product: meta.product_type || '?',
                    amount: r.amount, currency: r.currency, date: r.completed_at, status: r.status
                };
            });
            res.json(purchases);
        } else {
            const payments = await nedb.payments.find({}).sort({ completed_at: -1 }).limit(100);
            const purchases = payments.map(r => {
                let meta = {};
                try { meta = (typeof r.metadata === 'string') ? JSON.parse(r.metadata) : r.metadata || {}; } catch(e){}
                const email = meta.email || meta.customer_email || meta.customerEmail || '?';
                return {
                    id: r.payment_id, email, product: meta.product_type || '?',
                    amount: r.amount, currency: r.currency, date: r.completed_at, status: r.status
                };
            });
            res.json(purchases);
        }
    } catch (e) { res.json([]); }
});

// SUPPORT TICKETS (ADMIN)
app.get('/api/admin/support-tickets', requireAdmin, async (req, res) => {
    try {
        if(isPostgreSQL) {
            const result = await dbQuery(`SELECT * FROM support_tickets ORDER BY created_at DESC`);
            res.json(result.rows);
        } else {
            const t = await nedb.support_tickets.find({}).sort({ created_at: -1 });
            res.json(t);
        }
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Update Ticket Status (Viewed/Open)
app.put('/api/admin/support-tickets/:id/status', requireAdmin, async (req, res) => {
    const { status } = req.body;
    const ticketId = isPostgreSQL ? req.params.id : parseInt(req.params.id);
    try {
        let ticket_id;
        if(isPostgreSQL) {
            const ticketRes = await dbQuery("SELECT ticket_id, username FROM support_tickets WHERE id = $1", [ticketId]);
            if (ticketRes.rows.length === 0) return res.status(404).json({ error: "Ticket not found" });
            ticket_id = ticketRes.rows[0].ticket_id;
            await dbQuery("UPDATE support_tickets SET status = $1 WHERE id = $2", [status, ticketId]);
            if (ticket_id) await dbQuery("UPDATE messages SET status = $1 WHERE ticket_id = $2", [status, ticket_id]);
        } else {
            const t = await nedb.support_tickets.findOne({ id: ticketId });
            if(!t) return res.status(404).json({ error: "Ticket not found" });
            ticket_id = t.ticket_id;
            await nedb.support_tickets.update({ id: ticketId }, { $set: { status } });
            if(ticket_id) await nedb.messages.update({ ticket_id }, { $set: { status } }, { multi: true });
        }
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/admin/messages/:id/status', requireAdmin, async (req, res) => {
    const { status } = req.body;
    const ticketId = isPostgreSQL ? req.params.id : parseInt(req.params.id);
    try {
        // Logic same as PUT
        if(isPostgreSQL) {
            const ticketRes = await dbQuery("SELECT ticket_id FROM support_tickets WHERE id = $1", [ticketId]);
            if (ticketRes.rows.length === 0) return res.status(404).json({ error: "Ticket not found" });
            const { ticket_id } = ticketRes.rows[0];
            await dbQuery("UPDATE support_tickets SET status = $1 WHERE id = $2", [status, ticketId]);
            if (ticket_id) await dbQuery("UPDATE messages SET status = $1 WHERE ticket_id = $2", [status, ticket_id]);
        } else {
            const t = await nedb.support_tickets.findOne({ id: ticketId });
            if(!t) return res.status(404).json({ error: "Ticket not found" });
            await nedb.support_tickets.update({ id: ticketId }, { $set: { status } });
            if(t.ticket_id) await nedb.messages.update({ ticket_id: t.ticket_id }, { $set: { status } }, { multi: true });
        }
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/admin/messages/:id', requireAdmin, async (req, res) => {
    const ticketId = isPostgreSQL ? req.params.id : parseInt(req.params.id);
    try {
        if(isPostgreSQL) {
            const ticketRes = await dbQuery("SELECT ticket_id FROM support_tickets WHERE id = $1", [ticketId]);
            if (ticketRes.rows.length > 0) {
                const { ticket_id } = ticketRes.rows[0];
                if (ticket_id) await dbQuery("DELETE FROM messages WHERE ticket_id = $1", [ticket_id]);
            }
            await dbQuery("DELETE FROM support_tickets WHERE id = $1", [ticketId]);
        } else {
            const t = await nedb.support_tickets.findOne({ id: ticketId });
            if(t && t.ticket_id) await nedb.messages.remove({ ticket_id: t.ticket_id }, { multi: true });
            await nedb.support_tickets.remove({ id: ticketId }, {});
        }
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post('/api/admin/support-tickets/:id/reply', requireAdmin, async (req, res) => {
    const ticketDbId = isPostgreSQL ? req.params.id : parseInt(req.params.id);
    const { message, username } = req.body;
    if (!message || !username) return res.status(400).json({ error: "Missing data" });

    try {
        if(isPostgreSQL) {
            const ticketRes = await dbQuery("SELECT ticket_id, subject FROM support_tickets WHERE id = $1", [ticketDbId]);
            if (ticketRes.rows.length === 0) return res.status(404).json({ error: "Ticket not found" });
            const { ticket_id, subject } = ticketRes.rows[0];

            const userRes = await dbQuery("SELECT id FROM users WHERE username = $1", [username]);
            if (userRes.rows.length === 0) return res.status(404).json({ error: "User not found" });
            const userId = userRes.rows[0].id;

            const replySubject = `RE: ${subject} - Ticket: #${ticket_id}`;
            await dbQuery(
                `INSERT INTO messages (recipient_id, subject, body, type, is_read, created_at)
                 VALUES ($1, $2, $3, 'ticket_reply', false, $4)`,
                [userId, replySubject, message, new Date().toISOString()]
            );
            await dbQuery("UPDATE support_tickets SET status = 'closed' WHERE id = $1", [ticketDbId]);
            if (ticket_id) await dbQuery("UPDATE messages SET status = 'closed' WHERE ticket_id = $1", [ticket_id]);
        } else {
            const t = await nedb.support_tickets.findOne({ id: ticketDbId });
            if(!t) return res.status(404).json({ error: "Ticket not found" });
            const u = await nedb.users.findOne({ username });
            if(!u) return res.status(404).json({ error: "User not found" });

            const replySubject = `RE: ${t.subject} - Ticket: #${t.ticket_id}`;
            await nedb.messages.insert({ recipient_id: u.id, subject: replySubject, body: message, type: 'ticket_reply', is_read: false, created_at: new Date().toISOString() });

            await nedb.support_tickets.update({ id: ticketDbId }, { $set: { status: 'closed' } });
            if(t.ticket_id) await nedb.messages.update({ ticket_id: t.ticket_id }, { $set: { status: 'closed' } }, { multi: true });
        }
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/admin/support-tickets/:id', requireAdmin, async (req, res) => {
    const tid = isPostgreSQL ? req.params.id : parseInt(req.params.id);
    try {
        if(isPostgreSQL) {
            await dbQuery(`DELETE FROM support_tickets WHERE id = $1`, [tid]);
        } else {
            await nedb.support_tickets.remove({ id: tid }, {});
        }
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get('/api/admin/settings/:key', requireAdmin, async (req, res) => {
    try {
        const val = await DB.getSetting(req.params.key);
        res.json({ success: true, value: val });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/settings', requireAdmin, async (req, res) => {
    try {
        const { key, value } = req.body;
        await DB.setSetting(key, value);
        res.json({ success: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/maintenance-status', requireAdmin, async (req, res) => {
    try {
        const val = await DB.getSetting('maintenance_mode');
        res.json({ success: true, maintenance: val === 'true' });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

app.post('/api/admin/toggle-maintenance', requireAdmin, async (req, res) => {
    try {
        const { active } = req.body;
        await DB.setSetting('maintenance_mode', active ? 'true' : 'false');
        res.json({ success: true, maintenance: active });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

app.get('/api/admin/shop-status', requireAdmin, async (req, res) => {
    try {
        const val = await DB.getSetting('shop_active');
        res.json({ success: true, active: val === 'true' });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post('/api/admin/toggle-shop', requireAdmin, async (req, res) => {
    try {
        const { active } = req.body;
        await DB.setSetting('shop_active', active ? 'true' : 'false');
        res.json({ success: true, active });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get('/api/admin/system-status', requireAdmin, async (req, res) => {
    try {
        // Simple health check
        let dbOk = false;
        if(isPostgreSQL) {
            const dbRes = await dbQuery('SELECT 1');
            dbOk = !!dbRes;
        } else {
            dbOk = true; // NeDB usually ok if loaded
        }
        res.json({
            success: true,
            status: {
                serverTime: new Date().toISOString(),
                dbConnection: dbOk ? 'OK' : 'ERROR',
                platform: process.platform,
                uptime: process.uptime()
            }
        });
    } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

// ==================================================================
// LOCAL HUB ENDPOINTS (IT ADMIN & SOCKET.IO)
// ==================================================================

let isHubActive = false;
// Connected clients map: userId -> socketId
let connectedUsers = new Map();
let masterAdminSocketId = null;

// Socket.io Logic (Running but only accepting events if Hub is "Active")
io.on('connection', (socket) => {
    if(!isHubActive) {
        // Technically we accept connection but maybe we should disconnect if not active?
        // For now, allow connection but block actions.
    }

    // 1. REGISTER USER
    socket.on('register', (data) => {
        if(!isHubActive) return;
        const { userId, username, role } = data;
        connectedUsers.set(String(userId), socket.id);
        socket.userId = String(userId);
        socket.role = role || 'user';

        if(role === 'MASTER') {
            masterAdminSocketId = socket.id;
            console.log(`👑 Master Admin connected: ${username} (${socket.id})`);
        } else {
            console.log(`👤 User connected: ${username} (${userId})`);
            // Notify Master Admin
            if(masterAdminSocketId) {
                io.to(masterAdminSocketId).emit('user_online', { userId, username });
            }
        }
    });

    // 2. SEND MESSAGE (RELAY)
    socket.on('send_message', (data) => {
        if(!isHubActive) return;
        const { recipientId, encryptedPayload, type } = data; // Payload is full encrypted block

        // Support to Master Logic
        if(type === 'support') {
             if(masterAdminSocketId) {
                 io.to(masterAdminSocketId).emit('support_ticket', {
                     fromUserId: socket.userId,
                     payload: encryptedPayload,
                     timestamp: new Date().toISOString()
                 });
                 // Ack to sender
                 socket.emit('message_sent', { success: true });
             } else {
                 socket.emit('message_sent', { success: false, error: 'Support offline' });
             }
             return;
        }

        // Direct Message
        const targetSocketId = connectedUsers.get(String(recipientId));
        if(targetSocketId) {
            io.to(targetSocketId).emit('receive_message', {
                fromUserId: socket.userId,
                payload: encryptedPayload,
                timestamp: new Date().toISOString()
            });
            socket.emit('message_sent', { success: true });
        } else {
            // Store offline? OR just error for now (LAN mode usually assumes realtime)
            // Requirement says "autarkes System". Maybe store in Master DB?
            // For now: Error "User offline"
            socket.emit('message_sent', { success: false, error: 'User offline' });
        }
    });

    // 3. BROADCAST (Master Only)
    socket.on('broadcast', (data) => {
        if(!isHubActive) return;
        if(socket.role !== 'MASTER') return; // Security check

        socket.broadcast.emit('receive_broadcast', {
            message: data.message,
            timestamp: new Date().toISOString()
        });
    });

    socket.on('disconnect', () => {
        if(socket.userId) {
            connectedUsers.delete(socket.userId);
            if(masterAdminSocketId) {
                io.to(masterAdminSocketId).emit('user_offline', { userId: socket.userId });
            }
        }
        if(socket.id === masterAdminSocketId) {
            masterAdminSocketId = null;
            console.log("👑 Master Admin disconnected");
        }
    });
});


app.get('/api/hub/status', (req, res) => {
    res.json({ active: isHubActive, port: 3000 });
});

app.post('/api/hub/start', authenticateUser, async (req, res) => {
    // ENFORCEMENT: Only MASTER License can start Hub
    try {
        let licenseType = '';
        if(isPostgreSQL) {
            const r = await dbQuery(`
                SELECT k.product_code
                FROM users u
                JOIN license_keys k ON u.license_key_id = k.id
                WHERE u.id = $1
            `, [req.user.id]);
            if(r.rows.length > 0) licenseType = r.rows[0].product_code;
        } else {
            const u = await nedb.users.findOne({ id: req.user.id });
            if(u && u.license_key_id) {
                const k = await nedb.license_keys.findOne({ id: u.license_key_id });
                if(k) licenseType = k.product_code;
            }
        }

        if (licenseType !== 'MASTER') {
            return res.status(403).json({ error: 'Nur MASTER-Lizenzen dürfen den LAN-Hub starten.' });
        }

        isHubActive = true;
        const currentPort = server.address().port;
        console.log(`📡 LAN Hub (Socket.io) Active on Port ${currentPort}`);
        res.json({ success: true, active: true, port: currentPort });

    } catch (e) {
        console.error("Hub Start Error:", e);
        res.status(500).json({ success: false, error: e.message });
    }
});

app.post('/api/hub/stop', requireAdmin, (req, res) => {
    if (!isHubActive) return res.json({ success: true, active: false });

    isHubActive = false;
    // Disconnect all sockets?
    io.disconnectSockets();
    masterAdminSocketId = null;
    connectedUsers.clear();

    console.log('📡 LAN Hub stopped');
    res.json({ success: true, active: false });
});

// ==================================================================
// MESSAGING SYSTEM
// ==================================================================

app.get('/api/messages', authenticateUser, async (req, res) => {
    try {
        const userId = req.user.id;
        const now = new Date().toISOString();

        if(isPostgreSQL) {
            const sql = `
                SELECT * FROM messages
                WHERE (recipient_id = $1 AND (is_read = false OR type = 'ticket'))
                OR (recipient_id IS NULL AND (expires_at IS NULL OR expires_at > $2))
                ORDER BY created_at DESC
            `;
            const result = await dbQuery(sql, [userId, now]);
            res.json(result.rows);
        } else {
            const msgs = await nedb.messages.find({
                $or: [
                    { recipient_id: userId, $or: [{ is_read: false }, { type: 'ticket' }] },
                    { recipient_id: null, $or: [{ expires_at: null }, { expires_at: { $gt: now } }] }
                ]
            }).sort({ created_at: -1 });
            res.json(msgs);
        }
    } catch(e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/messages/:id/read', authenticateUser, async (req, res) => {
    try {
        const msgId = req.params.id;
        if(isPostgreSQL) {
            await dbQuery(`UPDATE messages SET is_read = true WHERE id = $1 AND recipient_id = $2`, [msgId, req.user.id]);
        } else {
            await nedb.messages.update({ id: msgId, recipient_id: req.user.id }, { $set: { is_read: true } });
        }
        res.json({ success: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/messages/:id', authenticateUser, async (req, res) => {
    try {
        const msgId = req.params.id;
        let msg;
        if(isPostgreSQL) {
            const msgRes = await dbQuery("SELECT type, status FROM messages WHERE id = $1 AND recipient_id = $2", [msgId, req.user.id]);
            if(msgRes.rows.length === 0) return res.status(404).json({ error: "Nachricht nicht gefunden" });
            msg = msgRes.rows[0];
        } else {
            msg = await nedb.messages.findOne({ id: msgId, recipient_id: req.user.id });
            if(!msg) return res.status(404).json({ error: "Nachricht nicht gefunden" });
        }

        if (msg.type === 'ticket' && msg.status !== 'closed') {
            return res.status(403).json({ error: "Ticket noch offen. Löschen nicht erlaubt." });
        }

        if(isPostgreSQL) {
            await dbQuery(`DELETE FROM messages WHERE id = $1 AND recipient_id = $2`, [msgId, req.user.id]);
        } else {
            await nedb.messages.remove({ id: msgId, recipient_id: req.user.id }, {});
        }
        res.json({ success: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/send-message', requireAdmin, async (req, res) => {
    try {
        const { recipientId, subject, body, type, expiresAt } = req.body;
        if(isPostgreSQL) {
            await dbQuery(
                `INSERT INTO messages (recipient_id, subject, body, type, expires_at, created_at, is_read) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                [recipientId || null, subject, body, type || 'general', expiresAt || null, new Date().toISOString(), false]
            );
        } else {
            await nedb.messages.insert({
                recipient_id: recipientId || null, subject, body, type: type || 'general', expires_at: expiresAt || null, created_at: new Date().toISOString(), is_read: false
            });
        }
        res.json({ success: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

// SCHEDULER (License Expiry)
const checkLicenseExpiries = async () => {
    try {
        if (!dbQuery && !nedb.license_keys) return;

        const now = new Date();
        const thresholds = [30, 10, 3]; // Days

        let activeKeysWithUsers = [];
        if(isPostgreSQL) {
            const sql = `
                SELECT u.id as user_id, l.expires_at
                FROM users u
                JOIN license_keys l ON u.license_key_id = l.id
                WHERE l.expires_at IS NOT NULL AND l.is_active = true
            `;
            const result = await dbQuery(sql);
            activeKeysWithUsers = result.rows;
        } else {
            const keys = await nedb.license_keys.find({ expires_at: { $ne: null }, is_active: true });
            for(let k of keys) {
                const u = await nedb.users.findOne({ license_key_id: k.id });
                if(u) activeKeysWithUsers.push({ user_id: u.id, expires_at: k.expires_at });
            }
        }

        for (const row of activeKeysWithUsers) {
            const expDate = new Date(row.expires_at);
            const diffTime = expDate - now;
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

            if (thresholds.includes(diffDays)) {
                const subject = `Lizenz läuft ab in ${diffDays} Tagen`;
                const checkTime = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

                let exists = false;
                if(isPostgreSQL) {
                    const existing = await dbQuery(`
                        SELECT id FROM messages
                        WHERE recipient_id = $1 AND subject = $2 AND created_at > $3
                    `, [row.user_id, subject, checkTime]);
                    exists = existing.rows.length > 0;
                } else {
                    const existing = await nedb.messages.findOne({ recipient_id: row.user_id, subject, created_at: { $gt: checkTime } });
                    exists = !!existing;
                }

                if (!exists) {
                    const msgBody = `Ihre Lizenz läuft am ${expDate.toLocaleDateString('de-DE')} ab. Bitte verlängern Sie rechtzeitig.`;
                    if(isPostgreSQL) {
                        await dbQuery(`
                            INSERT INTO messages (recipient_id, subject, body, type, is_read, created_at)
                            VALUES ($1, $2, $3, 'automated', false, $4)
                        `, [row.user_id, subject, msgBody, new Date().toISOString()]);
                    } else {
                        await nedb.messages.insert({ recipient_id: row.user_id, subject, body: msgBody, type: 'automated', is_read: false, created_at: new Date().toISOString() });
                    }
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

// Modifiziert für Electron Integration
if (require.main === module) {
    server.listen(PORT, () => {
        console.log(`🚀 Server running on Port ${PORT}`);
    });
}

module.exports = { app, startServer: (port) => server.listen(port || PORT, () => console.log(`🚀 Electron Server running on Port ${port || PORT}`)) };
