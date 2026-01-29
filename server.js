// server.js - Secret Messages Backend (Unified Version)

const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer'); // Added Multer
const fs = require('fs'); // Added fs
const { encryptServerSide } = require('./utils/serverCrypto');
const { initializeDatabase, dbQuery, isPostgreSQL } = require('./database/db');
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
}

// MOCK CLOUD SERVICES IF ENTERPRISE
const resend = (!IS_ENTERPRISE && process.env.RESEND_API_KEY)
    ? new Resend(process.env.RESEND_API_KEY)
    : { emails: { send: async () => { console.log(">> MOCK MAIL SENT (Enterprise/No Key)"); return { id: 'mock' }; } } };

const app = express();

// ==================================================================
// 1. MIDDLEWARE
// ==================================================================

// 1. Stripe Webhook (Raw)
app.use('/api/webhook', express.raw({ type: 'application/json' }));

// 2. Trust Proxy für Railway
app.set('trust proxy', 1);

// 3. Globaler JSON-Parser, aber NICHT für den Webhook-Pfad
app.use((req, res, next) => {
  if (req.originalUrl === '/api/webhook') {
    next();
  } else {
    express.json()(req, res, next);
  }
});

app.use(express.urlencoded({ extended: true }));

// HTTPS Redirect Middleware
app.use((req, res, next) => {
    if (req.hostname === 'localhost' || req.hostname === '127.0.0.1') return next();
    const isHttps = req.headers['x-forwarded-proto'] === 'https';
    const isRoot = req.hostname === 'secure-msg.app';
    const isProduction = process.env.NODE_ENV === 'production';

    if (isProduction && !IS_ENTERPRISE) {
        if (!isHttps) {
             return res.redirect(301, `https://${req.headers.host}${req.url}`);
        }
    }
    if (isRoot) {
        return res.redirect(301, `https://www.secure-msg.app${req.url}`);
    }
    next();
});

// MAINTENANCE MODE MIDDLEWARE
app.use(async (req, res, next) => {
    if (req.path.startsWith('/admin') ||
        req.path.startsWith('/api/admin') ||
        req.path.startsWith('/api/auth/login') ||
        req.path === '/maintenance' ||
        req.path.match(/\.(css|js|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot|json)$/)) {
        return next();
    }
    try {
        if (!dbQuery) return next();
        const resSettings = await dbQuery("SELECT value FROM settings WHERE key = 'maintenance_mode'");
        const isMaintenance = resSettings.rows.length > 0 && resSettings.rows[0].value === 'true';
        if (isMaintenance) {
            if (req.path.startsWith('/api')) {
                return res.status(503).json({ error: 'MAINTENANCE_MODE' });
            }
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
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://js.stripe.com", "https://cdnjs.cloudflare.com", "https://unpkg.com", "https://cdn.jsdelivr.net"],
      scriptSrcElem: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://js.stripe.com", "https://cdnjs.cloudflare.com", "https://unpkg.com", "https://cdn.jsdelivr.net"],
      scriptSrcAttr: ["'self'", "'unsafe-inline'"],
      frameSrc: ["'self'", "https://js.stripe.com"],
      connectSrc: ["'self'", "https://secure-msg.app", "https://www.secure-msg.app", "https://api.stripe.com", "https://js.stripe.com"],
      imgSrc: ["'self'", "data:", "https:"]
    }
  },
  strictTransportSecurity: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true
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

app.use(express.static('public', { index: false }));

// DETERMINE DATA DIRECTORY (Persistent Storage)
// Priority: USER_DATA_PATH (Electron) > DATA_PATH (Env) > Local 'data' folder
const DATA_DIR = process.env.USER_DATA_PATH
    ? path.join(process.env.USER_DATA_PATH, 'data')
    : (process.env.DATA_PATH || path.join(__dirname, 'data'));

// Ensure Data & Uploads Directories Exist
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const SECURITY_UPLOADS_DIR = path.join(UPLOADS_DIR, 'security');

if (!fs.existsSync(SECURITY_UPLOADS_DIR)) {
    try {
        fs.mkdirSync(SECURITY_UPLOADS_DIR, { recursive: true });
        console.log(`📂 Created Upload Directory: ${SECURITY_UPLOADS_DIR}`);
    } catch (e) {
        console.error("Failed to create upload directory:", e);
    }
}

// Mount persistent uploads directory
app.use('/uploads', express.static(UPLOADS_DIR));

// Multer Config
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        // Use persistent directory determined above
        if (!fs.existsSync(SECURITY_UPLOADS_DIR)){
            fs.mkdirSync(SECURITY_UPLOADS_DIR, { recursive: true });
        }
        cb(null, SECURITY_UPLOADS_DIR);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = path.extname(file.originalname);
        cb(null, 'post-' + uniqueSuffix + ext);
    }
});
const upload = multer({
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
    fileFilter: (req, file, cb) => {
        if(file.mimetype.startsWith('image/')) cb(null, true);
        else cb(new Error('Nur Bilder erlaubt!'), false);
    }
});

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'secret_fallback_key';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

function parseDbDate(dateStr) {
    if (!dateStr) return null;
    if (typeof dateStr === 'string' && dateStr.includes('.')) {
        const parts = dateStr.split('.');
        if (parts.length >= 3) {
            const d = parts[0];
            const m = parts[1];
            let y = parts[2];
            if (y.includes(' ')) y = y.split(' ')[0];
            if (y.length === 4) {
                return new Date(`${y}-${m}-${d}`);
            }
        }
    }
    const d = new Date(dateStr);
    return isNaN(d.getTime()) ? null : d;
}

function getMonthsFromProductCode(productCode) {
    const pc = (productCode || '').toLowerCase();
    if (pc === '1m' || pc === 'bundle_1m_2') return 1;
    if (pc === '3m' || pc === 'bundle_3m_5' || pc === 'bundle_3m_2') return 3;
    if (pc === '6m') return 6;
    if (pc === '1j' || pc === '12m' || pc === 'bundle_1y_10') return 12;
    return 0;
}

function calculateNewExpiration(currentExpirationStr, extensionMonths) {
    if (!extensionMonths || extensionMonths <= 0) return null;
    let baseDate = new Date();
    const currentExpiry = parseDbDate(currentExpirationStr);
    if (currentExpiry && currentExpiry > baseDate) {
        baseDate = currentExpiry;
    }
    const newDate = new Date(baseDate.getTime());
    newDate.setMonth(newDate.getMonth() + extensionMonths);
    return newDate.toISOString();
}

// ==================================================================
// 2. DATABASE SETUP
// ==================================================================
initializeDatabase();

// ==================================================================
// 2.1 ANALYTICS HELPERS
// ==================================================================
const anonymizeIp = (ip) => {
    if (!ip) return '0.0.0.0';
    if (ip.startsWith('::ffff:')) ip = ip.substring(7);
    if (ip.includes(':')) {
        const parts = ip.split(':');
        if (parts.length > 1) {
             return parts.slice(0, Math.max(1, parts.length - 1)).join(':') + ':XXXX';
        }
        return ip;
    }
    const parts = ip.split('.');
    if (parts.length === 4) {
        return `${parts[0]}.${parts[1]}.${parts[2]}.XXX`;
    }
    return ip;
};

const trackEvent = async (req, type, source, meta = {}) => {
    try {
        if (!dbQuery || IS_ENTERPRISE) return;
        const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
        const safeIp = anonymizeIp(ip);
        const metaStr = JSON.stringify(meta);
        const now = new Date().toISOString();
        await dbQuery(
            `INSERT INTO analytics_events (event_type, source, anonymized_ip, metadata, created_at) VALUES ($1, $2, $3, $4, $5)`,
            [type, source, safeIp, metaStr, now]
        );
    } catch (e) {
        console.warn("Analytics Error:", e.message);
    }
};

// ==================================================================
// 3. AUTHENTICATION & APP ROUTES
// ==================================================================

app.get('/api/ping', (req, res) => res.json({ status: 'ok' }));

app.post('/api/analytics/event', async (req, res) => {
    try {
        const { type, source, meta } = req.body;
        if (!type || !source) return res.status(400).json({ error: "Missing data" });
        await trackEvent(req, type, source, meta || {});
        res.json({ success: true });
    } catch(e) { res.status(500).json({ error: "Tracking failed" }); }
});

app.get('/api/shop-status', async (req, res) => {
    try {
        const result = await dbQuery("SELECT value FROM settings WHERE key = 'shop_active'");
        const active = result.rows.length > 0 && result.rows[0].value === 'true';
        res.json({ active });
    } catch (e) { res.status(500).json({ error: 'DB Error' }); }
});

// SUPPORT ENDPOINT
app.post('/api/support', rateLimiter, async (req, res) => {
    const { username, subject, email, message } = req.body;
    if ((!email && !username) || !message || !subject) {
        return res.status(400).json({ success: false, error: 'Bitte Pflichtfelder ausfüllen.' });
    }
    const ticketId = 'TIC-' + crypto.randomBytes(3).toString('hex').toUpperCase();
    const createdAt = new Date().toISOString();
    try {
        await dbQuery(
            `INSERT INTO support_tickets (ticket_id, username, email, subject, message, created_at, status) VALUES ($1, $2, $3, $4, $5, $6, 'open')`,
            [ticketId, username || null, email || null, subject, message, createdAt]
        );
        if (username) {
            try {
                const userRes = await dbQuery('SELECT id FROM users WHERE username = $1', [username]);
                if (userRes.rows.length > 0) {
                    const userId = userRes.rows[0].id;
                    await dbQuery(
                        `INSERT INTO messages (recipient_id, subject, body, type, is_read, created_at, status, ticket_id)
                         VALUES ($1, $2, $3, 'ticket', ${isPostgreSQL() ? 'true' : '1'}, $4, 'open', $5)`,
                        [userId, `[Ticket: ${ticketId}] ${subject}`, message, createdAt, ticketId]
                    );
                }
            } catch (err) { console.warn(">> Could not save copy to user inbox:", err.message); }
        }

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
                html: `<div style="font-family: Arial, sans-serif; color: #333; line-height: 1.6;"><h3 style="color: #00BFFF;">Vielen Dank für Ihre Anfrage!</h3><p>Hallo ${username || 'Nutzer'},</p><p>Ihre Nachricht ist bei uns eingegangen.</p><p><strong>Ticket:</strong> ${ticketId}</p></div>`
            });
            if (errorClient) console.warn('>> Warnung: Bestätigungsmail konnte nicht gesendet werden:', errorClient);
        }
        return res.status(200).json({ success: true, ticketId });
    } catch (error) {
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
            const blocked = dbUser ? (isPostgreSQL() ? dbUser.is_blocked : (dbUser.is_blocked === 1)) : false;
            if (!dbUser || blocked) return res.status(403).json({ error: "Konto gesperrt." });
            req.user = user;
            next();
        } catch (dbError) { return res.status(500).json({ error: 'Auth Error' }); }
    });
}

