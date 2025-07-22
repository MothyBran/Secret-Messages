// scripts/setup.js - Initial setup script
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

console.log('🚀 Starting Secret Messages Backend Setup...\n');

// Create necessary directories
const dirs = ['logs', 'backups', 'public'];
dirs.forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        console.log(`✅ Created directory: ${dir}`);
    }
});

// Database setup
const db = new sqlite3.Database('./secret_messages.db');

console.log('\n📊 Setting up database tables...');

db.serialize(() => {
    // License Keys Table
    db.run(`CREATE TABLE IF NOT EXISTS license_keys (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key_code TEXT UNIQUE NOT NULL,
        key_hash TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        activated_at DATETIME NULL,
        activated_ip TEXT NULL,
        device_fingerprint TEXT NULL,
        is_active BOOLEAN DEFAULT 0,
        usage_count INTEGER DEFAULT 0,
        max_usage INTEGER DEFAULT 1,
        expires_at DATETIME NULL,
        metadata TEXT NULL
    )`, (err) => {
        if (err) console.error('Error creating license_keys table:', err);
        else console.log('✅ License keys table ready');
    });

    // Authentication Sessions Table
    db.run(`CREATE TABLE IF NOT EXISTS auth_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_token TEXT UNIQUE NOT NULL,
        key_id INTEGER NOT NULL,
        ip_address TEXT NOT NULL,
        device_fingerprint TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_activity DATETIME DEFAULT CURRENT_TIMESTAMP,
        expires_at DATETIME NOT NULL,
        is_active BOOLEAN DEFAULT 1,
        FOREIGN KEY (key_id) REFERENCES license_keys (id)
    )`, (err) => {
        if (err) console.error('Error creating auth_sessions table:', err);
        else console.log('✅ Auth sessions table ready');
    });

    // Usage Logs Table
    db.run(`CREATE TABLE IF NOT EXISTS usage_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key_id INTEGER NOT NULL,
        session_id INTEGER NOT NULL,
        action TEXT NOT NULL,
        ip_address TEXT NOT NULL,
        user_agent TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        metadata TEXT NULL,
        FOREIGN KEY (key_id) REFERENCES license_keys (id),
        FOREIGN KEY (session_id) REFERENCES auth_sessions (id)
    )`, (err) => {
        if (err) console.error('Error creating usage_logs table:', err);
        else console.log('✅ Usage logs table ready');
    });

    // Payment Records Table
    db.run(`CREATE TABLE IF NOT EXISTS payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        payment_id TEXT UNIQUE NOT NULL,
        key_id INTEGER NOT NULL,
        amount DECIMAL(10,2) NOT NULL,
        currency TEXT DEFAULT 'EUR',
        status TEXT NOT NULL,
        payment_method TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        completed_at DATETIME NULL,
        metadata TEXT NULL,
        FOREIGN KEY (key_id) REFERENCES license_keys (id)
    )`, (err) => {
        if (err) console.error('Error creating payments table:', err);
        else console.log('✅ Payments table ready');
    });

    // Admin Settings Table
    db.run(`CREATE TABLE IF NOT EXISTS admin_settings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        setting_key TEXT UNIQUE NOT NULL,
        setting_value TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`, (err) => {
        if (err) console.error('Error creating admin_settings table:', err);
        else console.log('✅ Admin settings table ready');
    });
});

// Generate initial demo keys
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

console.log('\n🔑 Generating initial demo keys...');

const demoKeys = [
    'SM001-ALPHA-BETA1',
    'SM002-GAMMA-DELT2', 
    'SM003-ECHO-FOXTR3',
    'SM004-HOTEL-INDI4',
    'SM005-JULIET-KILO5'
];

setTimeout(() => {
    demoKeys.forEach((keyCode, index) => {
        const keyHash = hashKey(keyCode);
        
        db.run(
            `INSERT OR IGNORE INTO license_keys (key_code, key_hash) VALUES (?, ?)`,
            [keyCode, keyHash],
            function(err) {
                if (err) {
                    console.error(`❌ Error creating demo key ${keyCode}:`, err);
                } else if (this.changes > 0) {
                    console.log(`✅ Demo key created: ${keyCode}`);
                } else {
                    console.log(`ℹ️  Demo key already exists: ${keyCode}`);
                }
                
                if (index === demoKeys.length - 1) {
                    // Generate additional random keys
                    console.log('\n🎲 Generating additional random keys...');
                    
                    for (let i = 0; i < 10; i++) {
                        const randomKey = generateLicenseKey();
                        const randomHash = hashKey(randomKey);
                        
                        db.run(
                            `INSERT INTO license_keys (key_code, key_hash) VALUES (?, ?)`,
                            [randomKey, randomHash],
                            function(err) {
                                if (err) {
                                    console.error(`❌ Error creating random key:`, err);
                                } else {
                                    console.log(`✅ Random key created: ${randomKey}`);
                                }
                                
                                if (i === 9) {
                                    finishSetup();
                                }
                            }
                        );
                    }
                }
            }
        );
    });
}, 1000);

