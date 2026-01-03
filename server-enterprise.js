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

// Middleware
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            connectSrc: ["'self'", "http://localhost:*", "https://www.secure-msg.app"] // Allow local + activation
        }
    }
}));
app.use(cors());
app.use(express.json());

// 2. SQLite Database Connection
// Simplified version of the logic in server.js, optimized for local enterprise
let db;
let dbQuery;

const initializeDatabase = async () => {
    try {
        const sqlite3 = require('@vscode/sqlite3').verbose();

        // Determine DB Path: Priority to USER_DATA_PATH (Electron), else local
        let dbPath = './secret_messages.db';
        if (process.env.USER_DATA_PATH) {
            const dataDir = process.env.USER_DATA_PATH;
            if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
            dbPath = path.join(dataDir, 'secret_messages.db');
        }

        console.log(`📂 Enterprise DB Path: ${dbPath}`);

        db = new sqlite3.Database(dbPath);

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
        app.use('/', enterpriseRouter); // Mounts at root, handles logic before static if needed?
        // Actually, Express matches in order.
        // If we want '/' to be handled by router, mount it before static OR specifically for '/'
        // The router handles specifically '/' and redirects.
        // Static files should be served for everything else.

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

    // Additional tables can be added as we migrate logic
    console.log("✅ Enterprise Tables Verified");
};

// 4. Static Files
// Serve public folder. 'index: false' is crucial so we don't auto-serve index.html at '/'
// allowing our Router to handle the landing logic.
app.use(express.static('public', { index: false }));

// 5. Start Server
initializeDatabase().then(() => {
    app.listen(PORT, () => {
        console.log(`🚀 Enterprise Server running on Port ${PORT}`);
    });
});
