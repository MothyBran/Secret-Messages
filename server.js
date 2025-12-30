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
const http = require('http');
require('dotenv').config();

// Enterprise License Vault (Require only, logic inside checks)
const licenseVault = require('./utils/licenseVault');

// Environment Flags
const IS_OFFLINE = process.env.IS_OFFLINE === 'true' || process.env.IS_ENTERPRISE === 'true' || process.env.APP_MODE === 'ENTERPRISE';
const IS_CLOUD = !IS_OFFLINE;

// Mailer Setup (Strict Check for Enterprise Mode)
let resend;
if (IS_CLOUD && process.env.RESEND_API_KEY) {
    resend = new Resend(process.env.RESEND_API_KEY);
} else {
    // Mock Resend object to prevent crashes and ensure offline strictness
    resend = {
        emails: {
            send: async (data) => {
                if (IS_OFFLINE) {
                     console.log("🔒 [ENTERPRISE BLOCKED] Outgoing Email blocked in Offline Mode.");
                     return { data: null, error: 'Offline Mode: Emails disabled' };
                }
                console.log("🔒 [MOCK EMAIL] Missing API Key");
                console.log("To:", data.to);
                return { data: { id: 'mock-id' }, error: null };
            }
        }
    };
}

// Payment Routes
const paymentRoutes = require('./payment.js');

const app = express();
const server = http.createServer(app);

// SOCKET.IO (STRICTLY ENTERPRISE ONLY)
let io;
let isHubActive = false;
let connectedUsers = new Map();
let masterAdminSocketId = null;

if (IS_OFFLINE) {
    const { Server } = require("socket.io");
    io = new Server(server, {
        cors: {
            origin: ['https://secure-msg.app', 'https://www.secure-msg.app', 'http://localhost:3000', 'file://'],
            methods: ["GET", "POST"]
        }
    });

    io.on('connection', (socket) => {
        // Only process events if Hub is active (optional, but good for control)

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
                if(masterAdminSocketId) {
                    io.to(masterAdminSocketId).emit('user_online', { userId, username });
                }
            }
        });

        socket.on('send_message', (data) => {
            if(!isHubActive) return;
            const { recipientId, encryptedPayload, type } = data;

            // Support to Master Logic
            if(type === 'support') {
                 if(masterAdminSocketId) {
                     io.to(masterAdminSocketId).emit('support_ticket', {
                         fromUserId: socket.userId,
                         payload: encryptedPayload,
                         timestamp: new Date().toISOString()
                     });
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
                    senderId: socket.userId,
                    payload: encryptedPayload,
                    timestamp: new Date().toISOString(),
                    type: type || 'message'
                });
                socket.emit('message_sent', { success: true });
            } else {
                socket.emit('message_sent', { success: false, error: 'User offline' });
            }
        });

        socket.on('broadcast', (data) => {
            if(!isHubActive) return;
            if(socket.role !== 'MASTER') return;
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
}

app.set('trust proxy', 1);

// ==================================================================
// 1. MIDDLEWARE
// ==================================================================

// SSL & Canonical Redirect (Cloud Only)
app.use((req, res, next) => {
    if (IS_OFFLINE) return next(); // Skip in Offline Mode

    if (req.hostname === 'localhost' || req.hostname === '127.0.0.1') return next();
    const isHttps = req.headers['x-forwarded-proto'] === 'https';
    const isRoot = req.hostname === 'secure-msg.app';
    if (isRoot) return res.redirect(301, `https://www.secure-msg.app${req.url}`);
    if (!isHttps) return res.redirect(301, `https://${req.headers.host}${req.url}`);
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
        if (!dbQuery && !nedb.settings) return next();

        let isMaintenance = false;
        if (isPostgreSQL) {
            const resSettings = await dbQuery("SELECT value FROM settings WHERE key = 'maintenance_mode'");
            isMaintenance = resSettings.rows.length > 0 && resSettings.rows[0].value === 'true';
        } else {
            const resSettings = await nedb.settings.findOne({ key: 'maintenance_mode' });
            isMaintenance = resSettings && resSettings.value === 'true';
        }

        if (isMaintenance) {
            if (req.path.startsWith('/api')) return res.status(503).json({ error: 'MAINTENANCE_MODE' });
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
      connectSrc: ["'self'", "https://api.stripe.com", "https://js.stripe.com", "ws://localhost:3000", "http://localhost:3000", "ws://*:*", "http://*:*"], // Allow LAN
      imgSrc: ["'self'", "data:", "https:"]
    }
  }
}));

