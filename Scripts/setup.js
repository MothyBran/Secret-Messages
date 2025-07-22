#!/usr/bin/env node
/**
 * Setup Script for Secret Messages Backend
 * Initializes database, creates admin user, generates demo keys
 */

require('dotenv').config();
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const fs = require('fs');
const path = require('path');

// Database setup (supports both SQLite and PostgreSQL)
let db;
const DATABASE_TYPE = process.env.DATABASE_URL?.startsWith('postgresql') ? 'postgres' : 'sqlite';

if (DATABASE_TYPE === 'postgres') {
    const { Pool } = require('pg');
    db = new Pool({
        connectionString: process.env.DATABASE_URL
    });
} else {
    const sqlite3 = require('sqlite3').verbose();
    const dbPath = process.env.DATABASE_URL || './secret_messages.db';
    db = new sqlite3.Database(dbPath);
}

// Utility functions
function log(message) {
    console.log(`🔧 [SETUP] ${message}`);
}

function error(message) {
    console.error(`❌ [ERROR] ${message}`);
    process.exit(1);
}

function success(message) {
    console.log(`✅ [SUCCESS] ${message}`);
}

// Database schema creation
const SQLITE_SCHEMA = `
-- License Keys Table
CREATE TABLE IF NOT EXISTS license_keys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key_code VARCHAR(17) UNIQUE NOT NULL,
    key_hash VARCHAR(255) NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    activated_at DATETIME NULL,
    activated_ip VARCHAR(45) NULL,
    is_active BOOLEAN DEFAULT 0,
    usage_count INTEGER DEFAULT 0,
    expires_at DATETIME NULL,
    created_by VARCHAR(50) DEFAULT 'system'
);

-- User Sessions Table
CREATE TABLE IF NOT EXISTS user_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key_id INTEGER REFERENCES license_keys(id),
    token_hash VARCHAR(255) NOT NULL,
    ip_address VARCHAR(45) NOT NULL,
    user_agent TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME NOT NULL,
    is_active BOOLEAN DEFAULT 1,
    last_activity DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Activity Logs Table
CREATE TABLE IF NOT EXISTS activity_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key_id INTEGER REFERENCES license_keys(id),
    action VARCHAR(100) NOT NULL,
    metadata TEXT,
    ip_address VARCHAR(45),
    user_agent TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    success BOOLEAN DEFAULT 1
);

-- Payments Table
CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    stripe_payment_id VARCHAR(255) UNIQUE,
    amount INTEGER NOT NULL,
    currency VARCHAR(3) DEFAULT 'EUR',
    customer_email VARCHAR(255),
    status VARCHAR(50),
    key_count INTEGER,
    generated_keys TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME NULL
);

-- System Settings Table
CREATE TABLE IF NOT EXISTS system_settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key_name VARCHAR(100) UNIQUE NOT NULL,
    key_value TEXT,
    description TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_license_keys_code ON license_keys(key_code);
CREATE INDEX IF NOT EXISTS idx_license_keys_active ON license_keys(is_active);
CREATE INDEX IF NOT EXISTS idx_sessions_key_id ON user_sessions(key_id);
CREATE INDEX IF NOT EXISTS idx_sessions_active ON user_sessions(is_active);
CREATE INDEX IF NOT EXISTS idx_activity_key_id ON activity_logs(key_id);
CREATE INDEX IF NOT EXISTS idx_activity_timestamp ON activity_logs(timestamp);
CREATE INDEX IF NOT EXISTS idx_payments_stripe_id ON payments(stripe_payment_id);
`;

