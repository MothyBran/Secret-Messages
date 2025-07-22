// database/migrations/001_initial_schema.sql
-- Secret Messages Database Schema v1.0
-- Initial migration: Create base tables and indexes

BEGIN;

-- License Keys Table
CREATE TABLE IF NOT EXISTS license_keys (
    id SERIAL PRIMARY KEY,
    key_code VARCHAR(17) UNIQUE NOT NULL CHECK (key_code ~ '^[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}$'),
    key_hash TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    activated_at TIMESTAMP WITH TIME ZONE NULL,
    activated_ip INET NULL,
    device_fingerprint VARCHAR(255) NULL,
    is_active BOOLEAN DEFAULT FALSE,
    usage_count INTEGER DEFAULT 0 CHECK (usage_count >= 0),
    max_usage INTEGER DEFAULT 1 CHECK (max_usage > 0),
    expires_at TIMESTAMP WITH TIME ZONE NULL,
    metadata JSONB NULL,
    created_by VARCHAR(100) DEFAULT 'system',
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Authentication Sessions Table
CREATE TABLE IF NOT EXISTS auth_sessions (
    id SERIAL PRIMARY KEY,
    session_token TEXT UNIQUE NOT NULL,
    key_id INTEGER NOT NULL REFERENCES license_keys(id) ON DELETE CASCADE,
    ip_address INET NOT NULL,
    device_fingerprint VARCHAR(255) NOT NULL,
    user_agent TEXT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    last_activity TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    logout_reason VARCHAR(50) NULL
);

-- Usage Logs Table
CREATE TABLE IF NOT EXISTS usage_logs (
    id SERIAL PRIMARY KEY,
    key_id INTEGER NOT NULL REFERENCES license_keys(id) ON DELETE CASCADE,
    session_id INTEGER REFERENCES auth_sessions(id) ON DELETE SET NULL,
    action VARCHAR(100) NOT NULL,
    ip_address INET NOT NULL,
    user_agent TEXT NULL,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    metadata JSONB NULL,
    processing_time_ms INTEGER NULL,
    success BOOLEAN DEFAULT TRUE
);

-- Payments Table
CREATE TABLE IF NOT EXISTS payments (
    id SERIAL PRIMARY KEY,
    payment_id VARCHAR(255) UNIQUE NOT NULL,
    key_id INTEGER REFERENCES license_keys(id) ON DELETE SET NULL,
    customer_email VARCHAR(255) NOT NULL,
    amount DECIMAL(10,2) NOT NULL CHECK (amount > 0),
    currency CHAR(3) DEFAULT 'EUR',
    status VARCHAR(50) NOT NULL,
    payment_method VARCHAR(50) NULL,
    stripe_payment_intent_id VARCHAR(255) NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP WITH TIME ZONE NULL,
    refunded_at TIMESTAMP WITH TIME ZONE NULL,
    metadata JSONB NULL
);

-- Admin Settings Table
CREATE TABLE IF NOT EXISTS admin_settings (
    id SERIAL PRIMARY KEY,
    setting_key VARCHAR(100) UNIQUE NOT NULL,
    setting_value TEXT NOT NULL,
    data_type VARCHAR(20) DEFAULT 'string',
    description TEXT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_by VARCHAR(100) DEFAULT 'system'
);

-- System Health Table
CREATE TABLE IF NOT EXISTS system_health (
    id SERIAL PRIMARY KEY,
    metric_name VARCHAR(100) NOT NULL,
    metric_value DECIMAL(15,4) NOT NULL,
    metric_unit VARCHAR(20) NULL,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    instance_id VARCHAR(100) NULL
);

-- Performance Indexes
CREATE INDEX IF NOT EXISTS idx_license_keys_code ON license_keys(key_code);
CREATE INDEX IF NOT EXISTS idx_license_keys_active ON license_keys(is_active) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_license_keys_expires ON license_keys(expires_at) WHERE expires_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_auth_sessions_token ON auth_sessions(session_token);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_key_id ON auth_sessions(key_id);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_active ON auth_sessions(is_active, expires_at) WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_usage_logs_key_id ON usage_logs(key_id);
CREATE INDEX IF NOT EXISTS idx_usage_logs_timestamp ON usage_logs(timestamp);
CREATE INDEX IF NOT EXISTS idx_usage_logs_action ON usage_logs(action);

CREATE INDEX IF NOT EXISTS idx_payments_payment_id ON payments(payment_id);
CREATE INDEX IF NOT EXISTS idx_payments_email ON payments(customer_email);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);
CREATE INDEX IF NOT EXISTS idx_payments_created ON payments(created_at);

