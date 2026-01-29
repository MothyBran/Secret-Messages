// server-enterprise.js
// Isolated Enterprise Server Entrypoint

const express = require('express');
const path = require('path');
const fs = require('fs');
const helmet = require('helmet');
const cors = require('cors');
const multer = require('multer'); // Added Multer
require('dotenv').config();

// 1. Minimal Express Setup
const app = express();
const PORT = process.env.PORT || 3000;

// Priority 1: Serve Static Files (ABSOLUTE TOP as requested)
// Dynamic Public Path: Use __dirname to find files INSIDE the Electron ASAR package
const publicPath = path.join(__dirname, 'public');
console.log('📂 Enterprise Server serving assets from:', publicPath);

// Explicitly set MIME types for fonts to avoid "decoding failed" due to text/html 404s masquerading as files
app.use(express.static(publicPath, {
    index: false,
    setHeaders: (res, filePath) => {
        if (filePath.endsWith('.ttf')) {
            res.setHeader('Content-Type', 'font/ttf');
        }
    }
}));

// DETERMINE DATA DIRECTORY (Persistent Storage)
// Priority: USER_DATA_PATH (Electron) > DATA_PATH (Env) > Sibling 'secure-msg-data' > Local 'data' folder
let DATA_DIR;

if (process.env.USER_DATA_PATH) {
    DATA_DIR = path.join(process.env.USER_DATA_PATH, 'data');
} else if (process.env.DATA_PATH) {
    DATA_DIR = process.env.DATA_PATH;
} else {
    // Try Sibling Directory (Survives Code Updates/Overwrites)
    const siblingPath = path.join(__dirname, '../secure-msg-data');
    try {
        if (!fs.existsSync(siblingPath)) {
            // Try to create it to test permissions
            fs.mkdirSync(siblingPath);
        }
        // Check write permission
        const testFile = path.join(siblingPath, '.perm-test');
        fs.writeFileSync(testFile, 'ok');
        fs.unlinkSync(testFile);

        DATA_DIR = siblingPath;
        console.log("📂 Using Sibling Data Directory (Persistent):", DATA_DIR);
    } catch (e) {
        console.warn("⚠️ Sibling directory not writable (" + e.message + "). Falling back to local 'data' folder.");
        DATA_DIR = path.join(__dirname, 'data');
    }
}

console.log("📂 FINAL DATA_DIR:", DATA_DIR);

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

// Middleware (After Static, ensuring static is handled first)
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", "data:"], // Allow data: images (QR codes)
            fontSrc: ["'self'", "data:"], // Allow fonts from self and data URI (fallback)
            connectSrc: ["'self'", "http://localhost:*", "https://www.secure-msg.app"] // Allow local + activation
        }
    }
}));
app.use(cors());
app.use(express.json()); // Ensure this is loaded before routes

// 2. SQLite Database Connection
// Simplified version of the logic in server.js, optimized for local enterprise
let db;
let dbQuery;