const POSTGRES_SCHEMA = `
-- License Keys Table
CREATE TABLE IF NOT EXISTS license_keys (
    id SERIAL PRIMARY KEY,
    key_code VARCHAR(17) UNIQUE NOT NULL,
    key_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    activated_at TIMESTAMP NULL,
    activated_ip VARCHAR(45) NULL,
    is_active BOOLEAN DEFAULT FALSE,
    usage_count INTEGER DEFAULT 0,
    expires_at TIMESTAMP NULL,
    created_by VARCHAR(50) DEFAULT 'system'
);

-- User Sessions Table
CREATE TABLE IF NOT EXISTS user_sessions (
    id SERIAL PRIMARY KEY,
    key_id INTEGER REFERENCES license_keys(id),
    token_hash VARCHAR(255) NOT NULL,
    ip_address VARCHAR(45) NOT NULL,
    user_agent TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    last_activity TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Activity Logs Table
CREATE TABLE IF NOT EXISTS activity_logs (
    id SERIAL PRIMARY KEY,
    key_id INTEGER REFERENCES license_keys(id),
    action VARCHAR(100) NOT NULL,
    metadata JSONB,
    ip_address VARCHAR(45),
    user_agent TEXT,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    success BOOLEAN DEFAULT TRUE
);

-- Payments Table
CREATE TABLE IF NOT EXISTS payments (
    id SERIAL PRIMARY KEY,
    stripe_payment_id VARCHAR(255) UNIQUE,
    amount INTEGER NOT NULL,
    currency VARCHAR(3) DEFAULT 'EUR',
    customer_email VARCHAR(255),
    status VARCHAR(50),
    key_count INTEGER,
    generated_keys JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP NULL
);

-- System Settings Table
CREATE TABLE IF NOT EXISTS system_settings (
    id SERIAL PRIMARY KEY,
    key_name VARCHAR(100) UNIQUE NOT NULL,
    key_value TEXT,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_license_keys_code ON license_keys(key_code);
CREATE INDEX IF NOT EXISTS idx_license_keys_active ON license_keys(is_active);
CREATE INDEX IF NOT EXISTS idx_sessions_key_id ON user_sessions(key_id);
CREATE INDEX IF NOT EXISTS idx_sessions_active ON user_sessions(is_active);
CREATE INDEX IF NOT EXISTS idx_activity_key_id ON activity_logs(key_id);
CREATE INDEX IF NOT EXISTS idx_activity_timestamp ON activity_logs(timestamp);
CREATE INDEX IF NOT EXISTS idx_payments_stripe_id ON payments(stripe_payment_id);
`;

// Key generation functions
function generateLicenseKey() {
    const parts = [];
    for (let i = 0; i < 3; i++) {
        const part = crypto.randomBytes(3).toString('hex').toUpperCase().substring(0, 5);
        parts.push(part);
    }
    return parts.join('-');
}

function hashKey(key) {
    return bcrypt.hashSync(key, 10);
}

// Database operations
async function executeQuery(query, params = []) {
    if (DATABASE_TYPE === 'postgres') {
        const client = await db.connect();
        try {
            const result = await client.query(query, params);
            return result;
        } finally {
            client.release();
        }
    } else {
        return new Promise((resolve, reject) => {
            db.run(query, params, function(err) {
                if (err) {
                    reject(err);
                } else {
                    resolve({ lastID: this.lastID, changes: this.changes });
                }
            });
        });
    }
}

async function selectQuery(query, params = []) {
    if (DATABASE_TYPE === 'postgres') {
        const client = await db.connect();
        try {
            const result = await client.query(query, params);
            return result.rows;
        } finally {
            client.release();
        }
    } else {
        return new Promise((resolve, reject) => {
            db.all(query, params, (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(rows);
                }
            });
        });
    }
}

// Setup functions
async function createDatabase() {
    log('Creating database schema...');
    
    const schema = DATABASE_TYPE === 'postgres' ? POSTGRES_SCHEMA : SQLITE_SCHEMA;
    const statements = schema.split(';').filter(stmt => stmt.trim());
    
    for (const statement of statements) {
        if (statement.trim()) {
            try {
                await executeQuery(statement.trim());
            } catch (error) {
                if (!error.message.includes('already exists')) {
                    throw error;
                }
            }
        }
    }
    
    success('Database schema created successfully');
}

async function generateDemoKeys() {
    log('Generating demo license keys...');
    
    const demoKeys = [
        'SM001-ALPHA-BETA1',
        'SM002-GAMMA-DELT2',
        'SM003-ECHO-FOXTR3',
        'SM004-HOTEL-INDI4',
        'SM005-JULIET-KILO5'
    ];
    
    for (const keyCode of demoKeys) {
        const keyHash = hashKey(keyCode);
        
        try {
            await executeQuery(
                'INSERT INTO license_keys (key_code, key_hash, created_by) VALUES (?, ?, ?)',
                [keyCode, keyHash, 'setup']
            );
            log(`Generated demo key: ${keyCode}`);
        } catch (error) {
            if (error.message.includes('UNIQUE constraint') || error.message.includes('duplicate key')) {
                log(`Demo key already exists: ${keyCode}`);
            } else {
                throw error;
            }
        }
    }
    
    // Generate additional random keys
    const additionalKeys = 10;
    log(`Generating ${additionalKeys} additional random keys...`);
    
    for (let i = 0; i < additionalKeys; i++) {
        const keyCode = generateLicenseKey();
        const keyHash = hashKey(keyCode);
        
        try {
            await executeQuery(
                'INSERT INTO license_keys (key_code, key_hash, created_by) VALUES (?, ?, ?)',
                [keyCode, keyHash, 'setup']
            );
            log(`Generated key ${i + 1}: ${keyCode}`);
        } catch (error) {
            log(`Failed to generate key ${i + 1}: ${error.message}`);
        }
    }
    
    success(`Demo keys generated successfully`);
}