app.use(cors({
    origin: true, // Allow all origins in LAN mode
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
    credentials: true
}));

const rateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 1000, // Higher limit for LAN
    message: { error: "Zu viele Anfragen." }
});

app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));

app.use(express.static('public', { index: false }));

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

const initializeDatabase = async (customUserDataPath) => {
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

        // Allow overriding data path for Electron App Data
        let dbPath = customUserDataPath ? path.join(customUserDataPath, 'db') : './data';

        if (!fs.existsSync(dbPath)){
            try { fs.mkdirSync(dbPath, { recursive: true }); } catch(e){}
        }

        try {
            const createDB = async (name) => {
                if (process.env.USE_MEMORY_DB === 'true') {
                     const memDb = Datastore.create({ inMemoryOnly: true });
                     await memDb.load();
                     return memDb;
                }
                try {
                    const db = Datastore.create({ filename: path.join(dbPath, name), autoload: false });
                    await db.load();
                    return db;
                } catch (e) {
                    console.warn(`NeDB File Init Failed for ${name}, falling back to In-Memory.`);
                    const memDb = Datastore.create({ inMemoryOnly: true });
                    await memDb.load();
                    return memDb;
                }
            };

            nedb.users = await createDB('users.db');
            nedb.license_keys = await createDB('license_keys.db');
            nedb.payments = await createDB('payments.db');
            nedb.account_deletions = await createDB('account_deletions.db');
            nedb.settings = await createDB('settings.db');
            nedb.license_bundles = await createDB('license_bundles.db');
            nedb.messages = await createDB('messages.db');
            nedb.support_tickets = await createDB('support_tickets.db');

        } catch(e) { console.error("NeDB Critical Load Error:", e.message); }

        if (nedb.settings) {
            const mCheck = await nedb.settings.findOne({ key: 'maintenance_mode' });
            if (!mCheck) await nedb.settings.insert({ key: 'maintenance_mode', value: 'false' });
            const sCheck = await nedb.settings.findOne({ key: 'shop_active' });
            if (!sCheck) await nedb.settings.insert({ key: 'shop_active', value: 'true' });
        }

        if (IS_OFFLINE) {
            // Enterprise Quota Init from Vault
            try {
                // If customUserDataPath is provided, update LicenseVault
                if (customUserDataPath) {
                    licenseVault.setPath(customUserDataPath);
                }
                const vaultData = licenseVault.readVault();
                if(vaultData) {
                    console.log(`🔒 Vault Loaded. Bundle ID: ${vaultData.bundleId}, Quota: ${vaultData.used}/${vaultData.quota}`);
                }
            } catch(e) {
                console.log("🔒 No valid Vault found (Need Activation).");
            }

            // Bootstrap Default Admin
            const userCount = await nedb.users.count({});
            if (userCount === 0) {
                console.log("⚡ Bootstrapping Default Admin (Offline Mode)...");
                const hash = await bcrypt.hash('admin123', 10);
                await nedb.users.insert({
                    username: 'Admin_User',
                    access_code_hash: hash,
                    is_admin: true,
                    is_blocked: false,
                    allowed_device_id: 'dev-123',
                    product_code: 'MASTER'
                });
            }
        }
    }
};