const initializeDatabase = async () => {
    try {
        const sqlite3 = require('sqlite3').verbose();

        // Determine DB Path: Priority to USER_DATA_PATH (Electron), else local
        let dbPath = './secret_messages.db';
        if (process.env.USER_DATA_PATH) {
            const dataDir = process.env.USER_DATA_PATH;
            if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
            dbPath = path.join(dataDir, 'secret_messages.db');
        }

        db = new sqlite3.Database(dbPath);

        // High Fault Tolerance: Set Busy Timeout for File Locks
        if (typeof db.configure === 'function') {
            db.configure('busyTimeout', 5000); // 5 seconds retry
        }

        // Wrapper for Promise-based queries (compatible with existing code style)
        dbQuery = (text, params = []) => {
            return new Promise((resolve, reject) => {
                const sql = text.replace(/\$\d+/g, '?'); // Convert $1 to ? for SQLite
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

        // Basic Table Init (Users/License/Settings)
        await createTables();

        // 3. Mount Enterprise Router (Now that DB is ready)
        const enterpriseRouter = require('./enterprise/router')(dbQuery, upload);
        app.use('/', enterpriseRouter); // Mounts at root

        // 4. Debug 404 Middleware (Last Resort)
        app.use((req, res, next) => {
            console.warn(`⚠️ 404 Not Found: ${req.method} ${req.url}`);
            console.warn(`   looked in: ${publicPath}`);
            res.status(404).send('Not Found (Enterprise Server)');
        });

    } catch (e) {
        console.error("💥 Database Initialization Failed:", e);
        process.exit(1);
    }
};

const createTables = async () => {
    // Minimal schema for Enterprise operation
    // REMOVED license_expiration from users table definition
    await dbQuery(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username VARCHAR(50) UNIQUE,
        password TEXT,
        access_code_hash TEXT,
        license_key_id INTEGER,
        is_blocked INTEGER DEFAULT 0,
        is_admin INTEGER DEFAULT 1,
        department TEXT,
        role_title TEXT,
        registered_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        registration_key_hash TEXT,
        pik_encrypted TEXT
    )`);

    // Added license_keys table for consistency with new logic
    await dbQuery(`CREATE TABLE IF NOT EXISTS license_keys (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key_code TEXT UNIQUE,
        key_hash TEXT,
        product_code TEXT,
        is_active INTEGER DEFAULT 0,
        origin TEXT,
        assigned_user_id INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        expires_at DATETIME,
        activated_at DATETIME,
        max_users INTEGER,
        client_name TEXT,
        is_blocked INTEGER DEFAULT 0,
        bundle_id INTEGER
    )`);

    await dbQuery(`CREATE TABLE IF NOT EXISTS license_renewals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        key_code_hash TEXT,
        extended_until DATETIME,
        used_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    await dbQuery(`CREATE TABLE IF NOT EXISTS settings (
        key VARCHAR(50) PRIMARY KEY,
        value TEXT
    )`);

    await dbQuery(`CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sender_id TEXT,
        recipient_id TEXT,
        payload TEXT,
        iv TEXT,
        is_read INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    await dbQuery(`CREATE TABLE IF NOT EXISTS audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        action VARCHAR(50),
        details TEXT,
        ip_address VARCHAR(45),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // FORUM / SECURITY HUB TABLES
    await dbQuery(`CREATE TABLE IF NOT EXISTS security_posts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT,
        subtitle TEXT,
        content TEXT,
        image_url TEXT,
        priority TEXT,
        status TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    await dbQuery(`CREATE TABLE IF NOT EXISTS security_interactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        post_id INTEGER,
        user_id INTEGER,
        interaction_type TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(post_id, user_id) ON CONFLICT REPLACE
    )`);

    await dbQuery(`CREATE TABLE IF NOT EXISTS security_comments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        post_id INTEGER,
        user_id INTEGER,
        username TEXT,
        comment TEXT,
        parent_id INTEGER,
        is_pinned INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    await dbQuery(`CREATE TABLE IF NOT EXISTS security_comment_interactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        comment_id INTEGER,
        user_id INTEGER,
        interaction_type TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(comment_id, user_id) ON CONFLICT REPLACE
    )`);

    await dbQuery(`CREATE TABLE IF NOT EXISTS user_bookmarks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        post_id INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, post_id) ON CONFLICT IGNORE
    )`);

    // Schema Migration: Ensure columns exist (Idempotent)
    try { await dbQuery("ALTER TABLE users ADD COLUMN is_admin INTEGER DEFAULT 1"); } catch (e) { /* ignore */ }
    try { await dbQuery("ALTER TABLE users ADD COLUMN is_blocked INTEGER DEFAULT 0"); } catch (e) { /* ignore */ }
    try { await dbQuery("ALTER TABLE users ADD COLUMN license_key_id INTEGER"); } catch (e) { /* ignore */ }
    try { await dbQuery("ALTER TABLE users ADD COLUMN password TEXT"); } catch (e) { /* ignore */ }
    try { await dbQuery("ALTER TABLE users ADD COLUMN access_code_hash TEXT"); } catch (e) { /* ignore */ }
    try { await dbQuery("ALTER TABLE users ADD COLUMN registration_key_hash TEXT"); } catch (e) { /* ignore */ }
    try { await dbQuery("ALTER TABLE users ADD COLUMN pik_encrypted TEXT"); } catch (e) { /* ignore */ }
    // Do not migrate license_expiration
    // try { await dbQuery("ALTER TABLE users ADD COLUMN license_expiration DATETIME"); } catch (e) { /* ignore */ }
    try { await dbQuery("ALTER TABLE users ADD COLUMN department TEXT"); } catch (e) { /* ignore */ }
    try { await dbQuery("ALTER TABLE users ADD COLUMN role_title TEXT"); } catch (e) { /* ignore */ }
    try { await dbQuery("ALTER TABLE messages ADD COLUMN is_read INTEGER DEFAULT 0"); } catch (e) { /* ignore */ }
    try { await dbQuery("ALTER TABLE license_keys ADD COLUMN origin VARCHAR(20) DEFAULT 'unknown'"); } catch (e) { /* ignore */ }
    try { await dbQuery("ALTER TABLE users ADD COLUMN allowed_device_id TEXT"); } catch (e) { /* ignore */ }

    // Additional tables can be added as we migrate logic
};

// 5. Start Server Logic
let httpServer;
let activeSockets = new Set();

function startServer(port = PORT) {
    return new Promise((resolve, reject) => {
        if (httpServer) {
            console.warn("Server already running");
            return resolve(httpServer);
        }

        initializeDatabase().then(() => {
            httpServer = app.listen(port, () => {
                resolve(httpServer);
            });

            httpServer.on('connection', (socket) => {
                activeSockets.add(socket);
                socket.on('close', () => activeSockets.delete(socket));
            });

            httpServer.on('error', (err) => {
                reject(err);
            });
        }).catch(reject);
    });
}

function stopServer() {
    return new Promise((resolve) => {
        if (!httpServer) return resolve();
        for (const socket of activeSockets) {
            socket.destroy();
            activeSockets.delete(socket);
        }
        httpServer.close(() => {
            httpServer = null;
            resolve();
        });
    });
}

// Auto-start if run directly
if (require.main === module) {
    startServer();
}

module.exports = { app, startServer, stopServer };