-- Composite indexes for common queries
CREATE INDEX IF NOT EXISTS idx_usage_logs_key_action_time ON usage_logs(key_id, action, timestamp);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_key_active ON auth_sessions(key_id, is_active, expires_at);

-- Partial indexes for better performance
CREATE INDEX IF NOT EXISTS idx_license_keys_activated ON license_keys(activated_at) WHERE activated_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payments_completed ON payments(completed_at) WHERE completed_at IS NOT NULL;

-- Functions and Triggers
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Add updated_at triggers
CREATE TRIGGER update_license_keys_updated_at BEFORE UPDATE ON license_keys 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_admin_settings_updated_at BEFORE UPDATE ON admin_settings 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Auto-update last_activity on auth_sessions
CREATE OR REPLACE FUNCTION update_last_activity()
RETURNS TRIGGER AS $$
BEGIN
    NEW.last_activity = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_auth_sessions_activity BEFORE UPDATE ON auth_sessions 
    FOR EACH ROW EXECUTE FUNCTION update_last_activity();

-- Insert initial admin settings
INSERT INTO admin_settings (setting_key, setting_value, data_type, description) VALUES 
    ('app_version', '1.0.0', 'string', 'Application version'),
    ('key_price_eur', '9.99', 'decimal', 'Price for single license key in EUR'),
    ('bundle_5_price_eur', '39.99', 'decimal', 'Price for 5-key bundle in EUR'),
    ('bundle_10_price_eur', '69.99', 'decimal', 'Price for 10-key bundle in EUR'),
    ('max_sessions_per_key', '1', 'integer', 'Maximum active sessions per license key'),
    ('session_duration_days', '30', 'integer', 'Session duration in days'),
    ('rate_limit_requests', '100', 'integer', 'Rate limit requests per window'),
    ('rate_limit_window_minutes', '15', 'integer', 'Rate limit window in minutes'),
    ('backup_retention_days', '30', 'integer', 'Backup retention period in days'),
    ('maintenance_mode', 'false', 'boolean', 'Enable maintenance mode')
ON CONFLICT (setting_key) DO NOTHING;

COMMIT;

-- database/migrations/002_security_enhancements.sql
-- Migration 2: Add security enhancements and audit trails

BEGIN;

-- Security Audit Log Table
CREATE TABLE IF NOT EXISTS security_events (
    id SERIAL PRIMARY KEY,
    event_type VARCHAR(50) NOT NULL,
    severity VARCHAR(20) DEFAULT 'info',
    ip_address INET NOT NULL,
    user_agent TEXT NULL,
    key_id INTEGER REFERENCES license_keys(id) ON DELETE SET NULL,
    session_id INTEGER REFERENCES auth_sessions(id) ON DELETE SET NULL,
    event_details JSONB NULL,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    resolved BOOLEAN DEFAULT FALSE,
    resolved_at TIMESTAMP WITH TIME ZONE NULL,
    resolved_by VARCHAR(100) NULL
);

-- Failed Login Attempts Table
CREATE TABLE IF NOT EXISTS failed_login_attempts (
    id SERIAL PRIMARY KEY,
    ip_address INET NOT NULL,
    attempted_key VARCHAR(17) NULL,
    user_agent TEXT NULL,
    failure_reason VARCHAR(100) NOT NULL,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    blocked_until TIMESTAMP WITH TIME ZONE NULL
);