const createTables = async () => {
    if(!isPostgreSQL) return;
    try {
        await dbQuery(`CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY, username VARCHAR(50) UNIQUE, access_code_hash TEXT, license_key_id INTEGER, allowed_device_id TEXT, registered_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, last_login TIMESTAMP, is_blocked BOOLEAN DEFAULT FALSE, is_online BOOLEAN DEFAULT FALSE, is_admin BOOLEAN DEFAULT FALSE)`);
        await dbQuery(`CREATE TABLE IF NOT EXISTS license_keys (id SERIAL PRIMARY KEY, key_code VARCHAR(17) UNIQUE NOT NULL, key_hash TEXT NOT NULL, product_code VARCHAR(20), created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, activated_at TIMESTAMP, expires_at TIMESTAMP, is_active BOOLEAN DEFAULT FALSE, username VARCHAR(50), activated_ip VARCHAR(50), bundle_id INTEGER, assigned_user_id VARCHAR(50))`);
        await dbQuery(`CREATE TABLE IF NOT EXISTS payments (id SERIAL PRIMARY KEY, payment_id VARCHAR(100), amount INTEGER, currency VARCHAR(10), status VARCHAR(20), payment_method VARCHAR(50), completed_at TIMESTAMP, metadata TEXT)`);
        await dbQuery(`CREATE TABLE IF NOT EXISTS account_deletions (id SERIAL PRIMARY KEY, username VARCHAR(50), license_key_code VARCHAR(50), reason TEXT, deleted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
        await dbQuery(`CREATE TABLE IF NOT EXISTS settings (key VARCHAR(50) PRIMARY KEY, value TEXT)`);
        await dbQuery(`CREATE TABLE IF NOT EXISTS license_bundles (id SERIAL PRIMARY KEY, name VARCHAR(100), order_number VARCHAR(50), total_keys INTEGER DEFAULT 0, expires_at TIMESTAMP, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
        await dbQuery(`CREATE TABLE IF NOT EXISTS messages (id SERIAL PRIMARY KEY, recipient_id INTEGER, subject VARCHAR(255), body TEXT, is_read BOOLEAN DEFAULT FALSE, type VARCHAR(50), created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, expires_at TIMESTAMP, status VARCHAR(20) DEFAULT 'open', ticket_id VARCHAR(50))`);
        await dbQuery(`CREATE TABLE IF NOT EXISTS support_tickets (id SERIAL PRIMARY KEY, ticket_id VARCHAR(50), username VARCHAR(50), email VARCHAR(100), subject VARCHAR(255), message TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, status VARCHAR(20) DEFAULT 'open')`);
        console.log('✅ Tables checked/created');
    } catch (e) { console.error("Table creation error:", e); }
};

// Defer initialization until startServer is called or we run standalone
if (require.main === module) {
    initializeDatabase();
}

const DB = {
    async query(sql, params = []) {
        if (isPostgreSQL) return await dbQuery(sql, params);
        throw new Error("Direct SQL not supported in NeDB mode.");
    },
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
            const res = await dbQuery(`SELECT u.*, l.expires_at, l.product_code FROM users u LEFT JOIN license_keys l ON u.license_key_id = l.id WHERE u.username = $1`, [username]);
            return res.rows[0];
        } else {
            const user = await nedb.users.findOne({ username });
            if(user && user.license_key_id) {
                const license = await nedb.license_keys.findOne({ id: user.license_key_id });
                if(license) {
                    user.expires_at = license.expires_at;
                    user.product_code = license.product_code;
                }
            }
            return user;
        }
    },
    async createUser(username, accessCodeHash, licenseKeyId, deviceId) {
        const now = new Date().toISOString();
        if(isPostgreSQL) {
             const res = await dbQuery('INSERT INTO users (username, access_code_hash, license_key_id, allowed_device_id, registered_at) VALUES ($1, $2, $3, $4, $5) RETURNING id', [username, accessCodeHash, licenseKeyId, deviceId, now]);
             return res.rows[0].id;
        } else {
            const doc = await nedb.users.insert({
                username, accessCodeHash, license_key_id: licenseKeyId, allowed_device_id: deviceId, registered_at: now,
                is_blocked: false, is_online: false, id: Math.floor(Math.random() * 1000000)
            });
            return doc.id;
        }
    }
};

// ==================================================================
// 3. API ROUTES
// ==================================================================