app.post('/api/auth/login', rateLimiter, async (req, res) => {
    try {
        const { username, accessCode, deviceId } = req.body;
        // Updated to use LEFT JOIN on license_keys to fetch the correct expires_at
        const userRes = await dbQuery(`
            SELECT u.*, l.expires_at, l.is_blocked as key_blocked
            FROM users u
            LEFT JOIN license_keys l ON u.license_key_id = l.id
            WHERE u.username = $1
        `, [username]);

        if (userRes.rows.length === 0) return res.status(401).json({ success: false, error: "Benutzer nicht gefunden" });
        const user = userRes.rows[0];

        const isKeyBlocked = isPostgreSQL() ? user.key_blocked : (user.key_blocked === 1);
        if (isKeyBlocked) {
            await trackEvent(req, 'login_blocked', 'auth', { username, reason: 'license_blocked' });
            return res.status(403).json({ success: false, error: "LIZENZ GESPERRT" });
        }

        const match = await bcrypt.compare(accessCode, user.access_code_hash);
        if (!match) {
            await trackEvent(req, 'login_fail', 'auth', { username });
            return res.status(401).json({ success: false, error: "Falscher Zugangscode" });
        }
        if (!user.pik_encrypted) {
            try {
                if (user.license_key_id) {
                    const keyRes = await dbQuery('SELECT key_code FROM license_keys WHERE id = $1', [user.license_key_id]);
                    if (keyRes.rows.length > 0) {
                        let licenseKey = keyRes.rows[0].key_code;
                        let pikRaw = crypto.createHash('sha256').update(licenseKey).digest('hex');
                        const regKeyHash = crypto.createHash('sha256').update(pikRaw).digest('hex');
                        const pikEncrypted = encryptServerSide(pikRaw, accessCode);
                        await dbQuery('UPDATE users SET pik_encrypted = $1, registration_key_hash = $2 WHERE id = $3', [pikEncrypted, regKeyHash, user.id]);
                    }
                }
            } catch (migErr) { }
        }
        if (user.allowed_device_id && user.allowed_device_id !== deviceId) {
            await trackEvent(req, 'login_device_mismatch', 'auth', { username });

            // Insert Security Warning
            const subject = "⚠️ Sicherheitswarnung: Login Versuch";
            const body = "ACHTUNG: Ein Versuch, sich von einem unberechtigten Gerät auf ihr Profil einzuloggen, wurde blockiert. Wenn der Versuch nicht von Ihnen stammt, ändern Sie ggf. Ihren Zugangscode!";
            const now = new Date().toISOString();

            await dbQuery(
                `INSERT INTO messages (recipient_id, subject, body, type, is_read, created_at)
                 VALUES ($1, $2, $3, 'automated', ${isPostgreSQL() ? 'false' : '0'}, $4)`,
                [user.id, subject, body, now]
            );

            return res.status(403).json({ success: false, error: "DEVICE_NOT_AUTHORIZED" });
        }

        const isBlocked = isPostgreSQL() ? user.is_blocked : (user.is_blocked === 1);
        if (isBlocked) {
            await trackEvent(req, 'login_blocked', 'auth', { username, reason: 'account_blocked' });
            return res.status(403).json({ success: false, error: "ACCOUNT_BLOCKED" });
        }
        if (!user.allowed_device_id) {
            const sanitizedDeviceId = deviceId.replace(/[^a-zA-Z0-9-]/g, '').substring(0, 50);
            await dbQuery("UPDATE users SET allowed_device_id = $1 WHERE id = $2", [deviceId, user.id]);
        }

        // Determine Role from Badge
        let role = 'user';
        if (user.badge && (user.badge.toLowerCase().includes('admin') || user.badge.includes('🛡️'))) role = 'admin';
        else if (user.badge && (user.badge.toLowerCase().includes('dev') || user.badge.includes('👾'))) role = 'dev';

        const token = jwt.sign({ id: user.id, username: user.username, role }, JWT_SECRET, { expiresIn: '24h' });
        await dbQuery("UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = $1", [user.id]);
        await trackEvent(req, 'login_success', 'auth', { username });
        res.json({ success: true, token, username: user.username, badge: user.badge, expiresAt: user.expires_at || 'lifetime', hasLicense: !!user.license_key_id, role });
    } catch (err) { res.status(500).json({ success: false, error: "Serverfehler" }); }
});

app.post('/api/auth/logout', authenticateUser, async (req, res) => {
    try {
        await dbQuery('UPDATE users SET is_online = $1 WHERE id = $2', [(isPostgreSQL() ? false : 0), req.user.id]);
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
        const isBlocked = isPostgreSQL() ? key.is_blocked : (key.is_blocked === 1);
        if (isBlocked) return res.status(403).json({ error: 'Lizenz gesperrt' });
        if (key.activated_at) return res.status(403).json({ error: 'Key bereits benutzt' });
        if (key.assigned_user_id) {
            if (key.assigned_user_id !== username) return res.status(403).json({ error: 'Dieser Key ist für eine andere ID reserviert.' });
        }
        const userRes = await dbQuery('SELECT id FROM users WHERE username = $1', [username]);
        if (userRes.rows.length > 0) return res.status(409).json({ error: 'Username vergeben' });

        const pc = (key.product_code || '').toLowerCase();
        const extensionMonths = getMonthsFromProductCode(pc);
        let expiresAt = null;

        if (pc === 'unl' || pc === 'unlimited') expiresAt = null;
        else if (extensionMonths > 0) expiresAt = calculateNewExpiration(null, extensionMonths);

        const hash = await bcrypt.hash(accessCode, 10);
        const pikRaw = crypto.createHash('sha256').update(licenseKey).digest('hex');
        const pikEncrypted = encryptServerSide(pikRaw, accessCode);
        const regKeyHash = crypto.createHash('sha256').update(pikRaw).digest('hex');

        let insertSql = 'INSERT INTO users (username, access_code_hash, license_key_id, allowed_device_id, registered_at, registration_key_hash, pik_encrypted) VALUES ($1, $2, $3, $4, $5, $6, $7)';
        if (isPostgreSQL()) { insertSql += ' RETURNING id'; }

        await dbQuery(insertSql, [username, hash, key.id, deviceId, new Date().toISOString(), regKeyHash, pikEncrypted]);
        await dbQuery('UPDATE license_keys SET is_active = $1, activated_at = $2, expires_at = $3 WHERE id = $4', [(isPostgreSQL() ? true : 1), new Date().toISOString(), expiresAt, key.id]);
        await trackEvent(req, 'activation_success', 'auth', { username, product: key.product_code });
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: 'Aktivierung fehlgeschlagen: ' + e.message });
    }
});

app.post('/api/renew-license', authenticateUser, async (req, res) => {
    const { licenseKey } = req.body;
    if (!licenseKey) return res.status(400).json({ error: "Kein Key angegeben" });
    try {
        const userId = req.user.id;
        // 1. Hole den neuen Key aus der DB
        const keyRes = await dbQuery('SELECT * FROM license_keys WHERE key_code = $1', [licenseKey]);
        if (keyRes.rows.length === 0) return res.status(404).json({ error: 'Key nicht gefunden' });
        const key = keyRes.rows[0];

        const isBlocked = isPostgreSQL() ? key.is_blocked : (key.is_blocked === 1);
        if (isBlocked) return res.status(403).json({ error: 'Lizenz gesperrt' });
        if (key.activated_at) return res.status(403).json({ error: 'Key bereits benutzt' });

        // 2. Hole aktuelle Lizenzdaten des Users
        const userRes = await dbQuery(`
            SELECT u.username, u.license_key_id, l.expires_at
            FROM users u
            LEFT JOIN license_keys l ON u.license_key_id = l.id
            WHERE u.id = $1
        `, [userId]);

        const userData = userRes.rows[0];
        const currentExpiryStr = userData.expires_at;
        const oldKeyId = userData.license_key_id;

        const pc = (key.product_code || '').toLowerCase();
        let extensionMonths = getMonthsFromProductCode(pc);
        if (extensionMonths === 0 && pc !== 'unl' && pc !== 'unlimited') extensionMonths = 1;

        let newExpiresAt = null;
        if (pc === 'unl' || pc === 'unlimited') newExpiresAt = null;
        else newExpiresAt = calculateNewExpiration(currentExpiryStr, extensionMonths);

        // 3. Transaktion für sichere Aktualisierung
        const now = new Date().toISOString();
        const isActiveVal = isPostgreSQL() ? true : 1;
        const inActiveVal = isPostgreSQL() ? false : 0;

        // Alten Key deaktivieren (Historie)
        if (oldKeyId) {
            await dbQuery(`UPDATE license_keys SET is_active = ${inActiveVal} WHERE id = $1`, [oldKeyId]);
        }

        // Neuen Key aktivieren
        await dbQuery(`
            UPDATE license_keys
            SET is_active = $1, activated_at = $2, expires_at = $3, assigned_user_id = $4
            WHERE id = $5
        `, [isActiveVal, now, newExpiresAt, userData.username, key.id]);

        // User mit neuem Key verknüpfen (Kein update von license_expiration!)
        await dbQuery('UPDATE users SET license_key_id = $1 WHERE id = $2', [key.id, userId]);

        // Loggen
        await dbQuery('INSERT INTO license_renewals (user_id, key_code_hash, extended_until, used_at) VALUES ($1, $2, $3, $4)', [userId, key.key_hash, newExpiresAt, now]);

        await trackEvent(req, 'renewal_success', 'shop', { userId });
        res.json({ success: true, newExpiresAt: newExpiresAt || 'Unlimited' });
    } catch (e) { res.status(500).json({ error: "Fehler: " + e.message }); }
});

app.post('/api/auth/check-license', async (req, res) => {
    try {
        const { licenseKey, username } = req.body;
        if (!licenseKey) return res.status(400).json({ error: "Kein Key" });
        const keyRes = await dbQuery('SELECT assigned_user_id, is_active, is_blocked, product_code FROM license_keys WHERE key_code = $1', [licenseKey]);
        if (keyRes.rows.length === 0) return res.json({ isValid: false });
        const key = keyRes.rows[0];
        const isBlocked = isPostgreSQL() ? key.is_blocked : (key.is_blocked === 1);
        if (isBlocked) return res.json({ isValid: false, error: 'Lizenz gesperrt' });
        const isActive = isPostgreSQL() ? key.is_active : (key.is_active === 1);
        if (isActive) return res.json({ isValid: false, error: 'Bereits benutzt' });

        let predictedExpiry = null;
        if (username) {
            // Updated to fetch expiry from license_keys via license_key_id
            const userRes = await dbQuery(`
                SELECT l.expires_at
                FROM users u
                LEFT JOIN license_keys l ON u.license_key_id = l.id
                WHERE u.username = $1
            `, [username]);

            if (userRes.rows.length > 0) {
                const currentExpiryStr = userRes.rows[0].expires_at;
                const pc = (key.product_code || '').toLowerCase();
                let extensionMonths = getMonthsFromProductCode(pc);
                if (extensionMonths === 0) extensionMonths = 1;
                const dbDate = parseDbDate(currentExpiryStr);
                const startDate = (dbDate && dbDate > new Date()) ? dbDate : new Date();
                if (pc === 'unl' || pc === 'unlimited') predictedExpiry = 'Unlimited';
                else {
                    startDate.setMonth(startDate.getMonth() + extensionMonths);
                    predictedExpiry = startDate.toISOString();
                }
            }
        }
        res.json({ isValid: true, assignedUserId: key.assigned_user_id || null, predictedExpiry });
    } catch (e) { res.status(500).json({ error: 'Serverfehler' }); }
});

app.post('/api/auth/change-code', authenticateUser, async (req, res) => {
    try {
        const { newAccessCode } = req.body;
        const hash = await bcrypt.hash(newAccessCode, 10);
        await dbQuery("UPDATE users SET access_code_hash = $1 WHERE id = $2", [hash, req.user.id]);
        res.json({ success: true });
    } catch(e) { res.status(500).json({ error: "Fehler." }); }
});