-- Rate Limiting Table
CREATE TABLE IF NOT EXISTS rate_limits (
    id SERIAL PRIMARY KEY,
    identifier VARCHAR(255) NOT NULL, -- IP, user ID, etc.
    endpoint VARCHAR(100) NOT NULL,
    request_count INTEGER DEFAULT 1,
    window_start TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    blocked_until TIMESTAMP WITH TIME ZONE NULL
);

-- Add security indexes
CREATE INDEX IF NOT EXISTS idx_security_events_type ON security_events(event_type, timestamp);
CREATE INDEX IF NOT EXISTS idx_security_events_ip ON security_events(ip_address, timestamp);
CREATE INDEX IF NOT EXISTS idx_security_events_severity ON security_events(severity) WHERE severity IN ('warning', 'critical');

CREATE INDEX IF NOT EXISTS idx_failed_logins_ip ON failed_login_attempts(ip_address, timestamp);
CREATE INDEX IF NOT EXISTS idx_failed_logins_blocked ON failed_login_attempts(blocked_until) WHERE blocked_until IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_rate_limits_identifier ON rate_limits(identifier, endpoint, window_start);

-- Add columns to existing tables for enhanced security
ALTER TABLE license_keys ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMP WITH TIME ZONE NULL;
ALTER TABLE license_keys ADD COLUMN IF NOT EXISTS last_used_ip INET NULL;
ALTER TABLE license_keys ADD COLUMN IF NOT EXISTS security_flags JSONB NULL;

ALTER TABLE auth_sessions ADD COLUMN IF NOT EXISTS security_score INTEGER DEFAULT 100;
ALTER TABLE auth_sessions ADD COLUMN IF NOT EXISTS geo_location VARCHAR(100) NULL;

-- Security functions
CREATE OR REPLACE FUNCTION log_security_event(
    p_event_type VARCHAR(50),
    p_severity VARCHAR(20),
    p_ip_address INET,
    p_user_agent TEXT DEFAULT NULL,
    p_key_id INTEGER DEFAULT NULL,
    p_session_id INTEGER DEFAULT NULL,
    p_event_details JSONB DEFAULT NULL
) RETURNS INTEGER AS $$
DECLARE
    event_id INTEGER;
BEGIN
    INSERT INTO security_events (
        event_type, severity, ip_address, user_agent, 
        key_id, session_id, event_details
    ) VALUES (
        p_event_type, p_severity, p_ip_address, p_user_agent,
        p_key_id, p_session_id, p_event_details
    ) RETURNING id INTO event_id;
    
    RETURN event_id;
END;
$$ LANGUAGE plpgsql;

-- Function to check rate limits
CREATE OR REPLACE FUNCTION check_rate_limit(
    p_identifier VARCHAR(255),
    p_endpoint VARCHAR(100),
    p_max_requests INTEGER DEFAULT 100,
    p_window_minutes INTEGER DEFAULT 15
) RETURNS BOOLEAN AS $$
DECLARE
    current_count INTEGER;
    window_start TIMESTAMP WITH TIME ZONE;
BEGIN
    window_start := CURRENT_TIMESTAMP - INTERVAL '1 minute' * p_window_minutes;
    
    -- Clean old entries
    DELETE FROM rate_limits 
    WHERE identifier = p_identifier 
    AND endpoint = p_endpoint 
    AND window_start < window_start;
    
    -- Get current count
    SELECT COALESCE(SUM(request_count), 0) INTO current_count
    FROM rate_limits 
    WHERE identifier = p_identifier 
    AND endpoint = p_endpoint 
    AND window_start >= window_start;
    
    -- Check if rate limit exceeded
    IF current_count >= p_max_requests THEN
        RETURN FALSE;
    END IF;
    
    -- Increment counter
    INSERT INTO rate_limits (identifier, endpoint, request_count, window_start)
    VALUES (p_identifier, p_endpoint, 1, CURRENT_TIMESTAMP)
    ON CONFLICT (identifier, endpoint) 
    DO UPDATE SET 
        request_count = rate_limits.request_count + 1,
        window_start = CASE 
            WHEN rate_limits.window_start < window_start 
            THEN CURRENT_TIMESTAMP 
            ELSE rate_limits.window_start 
        END;
    
    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- Add unique constraint for rate limiting
