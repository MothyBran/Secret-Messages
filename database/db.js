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
            password_hash TEXT,
            registration_key_hash TEXT,
            license_expiration TIMESTAMP,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`,
        `CREATE TABLE IF NOT EXISTS license_keys (
            id SERIAL PRIMARY KEY,
            key_code TEXT UNIQUE,
            key_hash TEXT,
            product_code TEXT,
            is_active BOOLEAN DEFAULT FALSE,
            origin TEXT,
            assigned_user_id INTEGER,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`,
        `CREATE TABLE IF NOT EXISTS payments (
            id SERIAL PRIMARY KEY,
            payment_id TEXT UNIQUE,
            status TEXT,
            amount INTEGER,
            currency TEXT,
            metadata JSONB,
            completed_at TIMESTAMP
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
        )`
    ];

    for (let q of queries) {
        // SQLite Anpassung für Datentypen
        if (!_isPostgreSQL) {
            q = q.replace(/SERIAL PRIMARY KEY/g, 'INTEGER PRIMARY KEY AUTOINCREMENT')
                 .replace(/TIMESTAMP DEFAULT CURRENT_TIMESTAMP/g, 'DATETIME DEFAULT CURRENT_TIMESTAMP')
                 .replace(/TIMESTAMP/g, 'DATETIME')
                 .replace(/BOOLEAN DEFAULT FALSE/g, 'INTEGER DEFAULT 0')
                 .replace(/JSONB/g, 'TEXT');
        }
        try {
            await internalDbQuery(q, []);
        } catch (err) {
            console.error("Table Creation Error:", err.message);
        }
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
                if (text.trim().toLowerCase().startsWith('select')) {
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
