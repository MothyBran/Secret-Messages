-- Fix Schema Migration für Mobile Deployment
-- Behebt License Key Probleme ohne Kommandozeile

-- 1. Fehlende device_fingerprint Spalte hinzufügen
ALTER TABLE license_keys 
ADD COLUMN IF NOT EXISTS device_fingerprint VARCHAR(255);

-- 2. Auth Sessions Tabelle erstellen (falls nicht vorhanden)
CREATE TABLE IF NOT EXISTS auth_sessions (
    id SERIAL PRIMARY KEY,
    session_token VARCHAR(500) UNIQUE NOT NULL,
    key_id INTEGER REFERENCES license_keys(id),
    ip_address VARCHAR(45) NOT NULL,
    device_fingerprint VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP NOT NULL,
    is_active BOOLEAN DEFAULT true,
    last_activity TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 3. Performance-Indizes erstellen
CREATE INDEX IF NOT EXISTS idx_license_keys_code ON license_keys(key_code);
CREATE INDEX IF NOT EXISTS idx_license_keys_active ON license_keys(is_active);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_token ON auth_sessions(session_token);

-- 4. Demo-Keys einfügen (sichere Hashes)
INSERT INTO license_keys (key_code, key_hash, created_by, is_active) VALUES 
('SM001-ALPHA-BETA1', '$2b$10$vI.n8gO7mK5rN3qP4sT6u.xY7zA8bC9dE0fG1hI2jK3lM4nO5pQ6r', 'mobile-fix', false),
('SM002-GAMMA-DELT2', '$2b$10$wJ.o9hP8nL6sO4rQ5tU7v.yZ8aB9cD0eF1gH2iJ3kL4mN5oP6qR7s', 'mobile-fix', false),
('SM003-ECHO-FOXTR3', '$2b$10$xK.p0iQ9oM7tP5sR6uV8w.zA9bC0dE1fG2hI3jK4lM5nO6pQ7rS8t', 'mobile-fix', false)
ON CONFLICT (key_code) DO NOTHING;

-- 5. System-Status aktualisieren  
INSERT INTO system_settings (key_name, key_value, description) VALUES 
('schema_fix_applied', NOW()::text, 'Mobile schema fix completed'),
('app_status', 'ready', 'Application ready for use')
ON CONFLICT (key_name) DO UPDATE SET 
key_value = EXCLUDED.key_value;