CREATE UNIQUE INDEX IF NOT EXISTS idx_rate_limits_unique 
ON rate_limits(identifier, endpoint);

COMMIT;

-- database/migration.js - Migration Runner
const { Pool } = require('pg');
const fs = require('fs').promises;
const path = require('path');

class MigrationRunner {
    constructor(databaseUrl) {
        this.pool = new Pool({
            connectionString: databaseUrl,
            max: 5,
            idleTimeoutMillis: 30000,
            connectionTimeoutMillis: 10000
        });
        
        this.migrationsPath = path.join(__dirname, 'migrations');
    }
    
    async initialize() {
        // Create migrations table if it doesn't exist
        await this.pool.query(`
            CREATE TABLE IF NOT EXISTS schema_migrations (
                id SERIAL PRIMARY KEY,
                version VARCHAR(50) UNIQUE NOT NULL,
                name VARCHAR(255) NOT NULL,
                executed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                execution_time_ms INTEGER,
                checksum VARCHAR(64)
            )
        `);
        
        console.log('📊 Migration system initialized');
    }
    
    async getExecutedMigrations() {
        const result = await this.pool.query(
            'SELECT version FROM schema_migrations ORDER BY version'
        );
        return result.rows.map(row => row.version);
    }
    
    async getAvailableMigrations() {
        const files = await fs.readdir(this.migrationsPath);
        return files
            .filter(file => file.endsWith('.sql'))
            .map(file => {
                const match = file.match(/^(\d+)_(.+)\.sql$/);
                if (!match) {
                    throw new Error(`Invalid migration filename: ${file}`);
                }
                return {
                    version: match[1],
                    name: match[2],
                    filename: file
                };
            })
            .sort((a, b) => a.version.localeCompare(b.version));
    }
    
    async calculateChecksum(content) {
        const crypto = require('crypto');
        return crypto.createHash('sha256').update(content).digest('hex');
    }
    
    async executeMigration(migration) {
        const filePath = path.join(this.migrationsPath, migration.filename);
        const content = await fs.readFile(filePath, 'utf8');
        const checksum = await this.calculateChecksum(content);
        
        console.log(`⚡ Executing migration: ${migration.version}_${migration.name}`);
        
        const client = await this.pool.connect();
        const startTime = Date.now();
        
        try {
            await client.query('BEGIN');
            
            // Execute migration SQL
            await client.query(content);
            
            // Record migration
            const executionTime = Date.now() - startTime;
            await client.query(
                `INSERT INTO schema_migrations (version, name, execution_time_ms, checksum) 
                 VALUES ($1, $2, $3, $4)`,
                [migration.version, migration.name, executionTime, checksum]
            );
            
            await client.query('COMMIT');
            
            console.log(`✅ Migration ${migration.version} completed in ${executionTime}ms`);
            
        } catch (error) {
            await client.query('ROLLBACK');
            console.error(`❌ Migration ${migration.version} failed:`, error.message);
            throw error;
        } finally {
            client.release();
        }
    }
    
    async migrate() {
        await this.initialize();
        
        const executed = await this.getExecutedMigrations();
        const available = await this.getAvailableMigrations();
        
        const pending = available.filter(
            migration => !executed.includes(migration.version)
        );
        
        if (pending.length === 0) {
            console.log('✅ No pending migrations');
            return;
        }
        
        console.log(`📋 Found ${pending.length} pending migrations`);
        
        for (const migration of pending) {
            await this.executeMigration(migration);
        }
        
        console.log('🎉 All migrations completed successfully');
    }
    