async function insertSystemSettings() {
    log('Inserting system settings...');
    
    const settings = [
        {
            key_name: 'app_version',
            key_value: '1.0.0',
            description: 'Application version'
        },
        {
            key_name: 'setup_completed',
            key_value: new Date().toISOString(),
            description: 'Setup completion timestamp'
        },
        {
            key_name: 'admin_password_hash',
            key_value: bcrypt.hashSync(process.env.ADMIN_PASSWORD || 'SecureAdmin123!', 10),
            description: 'Admin panel password hash'
        },
        {
            key_name: 'rate_limit_enabled',
            key_value: 'true',
            description: 'Enable rate limiting'
        },
        {
            key_name: 'maintenance_mode',
            key_value: 'false',
            description: 'Maintenance mode status'
        }
    ];
    
    for (const setting of settings) {
        try {
            await executeQuery(
                'INSERT OR REPLACE INTO system_settings (key_name, key_value, description) VALUES (?, ?, ?)',
                [setting.key_name, setting.key_value, setting.description]
            );
        } catch (error) {
            // For PostgreSQL, use ON CONFLICT
            if (DATABASE_TYPE === 'postgres') {
                await executeQuery(
                    'INSERT INTO system_settings (key_name, key_value, description) VALUES ($1, $2, $3) ON CONFLICT (key_name) DO UPDATE SET key_value = $2, description = $3, updated_at = CURRENT_TIMESTAMP',
                    [setting.key_name, setting.key_value, setting.description]
                );
            } else {
                throw error;
            }
        }
    }
    
    success('System settings inserted successfully');
}

async function createDirectories() {
    log('Creating necessary directories...');
    
    const directories = [
        'logs',
        'backups',
        'uploads',
        'public'
    ];
    
    for (const dir of directories) {
        const dirPath = path.join(process.cwd(), dir);
        if (!fs.existsSync(dirPath)) {
            fs.mkdirSync(dirPath, { recursive: true });
            log(`Created directory: ${dir}`);
        } else {
            log(`Directory already exists: ${dir}`);
        }
    }
    
    success('Directories created successfully');
}

async function verifySetup() {
    log('Verifying setup...');
    
    try {
        // Check if tables exist and have data
        const keyCount = await selectQuery('SELECT COUNT(*) as count FROM license_keys');
        const settingsCount = await selectQuery('SELECT COUNT(*) as count FROM system_settings');
        
        const keyCountValue = DATABASE_TYPE === 'postgres' ? keyCount[0].count : keyCount[0].count;
        const settingsCountValue = DATABASE_TYPE === 'postgres' ? settingsCount[0].count : settingsCount[0].count;
        
        log(`License keys in database: ${keyCountValue}`);
        log(`System settings in database: ${settingsCountValue}`);
        
        if (keyCountValue > 0 && settingsCountValue > 0) {
            success('Setup verification passed');
            return true;
        } else {
            error('Setup verification failed');
            return false;
        }
    } catch (err) {
        error(`Setup verification failed: ${err.message}`);
        return false;
    }
}

// Main setup function
async function main() {
    console.log('🚀 Secret Messages Backend Setup');
    console.log('================================');
    console.log('');
    
    try {
        // Check environment
        if (!process.env.JWT_SECRET) {
            error('JWT_SECRET environment variable is required');
        }
        
        if (!process.env.ADMIN_PASSWORD) {
            error('ADMIN_PASSWORD environment variable is required');
        }
        
        log(`Using database type: ${DATABASE_TYPE}`);
        log(`Database URL: ${process.env.DATABASE_URL || 'SQLite (default)'}`);
        
        // Run setup steps
        await createDirectories();
        await createDatabase();
        await insertSystemSettings();
        await generateDemoKeys();
        
        // Verify setup
        const verified = await verifySetup();
        
        if (verified) {
            console.log('');
            console.log('🎉 Setup completed successfully!');
            console.log('');
            console.log('📋 Summary:');
            console.log(`   Database: ${DATABASE_TYPE}`);
            console.log(`   Admin Password: ${process.env.ADMIN_PASSWORD}`);
            console.log('   Demo Keys: SM001-ALPHA-BETA1, SM002-GAMMA-DELT2, etc.');
            console.log('');
            console.log('🚀 You can now start the application:');
            console.log('   npm start');
            console.log('');
            console.log('🌐 Access points:');
            console.log('   Main App: http://localhost:3000');
            console.log('   Admin Panel: http://localhost:3000/admin');
            console.log('   API Health: http://localhost:3000/api/health');
            console.log('');
        }
        
    } catch (err) {
        error(`Setup failed: ${err.message}`);
    } finally {
        // Close database connection
        if (DATABASE_TYPE === 'postgres') {
            await db.end();
        } else {
            db.close();
        }
    }
}

// Run setup if executed directly
if (require.main === module) {
    main();
}

module.exports = {
    createDatabase,
    generateDemoKeys,
    insertSystemSettings,
    verifySetup
};
