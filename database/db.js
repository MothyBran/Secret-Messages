// database/db.js
const path = require('path');
const fs = require('fs');
require('dotenv').config();

// ENTERPRISE SWITCH
const IS_ENTERPRISE = process.env.APP_MODE === 'ENTERPRISE';

let db;
let isPostgreSQL = false;
let dbQuery;

// Initialize Database
const initializeDatabase = async () => {
    console.log('🔧 Initializing Database...');
    const DATABASE_URL = process.env.DATABASE_URL;

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
        // SQLITE
        const sqlite3 = require('sqlite3').verbose();
        let dbPath = './secret_messages.db';

        // Electron / Enterprise Path Logic
        if (process.env.USER_DATA_PATH) {
            dbPath = path.join(process.env.USER_DATA_PATH, 'secret_messages.db');
            console.log("📂 Using DB Path:", dbPath);
        } else {
            console.log("📂 Using Local DB Path (Dev):", dbPath);
        }

        db = new sqlite3.Database(dbPath);

        // Configure busy timeout for concurrent write handling
        db.configure('busyTimeout', 5000);

        dbQuery = (text, params = []) => {
            return new Promise((resolve, reject) => {
                const sql = text.replace(/\$\d+/g, '?'); // Map $1, $2 to ?
                if (text.trim().toUpperCase().startsWith('SELECT') || text.trim().toUpperCase().startsWith('PRAGMA')) {
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
            is_online ${isPostgreSQL ? 'BOOLEAN DEFAULT FALSE' : 'INTEGER DEFAULT 0'},
            registration_key_hash TEXT,
            pik_encrypted TEXT,
            license_expiration ${isPostgreSQL ? 'TIMESTAMP' : 'DATETIME'}
        )`);

        await dbQuery(`CREATE TABLE IF NOT EXISTS license_renewals (
            id ${isPostgreSQL ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT'},
            user_id INTEGER,
            key_code_hash TEXT,
            extended_until ${isPostgreSQL ? 'TIMESTAMP' : 'DATETIME'},
            used_at ${isPostgreSQL ? 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP' : 'DATETIME DEFAULT CURRENT_TIMESTAMP'}
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
            activated_ip VARCHAR(50),
            origin VARCHAR(20) DEFAULT 'unknown'
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


        await dbQuery(`CREATE TABLE IF NOT EXISTS analytics_events (
            id ${isPostgreSQL ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT'},
            event_type VARCHAR(50),
            source VARCHAR(50),
            anonymized_ip VARCHAR(50),
            metadata TEXT,
            created_at ${isPostgreSQL ? 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP' : 'DATETIME DEFAULT CURRENT_TIMESTAMP'}
        )`);

        // Enterprise Keys Table
        await dbQuery(`CREATE TABLE IF NOT EXISTS enterprise_keys (
            id ${isPostgreSQL ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT'},
            key TEXT UNIQUE NOT NULL,
            bundle_id TEXT,
            quota_max INTEGER DEFAULT 10,
            activated_at ${isPostgreSQL ? 'TIMESTAMP' : 'DATETIME'},
            is_active ${isPostgreSQL ? 'BOOLEAN DEFAULT TRUE' : 'INTEGER DEFAULT 1'}
        )`);

        // --- MIGRATIONS (Column Checks) ---
        // We use try-catch to allow failures if columns already exist
        const safeAdd = async (sql) => { try { await dbQuery(sql); } catch(e) {} };

        await safeAdd(`ALTER TABLE analytics_events ADD COLUMN created_at DATETIME`);
        await safeAdd(`CREATE INDEX IF NOT EXISTS idx_analytics_type ON analytics_events(event_type)`);
        await safeAdd(`CREATE INDEX IF NOT EXISTS idx_analytics_date ON analytics_events(created_at)`);

        await safeAdd(`ALTER TABLE license_keys ADD COLUMN bundle_id INTEGER`);
        await safeAdd(`ALTER TABLE license_keys ADD COLUMN assigned_user_id VARCHAR(50)`);
        await safeAdd(`ALTER TABLE license_keys ADD COLUMN client_name VARCHAR(100)`);
        await safeAdd(`ALTER TABLE license_keys ADD COLUMN max_users INTEGER DEFAULT 1`);
        await safeAdd(`ALTER TABLE license_keys ADD COLUMN is_blocked ${isPostgreSQL ? 'BOOLEAN DEFAULT FALSE' : 'INTEGER DEFAULT 0'}`);
        await safeAdd(`ALTER TABLE license_keys ADD COLUMN origin VARCHAR(20) DEFAULT 'unknown'`);

        await safeAdd(`ALTER TABLE users ADD COLUMN registration_key_hash TEXT`);
        await safeAdd(`ALTER TABLE users ADD COLUMN pik_encrypted TEXT`);
        await safeAdd(`ALTER TABLE users ADD COLUMN license_expiration ${isPostgreSQL ? 'TIMESTAMP' : 'DATETIME'}`);
        await safeAdd(`ALTER TABLE users ADD COLUMN allowed_device_id TEXT`);

        await safeAdd(`ALTER TABLE messages ADD COLUMN status VARCHAR(20) DEFAULT 'open'`);
        await safeAdd(`ALTER TABLE messages ADD COLUMN ticket_id VARCHAR(50)`);

        // Initialize Settings
        try {
            const mCheck = await dbQuery("SELECT value FROM settings WHERE key = 'maintenance_mode'");
            if (mCheck.rows.length === 0) {
                await dbQuery("INSERT INTO settings (key, value) VALUES ('maintenance_mode', 'false')");
            }
            const sCheck = await dbQuery("SELECT value FROM settings WHERE key = 'shop_active'");
            if (sCheck.rows.length === 0) {
                await dbQuery("INSERT INTO settings (key, value) VALUES ('shop_active', 'true')");
            }
            const tCheck = await dbQuery("SELECT value FROM settings WHERE key = 'ticket_reply_template'");
            if (tCheck.rows.length === 0) {
                const defaultTemplate = "Hallo {username},\n\n[TEXT]\n\nMit freundlichen Grüßen,\nIhr Support-Team";
                await dbQuery("INSERT INTO settings (key, value) VALUES ('ticket_reply_template', $1)", [defaultTemplate]);
            }
        } catch (e) { console.warn("Settings init warning:", e.message); }

        console.log('✅ Tables checked/created');
    } catch (e) { console.error("Table creation error:", e); }
};

/**
 * Returns a transaction client that supports begin/commit/rollback
 * Unified for both PostgreSQL and SQLite
 */
const getTransactionClient = async () => {
    if (isPostgreSQL) {
        // Postgres: Use Pool Client
        const client = await db.connect();
        const query = (text, params) => client.query(text, params);
        const release = () => client.release();
        return { query, release, type: 'pg' };
    } else {
        // SQLite: Wrapper (Serialized)
        // Since SQLite in Node is single-threaded/serialized by default for 'run',
        // we essentially just use the global dbQuery but need to ensure
        // correct error handling logic in the calling code.
        return {
            query: dbQuery,
            release: () => {}, // No-op for SQLite
            type: 'sqlite'
        };
    }
};

module.exports = {
    initializeDatabase,
    dbQuery: (text, params) => dbQuery(text, params),
    getTransactionClient,
    getDb: () => db,
    isPostgreSQL: () => isPostgreSQL
};
