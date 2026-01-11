// server-enterprise.js
// Isolated Enterprise Server Entrypoint

const express = require('express');
const path = require('path');
const fs = require('fs');
const helmet = require('helmet');
const cors = require('cors');
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
        const enterpriseRouter = require('./enterprise/router')(dbQuery);
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
        pik_encrypted TEXT,
        license_expiration DATETIME
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

    // Schema Migration: Ensure columns exist (Idempotent)
    try { await dbQuery("ALTER TABLE users ADD COLUMN is_admin INTEGER DEFAULT 1"); } catch (e) { /* ignore */ }
    try { await dbQuery("ALTER TABLE users ADD COLUMN is_blocked INTEGER DEFAULT 0"); } catch (e) { /* ignore */ }
    try { await dbQuery("ALTER TABLE users ADD COLUMN license_key_id INTEGER"); } catch (e) { /* ignore */ }
    try { await dbQuery("ALTER TABLE users ADD COLUMN password TEXT"); } catch (e) { /* ignore */ }
    try { await dbQuery("ALTER TABLE users ADD COLUMN access_code_hash TEXT"); } catch (e) { /* ignore */ }
    try { await dbQuery("ALTER TABLE users ADD COLUMN registration_key_hash TEXT"); } catch (e) { /* ignore */ }
    try { await dbQuery("ALTER TABLE users ADD COLUMN pik_encrypted TEXT"); } catch (e) { /* ignore */ }
    try { await dbQuery("ALTER TABLE users ADD COLUMN license_expiration DATETIME"); } catch (e) { /* ignore */ }
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