    async rollback(targetVersion = null) {
        const executed = await this.getExecutedMigrations();
        
        if (executed.length === 0) {
            console.log('No migrations to rollback');
            return;
        }
        
        let migrationsToRollback;
        if (targetVersion) {
            const index = executed.findIndex(v => v === targetVersion);
            if (index === -1) {
                throw new Error(`Target version ${targetVersion} not found`);
            }
            migrationsToRollback = executed.slice(index + 1);
        } else {
            migrationsToRollback = [executed[executed.length - 1]];
        }
        
        console.log(`🔄 Rolling back ${migrationsToRollback.length} migrations`);
        
        for (const version of migrationsToRollback.reverse()) {
            await this.rollbackMigration(version);
        }
    }
    
    async rollbackMigration(version) {
        console.log(`🔄 Rolling back migration: ${version}`);
        
        // Check if rollback file exists
        const rollbackFile = path.join(this.migrationsPath, `${version}_rollback.sql`);
        
        try {
            const content = await fs.readFile(rollbackFile, 'utf8');
            
            const client = await this.pool.connect();
            try {
                await client.query('BEGIN');
                await client.query(content);
                await client.query(
                    'DELETE FROM schema_migrations WHERE version = $1',
                    [version]
                );
                await client.query('COMMIT');
                
                console.log(`✅ Rollback of ${version} completed`);
            } catch (error) {
                await client.query('ROLLBACK');
                throw error;
            } finally {
                client.release();
            }
        } catch (error) {
            if (error.code === 'ENOENT') {
                console.warn(`⚠️ No rollback file found for ${version}`);
            } else {
                throw error;
            }
        }
    }
    
    async status() {
        await this.initialize();
        
        const executed = await this.getExecutedMigrations();
        const available = await this.getAvailableMigrations();
        
        console.log('\n📊 Migration Status');
        console.log('==================');
        
        for (const migration of available) {
            const isExecuted = executed.includes(migration.version);
            const status = isExecuted ? '✅ Applied' : '⏳ Pending';
            console.log(`${migration.version}_${migration.name}: ${status}`);
        }
        
        const pending = available.filter(
            migration => !executed.includes(migration.version)
        );
        
        console.log(`\n📋 Summary: ${executed.length} applied, ${pending.length} pending`);
    }
    
    async close() {
        await this.pool.end();
    }
}

// database/seeder.js - Database Seeder
class DatabaseSeeder {
    constructor(databaseUrl) {
        this.pool = new Pool({ connectionString: databaseUrl });
    }
    
    async seed() {
        console.log('🌱 Starting database seeding...');
        
        await this.seedLicenseKeys();
        await this.seedAdminSettings();
        await this.seedTestData();
        
        console.log('✅ Database seeding completed');
    }
    
    async seedLicenseKeys() {
        const crypto = require('crypto');
        const bcrypt = require('bcrypt');
        
        // Generate demo license keys
        const demoKeys = [
            'SM001-ALPHA-BETA1',
            'SM002-GAMMA-DELT2',
            'SM003-ECHO-FOXTR3',
            'SM004-HOTEL-INDI4',
            'SM005-JULIET-KILO5'
        ];
        
        for (const keyCode of demoKeys) {
            const keyHash = await bcrypt.hash(keyCode, 10);
            
            await this.pool.query(`
                INSERT INTO license_keys (key_code, key_hash, created_by)
                VALUES ($1, $2, 'seeder')
                ON CONFLICT (key_code) DO NOTHING
            `, [keyCode, keyHash]);
        }
        
        // Generate random keys
        for (let i = 0; i < 50; i++) {
            const keyCode = this.generateRandomKey();
            const keyHash = await bcrypt.hash(keyCode, 10);
            
            await this.pool.query(`
                INSERT INTO license_keys (key_code, key_hash, created_by)
                VALUES ($1, $2, 'seeder')
                ON CONFLICT (key_code) DO NOTHING
            `, [keyCode, keyHash]);
        }
        
        console.log('🔑 License keys seeded');
    }
    
