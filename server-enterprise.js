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
// Dynamic Public Path for Packaged Apps
let publicPath = path.join(__dirname, 'public');
if (process.pkg) {
    // If packaged with pkg (though we use electron-builder, this pattern is safe)
    console.log("📦 Packaged Environment Detected");
}
// For Electron Builder (files copied to resources), sometimes __dirname is inside asar.
// Simple check: if public doesn't exist here, maybe it's up one level?
if (!fs.existsSync(publicPath)) {
    const upOne = path.join(__dirname, '..', 'public');
    if (fs.existsSync(upOne)) publicPath = upOne;
}

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
        let sqlite3;
        try {
            sqlite3 = require('sqlite3').verbose();
        } catch (e) {
            sqlite3 = require('@vscode/sqlite3').verbose();
        }

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
        access_code_hash TEXT,
        license_key_id INTEGER,
        is_blocked INTEGER DEFAULT 0,
        is_admin INTEGER DEFAULT 0,
        registered_at DATETIME DEFAULT CURRENT_TIMESTAMP
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
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

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