function finishSetup() {
    // Insert default admin settings
    const defaultSettings = [
        ['app_version', '1.0.0'],
        ['setup_completed', 'true'],
        ['setup_date', new Date().toISOString()],
        ['key_price_eur', '9.99'],
        ['max_sessions_per_key', '1'],
        ['session_duration_days', '30']
    ];

    defaultSettings.forEach(([key, value]) => {
        db.run(
            `INSERT OR IGNORE INTO admin_settings (setting_key, setting_value) VALUES (?, ?)`,
            [key, value],
            (err) => {
                if (err) console.error(`Error setting ${key}:`, err);
            }
        );
    });

    console.log('\n📄 Creating admin panel HTML...');
    createAdminPanel();

    setTimeout(() => {
        console.log('\n✅ Setup completed successfully!');
        console.log('\n📋 Summary:');
        console.log('   • Database tables created');
        console.log('   • Demo keys generated');
        console.log('   • Random keys generated');
        console.log('   • Admin panel created');
        console.log('\n🚀 You can now start the server with: npm start');
        console.log('🔧 Admin Panel: http://localhost:3000/admin');
        console.log('🔑 Demo Keys: SM001-ALPHA-BETA1, SM002-GAMMA-DELT2, etc.');
        
        db.close((err) => {
            if (err) console.error('Error closing database:', err);
            process.exit(0);
        });
    }, 2000);
}