    generateRandomKey() {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        const parts = [];
        
        for (let i = 0; i < 3; i++) {
            let part = '';
            for (let j = 0; j < 5; j++) {
                part += chars.charAt(Math.floor(Math.random() * chars.length));
            }
            parts.push(part);
        }
        
        return parts.join('-');
    }
    
    async seedAdminSettings() {
        const settings = [
            ['maintenance_window_start', '02:00', 'string', 'Daily maintenance window start time'],
            ['maintenance_window_end', '04:00', 'string', 'Daily maintenance window end time'],
            ['email_notifications_enabled', 'true', 'boolean', 'Enable email notifications'],
            ['slack_notifications_enabled', 'false', 'boolean', 'Enable Slack notifications'],
            ['auto_cleanup_sessions_days', '7', 'integer', 'Auto-cleanup inactive sessions after days'],
            ['max_failed_login_attempts', '5', 'integer', 'Maximum failed login attempts before blocking'],
            ['block_duration_minutes', '30', 'integer', 'IP block duration in minutes'],
            ['prometheus_metrics_enabled', 'true', 'boolean', 'Enable Prometheus metrics collection']
        ];
        
        for (const [key, value, dataType, description] of settings) {
            await this.pool.query(`
                INSERT INTO admin_settings (setting_key, setting_value, data_type, description)
                VALUES ($1, $2, $3, $4)
                ON CONFLICT (setting_key) DO NOTHING
            `, [key, value, dataType, description]);
        }
        
        console.log('⚙️ Admin settings seeded');
    }
    
    async seedTestData() {
        if (process.env.NODE_ENV === 'production') {
            console.log('⚠️ Skipping test data seeding in production');
            return;
        }
        
        // Create test usage logs
        const testKeyResult = await this.pool.query(
            'SELECT id FROM license_keys LIMIT 1'
        );
        
        if (testKeyResult.rows.length > 0) {
            const keyId = testKeyResult.rows[0].id;
            
            const actions = ['encrypt_message', 'decrypt_message', 'copy_to_clipboard', 'clear_all'];
            
            for (let i = 0; i < 100; i++) {
                const action = actions[Math.floor(Math.random() * actions.length)];
                const timestamp = new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000);
                
                await this.pool.query(`
                    INSERT INTO usage_logs (key_id, action, ip_address, timestamp, success)
                    VALUES ($1, $2, $3, $4, $5)
                `, [keyId, action, '127.0.0.1', timestamp, Math.random() > 0.1]);
            }
        }
        
        console.log('🧪 Test data seeded');
    }
    
    async close() {
        await this.pool.end();
    }
}

// CLI Interface
if (require.main === module) {
    const command = process.argv[2];
    const databaseUrl = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/secretmessages';
    
    async function main() {
        switch (command) {
            case 'migrate':
                const migrator = new MigrationRunner(databaseUrl);
                try {
                    await migrator.migrate();
                } finally {
                    await migrator.close();
                }
                break;
                
            case 'rollback':
                const rollbackMigrator = new MigrationRunner(databaseUrl);
                try {
                    const version = process.argv[3];
                    await rollbackMigrator.rollback(version);
                } finally {
                    await rollbackMigrator.close();
                }
                break;
                
            case 'status':
                const statusMigrator = new MigrationRunner(databaseUrl);
                try {
                    await statusMigrator.status();
                } finally {
                    await statusMigrator.close();
                }
                break;
                
            case 'seed':
                const seeder = new DatabaseSeeder(databaseUrl);
                try {
                    await seeder.seed();
                } finally {
                    await seeder.close();
                }
                break;
                
            default:
                console.log('Usage: node database/migration.js <command>');
                console.log('Commands:');
                console.log('  migrate  - Run pending migrations');
                console.log('  rollback [version] - Rollback migrations');
                console.log('  status   - Show migration status');
                console.log('  seed     - Seed database with initial data');
                process.exit(1);
        }
    }
    
    main().catch(error => {
        console.error('Migration failed:', error);
        process.exit(1);
    });
}

