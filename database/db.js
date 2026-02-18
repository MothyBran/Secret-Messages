const path = require('path');
require('dotenv').config();

const IS_ENTERPRISE = process.env.APP_MODE === 'ENTERPRISE';
let db;
let _isPostgreSQL = false; 

// Platzhalter-Funktion, die später überschrieben wird
let internalDbQuery = async () => {
    throw new Error("Datenbank nicht initialisiert! Rufe initializeDatabase() zuerst auf.");
};

/**
 * Erstellt die notwendigen Tabellen, falls sie nicht existieren
 */
async function createTables() {
    console.log('🏗️ Checking/Creating Tables...');
    const queries = [
        `CREATE TABLE IF NOT EXISTS users (
            id SERIAL PRIMARY KEY,
            username TEXT UNIQUE,
            access_code_hash TEXT,
            registration_key_hash TEXT,
            license_key_id INTEGER,
            badge TEXT,
            allowed_device_id TEXT,
            pik_encrypted TEXT,
            is_blocked BOOLEAN DEFAULT FALSE,
            is_online BOOLEAN DEFAULT FALSE,
            last_login TIMESTAMP,
            registered_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`,
        `CREATE TABLE IF NOT EXISTS license_keys (
            id SERIAL PRIMARY KEY,
            key_code TEXT UNIQUE,
            key_hash TEXT,
            product_code TEXT,
            is_active BOOLEAN DEFAULT FALSE,
            is_blocked BOOLEAN DEFAULT FALSE,
            origin TEXT,
            assigned_user_id INTEGER,
            bundle_id INTEGER,
            client_name TEXT,
            max_users INTEGER,
            activated_at TIMESTAMP,
            expires_at TIMESTAMP,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`,
        `CREATE TABLE IF NOT EXISTS payments (
            id SERIAL PRIMARY KEY,
            payment_id TEXT UNIQUE,
            payment_intent_id TEXT,
            status TEXT,
            amount INTEGER,
            currency TEXT,
            payment_method TEXT,
            metadata JSONB,
            completed_at TIMESTAMP,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`,
        `CREATE TABLE IF NOT EXISTS messages (
            id SERIAL PRIMARY KEY,
            recipient_id INTEGER,
            subject TEXT,
            body TEXT,
            type TEXT,
            is_read BOOLEAN DEFAULT FALSE,
            ticket_id TEXT,
            status TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            expires_at TIMESTAMP
        )`,
        `CREATE TABLE IF NOT EXISTS support_tickets (
            id SERIAL PRIMARY KEY,
            ticket_id TEXT UNIQUE,
            username TEXT,
            email TEXT,
            subject TEXT,
            message TEXT,
            status TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`,
        `CREATE TABLE IF NOT EXISTS license_renewals (
            id SERIAL PRIMARY KEY,
            user_id INTEGER,
            extended_until TIMESTAMP,
            used_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            key_code_hash TEXT
        )`,
        `CREATE TABLE IF NOT EXISTS user_sessions (
            user_id INTEGER,
            token TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`,
        `CREATE TABLE IF NOT EXISTS settings (
            key TEXT UNIQUE,
            value TEXT
        )`,
        `CREATE TABLE IF NOT EXISTS analytics_events (
            id SERIAL PRIMARY KEY,
            event_type TEXT,
            source TEXT,
            anonymized_ip TEXT,
            metadata JSONB,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`,
        `CREATE TABLE IF NOT EXISTS security_posts (
            id SERIAL PRIMARY KEY,
            title TEXT,
            subtitle TEXT,
            content TEXT,
            image_url TEXT,
            priority TEXT,
            status TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`,
        `CREATE TABLE IF NOT EXISTS security_interactions (
            id SERIAL PRIMARY KEY,
            post_id INTEGER,
            user_id INTEGER,
            interaction_type TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(post_id, user_id)
        )`,
        `CREATE TABLE IF NOT EXISTS security_comments (
            id SERIAL PRIMARY KEY,
            post_id INTEGER,
            user_id INTEGER,
            username TEXT,
            comment TEXT,
            parent_id INTEGER,
            is_pinned BOOLEAN DEFAULT FALSE,
            is_anonymous BOOLEAN DEFAULT FALSE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`,
        `CREATE TABLE IF NOT EXISTS security_comment_interactions (
            id SERIAL PRIMARY KEY,
            comment_id INTEGER,
            user_id INTEGER,
            interaction_type TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(comment_id, user_id)
        )`,
        `CREATE TABLE IF NOT EXISTS user_bookmarks (
            id SERIAL PRIMARY KEY,
            user_id INTEGER,
            post_id INTEGER,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(user_id, post_id)
        )`,
        `CREATE TABLE IF NOT EXISTS pairing_codes (
            id SERIAL PRIMARY KEY,
            user_id INTEGER,
            code TEXT,
            expires_at TIMESTAMP,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`,
        `CREATE TABLE IF NOT EXISTS contacts (
            id SERIAL PRIMARY KEY,
            user_id INTEGER,
            encrypted_data TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`
    ];

    for (let q of queries) {
        // SQLite Anpassung für Datentypen
        if (!_isPostgreSQL) {
            q = q.replace(/SERIAL PRIMARY KEY/g, 'INTEGER PRIMARY KEY AUTOINCREMENT')
                 .replace(/TIMESTAMP DEFAULT CURRENT_TIMESTAMP/g, 'DATETIME DEFAULT CURRENT_TIMESTAMP')
                 .replace(/TIMESTAMP/g, 'DATETIME')
                 .replace(/BOOLEAN DEFAULT FALSE/g, 'INTEGER DEFAULT 0')
                 .replace(/JSONB/g, 'TEXT')
                 .replace(/UNIQUE\(post_id, user_id\)/g, 'UNIQUE(post_id, user_id) ON CONFLICT REPLACE');
        }
        try {
            await internalDbQuery(q, []);
        } catch (err) {
            console.error("Table Creation Error:", err.message);
        }
    }

    // --- MIGRATION: license_key_id hinzufügen ---
    try {
        console.log('🔄 Running Migrations...');
        if (_isPostgreSQL) {
            await internalDbQuery(`ALTER TABLE users ADD COLUMN IF NOT EXISTS license_key_id INTEGER`);
        } else {
            // SQLite hat kein "ADD COLUMN IF NOT EXISTS", daher prüfen wir vorher
            const check = await internalDbQuery(`PRAGMA table_info(users)`);
            const hasCol = check.rows.some(c => c.name === 'license_key_id');
            if (!hasCol) {
                await internalDbQuery(`ALTER TABLE users ADD COLUMN license_key_id INTEGER`);
                console.log('✅ Migrated: Added license_key_id to users (SQLite)');
            }
        }
    } catch (e) {
        console.warn("Migration Warning (license_key_id):", e.message);
    }

    // --- MIGRATION: created_at zu payments hinzufügen ---
    try {
        if (_isPostgreSQL) {
            await internalDbQuery(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`);
        } else {
            const check = await internalDbQuery(`PRAGMA table_info(payments)`);
            const hasCol = check.rows.some(c => c.name === 'created_at');
            if (!hasCol) {
                await internalDbQuery(`ALTER TABLE payments ADD COLUMN created_at DATETIME DEFAULT CURRENT_TIMESTAMP`);
                console.log('✅ Migrated: Added created_at to payments (SQLite)');
            }
        }
    } catch (e) {
        console.warn("Migration Warning (payments created_at):", e.message);
    }

    // --- MIGRATION: badge zu users hinzufügen ---
    try {
        if (_isPostgreSQL) {
            await internalDbQuery(`ALTER TABLE users ADD COLUMN IF NOT EXISTS badge TEXT`);
        } else {
            const check = await internalDbQuery(`PRAGMA table_info(users)`);
            const hasCol = check.rows.some(c => c.name === 'badge');
            if (!hasCol) {
                await internalDbQuery(`ALTER TABLE users ADD COLUMN badge TEXT`);
                console.log('✅ Migrated: Added badge to users (SQLite)');
            }
        }
    } catch (e) {
        console.warn("Migration Warning (users badge):", e.message);
    }

    // --- MIGRATION: is_deleted zu messages hinzufügen ---
    try {
        if (_isPostgreSQL) {
            await internalDbQuery(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT FALSE`);
        } else {
            const check = await internalDbQuery(`PRAGMA table_info(messages)`);
            const hasCol = check.rows.some(c => c.name === 'is_deleted');
            if (!hasCol) {
                await internalDbQuery(`ALTER TABLE messages ADD COLUMN is_deleted INTEGER DEFAULT 0`);
                console.log('✅ Migrated: Added is_deleted to messages (SQLite)');
            }
        }
    } catch (e) {
        console.warn("Migration Warning (messages is_deleted):", e.message);
    }

    // --- MIGRATION: parent_id, is_pinned zu security_comments hinzufügen ---
    try {
        if (_isPostgreSQL) {
            await internalDbQuery(`ALTER TABLE security_comments ADD COLUMN IF NOT EXISTS parent_id INTEGER`);
            await internalDbQuery(`ALTER TABLE security_comments ADD COLUMN IF NOT EXISTS is_pinned BOOLEAN DEFAULT FALSE`);
        } else {
            const check = await internalDbQuery(`PRAGMA table_info(security_comments)`);
            const hasParent = check.rows.some(c => c.name === 'parent_id');
            const hasPinned = check.rows.some(c => c.name === 'is_pinned');

            if (!hasParent) {
                await internalDbQuery(`ALTER TABLE security_comments ADD COLUMN parent_id INTEGER`);
                console.log('✅ Migrated: Added parent_id to security_comments');
            }
            if (!hasPinned) {
                await internalDbQuery(`ALTER TABLE security_comments ADD COLUMN is_pinned INTEGER DEFAULT 0`);
                console.log('✅ Migrated: Added is_pinned to security_comments');
            }
        }
    } catch (e) {
        console.warn("Migration Warning (security_comments):", e.message);
    }

    // --- MIGRATION: is_anonymous zu security_comments hinzufügen ---
    try {
        if (_isPostgreSQL) {
            await internalDbQuery(`ALTER TABLE security_comments ADD COLUMN IF NOT EXISTS is_anonymous BOOLEAN DEFAULT FALSE`);
        } else {
            const check = await internalDbQuery(`PRAGMA table_info(security_comments)`);
            const hasCol = check.rows.some(c => c.name === 'is_anonymous');
            if (!hasCol) {
                await internalDbQuery(`ALTER TABLE security_comments ADD COLUMN is_anonymous INTEGER DEFAULT 0`);
                console.log('✅ Migrated: Added is_anonymous to security_comments');
            }
        }
    } catch (e) {
        console.warn("Migration Warning (security_comments is_anonymous):", e.message);
    }

    // --- MIGRATION: allowed_tor_device_id zu users hinzufügen ---
    try {
        if (_isPostgreSQL) {
            await internalDbQuery(`ALTER TABLE users ADD COLUMN IF NOT EXISTS allowed_tor_device_id TEXT`);
        } else {
            const check = await internalDbQuery(`PRAGMA table_info(users)`);
            const hasCol = check.rows.some(c => c.name === 'allowed_tor_device_id');
            if (!hasCol) {
                await internalDbQuery(`ALTER TABLE users ADD COLUMN allowed_tor_device_id TEXT`);
                console.log('✅ Migrated: Added allowed_tor_device_id to users');
            }
        }
    } catch (e) {
        console.warn("Migration Warning (users allowed_tor_device_id):", e.message);
    }

    // --- MIGRATION: sender_id zu messages hinzufügen ---
    try {
        if (_isPostgreSQL) {
            await internalDbQuery(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS sender_id INTEGER`);
        } else {
            const check = await internalDbQuery(`PRAGMA table_info(messages)`);
            const hasCol = check.rows.some(c => c.name === 'sender_id');
            if (!hasCol) {
                await internalDbQuery(`ALTER TABLE messages ADD COLUMN sender_id INTEGER`);
                console.log('✅ Migrated: Added sender_id to messages');
            }
        }
    } catch (e) {
        console.warn("Migration Warning (messages sender_id):", e.message);
    }
}

/**
 * Initialisiert die Datenbankverbindung
 */
const initializeDatabase = async () => {
    console.log('🔧 Initializing Database...');
    const DATABASE_URL = process.env.DATABASE_URL;

    if (!IS_ENTERPRISE && DATABASE_URL && DATABASE_URL.includes('postgresql')) {
        console.log('📡 PostgreSQL detected');
        _isPostgreSQL = true;
        const { Pool } = require('pg');
        db = new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
        
        internalDbQuery = async (text, params) => await db.query(text, params);
        await createTables();
    } else {
        console.log('📂 SQLite detected');
        const sqlite3 = require('sqlite3').verbose();
        const dbPath = IS_ENTERPRISE ? path.join(process.env.USER_DATA_PATH || '.', 'secret_messages.db') : './secret_messages.db';
        
        db = new sqlite3.Database(dbPath);
        
        internalDbQuery = (text, params) => {
            return new Promise((resolve, reject) => {
                const sql = text.replace(/\$\d/g, '?'); // $1 -> ? für SQLite
                if (text.trim().toLowerCase().startsWith('select') || text.trim().toLowerCase().startsWith('pragma')) {
                    db.all(sql, params, (err, rows) => err ? reject(err) : resolve({ rows }));
                } else {
                    db.run(sql, params, function(err) { 
                        err ? reject(err) : resolve({ rows: [], lastID: this.lastID }); 
                    });
                }
            });
        };
        await createTables();
    }
    console.log('✅ Database Ready.');
};

// EXPORTS
module.exports = {
    initializeDatabase,
    // Diese Funktion leitet an die initialisierte Verbindung weiter
    dbQuery: (text, params) => internalDbQuery(text, params),
    
    // WICHTIG für payment.js Transaktionen
    getTransactionClient: async () => {
        if (_isPostgreSQL) {
            const client = await db.connect();
            return client;
        }
        // Mock für SQLite (kein echtes Pooling nötig)
        return { 
            query: (t, p) => internalDbQuery(t, p), 
            release: () => {} 
        };
    },

    // WICHTIG: Export als Funktion für isPostgreSQL()
    isPostgreSQL: () => _isPostgreSQL
};