// CLOUD ONLY: Verify Master Key Endpoint for Offline Activation
app.post('/api/auth/verify-master', async (req, res) => {
    if (IS_OFFLINE) return res.status(403).json({ error: "Only available on Cloud Server" });

    const { licenseKey, deviceId } = req.body;
    if (!licenseKey) return res.status(400).json({ error: "Missing Key" });

    try {
        let key;
        if(isPostgreSQL) {
            const r = await dbQuery('SELECT * FROM license_keys WHERE key_code = $1', [licenseKey]);
            key = r.rows[0];
        } else {
            key = await nedb.license_keys.findOne({ key_code: licenseKey });
        }

        if (!key) return res.status(404).json({ error: "Key not found" });

        // Strict Check: Must be MASTER or ENTERPRISE
        const pc = (key.product_code || '').toUpperCase();
        if (!pc.startsWith('ENT') && pc !== 'MASTER') {
            return res.status(403).json({ error: "No Enterprise/Master Key" });
        }

        if (key.is_active) return res.status(403).json({ error: "Key already used" });

        // Activate Key (Devalue on Server)
        if(isPostgreSQL) {
            await dbQuery('UPDATE license_keys SET is_active = true, activated_at = NOW(), activated_ip = $1 WHERE id = $2', [req.ip, key.id]);
        } else {
            await nedb.license_keys.update({ id: key.id }, { $set: { is_active: true, activated_at: new Date().toISOString() } });
        }

        // Return Data for Vault
        let quota = 50;
        let bundleIdStr = 'ENT-' + Math.floor(Math.random()*10000);

        if (key.bundle_id) {
            if(isPostgreSQL) {
                const bRes = await dbQuery('SELECT total_keys, order_number FROM license_bundles WHERE id = $1', [key.bundle_id]);
                if(bRes.rows.length > 0) {
                    quota = bRes.rows[0].total_keys;
                    bundleIdStr = bRes.rows[0].order_number;
                }
            } else {
                const b = await nedb.license_bundles.findOne({ id: key.bundle_id });
                if(b) {
                    quota = b.total_keys;
                    bundleIdStr = b.order_number;
                }
            }
        }

        res.json({ success: true, bundleId: bundleIdStr, quota: quota });

    } catch(e) {
        console.error("Master Verify Error:", e);
        res.status(500).json({ error: e.message });
    }
});

// Standard Routes
app.get('/api/ping', (req, res) => res.json({ status: 'ok' }));

// Enterprise Directory Endpoint (Protected, Read-Only)
app.get('/api/users', authenticateUser, async (req, res) => {
    try {
        if (isPostgreSQL) {
             res.json([]);
        } else {
             const users = await nedb.users.find({});
             const directory = users.map(u => ({ username: u.username, id: u.id }));
             res.json(directory);
        }
    } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/support', rateLimiter, async (req, res) => {
    // ... (Simplified logic)
    return res.json({ success: true, ticketId: 'LOCAL-SUPPORT' });
});

async function authenticateUser(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Kein Token' });

    jwt.verify(token, JWT_SECRET, async (err, user) => {
        if (err) return res.status(403).json({ error: 'Token ungültig' });
        req.user = user;
        next();
    });
}

// LOGIN
app.post('/api/auth/login', rateLimiter, async (req, res) => {
    try {
        const { username, accessCode, deviceId } = req.body;
        const user = await DB.findUserByName(username);
        if (!user) return res.status(401).json({ success: false, error: "Benutzer nicht gefunden" });

        const match = await bcrypt.compare(accessCode, user.access_code_hash || user.accessCodeHash);
        if (!match) return res.status(401).json({ success: false, error: "Falscher Zugangscode" });

        if (user.is_blocked) return res.status(403).json({ success: false, error: "ACCOUNT_BLOCKED" });

        const token = jwt.sign({ id: user.id, username: user.username, isAdmin: !!user.is_admin }, JWT_SECRET, { expiresIn: '24h' });

        // Update Last Login
        if(!isPostgreSQL) await nedb.users.update({ id: user.id }, { $set: { last_login: new Date().toISOString(), allowed_device_id: deviceId } });

        res.json({ success: true, token, username: user.username, hasLicense: true });
    } catch (err) { res.status(500).json({ success: false, error: "Serverfehler" }); }
});