function createAdminPanel() {
    const adminHTML = `<!DOCTYPE html>
<html lang="de">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Secret Messages - Admin Panel</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: 'Courier New', monospace;
            background: linear-gradient(135deg, #0d0d0d 0%, #1a1a1a 50%, #0d0d0d 100%);
            color: #00ff41;
            min-height: 100vh;
            padding: 20px;
        }
        .container { max-width: 1200px; margin: 0 auto; }
        .header { text-align: center; margin-bottom: 40px; }
        .title { font-size: 2.5rem; text-shadow: 0 0 20px #00ff41; margin-bottom: 10px; }
        .card {
            background: rgba(0, 0, 0, 0.8);
            border: 1px solid #00ff41;
            border-radius: 8px;
            padding: 20px;
            margin-bottom: 20px;
        }
        .btn {
            background: linear-gradient(45deg, #003300, #006600);
            border: 1px solid #00ff41;
            color: #00ff41;
            padding: 10px 20px;
            border-radius: 4px;
            cursor: pointer;
            font-family: 'Courier New', monospace;
            margin: 5px;
        }
        .btn:hover { background: linear-gradient(45deg, #004400, #008800); }
        input, textarea {
            background: rgba(0, 0, 0, 0.8);
            border: 1px solid #00ff41;
            color: #00ff41;
            padding: 10px;
            border-radius: 4px;
            font-family: 'Courier New', monospace;
            margin: 5px;
        }
        .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 20px; }
        .stat { text-align: center; padding: 20px; }
        .stat-number { font-size: 2rem; color: #00ff41; }
        .stat-label { color: #00cc33; }
        table { width: 100%; border-collapse: collapse; }
        th, td { padding: 10px; border: 1px solid #333; text-align: left; }
        th { background: rgba(0, 255, 65, 0.1); }
        .status-active { color: #00ff41; }
        .status-inactive { color: #ff4444; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1 class="title">ADMIN PANEL</h1>
            <p>Secret Messages Management System</p>
        </div>

        <div class="grid">
            <div class="card">
                <h3>📊 Statistiken</h3>
                <div id="stats">
                    <div class="stat">
                        <div class="stat-number" id="totalKeys">-</div>
                        <div class="stat-label">Gesamt Keys</div>
                    </div>
                    <div class="stat">
                        <div class="stat-number" id="activeKeys">-</div>
                        <div class="stat-label">Aktive Keys</div>
                    </div>
                    <div class="stat">
                        <div class="stat-number" id="activeSessions">-</div>
                        <div class="stat-label">Aktive Sessions</div>
                    </div>
                </div>
                <button class="btn" onclick="loadStats()">Aktualisieren</button>
            </div>

            <div class="card">
                <h3>🔑 Keys Generieren</h3>
                <input type="number" id="keyQuantity" placeholder="Anzahl Keys" value="1" min="1" max="100">
                <input type="number" id="keyExpiry" placeholder="Gültigkeitsdauer (Tage)" value="">
                <input type="password" id="adminPassword" placeholder="Admin Passwort">
                <button class="btn" onclick="generateKeys()">Keys Generieren</button>
                <div id="generatedKeys"></div>
            </div>
        </div>

        <div class="card">
            <h3>📋 Key Management</h3>
            <input type="password" id="listAdminPassword" placeholder="Admin Passwort">
            <button class="btn" onclick="loadKeys()">Keys Laden</button>
            <div id="keysTable"></div>
        </div>
    </div>

    <script>
        const API_BASE = '/api';

        async function loadStats() {
            try {
                const password = prompt('Admin Passwort:');
                const response = await fetch(API_BASE + '/admin/stats', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ password })
                });
                
                const data = await response.json();
                if (data.success) {
                    document.getElementById('totalKeys').textContent = data.stats.totalKeys;
                    document.getElementById('activeKeys').textContent = data.stats.activeKeys;
                    document.getElementById('activeSessions').textContent = data.stats.activeSessions;
                } else {
                    alert('Fehler: ' + data.error);
                }
            } catch (error) {
                alert('Fehler beim Laden der Statistiken: ' + error.message);
            }
        }

        async function generateKeys() {
            const quantity = document.getElementById('keyQuantity').value;
            const expiry = document.getElementById('keyExpiry').value;
            const password = document.getElementById('adminPassword').value;

            if (!password) {
                alert('Admin Passwort erforderlich');
                return;
            }

            try {
                const response = await fetch(API_BASE + '/admin/generate-key', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        password, 
                        quantity: parseInt(quantity),
                        expiresIn: expiry ? parseInt(expiry) : null
                    })
                });
                
                const data = await response.json();
                if (data.success) {
                    let html = '<h4>Generierte Keys:</h4>';
                    data.keys.forEach(key => {
                        html += '<div style="margin: 5px 0; padding: 10px; background: rgba(0,255,65,0.1); border-radius: 4px;">';
                        html += '<strong>' + key.key + '</strong>';
                        if (key.expires_at) html += ' (Gültig bis: ' + new Date(key.expires_at).toLocaleDateString() + ')';
                        html += '</div>';
                    });
                    document.getElementById('generatedKeys').innerHTML = html;
                    document.getElementById('adminPassword').value = '';
                } else {
                    alert('Fehler: ' + data.error);
                }
            } catch (error) {
                alert('Fehler beim Generieren der Keys: ' + error.message);
            }
        }

        async function loadKeys() {
            const password = document.getElementById('listAdminPassword').value;

            if (!password) {
                alert('Admin Passwort erforderlich');
                return;
            }

            try {
                const response = await fetch(API_BASE + '/admin/keys', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ password, page: 1, limit: 50 })
                });
                
                const data = await response.json();
                if (data.success) {
                    let html = '<table><thead><tr><th>Key</th><th>Status</th><th>Erstellt</th><th>Aktiviert</th><th>IP</th><th>Nutzung</th></tr></thead><tbody>';
                    data.keys.forEach(key => {
                        html += '<tr>';
                        html += '<td><code>' + key.key_code + '</code></td>';
                        html += '<td class="' + (key.is_active ? 'status-active">Aktiv' : 'status-inactive">Inaktiv') + '</td>';
                        html += '<td>' + new Date(key.created_at).toLocaleDateString() + '</td>';
                        html += '<td>' + (key.activated_at ? new Date(key.activated_at).toLocaleDateString() : '-') + '</td>';
                        html += '<td>' + (key.activated_ip || '-') + '</td>';
                        html += '<td>' + key.usage_count + '</td>';
                        html += '</tr>';
                    });
                    html += '</tbody></table>';
                    document.getElementById('keysTable').innerHTML = html;
                    document.getElementById('listAdminPassword').value = '';
                } else {
                    alert('Fehler: ' + data.error);
                }
            } catch (error) {
                alert('Fehler beim Laden der Keys: ' + error.message);
            }
        }

        // Load stats on page load
        window.addEventListener('load', () => {
            // Auto-load stats if this is initial setup
            setTimeout(loadStats, 1000);
        });
    </script>
</body>
</html>`;

    fs.writeFileSync('./public/admin.html', adminHTML);
    console.log('✅ Admin panel created at: ./public/admin.html');
}