app.get('/api/checkAccess', authenticateUser, async (req, res) => {
    try {
        const { deviceId } = req.query;
        const userRes = await dbQuery('SELECT u.*, l.expires_at FROM users u LEFT JOIN license_keys l ON u.license_key_id = l.id WHERE u.id = $1', [req.user.id]);
        const user = userRes.rows[0];
        if (!user) return res.json({ status: 'banned' });
        const blocked = isPostgreSQL() ? user.is_blocked : (user.is_blocked === 1);
        if (blocked) return res.json({ status: 'banned' });

        if (deviceId && user.allowed_device_id && user.allowed_device_id !== deviceId) {
            return res.json({ status: 'device_mismatch' });
        }

        if (user.expires_at) {
            if (new Date(user.expires_at) < new Date()) return res.json({ status: 'expired' });
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
        const isBlocked = (isPostgreSQL() ? user.is_blocked : (user.is_blocked === 1));
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
        await dbQuery('INSERT INTO account_deletions (username, license_key_code, reason, deleted_at) VALUES ($1, $2, $3, $4)', [user.username, licenseCode, 'user_request', new Date().toISOString()]);
        await dbQuery('DELETE FROM users WHERE id = $1', [req.user.id]);
        if (user.license_key_id) await dbQuery('DELETE FROM license_keys WHERE id = $1', [user.license_key_id]);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: 'Fehler beim Löschen des Accounts.' }); }
});

app.post('/api/auth/validate', async (req, res) => {
    const { token } = req.body;
    if (!token) return res.json({ valid: false });
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        // Explicitly SELECT l.expires_at via JOIN
        const userRes = await dbQuery(`
            SELECT u.*, l.expires_at, l.is_blocked as key_blocked
            FROM users u
            LEFT JOIN license_keys l ON u.license_key_id = l.id
            WHERE u.id = $1
        `, [decoded.id]);

        if (userRes.rows.length > 0) {
            const user = userRes.rows[0];
            const isBlocked = isPostgreSQL() ? user.is_blocked : (user.is_blocked === 1);
            if (isBlocked) return res.json({ valid: false, reason: 'blocked' });
            const isKeyBlocked = isPostgreSQL() ? user.key_blocked : (user.key_blocked === 1);
            if (isKeyBlocked) return res.json({ valid: false, reason: 'license_blocked' });
            if (!user.license_key_id) return res.json({ valid: false, reason: 'no_license' });

            // source of truth is l.expires_at (fetched via join)
            let expirySource = user.expires_at;
            let isExpired = false;
            if (expirySource) {
                if (new Date(expirySource) < new Date()) isExpired = true;
            }
            if (isExpired) return res.json({ valid: false, reason: 'expired', expiresAt: expirySource });

            // Tracking for Live Stats
            await trackEvent(req, 'token_validate', 'auth', { username: user.username });
            res.json({ valid: true, username: user.username, badge: user.badge, expiresAt: expirySource || 'lifetime' });
        } else {
            res.json({ valid: false, reason: 'user_not_found' });
        }
    } catch (e) { res.json({ valid: false, reason: 'invalid_token' }); }
});

const pendingTransfers = new Map();
app.get('/api/auth/export-profile', authenticateUser, async (req, res) => {
    try {
        const userRes = await dbQuery('SELECT pik_encrypted FROM users WHERE id = $1', [req.user.id]);
        if (userRes.rows.length === 0) return res.status(404).json({ error: "User not found" });
        const { pik_encrypted } = userRes.rows[0];
        if (!pik_encrypted) return res.status(400).json({ error: "Kein PIK vorhanden" });
        res.json({ success: true, pik_encrypted, uid: req.user.username });
    } catch(e) { res.status(500).json({ error: "Fehler beim Export" }); }
});

app.post('/api/auth/transfer-start', authenticateUser, async (req, res) => {
    const { uid } = req.body;
    // Security: Ensure the requested UID matches the authenticated user
    if (!uid || uid !== req.user.username) return res.status(403).json({ error: "Unauthorized Transfer Request" });

    if (pendingTransfers.has(uid)) clearTimeout(pendingTransfers.get(uid).timer);

    const transferCode = crypto.randomBytes(3).toString('hex').toUpperCase(); // 6 chars

    const timer = setTimeout(async () => {
        try {
            pendingTransfers.delete(uid);
            const uRes = await dbQuery('SELECT id FROM users WHERE username = $1', [uid]);
            if (uRes.rows.length > 0) {
                const userId = uRes.rows[0].id;
                await dbQuery(
                    `INSERT INTO messages (recipient_id, subject, body, type, is_read, created_at) VALUES ($1, $2, $3, 'automated', ${isPostgreSQL() ? 'false' : '0'}, $4)`,
                    [userId, "⚠️ SICHERHEITSWARNUNG: Profil-Transfer", "ACHTUNG: Ein unberechtigter Versuch, Ihr Profil auf ein neues Gerät zu übertragen, wurde blockiert.", new Date().toISOString()]
                );
            }
        } catch(e) { console.error("Transfer Timeout Error", e); }
    }, 120000); // Increased to 2 minutes

    pendingTransfers.set(uid, { timer, attempts: 0, code: transferCode });
    res.json({ success: true, transferCode });
});

app.post('/api/auth/transfer-complete', async (req, res) => {
    const { uid, proof, timestamp, deviceId, transferCode } = req.body;
    if (!uid || !deviceId) return res.status(400).json({ error: "Invalid Data" });

    try {
        const transferSession = pendingTransfers.get(uid);
        if (!transferSession) return res.status(403).json({ error: "Kein aktiver Transfer-Versuch oder Timeout." });

        if (transferSession.attempts >= 3) {
            pendingTransfers.delete(uid);
            return res.status(403).json({ error: "Zu viele Fehlversuche. Transfer abgebrochen." });
        }

        // Join with license_keys to get expires_at
        const uRes = await dbQuery(`
            SELECT u.*, l.expires_at
            FROM users u
            LEFT JOIN license_keys l ON u.license_key_id = l.id
            WHERE u.username = $1
        `, [uid]);

        if (uRes.rows.length === 0) return res.status(404).json({ error: "User not found" });
        const user = uRes.rows[0];

        let valid = false;

        // Way 1: QR Proof
        if (proof && timestamp) {
            const sentTime = new Date(timestamp).getTime();
            const now = Date.now();
            if (Math.abs(now - sentTime) > 120000) return res.status(403).json({ error: "Zeitstempel ungültig" });
            const serverHash = user.registration_key_hash;
            if (!serverHash) return res.status(403).json({ error: "Integritätsfehler" });
            const expectedProof = crypto.createHash('sha256').update(serverHash + timestamp).digest('hex');
            if (proof === expectedProof) valid = true;
        }
        // Way 2: Manual Code
        else if (transferCode) {
            if (transferCode.toUpperCase() === transferSession.code) valid = true;
        }

        if (!valid) {
            transferSession.attempts++;
            return res.status(403).json({ error: "Identifizierung fehlgeschlagen." });
        }

        clearTimeout(transferSession.timer);
        pendingTransfers.delete(uid);

        await dbQuery("UPDATE users SET allowed_device_id = $1, last_login = CURRENT_TIMESTAMP WHERE id = $2", [deviceId, user.id]);
        const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '24h' });

        await dbQuery("INSERT INTO messages (recipient_id, subject, body, type, is_read, created_at) VALUES ($1, $2, $3, 'automated', $4, $5)", [user.id, "Info: Profil erfolgreich übertragen", `Ihr Profil wurde erfolgreich auf ein neues Gerät übertragen.\nGerät-ID: ${deviceId.substring(0,10)}...`, (isPostgreSQL() ? false : 0), new Date().toISOString()]);

        res.json({
            success: true,
            token,
            username: user.username,
            badge: user.badge,
            expiresAt: user.expires_at || 'lifetime',
            hasLicense: !!user.license_key_id,
            pik_encrypted: user.pik_encrypted // Sent for manual decryption on client
        });
    } catch(e) { res.status(500).json({ error: "Serverfehler" }); }
});

const requireAdmin = async (req, res, next) => {
    const authHeader = req.headers['authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.split(' ')[1];
        try {
            const decoded = jwt.verify(token, JWT_SECRET);
            if (decoded.role === 'admin') return next();
        } catch (e) { }
    }
    const sentPassword = req.headers['x-admin-password'] || req.body.password;
    if (sentPassword === ADMIN_PASSWORD) {
        if (dbQuery) {
            const resSettings = await dbQuery("SELECT value FROM settings WHERE key = 'admin_2fa_enabled'");
            const is2FA = resSettings.rows.length > 0 && resSettings.rows[0].value === 'true';
            if (is2FA) return res.status(403).json({ success: false, error: '2FA required. Please login.' });
        }
        return next();
    }
    return res.status(403).json({ success: false, error: 'Admin Auth Failed' });
};

const requireModerator = async (req, res, next) => {
    const authHeader = req.headers['authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.split(' ')[1];
        try {
            const decoded = jwt.verify(token, JWT_SECRET);
            if (decoded.role === 'admin' || decoded.role === 'dev') return next();
        } catch (e) { }
    }
    const sentPassword = req.headers['x-admin-password'] || req.body.password;
    if (sentPassword === ADMIN_PASSWORD) return next();
    return res.status(403).json({ success: false, error: 'Keine Berechtigung' });
};

app.post('/api/admin/auth', async (req, res) => {
    const { password } = req.body;
    const token = req.headers['x-admin-2fa-token'] || req.body.token;
    if (password !== ADMIN_PASSWORD) return res.status(403).json({ success: false, error: 'Falsches Passwort' });
    try {
        const resSecret = await dbQuery("SELECT value FROM settings WHERE key = 'admin_2fa_secret'");
        const hasSecret = resSecret.rows.length > 0 && resSecret.rows[0].value;
        if (hasSecret) {
            if (!token) return res.json({ success: false, error: '2FA Token erforderlich' });
            const verified = speakeasy.totp.verify({ secret: resSecret.rows[0].value, encoding: 'base32', token: token });
            if (!verified) return res.json({ success: false, error: 'Ungültiger 2FA Code' });
        }
        const jwtToken = jwt.sign({ role: 'admin' }, JWT_SECRET, { expiresIn: '4h' });
        res.json({ success: true, token: jwtToken });
    } catch (e) { res.status(500).json({ success: false, error: 'Auth Error' }); }
});

