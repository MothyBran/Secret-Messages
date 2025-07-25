// migrate-to-user-auth.js
// Migrations-Skript für die Umstellung auf Benutzer-basierte Authentifizierung

require('dotenv').config();

const DATABASE_URL = process.env.DATABASE_URL;
let db, isPostgreSQL = false;

async function runMigration() {
    console.log('🔄 Starte Migration zu Benutzer-basierter Authentifizierung...\n');
    
    // Database setup
    if (DATABASE_URL && DATABASE_URL.startsWith('postgresql')) {
        const { Pool } = require('pg');
        db = new Pool({ connectionString: DATABASE_URL });
        isPostgreSQL = true;
        console.log('📦 Verwende PostgreSQL Datenbank');
    } else {
        const sqlite3 = require('sqlite3').verbose();
        db = new sqlite3.Database('./secret_messages.db');
        console.log('📁 Verwende SQLite Datenbank');
    }
    
    try {
        // 1. Add new columns to license_keys
        console.log('1️⃣ Erweitere license_keys Tabelle...');
        
        if (isPostgreSQL) {
            await db.query(`
                ALTER TABLE license_keys 
                ADD COLUMN IF NOT EXISTS username VARCHAR(50) UNIQUE,
                ADD COLUMN IF NOT EXISTS access_code_hash VARCHAR(255),
                ADD COLUMN IF NOT EXISTS user_created_at TIMESTAMP
            `);
        } else {
            // SQLite doesn't support ADD COLUMN IF NOT EXISTS
            try {
                await new Promise((resolve, reject) => {
                    db.run('ALTER TABLE license_keys ADD COLUMN username VARCHAR(50) UNIQUE', err => {
                        if (err && !err.message.includes('duplicate column')) reject(err);
                        else resolve();
                    });
                });
            } catch (e) {}
            
            try {
                await new Promise((resolve, reject) => {
                    db.run('ALTER TABLE license_keys ADD COLUMN access_code_hash VARCHAR(255)', err => {
                        if (err && !err.message.includes('duplicate column')) reject(err);
                        else resolve();
                    });
                });
            } catch (e) {}
            
            try {
                await new Promise((resolve, reject) => {
                    db.run('ALTER TABLE license_keys ADD COLUMN user_created_at DATETIME', err => {
                        if (err && !err.message.includes('duplicate column')) reject(err);
                        else resolve();
                    });
                });
            } catch (e) {}
        }
        
        console.log('✅ license_keys Tabelle erweitert\n');
        
        // 2. Create user_sessions table
        console.log('2️⃣ Erstelle user_sessions Tabelle...');
        
        if (isPostgreSQL) {
            await db.query(`
                CREATE TABLE IF NOT EXISTS user_sessions (
                    id SERIAL PRIMARY KEY,
                    session_token VARCHAR(500) UNIQUE NOT NULL,
                    username VARCHAR(50) NOT NULL,
                    license_key_id INTEGER REFERENCES license_keys(id) ON DELETE CASCADE,
                    ip_address INET NOT NULL,
                    user_agent TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    last_activity TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    expires_at TIMESTAMP NOT NULL,
                    is_active BOOLEAN DEFAULT TRUE
                )
            `);
        } else {
            await new Promise((resolve, reject) => {
                db.run(`
                    CREATE TABLE IF NOT EXISTS user_sessions (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        session_token VARCHAR(500) UNIQUE NOT NULL,
                        username VARCHAR(50) NOT NULL,
                        license_key_id INTEGER REFERENCES license_keys(id) ON DELETE CASCADE,
                        ip_address VARCHAR(45) NOT NULL,
                        user_agent TEXT,
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                        last_activity DATETIME DEFAULT CURRENT_TIMESTAMP,
                        expires_at DATETIME NOT NULL,
                        is_active BOOLEAN DEFAULT 1
                    )
                `, err => err ? reject(err) : resolve());
            });
        }
        
        console.log('✅ user_sessions Tabelle erstellt\n');
        
        // 3. Create account_deletions table
        console.log('3️⃣ Erstelle account_deletions Tabelle...');
        
        if (isPostgreSQL) {
            await db.query(`
                CREATE TABLE IF NOT EXISTS account_deletions (
                    id SERIAL PRIMARY KEY,
                    username VARCHAR(50) NOT NULL,
                    license_key_code VARCHAR(17) NOT NULL,
                    deleted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    deletion_ip INET,
                    reason VARCHAR(255) DEFAULT 'user_requested'
                )
            `);
        } else {
            await new Promise((resolve, reject) => {
                db.run(`
                    CREATE TABLE IF NOT EXISTS account_deletions (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        username VARCHAR(50) NOT NULL,
                        license_key_code VARCHAR(17) NOT NULL,
                        deleted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                        deletion_ip VARCHAR(45),
                        reason VARCHAR(255) DEFAULT 'user_requested'
                    )
                `, err => err ? reject(err) : resolve());
            });
        }
        
        console.log('✅ account_deletions Tabelle erstellt\n');
        
        // 4. Create indexes
        console.log('4️⃣ Erstelle Indizes...');
        
        if (isPostgreSQL) {
            await db.query('CREATE INDEX IF NOT EXISTS idx_license_keys_username ON license_keys(username)');
            await db.query('CREATE INDEX IF NOT EXISTS idx_user_sessions_username ON user_sessions(username)');
            await db.query('CREATE INDEX IF NOT EXISTS idx_user_sessions_token ON user_sessions(session_token)');
        } else {
            await new Promise((resolve, reject) => {
                db.run('CREATE INDEX IF NOT EXISTS idx_license_keys_username ON license_keys(username)', 
                    err => err ? reject(err) : resolve());
            });
            await new Promise((resolve, reject) => {
                db.run('CREATE INDEX IF NOT EXISTS idx_user_sessions_username ON user_sessions(username)', 
                    err => err ? reject(err) : resolve());
            });
            await new Promise((resolve, reject) => {
                db.run('CREATE INDEX IF NOT EXISTS idx_user_sessions_token ON user_sessions(session_token)', 
                    err => err ? reject(err) : resolve());
            });
        }
        
        console.log('✅ Indizes erstellt\n');
        
        // 5. Update system settings
        console.log('5️⃣ Aktualisiere System-Einstellungen...');
        
        const settings = [
            ['auth_mode', 'user_based', 'Authentication mode: user_based or device_based'],
            ['access_code_length', '5', 'Length of user access code'],
            ['allow_account_deletion', 'true', 'Allow users to delete their accounts']
        ];
        
        for (const [key, value, desc] of settings) {
            if (isPostgreSQL) {
                await db.query(`
                    INSERT INTO system_settings (setting_key, setting_value, description) 
                    VALUES ($1, $2, $3)
                    ON CONFLICT (setting_key) DO UPDATE SET 
                        setting_value = EXCLUDED.setting_value,
                        updated_at = CURRENT_TIMESTAMP
                `, [key, value, desc]);
            } else {
                await new Promise((resolve, reject) => {
                    db.run(`
                        INSERT OR REPLACE INTO system_settings (key_name, key_value, description) 
                        VALUES (?, ?, ?)
                    `, [key, value, desc], err => err ? reject(err) : resolve());
                });
            }
        }
        
        console.log('✅ System-Einstellungen aktualisiert\n');
        
        console.log('🎉 Migration erfolgreich abgeschlossen!\n');
        console.log('📝 Nächste Schritte:');
        console.log('   1. Server neu starten');
        console.log('   2. Neue index.html in public/ Ordner kopieren');
        console.log('   3. Aktualisierte server.js verwenden');
        console.log('   4. Testen mit Demo-Keys\n');
        
    } catch (error) {
        console.error('❌ Fehler bei der Migration:', error);
        process.exit(1);
    } finally {
        if (isPostgreSQL) {
            await db.end();
        } else {
            db.close();
        }
    }
}

// Run migration
runMigration();