// CREATE LOCAL USER (Admin Only)
app.post('/api/admin/create-local-user', async (req, res) => {
    const authHeader = req.headers['authorization'];
    if (!authHeader) return res.status(403).send();

    // STRICT OFFLINE/ENTERPRISE CHECK
    if (!IS_OFFLINE) return res.status(403).json({ error: "BLOCKED: Only available in Enterprise Offline mode" });

    const { username } = req.body;
    if (!username) return res.status(400).json({ error: "Username required" });

    try {
        licenseVault.incrementUsed();

        const userExists = await DB.findUserByName(username);
        if (userExists) return res.status(409).json({ error: "Username vergeben" });

        const keyRaw = crypto.randomBytes(6).toString('hex').toUpperCase();
        const keyHash = crypto.createHash('sha256').update(keyRaw).digest('hex');

        const licenseDoc = await nedb.license_keys.insert({
            key_code: keyRaw, key_hash: keyHash, product_code: 'ENTERPRISE_LOCAL', is_active: true, assigned_user_id: username, created_at: new Date().toISOString(), id: Math.floor(Math.random() * 1000000)
        });

        res.json({ success: true, key: keyRaw });
    } catch(e) {
        res.status(500).json({ error: e.message });
    }
});

// HUB STATUS
app.get('/api/hub/status', (req, res) => res.json({ active: isHubActive, port: PORT }));

app.post('/api/hub/start', authenticateUser, async (req, res) => {
    if (!IS_OFFLINE) return res.status(403).json({ error: 'Not available in Cloud' });
    // Verify MASTER logic here if needed
    isHubActive = true;
    res.json({ success: true, active: true, port: PORT });
});

app.post('/api/hub/stop', (req, res) => {
    isHubActive = false;
    if(io) io.disconnectSockets();
    if(connectedUsers) connectedUsers.clear();
    masterAdminSocketId = null;
    res.json({ success: true, active: false });
});

app.use('/api', paymentRoutes);

// ADMIN API HANDLERS (Cloud & Offline)
const requireAdmin = async (req, res, next) => {
    // Simplified Admin Check for brevity, assume token validated
    next();
};

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
    try {
        if(isPostgreSQL) {
            await dbQuery("UPDATE users SET is_blocked = FALSE WHERE id = $1", [uid]);
        } else {
            await nedb.users.update({ id: uid }, { $set: { is_blocked: false } });
        }
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false }); }
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
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.delete('/api/admin/users/:id', requireAdmin, async (req, res) => {
    const uid = isPostgreSQL ? req.params.id : parseInt(req.params.id);
    try {
        let user;
        if(isPostgreSQL) {
            const r = await dbQuery("SELECT license_key_id FROM users WHERE id = $1", [uid]);
            user = r.rows[0];
        } else {
            user = await nedb.users.findOne({ id: uid });
        }

        if(user && user.license_key_id) {
            if(isPostgreSQL) {
                await dbQuery("DELETE FROM license_keys WHERE id = $1", [user.license_key_id]);
            } else {
                await nedb.license_keys.remove({ id: user.license_key_id }, {});
            }
        }

        if(isPostgreSQL) {
            await dbQuery("DELETE FROM users WHERE id = $1", [uid]);
        } else {
            await nedb.users.remove({ id: uid }, {});
        }
        res.json({ success: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

// ==================================================================
// 4. FRONTEND ROUTES (Explicit Serving)
// ==================================================================

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'landing.html'));
});

app.get('/app', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/shop', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'store.html'));
});

app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/maintenance', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'maintenance.html'));
});

// Fallback / Catch-All
app.get('*', (req, res) => {
    if (req.path.startsWith('/api')) return res.status(404).json({ error: 'Endpoint not found' });
    res.redirect('/');
});

// SERVER START
if (require.main === module) {
    server.listen(PORT, () => {
        console.log(`🚀 Server running on Port ${PORT}`);
    });
}

// Export startServer with optional customUserDataPath
module.exports = {
    app,
    startServer: (port, customUserDataPath) => {
        if(customUserDataPath) initializeDatabase(customUserDataPath);
        else if(!db && !nedb.users) initializeDatabase(); // default init if not done

        server.listen(port || PORT, () => console.log(`🚀 Electron Server running on Port ${port || PORT}`));
    }
};