app.get('/api/admin/2fa-setup', requireAdmin, async (req, res) => {
    try {
        const secret = speakeasy.generateSecret({ name: "SecureMsg Admin" });
        QRCode.toDataURL(secret.otpauth_url, async (err, data_url) => {
            if (err) return res.status(500).json({ success: false, error: 'QR Gen Error' });
            res.json({ success: true, secret: secret.base32, qrCode: data_url });
        });
    } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post('/api/admin/2fa/verify', requireAdmin, async (req, res) => {
    const { token, secret } = req.body;
    try {
        const verified = speakeasy.totp.verify({ secret: secret, encoding: 'base32', token: token });
        if (verified) {
            await dbQuery("INSERT INTO settings (key, value) VALUES ('admin_2fa_secret', $1) ON CONFLICT(key) DO UPDATE SET value = $1", [secret]);
            await dbQuery("INSERT INTO settings (key, value) VALUES ('admin_2fa_enabled', 'true') ON CONFLICT(key) DO UPDATE SET value = 'true'");
            res.json({ success: true });
        } else { res.json({ success: false, error: 'Ungültiger Code' }); }
    } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post('/api/admin/2fa/disable', requireAdmin, async (req, res) => {
    try {
        await dbQuery("UPDATE settings SET value = 'false' WHERE key = 'admin_2fa_enabled'");
        res.json({ success: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/mail/send', requireAdmin, async (req, res) => {
    const { type, recipientId, subject, body, expiresAt } = req.body;
    if (!subject || !body) return res.status(400).json({ error: "Betreff/Nachricht fehlt." });

    try {
        const now = new Date().toISOString();
        const isReadVal = isPostgreSQL() ? false : 0;

        if (type === 'broadcast') {
            // Send to ALL users
            // 1. Get all user IDs
            const usersRes = await dbQuery("SELECT id FROM users");
            if (usersRes.rows.length === 0) return res.json({ success: true, count: 0 });

            // 2. Bulk Insert (or loop)
            // Using loop for simplicity and DB compatibility (SQLite/Postgres)
            // Ideally use batch insert but loop is safer for cross-db compatibility here
            await dbQuery('BEGIN');
            for (const row of usersRes.rows) {
                await dbQuery(
                    `INSERT INTO messages (recipient_id, subject, body, type, expires_at, created_at, is_read) VALUES ($1, $2, $3, 'broadcast', $4, $5, $6)`,
                    [row.id, subject, body, expiresAt || null, now, isReadVal]
                );
            }
            await dbQuery('COMMIT');
            return res.json({ success: true, count: usersRes.rows.length });

        } else if (type === 'user') {
            if (!recipientId) return res.status(400).json({ error: "User ID fehlt." });

            // Validate User
            const uCheck = await dbQuery("SELECT id FROM users WHERE id = $1", [recipientId]);
            if (uCheck.rows.length === 0) return res.status(404).json({ error: "User ID nicht gefunden." });

            await dbQuery(
                `INSERT INTO messages (recipient_id, subject, body, type, expires_at, created_at, is_read) VALUES ($1, $2, $3, 'admin_msg', $4, $5, $6)`,
                [recipientId, subject, body, expiresAt || null, now, isReadVal]
            );
            return res.json({ success: true });
        } else {
            return res.status(400).json({ error: "Ungültiger Empfängertyp." });
        }
    } catch(e) {
        await dbQuery('ROLLBACK');
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/admin/stats', requireAdmin, async (req, res) => {
    try {
        const now = isPostgreSQL() ? 'NOW()' : 'DATETIME("now")';
        const activeUsers = await dbQuery(`SELECT COUNT(*) as c FROM users WHERE is_blocked = ${isPostgreSQL() ? 'false' : '0'}`);
        const blockedUsers = await dbQuery(`SELECT COUNT(*) as c FROM users WHERE is_blocked = ${isPostgreSQL() ? 'true' : '1'}`);
        const activeKeys = await dbQuery(`SELECT COUNT(*) as c FROM license_keys WHERE is_active = ${isPostgreSQL() ? 'true' : '1'}`);
        const expiredKeys = await dbQuery(`SELECT COUNT(*) as c FROM license_keys WHERE expires_at IS NOT NULL AND expires_at <= ${now}`);
        const totalPurchases = await dbQuery(`SELECT COUNT(*) as c FROM payments WHERE status = 'completed'`);
        const totalRevenue = await dbQuery(`SELECT SUM(amount) as s FROM payments WHERE status = 'completed'`);
        const totalBundles = await dbQuery(`SELECT COUNT(*) as c FROM license_bundles`);
        const unassignedBundleKeys = await dbQuery(`SELECT COUNT(*) as c FROM license_keys WHERE bundle_id IS NOT NULL AND is_active = ${isPostgreSQL() ? 'false' : '0'}`);
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

app.get('/api/admin/stats/advanced', requireAdmin, async (req, res) => {
    try {
        let { startDate, endDate, granularity } = req.query; // granularity: day, week, month, year, manual

        // 1. Determine Time Range
        let start, end;
        const now = new Date();

        if (granularity === 'day') {
            start = new Date(now); start.setHours(0,0,0,0);
            end = new Date(now); end.setHours(23,59,59,999);
        } else if (granularity === 'week') {
            start = new Date(now); start.setDate(now.getDate() - 7); start.setHours(0,0,0,0);
            end = new Date(now); end.setHours(23,59,59,999);
        } else if (granularity === 'month') {
            start = new Date(now.getFullYear(), now.getMonth(), 1);
            end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
        } else if (granularity === 'year') {
            start = new Date(now.getFullYear(), 0, 1);
            end = new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999);
        } else {
            // Manual or Default
            end = endDate ? new Date(endDate) : new Date();
            end.setHours(23, 59, 59, 999);
            start = startDate ? new Date(startDate) : new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);
            start.setHours(0, 0, 0, 0);
        }

        const startIso = start.toISOString();
        const endIso = end.toISOString();

        // 2. Determine Date Grouping Function
        let dateFunc, dateFuncPayments;
        if (granularity === 'day') {
            // Hourly
            dateFunc = isPostgreSQL() ? "TO_CHAR(created_at, 'YYYY-MM-DD HH24:00')" : "strftime('%Y-%m-%d %H:00', created_at)";
            dateFuncPayments = isPostgreSQL() ? "TO_CHAR(completed_at, 'YYYY-MM-DD HH24:00')" : "strftime('%Y-%m-%d %H:00', completed_at)";
        } else if (granularity === 'year') {
            // Monthly
            dateFunc = isPostgreSQL() ? "TO_CHAR(created_at, 'YYYY-MM')" : "strftime('%Y-%m', created_at)";
            dateFuncPayments = isPostgreSQL() ? "TO_CHAR(completed_at, 'YYYY-MM')" : "strftime('%Y-%m', completed_at)";
        } else {
            // Daily (Week, Month, Manual)
            dateFunc = isPostgreSQL() ? "TO_CHAR(created_at, 'YYYY-MM-DD')" : "DATE(created_at)";
            dateFuncPayments = isPostgreSQL() ? "TO_CHAR(completed_at, 'YYYY-MM-DD')" : "DATE(completed_at)";
        }

        // 3. Traffic Logic with Source Breakdown
        // We aggregate by Time Unit AND Source to get multi-line chart data
        const trafficSql = `
            SELECT ${dateFunc} as label, source, COUNT(DISTINCT anonymized_ip) as visitors, COUNT(*) as page_views
            FROM analytics_events
            WHERE event_type = 'page_view' AND created_at >= $1 AND created_at <= $2
            GROUP BY label, source
            ORDER BY label ASC
        `;
        const trafficRes = await dbQuery(trafficSql, [startIso, endIso]);

        // 4. Finance Logic
        const financeSql = `
            SELECT ${dateFuncPayments} as label, SUM(amount) as revenue, COUNT(*) as sales
            FROM payments
            WHERE status = 'completed' AND completed_at >= $1 AND completed_at <= $2
            GROUP BY label
            ORDER BY label ASC
        `;
        const financeRes = await dbQuery(financeSql, [startIso, endIso]);

        // 5. Product Breakdown
        const productSql = `SELECT metadata FROM payments WHERE status = 'completed' AND completed_at >= $1 AND completed_at <= $2`;
        const productRes = await dbQuery(productSql, [startIso, endIso]);
        const products = {};
        productRes.rows.forEach(row => {
            try {
                const meta = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata;
                const type = meta.product_type || 'Unknown';
                products[type] = (products[type] || 0) + 1;
            } catch(e){}
        });

        // 6. LIVE TRAFFIC (Last 10 minutes)
        // We fetch raw events to process unique Usernames in JS (easier than SQL JSON extraction across DBs)
        const tenMinsAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
        const liveEventsSql = `SELECT event_type, source, anonymized_ip, metadata FROM analytics_events WHERE created_at > $1`;
        const liveRes = await dbQuery(liveEventsSql, [tenMinsAgo]);

        const liveStats = {
            visitors: new Set(),
            users: new Set(),
            guests_approx: 0,
            pages: { landing: 0, shop: 0, app: 0 }
        };

        liveRes.rows.forEach(row => {
            // Visitors (IP based)
            if (row.event_type === 'page_view') {
                liveStats.visitors.add(row.anonymized_ip);
                if (row.source === 'landing') liveStats.pages.landing++;
                if (row.source === 'shop') liveStats.pages.shop++;
                if (row.source === 'app') liveStats.pages.app++;
            }
            // Users (Login/Validate based)
            if (['login_success', 'token_validate'].includes(row.event_type)) {
                try {
                    const meta = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata;
                    if (meta && meta.username) liveStats.users.add(meta.username);
                } catch(e){}
            }
        });
        // Approximate guests (Total Visitors - Logged In Users). Not perfect but decent proxy.
        liveStats.guests_approx = Math.max(0, liveStats.visitors.size - liveStats.users.size);

        // 7. Retention Logic
        // Active Users: Users with active license
        const activeUsersSql = `
            SELECT COUNT(DISTINCT u.id) as c
            FROM users u
            JOIN license_keys l ON u.license_key_id = l.id
            WHERE u.is_blocked = ${isPostgreSQL() ? 'FALSE' : '0'}
            AND l.is_active = ${isPostgreSQL() ? 'TRUE' : '1'}
            AND (l.expires_at IS NULL OR l.expires_at > ${isPostgreSQL() ? 'NOW()' : 'DATETIME("now")'})
        `;
        const activeUsersRes = await dbQuery(activeUsersSql);

        // Renewed Users: Users who appear in license_renewals
        const renewedUsersSql = `SELECT COUNT(DISTINCT user_id) as c FROM license_renewals`;
        const renewedUsersRes = await dbQuery(renewedUsersSql);

        // Expired/Churned (Users with license_key_id but key is expired)
        // or Users who had a key but now don't (if we tracked that perfectly, hard to say).
        // Let's count keys that are expired
        const expiredKeysSql = `SELECT COUNT(*) as c FROM license_keys WHERE expires_at IS NOT NULL AND expires_at < ${isPostgreSQL() ? 'NOW()' : 'DATETIME("now")'}`;
        const expiredKeysRes = await dbQuery(expiredKeysSql);

        // 8. Support Top List
        const supportTopSql = `SELECT subject, COUNT(*) as c FROM support_tickets GROUP BY subject ORDER BY c DESC LIMIT 10`;
        const supportTopRes = await dbQuery(supportTopSql);

        // 9. Security Details
        const securitySql = `SELECT event_type, metadata, COUNT(*) as c FROM analytics_events WHERE event_type IN ('login_blocked', 'login_fail', 'login_device_mismatch') AND created_at >= $1 AND created_at <= $2 GROUP BY event_type, metadata`;
        const securityRes = await dbQuery(securitySql, [startIso, endIso]);
        // Consolidate security events (metadata might scatter grouping, so we process basic types)
        const securitySummary = { blocked: 0, failed: 0, mismatch: 0, details: [] };
        securityRes.rows.forEach(r => {
            if (r.event_type === 'login_blocked') securitySummary.blocked += parseInt(r.c);
            if (r.event_type === 'login_fail') securitySummary.failed += parseInt(r.c);
            if (r.event_type === 'login_device_mismatch') securitySummary.mismatch += parseInt(r.c);
            // Add to details if interesting
             try {
                const meta = typeof r.metadata === 'string' ? JSON.parse(r.metadata) : r.metadata;
                if(r.event_type === 'login_device_mismatch') {
                    securitySummary.details.push({ type: 'Wrong Device', user: meta.username, count: r.c });
                }
            } catch(e){}
        });

        res.json({
            success: true,
            granularity,
            traffic: trafficRes.rows, // contains label, source, visitors, page_views
            finance: financeRes.rows, // contains label, revenue, sales
            products: products,
            live: {
                visitors: liveStats.visitors.size,
                users: liveStats.users.size,
                guests: liveStats.guests_approx,
                pages: liveStats.pages
            },
            retention: {
                active_users: activeUsersRes.rows[0].c,
                renewed_users: renewedUsersRes.rows[0].c,
                expired_keys: expiredKeysRes.rows[0].c
            },
            support: {
                top_subjects: supportTopRes.rows
            },
            security: securitySummary
        });
    } catch(e) { console.error(e); res.status(500).json({ success: false, error: e.message }); }
});

app.get('/api/admin/keys', requireAdmin, async (req, res) => {
    try {
        const result = await dbQuery(`SELECT k.*, u.username, u.id as user_id FROM license_keys k LEFT JOIN users u ON u.license_key_id = k.id WHERE (k.product_code != 'ENTERPRISE' OR k.product_code IS NULL) ORDER BY k.created_at DESC LIMIT 200`);
        const keys = result.rows.map(r => ({ ...r, is_active: isPostgreSQL() ? r.is_active : (r.is_active === 1) }));
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
        // Do NOT update users.license_expiration (column deprecated)
        // await dbQuery(`UPDATE users SET license_expiration = $1 WHERE license_key_id = $2`, [expires_at || null, keyId]);

        await dbQuery(`UPDATE users SET license_key_id = NULL WHERE license_key_id = $1`, [keyId]);
        if (user_id) {
            const userCheck = await dbQuery(`SELECT id FROM users WHERE id = $1`, [user_id]);
            if (userCheck.rows.length > 0) {
                // Only update license_key_id
                await dbQuery(`UPDATE users SET license_key_id = $1 WHERE id = $2`, [keyId, user_id]);
                const now = new Date().toISOString();
                await dbQuery(`UPDATE license_keys SET is_active = ${isPostgreSQL() ? 'true' : '1'}, activated_at = COALESCE(activated_at, $2) WHERE id = $1`, [keyId, now]);
            }
        }
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.delete('/api/admin/keys/:id', requireAdmin, async (req, res) => {
    const keyId = req.params.id;
    const cascade = req.query.cascade === 'true';
    try {
        await dbQuery('BEGIN');
        if (cascade) {
             const userRes = await dbQuery('SELECT id FROM users WHERE license_key_id = $1', [keyId]);
             if (userRes.rows.length > 0) await dbQuery('DELETE FROM users WHERE id = $1', [userRes.rows[0].id]);
        } else {
             await dbQuery('UPDATE users SET license_key_id = NULL WHERE license_key_id = $1', [keyId]);
        }
        await dbQuery('DELETE FROM license_keys WHERE id = $1', [keyId]);
        await dbQuery('COMMIT');
        res.json({ success: true });
    } catch (e) {
        await dbQuery('ROLLBACK');
        res.status(500).json({ success: false, error: e.message });
    }
});

app.delete('/api/admin/users/:id', requireAdmin, async (req, res) => {
    const userId = req.params.id;
    const cascade = req.query.cascade === 'true';
    try {
        const userRes = await dbQuery('SELECT license_key_id, username FROM users WHERE id = $1', [userId]);
        if (userRes.rows.length === 0) return res.status(404).json({ error: "User not found" });
        const user = userRes.rows[0];
        await dbQuery('BEGIN');
        if (user.license_key_id) {
            await dbQuery('UPDATE users SET license_key_id = NULL WHERE id = $1', [userId]);
            if (!cascade) await dbQuery(`UPDATE license_keys SET is_active = ${isPostgreSQL() ? 'false' : '0'}, activated_at = NULL WHERE id = $1`, [user.license_key_id]);
        }
        await dbQuery('DELETE FROM users WHERE id = $1', [userId]);
        if (cascade && user.license_key_id) await dbQuery('DELETE FROM license_keys WHERE id = $1', [user.license_key_id]);
        await dbQuery('COMMIT');
        res.json({ success: true });
    } catch (e) {
        await dbQuery('ROLLBACK');
        res.status(500).json({ success: false, error: e.message });
    }
});

app.get('/api/admin/users/:id/details', requireAdmin, async (req, res) => {
    try {
        const userId = req.params.id;
        // Fetch expires_at from license_keys and alias it as license_expiration
        const userRes = await dbQuery(`
            SELECT u.id, u.username, u.registered_at, u.last_login, u.registration_key_hash, u.badge,
                   u.license_key_id, l.expires_at as license_expiration, u.is_blocked, u.allowed_device_id
            FROM users u
            LEFT JOIN license_keys l ON u.license_key_id = l.id
            WHERE u.id = $1
        `, [userId]);

        if (userRes.rows.length === 0) return res.status(404).json({ error: "User not found" });
        const user = { ...userRes.rows[0], is_blocked: isPostgreSQL() ? userRes.rows[0].is_blocked : (userRes.rows[0].is_blocked === 1) };
        const historyRes = await dbQuery(`SELECT key_code, product_code, activated_at, expires_at, is_active, origin FROM license_keys WHERE assigned_user_id = $1 OR id = $2 ORDER BY activated_at DESC`, [user.username, user.license_key_id]);
        const history = historyRes.rows.map(r => ({ ...r, is_active: isPostgreSQL() ? r.is_active : (r.is_active === 1) }));
        res.json({ success: true, user, history });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/admin/users/:id/badge', requireAdmin, async (req, res) => {
    const userId = req.params.id;
    const { badge } = req.body;
    try {
        await dbQuery("UPDATE users SET badge = $1 WHERE id = $2", [badge || null, userId]);
        res.json({ success: true });
    } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post('/api/admin/users/:id/link-key', requireAdmin, async (req, res) => {
    const userId = req.params.id;
    const { keyCode } = req.body;
    if (!keyCode) return res.status(400).json({ error: "Key Code missing" });
    try {
        // Fetch current expiration from JOIN
        const userRes = await dbQuery(`
            SELECT u.username, u.license_key_id, l.expires_at
            FROM users u
            LEFT JOIN license_keys l ON u.license_key_id = l.id
            WHERE u.id = $1
        `, [userId]);

        if (userRes.rows.length === 0) return res.status(404).json({ error: "User not found" });
        const user = userRes.rows[0];

        if (user.license_key_id) {
            const currentKeyRes = await dbQuery('SELECT expires_at, product_code FROM license_keys WHERE id = $1', [user.license_key_id]);
            if (currentKeyRes.rows.length > 0) {
                const currentKey = currentKeyRes.rows[0];
                const isLifetime = !currentKey.expires_at || (currentKey.product_code && currentKey.product_code.toLowerCase().includes('unl'));
                // Use expires_at from key
                if (isLifetime) return res.status(403).json({ error: "Benutzer hat bereits eine Lifetime-Lizenz." });

                // Archive old key by setting is_active=false (as per instructions)
                const inActiveVal = isPostgreSQL() ? false : 0;
                await dbQuery(`UPDATE license_keys SET is_active = ${inActiveVal} WHERE id = $1`, [user.license_key_id]);
            }
        }

        const keyRes = await dbQuery('SELECT * FROM license_keys WHERE key_code = $1', [keyCode]);
        if (keyRes.rows.length === 0) return res.status(404).json({ error: "Key not found" });
        const key = keyRes.rows[0];
        const isActive = isPostgreSQL() ? key.is_active : (key.is_active === 1);
        if (isActive) return res.status(403).json({ error: "Key already active" });

        const pc = (key.product_code || '').toLowerCase();
        let extensionMonths = getMonthsFromProductCode(pc);
        if (extensionMonths === 0 && pc !== 'unl' && pc !== 'unlimited') extensionMonths = 1;

        let newExpiresAt = null;
        if (pc === 'unl' || pc === 'unlimited') newExpiresAt = null;
        else newExpiresAt = calculateNewExpiration(user.expires_at, extensionMonths);

        await dbQuery('BEGIN');
        const now = new Date().toISOString();
        await dbQuery(`UPDATE license_keys SET is_active = ${isPostgreSQL() ? 'true' : '1'}, activated_at = $1, expires_at = $2, assigned_user_id = $3 WHERE id = $4`, [now, newExpiresAt, user.username, key.id]);

        // Update ONLY license_key_id
        await dbQuery(`UPDATE users SET license_key_id = $1 WHERE id = $2`, [key.id, userId]);

        await dbQuery('INSERT INTO license_renewals (user_id, key_code_hash, extended_until, used_at) VALUES ($1, $2, $3, $4)', [userId, key.key_hash, newExpiresAt, now]);
        await dbQuery('COMMIT');
        res.json({ success: true, newExpiresAt });
    } catch (e) {
        await dbQuery('ROLLBACK');
        res.status(500).json({ error: "Fehler beim Verknüpfen: " + e.message });
    }
});

app.post('/api/admin/generate-enterprise', requireAdmin, async (req, res) => {
    try {
        const { clientName, quota, expiresAt } = req.body;
        const rand = crypto.randomBytes(5).toString('hex').toUpperCase();
        const keyRaw = 'ENT-' + rand.substring(0, 5) + '-' + rand.substring(5, 10);
        const keyHash = crypto.createHash('sha256').update(keyRaw).digest('hex');
        const quotaInt = parseInt(quota) || 5;
        let insertSql = `INSERT INTO license_keys (key_code, key_hash, product_code, client_name, max_users, expires_at, is_active) VALUES ($1, $2, 'ENTERPRISE', $3, $4, $5, ${isPostgreSQL() ? 'false' : '0'})`;
        await dbQuery(insertSql, [keyRaw, keyHash, clientName, quotaInt, expiresAt || null]);
        res.json({ success: true, key: keyRaw });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/enterprise-keys', requireAdmin, async (req, res) => {
    try {
        const result = await dbQuery(`SELECT k.* FROM license_keys k WHERE k.product_code = 'ENTERPRISE' ORDER BY k.created_at DESC`);
        const keys = result.rows.map(r => ({ ...r, is_active: isPostgreSQL() ? r.is_active : (r.is_active === 1), is_blocked: isPostgreSQL() ? r.is_blocked : (r.is_blocked === 1) }));
        res.json(keys);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/enterprise-keys/:id/toggle-block', requireAdmin, async (req, res) => {
    try {
        const { blocked } = req.body;
        const val = isPostgreSQL() ? blocked : (blocked ? 1 : 0);
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
        await dbQuery('UPDATE users SET license_key_id = NULL WHERE license_key_id = $1', [keyId]);
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
            await dbQuery(`INSERT INTO license_keys (key_code, key_hash, product_code, is_active, origin) VALUES ($1, $2, $3, $4, 'admin')`, [keyRaw, keyHash, productCode, (isPostgreSQL() ? false : 0)]);
            newKeys.push(keyRaw);
        }
        res.json({ success: true, keys: newKeys });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/generate-bundle', requireAdmin, async (req, res) => {
    try {
        const { name, count, productCode, idStem, startNumber } = req.body;
        const amount = parseInt(count) || 1;
        const start = parseInt(startNumber) || 1;
        const orderNum = 'ORD-' + crypto.randomBytes(4).toString('hex').toUpperCase();
        let insertBundle = await dbQuery(`INSERT INTO license_bundles (name, order_number, total_keys, created_at) VALUES ($1, $2, $3, $4) ${isPostgreSQL() ? 'RETURNING id' : ''}`, [name, orderNum, amount, new Date().toISOString()]);
        let bundleId = isPostgreSQL() ? insertBundle.rows[0].id : insertBundle.lastID;
        const newKeys = [];
        for(let i = 0; i < amount; i++) {
            const seqNum = start + i;
            const assignedId = `${idStem}${String(seqNum).padStart(3, '0')}`;
            const keyRaw = crypto.randomBytes(6).toString('hex').toUpperCase().match(/.{1,4}/g).join('-');
            const keyHash = crypto.createHash('sha256').update(keyRaw).digest('hex');
            await dbQuery(`INSERT INTO license_keys (key_code, key_hash, product_code, is_active, bundle_id, assigned_user_id, origin) VALUES ($1, $2, $3, $4, $5, $6, 'admin')`, [keyRaw, keyHash, productCode, (isPostgreSQL() ? false : 0), bundleId, assignedId]);
            newKeys.push({ key: keyRaw, assignedId });
        }
        res.json({ success: true, bundleId, keys: newKeys });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/bundles', requireAdmin, async (req, res) => {
    try {
        const result = await dbQuery(`SELECT b.*, (SELECT COUNT(*) FROM license_keys k WHERE k.bundle_id = b.id AND k.is_active = ${isPostgreSQL() ? 'TRUE' : '1'}) as active_count FROM license_bundles b ORDER BY b.created_at DESC`);
        res.json(result.rows);
    } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/bundles/:id/keys', requireAdmin, async (req, res) => {
    try {
        const result = await dbQuery(`SELECT key_code, assigned_user_id, is_active, expires_at FROM license_keys WHERE bundle_id = $1 ORDER BY assigned_user_id ASC`, [req.params.id]);
        const keys = result.rows.map(r => ({ ...r, is_active: isPostgreSQL() ? r.is_active : (r.is_active === 1) }));
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
        await dbQuery(`UPDATE users SET license_key_id = NULL WHERE license_key_id IN (SELECT id FROM license_keys WHERE bundle_id = $1)`, [bundleId]);
        await dbQuery(`DELETE FROM license_keys WHERE bundle_id = $1`, [bundleId]);
        await dbQuery(`DELETE FROM license_bundles WHERE id = $1`, [bundleId]);
        res.json({ success: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/users', requireAdmin, async (req, res) => {
    try {
        // JOIN license_keys to get the correct expires_at (aliased as license_expiration for frontend compatibility)
        const result = await dbQuery(`
            SELECT u.*, k.key_code, k.expires_at as license_expiration,
                   (SELECT COUNT(*) FROM license_keys WHERE id = u.license_key_id OR assigned_user_id = u.username) as license_count
            FROM users u
            LEFT JOIN license_keys k ON u.license_key_id = k.id
            ORDER BY u.registered_at DESC LIMIT 100
        `);
        const users = result.rows.map(r => ({ ...r, is_blocked: isPostgreSQL() ? r.is_blocked : (r.is_blocked === 1), is_online: isPostgreSQL() ? r.is_online : (r.is_online === 1) }));
        res.json(users);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/users/:id/licenses', requireAdmin, async (req, res) => {
    try {
        const userId = req.params.id;
        const userRes = await dbQuery('SELECT username, license_key_id FROM users WHERE id = $1', [userId]);
        if (userRes.rows.length === 0) return res.status(404).json({ error: "User not found" });
        const { username, license_key_id } = userRes.rows[0];
        const result = await dbQuery(`SELECT * FROM license_keys WHERE id = $1 OR assigned_user_id = $2 ORDER BY activated_at DESC`, [license_key_id, username]);
        const keys = result.rows.map(r => ({ ...r, is_active: isPostgreSQL() ? r.is_active : (r.is_active === 1) }));
        res.json(keys);
    } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/block-user/:id', requireAdmin, async (req, res) => {
    try {
        await dbQuery("UPDATE users SET is_blocked = TRUE WHERE id = $1", [req.params.id]);
        await dbQuery("DELETE FROM user_sessions WHERE user_id = $1", [req.params.id]);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false }); }
});

app.post('/api/admin/unblock-user/:id', requireAdmin, async (req, res) => {
    await dbQuery(`UPDATE users SET is_blocked = ${isPostgreSQL() ? 'false' : '0'} WHERE id = $1`, [req.params.id]);
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
        const result = await dbQuery(`SELECT * FROM payments ORDER BY COALESCE(completed_at, created_at) DESC LIMIT 100`);
        const purchases = result.rows.map(r => {
            let meta = {};
            try { meta = (typeof r.metadata === 'string') ? JSON.parse(r.metadata) : r.metadata || {}; } catch(e){}
            const email = meta.email || meta.customer_email || meta.customerEmail || '?';
            return { id: r.payment_id, email: email, product: meta.product_type || '?', amount: r.amount, currency: r.currency, date: r.completed_at || r.created_at, status: r.status };
        });
        res.json(purchases);
    } catch (e) { res.json([]); }
});

app.get('/api/admin/support-tickets', requireAdmin, async (req, res) => {
    try {
        const result = await dbQuery(`SELECT * FROM support_tickets ORDER BY created_at DESC`);
        res.json(result.rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/admin/support-tickets/:id/status', requireAdmin, async (req, res) => {
    const { status } = req.body;
    const ticketId = req.params.id;
    try {
        const ticketRes = await dbQuery("SELECT ticket_id, username FROM support_tickets WHERE id = $1", [ticketId]);
        if (ticketRes.rows.length === 0) return res.status(404).json({ error: "Ticket not found" });
        const { ticket_id } = ticketRes.rows[0];
        await dbQuery("UPDATE support_tickets SET status = $1 WHERE id = $2", [status, ticketId]);
        if (ticket_id) await dbQuery("UPDATE messages SET status = $1 WHERE ticket_id = $2", [status, ticket_id]);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/admin/messages/:id/status', requireAdmin, async (req, res) => {
    const { status } = req.body;
    const ticketId = req.params.id;
    try {
        const ticketRes = await dbQuery("SELECT ticket_id FROM support_tickets WHERE id = $1", [ticketId]);
        if (ticketRes.rows.length === 0) return res.status(404).json({ error: "Ticket not found" });
        const { ticket_id } = ticketRes.rows[0];
        await dbQuery("UPDATE support_tickets SET status = $1 WHERE id = $2", [status, ticketId]);
        if (ticket_id) await dbQuery("UPDATE messages SET status = $1 WHERE ticket_id = $2", [status, ticket_id]);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/admin/messages/:id', requireAdmin, async (req, res) => {
    const ticketId = req.params.id;
    try {
        const ticketRes = await dbQuery("SELECT ticket_id FROM support_tickets WHERE id = $1", [ticketId]);
        if (ticketRes.rows.length > 0) {
            const { ticket_id } = ticketRes.rows[0];
            if (ticket_id) await dbQuery("DELETE FROM messages WHERE ticket_id = $1", [ticket_id]);
        }
        await dbQuery("DELETE FROM support_tickets WHERE id = $1", [ticketId]);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post('/api/admin/support-tickets/:id/reply', requireAdmin, async (req, res) => {
    const ticketDbId = req.params.id;
    const { message, username } = req.body;
    if (!message || !username) return res.status(400).json({ error: "Missing data" });
    try {
        const ticketRes = await dbQuery("SELECT ticket_id, subject FROM support_tickets WHERE id = $1", [ticketDbId]);
        if (ticketRes.rows.length === 0) return res.status(404).json({ error: "Ticket not found" });
        const { ticket_id, subject } = ticketRes.rows[0];
        const userRes = await dbQuery("SELECT id FROM users WHERE username = $1", [username]);
        if (userRes.rows.length === 0) return res.status(404).json({ error: "User not found" });
        const userId = userRes.rows[0].id;
        const replySubject = `RE: ${subject} - Ticket: #${ticket_id}`;
        await dbQuery(`INSERT INTO messages (recipient_id, subject, body, type, is_read, created_at) VALUES ($1, $2, $3, 'ticket_reply', ${isPostgreSQL() ? 'false' : '0'}, $4)`, [userId, replySubject, message, new Date().toISOString()]);
        await dbQuery("UPDATE support_tickets SET status = 'closed' WHERE id = $1", [ticketDbId]);
        if (ticket_id) await dbQuery("UPDATE messages SET status = 'closed' WHERE ticket_id = $1", [ticket_id]);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/admin/support-tickets/:id', requireAdmin, async (req, res) => {
    try {
        await dbQuery(`DELETE FROM support_tickets WHERE id = $1`, [req.params.id]);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

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
        const check = await dbQuery("SELECT key FROM settings WHERE key = $1", [key]);
        if (check.rows.length > 0) await dbQuery("UPDATE settings SET value = $1 WHERE key = $2", [value, key]);
        else await dbQuery("INSERT INTO settings (key, value) VALUES ($1, $2)", [key, value]);
        res.json({ success: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/maintenance-status', requireAdmin, async (req, res) => {
    try {
        const result = await dbQuery("SELECT value FROM settings WHERE key = 'maintenance_mode'");
        const isActive = result.rows.length > 0 && result.rows[0].value === 'true';
        res.json({ success: true, maintenance: isActive });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post('/api/admin/toggle-maintenance', requireAdmin, async (req, res) => {
    try {
        const { active } = req.body;
        const val = active ? 'true' : 'false';
        await dbQuery("UPDATE settings SET value = $1 WHERE key = 'maintenance_mode'", [val]);
        res.json({ success: true, maintenance: active });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
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

app.get('/api/messages', authenticateUser, async (req, res) => {
    try {
        const userId = req.user.id;
        const now = new Date().toISOString();
        const isDeletedCheck = isPostgreSQL() ? 'is_deleted IS FALSE' : 'is_deleted = 0';

        // Fetch all non-deleted messages that are not expired
        const sql = `SELECT * FROM messages WHERE
            ((recipient_id = $1 AND (${isDeletedCheck} OR is_deleted IS NULL))
            OR (recipient_id IS NULL))
            AND (expires_at IS NULL OR expires_at > $2)
            ORDER BY created_at DESC`;

        const result = await dbQuery(sql, [userId, now]);
        const msgs = result.rows.map(r => ({ ...r, is_read: isPostgreSQL() ? r.is_read : (r.is_read === 1) }));
        res.json(msgs);
    } catch(e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/messages/:id/read', authenticateUser, async (req, res) => {
    try {
        const msgId = req.params.id;
        await dbQuery(`UPDATE messages SET is_read = ${isPostgreSQL() ? 'true' : '1'} WHERE id = $1 AND recipient_id = $2`, [msgId, req.user.id]);
        res.json({ success: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/messages/:id', authenticateUser, async (req, res) => {
    try {
        const msgId = req.params.id;
        const msgRes = await dbQuery("SELECT type, status FROM messages WHERE id = $1 AND recipient_id = $2", [msgId, req.user.id]);
        if(msgRes.rows.length === 0) return res.status(404).json({ error: "Nachricht nicht gefunden" });
        const msg = msgRes.rows[0];
        if (msg.type === 'ticket' && msg.status !== 'closed') return res.status(403).json({ error: "Ticket noch offen." });

        // Soft Delete
        const val = isPostgreSQL() ? 'TRUE' : '1';
        await dbQuery(`UPDATE messages SET is_deleted = ${val} WHERE id = $1 AND recipient_id = $2`, [msgId, req.user.id]);
        res.json({ success: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

const checkLicenseExpiries = async () => {
    try {
        if (!dbQuery) return;
        const now = new Date();
        const thresholds = [30, 10, 3];
        const sql = `SELECT u.id as user_id, l.expires_at FROM users u JOIN license_keys l ON u.license_key_id = l.id WHERE l.expires_at IS NOT NULL AND l.is_active = ${isPostgreSQL() ? 'true' : '1'}`;
        const result = await dbQuery(sql);
        for (const row of result.rows) {
            const expDate = new Date(row.expires_at);
            const diffTime = expDate - now;
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            if (thresholds.includes(diffDays)) {
                const subject = `Lizenz läuft ab in ${diffDays} Tagen`;
                const existing = await dbQuery(`SELECT id FROM messages WHERE recipient_id = $1 AND subject = $2 AND created_at > $3`, [row.user_id, subject, new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString()]);
                if (existing.rows.length === 0) {
                    await dbQuery(`INSERT INTO messages (recipient_id, subject, body, type, is_read, created_at) VALUES ($1, $2, $3, 'automated', ${isPostgreSQL() ? 'false' : '0'}, $4)`, [row.user_id, subject, `Ihre Lizenz läuft am ${expDate.toLocaleDateString('de-DE')} ab.`, new Date().toISOString()]);
                }
            }
        }
    } catch(e) { console.error("Scheduler Error:", e); }
};
setInterval(checkLicenseExpiries, 12 * 60 * 60 * 1000);
setTimeout(checkLicenseExpiries, 10000);

// ==================================================================
// 4. SECURITY NEWS HUB API
// ==================================================================

// Serve Forum Page
app.get('/forum', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'forum.html'));
});

// --- PUBLIC API ---

app.get('/api/posts', async (req, res) => {
    try {
        // Fetch published posts
        const result = await dbQuery(`
            SELECT id, title, subtitle, image_url, priority, created_at,
            (SELECT COUNT(*) FROM security_interactions WHERE post_id = p.id AND interaction_type = 'like') as likes,
            (SELECT COUNT(*) FROM security_interactions WHERE post_id = p.id AND interaction_type = 'dislike') as dislikes,
            (SELECT COUNT(*) FROM security_interactions WHERE post_id = p.id AND interaction_type = 'question') as questions,
            (SELECT COUNT(*) FROM security_comments WHERE post_id = p.id) as comments_count
            FROM security_posts p
            WHERE status = 'published'
            ORDER BY created_at DESC
        `);
        res.json(result.rows);
    } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/posts/:id', async (req, res) => {
    try {
        const id = req.params.id;
        const result = await dbQuery(`
            SELECT id, title, subtitle, content, image_url, priority, created_at,
            (SELECT COUNT(*) FROM security_interactions WHERE post_id = p.id AND interaction_type = 'like') as likes,
            (SELECT COUNT(*) FROM security_interactions WHERE post_id = p.id AND interaction_type = 'dislike') as dislikes,
            (SELECT COUNT(*) FROM security_interactions WHERE post_id = p.id AND interaction_type = 'question') as questions
            FROM security_posts p
            WHERE id = $1 AND status = 'published'
        `, [id]);
        if (result.rows.length === 0) return res.status(404).json({ error: "Post not found" });
        res.json(result.rows[0]);
    } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/posts/:id/comments', async (req, res) => {
    try {
        // Fetch comments with user badges and interaction stats
        // We join security_comments with users to get the badge.
        // We also calculate likes/dislikes for each comment.
        const sql = `
            SELECT c.*, u.badge,
            (SELECT COUNT(*) FROM security_comment_interactions WHERE comment_id = c.id AND interaction_type = 'like') as likes,
            (SELECT COUNT(*) FROM security_comment_interactions WHERE comment_id = c.id AND interaction_type = 'dislike') as dislikes
            FROM security_comments c
            LEFT JOIN users u ON c.user_id = u.id
            WHERE c.post_id = $1
            ORDER BY c.is_pinned DESC, c.created_at ASC
        `;
        const result = await dbQuery(sql, [req.params.id]);

        // Map rows to correct types (Postgres vs SQLite)
        const comments = result.rows.map(c => ({
            ...c,
            is_pinned: isPostgreSQL() ? c.is_pinned : (c.is_pinned === 1)
        }));

        res.json(comments);
    } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/posts/:id/comments', authenticateUser, async (req, res) => {
    try {
        const { comment, parent_id } = req.body;
        if (!comment) return res.status(400).json({ error: "Kommentar fehlt." });

        // Optional: Check if parent exists and belongs to same post
        if(parent_id) {
            const pCheck = await dbQuery("SELECT post_id FROM security_comments WHERE id = $1", [parent_id]);
            if(pCheck.rows.length === 0) return res.status(404).json({ error: "Eltern-Kommentar nicht gefunden." });
            // Strict nesting limit check could be here, but we do it loosely on frontend
        }

        await dbQuery(`INSERT INTO security_comments (post_id, user_id, username, comment, parent_id, created_at) VALUES ($1, $2, $3, $4, $5, $6)`,
            [req.params.id, req.user.id, req.user.username, comment, parent_id || null, new Date().toISOString()]);
        res.json({ success: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/comments/:id/vote', authenticateUser, async (req, res) => {
    try {
        const { type } = req.body; // 'like', 'dislike'
        if (!['like', 'dislike'].includes(type)) return res.status(400).json({ error: "Invalid type" });

        if (isPostgreSQL()) {
            await dbQuery(`
                INSERT INTO security_comment_interactions (comment_id, user_id, interaction_type, created_at)
                VALUES ($1, $2, $3, $4)
                ON CONFLICT (comment_id, user_id) DO UPDATE SET interaction_type = $3, created_at = $4
            `, [req.params.id, req.user.id, type, new Date().toISOString()]);
        } else {
            await dbQuery(`
                INSERT OR REPLACE INTO security_comment_interactions (id, comment_id, user_id, interaction_type, created_at)
                VALUES (
                    (SELECT id FROM security_comment_interactions WHERE comment_id = $1 AND user_id = $2),
                    $1, $2, $3, $4
                )
            `, [req.params.id, req.user.id, type, new Date().toISOString()]);
        }
        res.json({ success: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/comments/:id', requireModerator, async (req, res) => {
    try {
        // Soft delete or hard delete? Request said "Delete Button", implies hard delete or 'deleted' placeholder.
        // Hard delete cleans up db.
        // BUT if it has children, they become orphans or need to be deleted.
        // Let's cascade delete for simplicity or set content to [Deleted].
        // Implementing hard delete for now.
        await dbQuery(`DELETE FROM security_comments WHERE id = $1`, [req.params.id]);
        await dbQuery(`DELETE FROM security_comment_interactions WHERE comment_id = $1`, [req.params.id]);
        // Orphan handling: Update children parent_id to NULL or delete them?
        // Better: Update children to have parent_id of THIS comment's parent (lift up) or delete them.
        // Simple: Delete all children (Cascade).
        // Since we don't have FK constraints defined in SQL string above with ON DELETE CASCADE, we do it manually or leave orphans (orphans will render as root comments).
        // Let's leave orphans as root comments for now (simple).
        await dbQuery(`UPDATE security_comments SET parent_id = NULL WHERE parent_id = $1`, [req.params.id]);

        res.json({ success: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/comments/:id/pin', requireModerator, async (req, res) => {
    try {
        const { pinned } = req.body;
        const val = isPostgreSQL() ? pinned : (pinned ? 1 : 0);
        await dbQuery(`UPDATE security_comments SET is_pinned = $1 WHERE id = $2`, [val, req.params.id]);
        res.json({ success: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/posts/:id/vote', authenticateUser, async (req, res) => {
    try {
        const { type } = req.body; // 'like', 'dislike', 'question'
        if (!['like', 'dislike', 'question'].includes(type)) return res.status(400).json({ error: "Invalid type" });

        // Upsert Vote (One vote per user per post)
        // SQLite supports INSERT OR REPLACE, Postgres supports ON CONFLICT
        if (isPostgreSQL()) {
            await dbQuery(`
                INSERT INTO security_interactions (post_id, user_id, interaction_type, created_at)
                VALUES ($1, $2, $3, $4)
                ON CONFLICT (post_id, user_id) DO UPDATE SET interaction_type = $3, created_at = $4
            `, [req.params.id, req.user.id, type, new Date().toISOString()]);
        } else {
            await dbQuery(`
                INSERT OR REPLACE INTO security_interactions (id, post_id, user_id, interaction_type, created_at)
                VALUES (
                    (SELECT id FROM security_interactions WHERE post_id = $1 AND user_id = $2),
                    $1, $2, $3, $4
                )
            `, [req.params.id, req.user.id, type, new Date().toISOString()]);
        }
        res.json({ success: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

// BOOKMARKS
app.get('/api/bookmarks', authenticateUser, async (req, res) => {
    try {
        const sql = `
            SELECT p.*,
            (SELECT COUNT(*) FROM security_interactions WHERE post_id = p.id AND interaction_type = 'like') as likes,
            (SELECT COUNT(*) FROM security_interactions WHERE post_id = p.id AND interaction_type = 'dislike') as dislikes,
            (SELECT COUNT(*) FROM security_interactions WHERE post_id = p.id AND interaction_type = 'question') as questions,
            (SELECT COUNT(*) FROM security_comments WHERE post_id = p.id) as comments_count
            FROM security_posts p
            JOIN user_bookmarks b ON p.id = b.post_id
            WHERE b.user_id = $1
            ORDER BY b.created_at DESC
        `;
        const result = await dbQuery(sql, [req.user.id]);
        res.json(result.rows);
    } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/posts/:id/bookmark', authenticateUser, async (req, res) => {
    try {
        const postId = req.params.id;
        if (isPostgreSQL()) {
            await dbQuery(`INSERT INTO user_bookmarks (user_id, post_id, created_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [req.user.id, postId, new Date().toISOString()]);
        } else {
            await dbQuery(`INSERT OR IGNORE INTO user_bookmarks (user_id, post_id, created_at) VALUES ($1, $2, $3)`, [req.user.id, postId, new Date().toISOString()]);
        }
        res.json({ success: true, bookmarked: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/posts/:id/bookmark', authenticateUser, async (req, res) => {
    try {
        await dbQuery(`DELETE FROM user_bookmarks WHERE user_id = $1 AND post_id = $2`, [req.user.id, req.params.id]);
        res.json({ success: true, bookmarked: false });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

// ACTIVITY FEED
app.get('/api/forum/activity', authenticateUser, async (req, res) => {
    try {
        // Replies to my comments
        const repliesSql = `
            SELECT c.id, c.post_id, c.username as actor, c.created_at, 'reply' as type, p.title as post_title
            FROM security_comments c
            JOIN security_comments parent ON c.parent_id = parent.id
            JOIN security_posts p ON c.post_id = p.id
            WHERE parent.user_id = $1 AND c.user_id != $1
            ORDER BY c.created_at DESC LIMIT 20
        `;
        // Likes on my comments
        const likesSql = `
            SELECT i.created_at, 'like' as type, c.comment as content_preview, u.username as actor
            FROM security_comment_interactions i
            JOIN security_comments c ON i.comment_id = c.id
            LEFT JOIN users u ON i.user_id = u.id
            WHERE c.user_id = $1 AND i.interaction_type = 'like' AND i.user_id != $1
            ORDER BY i.created_at DESC LIMIT 30
        `;

        const [replies, likes] = await Promise.all([
            dbQuery(repliesSql, [req.user.id]),
            dbQuery(likesSql, [req.user.id])
        ]);

        const combined = [
            ...replies.rows.map(r => ({ ...r, text: `hat auf deinen Kommentar in "${r.post_title}" geantwortet.` })),
            ...likes.rows.map(r => ({ ...r, text: `gefällt dein Kommentar: "${r.content_preview ? r.content_preview.substring(0, 30) + '...' : ''}"` }))
        ];

        // Sort combined
        combined.sort((a,b) => new Date(b.created_at) - new Date(a.created_at));
        res.json(combined.slice(0, 30));
    } catch(e) { res.status(500).json({ error: e.message }); }
});

// MY COMMENTS
app.get('/api/user/comments', authenticateUser, async (req, res) => {
    try {
        const sql = `
            SELECT c.*, p.title as post_title
            FROM security_comments c
            JOIN security_posts p ON c.post_id = p.id
            WHERE c.user_id = $1
            ORDER BY c.created_at DESC
        `;
        const result = await dbQuery(sql, [req.user.id]);
        res.json(result.rows);
    } catch(e) { res.status(500).json({ error: e.message }); }
});

// ADMIN STATS
app.get('/api/admin/forum/stats', requireAdmin, async (req, res) => {
    try {
        const posts = await dbQuery(`SELECT COUNT(*) as c FROM security_posts`);
        const comments = await dbQuery(`SELECT COUNT(*) as c FROM security_comments`);
        const likes = await dbQuery(`SELECT COUNT(*) as c FROM security_interactions WHERE interaction_type = 'like'`);
        const questions = await dbQuery(`SELECT COUNT(*) as c FROM security_interactions WHERE interaction_type = 'question'`);
        const bookmarks = await dbQuery(`SELECT COUNT(*) as c FROM user_bookmarks`);

        res.json({
            success: true,
            stats: {
                posts: posts.rows[0].c,
                comments: comments.rows[0].c,
                likes: likes.rows[0].c,
                questions: questions.rows[0].c,
                bookmarks: bookmarks.rows[0].c
            }
        });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

// --- ADMIN API ---

app.get('/api/admin/posts', requireAdmin, async (req, res) => {
    try {
        const result = await dbQuery(`SELECT * FROM security_posts ORDER BY created_at DESC`);
        res.json(result.rows);
    } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/posts', requireAdmin, async (req, res) => {
    try {
        const { title, subtitle, content, priority, status, image_url } = req.body;
        await dbQuery(`
            INSERT INTO security_posts (title, subtitle, content, image_url, priority, status, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
        `, [title, subtitle, content, image_url, priority || 'Info', status || 'draft', new Date().toISOString()]);
        res.json({ success: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/admin/posts/:id', requireAdmin, async (req, res) => {
    try {
        const { title, subtitle, content, priority, status, image_url } = req.body;
        await dbQuery(`
            UPDATE security_posts SET title = $1, subtitle = $2, content = $3, image_url = $4, priority = $5, status = $6
            WHERE id = $7
        `, [title, subtitle, content, image_url, priority, status, req.params.id]);
        res.json({ success: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/admin/posts/:id', requireAdmin, async (req, res) => {
    try {
        await dbQuery(`DELETE FROM security_posts WHERE id = $1`, [req.params.id]);
        // Also clean up interactions/comments? Yes cascade logically
        await dbQuery(`DELETE FROM security_interactions WHERE post_id = $1`, [req.params.id]);
        await dbQuery(`DELETE FROM security_comments WHERE post_id = $1`, [req.params.id]);
        res.json({ success: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/posts/upload', requireAdmin, upload.single('image'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: "Kein Bild." });
    res.json({ success: true, url: `/uploads/security/${req.file.filename}` });
});


// ==================================================================
// 5. START & ROUTING
// ==================================================================

if (IS_ENTERPRISE) {
    app.get('/api/config', async (req, res) => {
        const stats = await enterpriseManager.init();
        res.json({ mode: 'ENTERPRISE', activated: stats.activated, stats: enterpriseManager.getStats() });
    });
    app.post('/api/enterprise/activate', async (req, res) => {
        try {
            const { licenseKey } = req.body;
            if (!licenseKey) return res.status(400).json({ error: "licenseKey is required" });
            const result = await enterpriseManager.activate(licenseKey);
            res.json(result);
        } catch(e) { res.status(500).json({ error: "Activation failed: " + e.message, details: e.stack }); }
    });
    app.post('/api/enterprise/complete-activation', async (req, res) => {
        try {
            const activationData = req.body;
            if (!activationData || !activationData.valid) return res.status(400).json({ error: "Invalid Activation Data" });
            const result = await enterpriseManager.completeActivation(activationData);
            res.json(result);
        } catch(e) { res.status(500).json({ error: e.message }); }
    });
    app.post('/api/enterprise/users', async (req, res) => {
        try {
            const { username, openRecipient } = req.body;
            const result = await enterpriseManager.createUser(username, openRecipient);
            res.json(result);
        } catch(e) { res.status(400).json({ error: e.message }); }
    });
    app.get('/api/enterprise/users', async (req, res) => { res.json(enterpriseManager.getUsers()); });
    app.get('/api/enterprise/admin/messages', async (req, res) => {
        try {
            if(dbQuery) {
                const r = await dbQuery("SELECT * FROM enterprise_messages ORDER BY created_at DESC");
                const tickets = r.rows.map(m => ({ id: m.id, ticket_id: m.id, username: m.sender_id, subject: m.subject, message: m.body, created_at: m.created_at, status: m.is_read ? 'closed' : 'open', email: '' }));
                res.json(tickets);
            } else { res.json([]); }
        } catch(e) { res.status(500).json({ error: e.message }); }
    });
} else {
    app.get('/api/config', (req, res) => { res.json({ mode: 'CLOUD' }); });
    app.post('/api/enterprise/activate', async (req, res) => {
        res.header("Access-Control-Allow-Origin", "*");
        res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization");
        try {
            const authHeader = req.headers['authorization'];
            const licenseKey = authHeader && authHeader.split(' ')[1];
            if (!licenseKey) return res.status(400).json({ success: false, error: "EMPTY_HEADER" });
            let result = await dbQuery("SELECT * FROM license_keys WHERE key_code = $1 AND product_code = 'ENTERPRISE'", [licenseKey]);
            if (result.rows.length === 0) result = await dbQuery("SELECT * FROM enterprise_keys WHERE key = $1", [licenseKey]);
            if (result.rows.length === 0) return res.status(404).json({ success: false, valid: false, error: 'Invalid Enterprise Key' });
            const license = result.rows[0];
            const isBlocked = isPostgreSQL() ? license.is_blocked : (license.is_blocked === 1);
            if (isBlocked) return res.status(403).json({ success: false, valid: false, error: 'License Blocked' });
            if (license.activated_at) return res.status(403).json({ success: false, valid: false, error: 'License Already Activated' });
            const tableUsed = license.key_code ? 'license_keys' : 'enterprise_keys';
            const dbId = license.id;
            await dbQuery(`UPDATE ${tableUsed} SET is_active = $1, activated_at = $2 WHERE id = $3`, [(isPostgreSQL() ? true : 1), new Date().toISOString(), dbId]);
            res.json({ success: true, valid: true, bundleId: license.bundle_id || 'ENT-BUNDLE', quota: license.max_users || license.quota_max || 10, clientName: license.client_name || 'Enterprise Customer' });
        } catch (e) { res.status(500).json({ success: false, error: "Server Error" }); }
    });
}

// Payment Router Mount (Only for non-Enterprise modes)
if (!IS_ENTERPRISE) {
    app.use('/api', require('./payment.js'));
}

app.get('/activation', (req, res) => {
    if (IS_ENTERPRISE) res.sendFile(path.join(__dirname, 'public', 'activation.html'));
    else res.redirect('/');
});
app.get('/enterprise', async (req, res) => {
    if (IS_ENTERPRISE) {
        const stats = await enterpriseManager.init();
        if(!stats.activated) return res.redirect('/activation');
        res.sendFile(path.join(__dirname, 'public', 'it-admin.html'));
    } else res.redirect('/');
});
app.get('/', async (req, res) => {
    if (IS_ENTERPRISE) {
        const stats = await enterpriseManager.init();
        if(!stats.activated) return res.redirect('/activation');
        return res.redirect('/enterprise');
    }
    await trackEvent(req, 'page_view', 'landing');
    res.sendFile(path.join(__dirname, 'public', 'landing.html'));
});
app.get('/app', async (req, res) => {
    if (!IS_ENTERPRISE) await trackEvent(req, 'page_view', 'app');
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
app.get('/shop', async (req, res) => {
    if (!IS_ENTERPRISE) await trackEvent(req, 'page_view', 'shop');
    res.sendFile(path.join(__dirname, 'public', 'store.html'));
});
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/maintenance', (req, res) => res.sendFile(path.join(__dirname, 'public', 'maintenance.html')));
app.get('*', (req, res) => {
    if (req.path.startsWith('/api') || req.path.match(/\.[0-9a-z]+$/i)) res.status(404).send('Not Found');
    else res.redirect('/');
});

let httpServer;
let activeSockets = new Set();
function startServer(port = PORT) {
    if (httpServer) { console.warn("Server already running"); return httpServer; }
    httpServer = app.listen(port, () => {
        console.log(`🚀 Server running on Port ${port}`);
        if (IS_ENTERPRISE) {
            if(!isPostgreSQL && db) {
                // Enterprise Messages Table (Added is_deleted, expires_at)
                db.run(`CREATE TABLE IF NOT EXISTS enterprise_messages (id TEXT PRIMARY KEY, sender_id TEXT, recipient_id TEXT, subject TEXT, body TEXT, attachment TEXT, is_read INTEGER DEFAULT 0, is_deleted INTEGER DEFAULT 0, expires_at DATETIME, created_at DATETIME)`, (err) => {
                    if(err) console.error("EntDB Error", err);
                    else {
                        // Attempt to add columns if missing (SQLite specific migration for Enterprise)
                        db.run(`ALTER TABLE enterprise_messages ADD COLUMN is_deleted INTEGER DEFAULT 0`, () => {});
                        db.run(`ALTER TABLE enterprise_messages ADD COLUMN expires_at DATETIME`, () => {});
                    }
                });
            }
            if(socketServer) socketServer.attach(httpServer, dbQuery);
            if(enterpriseManager) enterpriseManager.init().then(config => { if(config.activated) require('./enterprise/discovery').start(port); });
        }
    });
    httpServer.on('connection', (socket) => {
        activeSockets.add(socket);
        socket.on('close', () => activeSockets.delete(socket));
    });
    return httpServer;
}
function stopServer() {
    return new Promise((resolve) => {
        if (!httpServer) return resolve();
        console.log("🛑 Stopping Server...");
        for (const socket of activeSockets) { socket.destroy(); activeSockets.delete(socket); }
        httpServer.close(() => { console.log("✅ Server stopped."); httpServer = null; resolve(); });
    });
}
if (require.main === module) startServer();
module.exports = { app, startServer, stopServer };
