const fs = require('fs');
const path = require('path');

/**
 * DB MIGRATION & SCHEMA CHECK
 * Ensures local SQLite database has all required tables and columns for Enterprise/Dev mode.
 */

async function ensureDbSchema() {
    console.log("⚙️  Checking Database Schema...");

    // 1. Determine DB Path
    const sqlite3 = require('sqlite3').verbose();

    let dbPath = './secret_messages.db';
    if (process.env.USER_DATA_PATH) {
        if (!fs.existsSync(process.env.USER_DATA_PATH)) {
            fs.mkdirSync(process.env.USER_DATA_PATH, { recursive: true });
        }
        dbPath = path.join(process.env.USER_DATA_PATH, 'secret_messages.db');
    } else {
        // Ensure local data dir exists if using default
        const dataDir = path.dirname(dbPath);
        if (dataDir !== '.' && !fs.existsSync(dataDir)) {
             fs.mkdirSync(dataDir, { recursive: true });
        }
    }

    console.log(`   Database Path: ${dbPath}`);
    const db = new sqlite3.Database(dbPath);

    const dbRun = (sql, params = []) => new Promise((resolve, reject) => {
        db.run(sql, params, function(err) {
            if (err) reject(err); else resolve(this);
        });
    });

    try {
        // 2. Core Tables
        await dbRun(`CREATE TABLE IF NOT EXISTS users (
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
            allowed_device_id TEXT,
            last_login DATETIME,
            is_online INTEGER DEFAULT 0
        )`);

        await dbRun(`CREATE TABLE IF NOT EXISTS license_keys (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            key_code VARCHAR(17) UNIQUE NOT NULL,
            key_hash TEXT NOT NULL,
            product_code VARCHAR(10),
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            activated_at DATETIME,
            expires_at DATETIME,
            is_active INTEGER DEFAULT 0,
            username VARCHAR(50),
            activated_ip VARCHAR(50),
            bundle_id INTEGER,
            assigned_user_id VARCHAR(50),
            client_name VARCHAR(100),
            max_users INTEGER DEFAULT 1,
            is_blocked INTEGER DEFAULT 0,
            origin VARCHAR(20) DEFAULT 'unknown'
        )`);

         await dbRun(`CREATE TABLE IF NOT EXISTS settings (
            key VARCHAR(50) PRIMARY KEY,
            value TEXT
        )`);

        await dbRun(`CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sender_id TEXT,
            recipient_id TEXT,
            subject VARCHAR(255),
            body TEXT,
            payload TEXT,
            iv TEXT,
            type VARCHAR(50),
            is_read INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            expires_at DATETIME,
            status VARCHAR(20) DEFAULT 'open',
            ticket_id VARCHAR(50)
        )`);

        await dbRun(`CREATE TABLE IF NOT EXISTS support_tickets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ticket_id VARCHAR(50),
            username VARCHAR(50),
            email VARCHAR(100),
            subject VARCHAR(255),
            message TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            status VARCHAR(20) DEFAULT 'open'
        )`);

        await dbRun(`CREATE TABLE IF NOT EXISTS analytics_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            event_type VARCHAR(50),
            source VARCHAR(50),
            anonymized_ip VARCHAR(50),
            metadata TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        await dbRun(`CREATE TABLE IF NOT EXISTS audit_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            action VARCHAR(50),
            details TEXT,
            ip_address VARCHAR(45),
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        await dbRun(`CREATE TABLE IF NOT EXISTS license_renewals (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            key_code_hash TEXT,
            extended_until DATETIME,
            used_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

         await dbRun(`CREATE TABLE IF NOT EXISTS license_bundles (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name VARCHAR(100),
            order_number VARCHAR(50),
            total_keys INTEGER DEFAULT 0,
            expires_at DATETIME,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        // 3. Columns & Migrations (Idempotent)
        const safeAlter = async (table, col, def) => {
            try {
                await dbRun(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
            } catch (e) {
                // Ignore duplicate column errors
            }
        };

        // Users
        await safeAlter('users', 'pik_encrypted', 'TEXT');
        await safeAlter('users', 'registration_key_hash', 'TEXT');
        await safeAlter('users', 'department', 'TEXT');
        await safeAlter('users', 'role_title', 'TEXT');
        await safeAlter('users', 'password', 'TEXT');
        await safeAlter('users', 'is_admin', 'INTEGER DEFAULT 0');
        // license_expiration deprecated
        // await safeAlter('users', 'license_expiration', 'DATETIME');

        // License Keys
        await safeAlter('license_keys', 'origin', "VARCHAR(20) DEFAULT 'unknown'");

        // Analytics Indices
        await dbRun(`CREATE INDEX IF NOT EXISTS idx_analytics_type ON analytics_events(event_type)`);
        await dbRun(`CREATE INDEX IF NOT EXISTS idx_analytics_date ON analytics_events(created_at)`);

        console.log("✅ Database Schema verified and up-to-date.");
        db.close();

    } catch (e) {
        console.error("❌ Schema Check Failed:", e);
        process.exit(1);
    }
}

if (require.main === module) {
    ensureDbSchema();
}

module.exports = ensureDbSchema;
