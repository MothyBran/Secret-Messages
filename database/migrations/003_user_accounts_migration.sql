-- Migration: Benutzer-basierte Authentifizierung
-- Ändert das System von Gerätebindung zu Benutzerbindung

BEGIN;

-- 1. Erweitere license_keys Tabelle um Benutzer-Informationen
ALTER TABLE license_keys 
ADD COLUMN IF NOT EXISTS username VARCHAR(50) UNIQUE,
ADD COLUMN IF NOT EXISTS access_code_hash VARCHAR(255),
ADD COLUMN IF NOT EXISTS user_created_at TIMESTAMP WITH TIME ZONE;

-- Entferne Gerätebindungs-Spalten (optional, später)
-- ALTER TABLE license_keys DROP COLUMN IF EXISTS device_fingerprint;
-- ALTER TABLE license_keys DROP COLUMN IF EXISTS activated_ip;

-- 2. Erstelle users Tabelle für bessere Struktur (optional für Zukunft)
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    access_code_hash VARCHAR(255) NOT NULL,
    license_key_id INTEGER UNIQUE REFERENCES license_keys(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    last_login TIMESTAMP WITH TIME ZONE,
    login_count INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE
);

-- 3. Erstelle user_sessions Tabelle (ersetze auth_sessions)
CREATE TABLE IF NOT EXISTS user_sessions (
    id SERIAL PRIMARY KEY,
    session_token VARCHAR(500) UNIQUE NOT NULL,
    username VARCHAR(50) NOT NULL,
    license_key_id INTEGER REFERENCES license_keys(id) ON DELETE CASCADE,
    ip_address INET NOT NULL,
    user_agent TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    last_activity TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    is_active BOOLEAN DEFAULT TRUE
);

-- 4. Account-Löschungs-Log
CREATE TABLE IF NOT EXISTS account_deletions (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) NOT NULL,
    license_key_code VARCHAR(17) NOT NULL,
    deleted_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    deletion_ip INET,
    reason VARCHAR(255) DEFAULT 'user_requested'
);

-- 5. Indices für Performance
CREATE INDEX IF NOT EXISTS idx_license_keys_username ON license_keys(username);
CREATE INDEX IF NOT EXISTS idx_user_sessions_username ON user_sessions(username);
CREATE INDEX IF NOT EXISTS idx_user_sessions_token ON user_sessions(session_token);

-- 6. Update system_settings
INSERT INTO system_settings (setting_key, setting_value, value_type, description) VALUES 
    ('auth_mode', 'user_based', 'string', 'Authentication mode: user_based or device_based'),
    ('access_code_length', '5', 'integer', 'Length of user access code'),
    ('allow_account_deletion', 'true', 'boolean', 'Allow users to delete their accounts')
ON CONFLICT (setting_key) DO UPDATE SET 
    setting_value = EXCLUDED.setting_value,
    updated_at = CURRENT_TIMESTAMP;

COMMIT;