module.exports = { MigrationRunner, DatabaseSeeder };

// database/backup.js - Advanced Backup System
const { spawn } = require('child_process');
const { createGzip, createGunzip } = require('zlib');
const { createReadStream, createWriteStream } = require('fs');
const { pipeline } = require('stream');
const { promisify } = require('util');
const pipelineAsync = promisify(pipeline);

class BackupManager {
    constructor(config) {
        this.config = {
            databaseUrl: config.databaseUrl,
            backupDir: config.backupDir || './backups',
            s3Config: config.s3Config,
            retentionDays: config.retentionDays || 30,
            compressionLevel: config.compressionLevel || 6
        };
    }
    
    async createBackup(name = null) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupName = name || `backup-${timestamp}`;
        const filename = `${backupName}.sql`;
        const compressedFilename = `${filename}.gz`;
        
        console.log(`📦 Creating backup: ${backupName}`);
        
        try {
            // Create SQL dump
            await this.createSQLDump(filename);
            
            // Compress backup
            await this.compressFile(filename, compressedFilename);
            
            // Upload to S3 if configured
            if (this.config.s3Config) {
                await this.uploadToS3(compressedFilename);
            }
            
            // Cleanup local uncompressed file
            await this.deleteFile(filename);
            
            // Update backup metadata
            await this.updateBackupMetadata(backupName, compressedFilename);
            
            console.log(`✅ Backup created successfully: ${compressedFilename}`);
            return compressedFilename;
            
        } catch (error) {
            console.error(`❌ Backup failed: ${error.message}`);
            throw error;
        }
    }
    
    async createSQLDump(filename) {
        return new Promise((resolve, reject) => {
            const outputPath = `${this.config.backupDir}/${filename}`;
            const pgDump = spawn('pg_dump', [
                this.config.databaseUrl,
                '--no-password',
                '--verbose',
                '--clean',
                '--no-acl',
                '--no-owner',
                '--format=custom'
            ]);
            
            const writeStream = createWriteStream(outputPath);
            
            pgDump.stdout.pipe(writeStream);
            
            pgDump.stderr.on('data', (data) => {
                console.log(`pg_dump: ${data}`);
            });
            
            pgDump.on('close', (code) => {
                if (code === 0) {
                    resolve();
                } else {
                    reject(new Error(`pg_dump exited with code ${code}`));
                }
            });
            
            pgDump.on('error', reject);
        });
    }
    
    async compressFile(inputFile, outputFile) {
        const inputPath = `${this.config.backupDir}/${inputFile}`;
        const outputPath = `${this.config.backupDir}/${outputFile}`;
        
        const gzip = createGzip({ level: this.config.compressionLevel });
        
        await pipelineAsync(
            createReadStream(inputPath),
            gzip,
            createWriteStream(outputPath)
        );
    }
    
    async uploadToS3(filename) {
        const AWS = require('aws-sdk');
        const s3 = new AWS.S3(this.config.s3Config);
        
        const filePath = `${this.config.backupDir}/${filename}`;
        const fileStream = createReadStream(filePath);
        
        const uploadParams = {
            Bucket: this.config.s3Config.bucket,
            Key: `database-backups/${filename}`,
            Body: fileStream,
            StorageClass: 'STANDARD_IA'
        };
        
        await s3.upload(uploadParams).promise();
        console.log(`☁️ Backup uploaded to S3: ${filename}`);
    }
    
    async restoreBackup(backupFile) {
        console.log(`🔄 Restoring backup: ${backupFile}`);
        
        try {
            const filePath = `${this.config.backupDir}/${backupFile}`;
            
            // Decompress if needed
            let sqlFile = backupFile;
            if (backupFile.endsWith('.gz')) {
                sqlFile = backupFile.replace('.gz', '');
                await this.decompressFile(backupFile, sqlFile);
            }
            
            // Restore database
            await this.restoreFromSQL(sqlFile);
            
            // Cleanup decompressed file
            if (backupFile.endsWith('.gz')) {
                await this.deleteFile(sqlFile);
            }
            
            console.log(`✅ Backup restored successfully`);
            
        } catch (error) {
            console.error(`❌ Restore failed: ${error.message}`);
            throw error;
        }
    }
    
    async decompressFile(inputFile, outputFile) {
        const inputPath = `${this.config.backupDir}/${inputFile}`;
        const outputPath = `${this.config.backupDir}/${outputFile}`;
        
        const gunzip = createGunzip();
        
        await pipelineAsync(
            createReadStream(inputPath),
            gunzip,
            createWriteStream(outputPath)
        );
    }
    
    async restoreFromSQL(filename) {
        return new Promise((resolve, reject) => {
            const inputPath = `${this.config.backupDir}/${filename}`;
            const pgRestore = spawn('pg_restore', [
                '--no-password',
                '--verbose',
                '--clean',
                '--no-acl',
                '--no-owner',
                '--dbname', this.config.databaseUrl,
                inputPath
            ]);
            
            pgRestore.stderr.on('data', (data) => {
                console.log(`pg_restore: ${data}`);
            });
            
            pgRestore.on('close', (code) => {
                if (code === 0) {
                    resolve();
                } else {
                    reject(new Error(`pg_restore exited with code ${code}`));
                }
            });
            
            pgRestore.on('error', reject);
        });
    }
    
    async updateBackupMetadata(name, filename) {
        const fs = require('fs').promises;
        const metadataFile = `${this.config.backupDir}/backup-metadata.json`;
        
        let metadata = [];
        try {
            const content = await fs.readFile(metadataFile, 'utf8');
            metadata = JSON.parse(content);
        } catch (error) {
            // File doesn't exist yet
        }
        
        const stats = await fs.stat(`${this.config.backupDir}/${filename}`);
        
        metadata.push({
            name,
            filename,
            created: new Date().toISOString(),
            size: stats.size,
            compressed: filename.endsWith('.gz')
        });
        
        // Keep only recent backups in metadata
        metadata = metadata.slice(-100);
        
        await fs.writeFile(metadataFile, JSON.stringify(metadata, null, 2));
    }
    
    async cleanupOldBackups() {
        const fs = require('fs').promises;
        const cutoffDate = new Date(Date.now() - this.config.retentionDays * 24 * 60 * 60 * 1000);
        
        try {
            const files = await fs.readdir(this.config.backupDir);
            
            for (const file of files) {
                if (file.endsWith('.sql') || file.endsWith('.sql.gz')) {
                    const stats = await fs.stat(`${this.config.backupDir}/${file}`);
                    
                    if (stats.mtime < cutoffDate) {
                        await this.deleteFile(file);
                        console.log(`🗑️ Deleted old backup: ${file}`);
                    }
                }
            }
            
        } catch (error) {
            console.error('Cleanup failed:', error);
        }
    }
    
    async deleteFile(filename) {
        const fs = require('fs').promises;
        const filePath = `${this.config.backupDir}/${filename}`;
        
        try {
            await fs.unlink(filePath);
        } catch (error) {
            if (error.code !== 'ENOENT') {
                throw error;
            }
        }
    }
    
    async listBackups() {
        const fs = require('fs').promises;
        
        try {
            const files = await fs.readdir(this.config.backupDir);
            const backups = files
                .filter(file => file.endsWith('.sql') || file.endsWith('.sql.gz'))
                .map(file => ({
                    name: file,
                    path: `${this.config.backupDir}/${file}`
                }));
            
            return backups;
        } catch (error) {
            console.error('Failed to list backups:', error);
            return [];
        }
    }
}
