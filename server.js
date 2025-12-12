// server.js - Secret Messages Backend (Full Version)
// Enthält Auth, Payment Integration und das neue Admin Dashboard

const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
require('dotenv').config();

// Payment Routes importieren
const paymentRoutes = require('./payment.js');

const app = express();
app.set('trust proxy', 1);

// ==================================================================
// 1. MIDDLEWARE
// ==================================================================

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      scriptSrc: ["'self'", "https://js.stripe.com"],
      scriptSrcElem: ["'self'", "https://js.stripe.com"],
      frameSrc: ["'self'", "https://js.stripe.com"],
      connectSrc: ["'self'", "https://api.stripe.com", "https://js.stripe.com"],
      imgSrc: ["'self'", "data:", "https:"]
    }
  }
}));

app.use(cors());

// ==================================================================
// RATE LIMITER DEFINITION (Fehlte vorher)
// ==================================================================
const rateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 Minuten
    max: 100, // Maximal 100 Anfragen pro IP
    message: { error: "Zu viele Anfragen, bitte versuchen Sie es später erneut." }
});

// Raw Body für Stripe Webhooks, JSON für alles andere
app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));

app.use(express.static('public'));

// Logging Middleware
app.use((req, res, next) => {
    // console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
});

// Environment Variables
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'change_this_secret';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const DATABASE_URL = process.env.DATABASE_URL;

// ==================================================================
// 2. DATABASE SETUP (PostgreSQL + SQLite Fallback)
// ==================================================================

let db, isPostgreSQL = false;
let dbQuery; // Wrapper für einheitliche Abfragen

const initializeDatabase = async () => {
    console.log('🔧 Initializing Database...');
    
    if (DATABASE_URL && DATABASE_URL.includes('postgresql')) {
        console.log('📡 PostgreSQL detected');
        isPostgreSQL = true;
        const { Pool } = require('pg');
        db = new Pool({
            connectionString: DATABASE_URL,
            ssl: { rejectUnauthorized: false }
        });
        
        // Postgres Wrapper
        dbQuery = async (text, params) => await db.query(text, params);
        
        await createTables();
    } else {
        console.log('📁 Using SQLite (local)');
        const sqlite3 = require('sqlite3').verbose();
        db = new sqlite3.Database('./secret_messages.db');
        
        // SQLite Wrapper (Promise-based)
        dbQuery = (text, params = []) => {
            return new Promise((resolve, reject) => {
                // SQLite nutzt ? statt $1, $2
                // Einfacher Regex-Replace für Kompatibilität (Vorsicht bei Strings!)
                const sql = text.replace(/\$\d+/g, '?');
                
                if (text.trim().toUpperCase().startsWith('SELECT')) {
                    db.all(sql, params, (err, rows) => {
                        if (err) reject(err);
                        else resolve({ rows: rows, rowCount: rows.length });
                    });
                } else {
                    db.run(sql, params, function(err) {
                        if (err) reject(err);
                        else resolve({ rows: [], rowCount: this.changes, lastID: this.lastID });
                    });
                }
            });
        };
        
        createTables();
    }
};

const createTables = async () => {
    try {
        // Users
        await dbQuery(`CREATE TABLE IF NOT EXISTS users (
            id ${isPostgreSQL ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT'},
            username VARCHAR(50) UNIQUE,
            access_code_hash TEXT,
            license_key_id INTEGER,
            allowed_device_id TEXT,  -- <--- NEUE SPALTE FÜR GERÄTE-ID
            registered_at ${isPostgreSQL ? 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP' : 'DATETIME DEFAULT CURRENT_TIMESTAMP'},
            last_login ${isPostgreSQL ? 'TIMESTAMP' : 'DATETIME'},
            is_blocked ${isPostgreSQL ? 'BOOLEAN DEFAULT FALSE' : 'INTEGER DEFAULT 0'},
            is_online ${isPostgreSQL ? 'BOOLEAN DEFAULT FALSE' : 'INTEGER DEFAULT 0'}
        )`);

        // License Keys
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
            activated_ip VARCHAR(50) 
        )`);

        // Payments (WICHTIG für Admin Panel)
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

        // Purchases (Alte Tabelle, behalten wir für Kompatibilität)
        await dbQuery(`CREATE TABLE IF NOT EXISTS purchases (
            id ${isPostgreSQL ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT'},
            buyer VARCHAR(100),
            license VARCHAR(50),
            price REAL,
            date ${isPostgreSQL ? 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP' : 'DATETIME DEFAULT CURRENT_TIMESTAMP'}
        )`);

        console.log('✅ Tables checked/created');
    } catch (e) {
        console.error("Table creation error:", e);
    }
};

initializeDatabase();

// ==================================================================
// 3. AUTHENTICATION & APP ROUTES
// ==================================================================

// Middleware: Token Check (FIXED: Jetzt asynchron und prüft Sperr-Status)
async function authenticateUser(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Kein Token' });

    jwt.verify(token, JWT_SECRET, async (err, user) => { // Beachten Sie das async hier
        if (err) return res.status(403).json({ error: 'Token ungültig' });
        
        try {
            // Holt den aktuellen is_blocked Status
            const userResult = await dbQuery("SELECT is_blocked FROM users WHERE id = $1", [user.id]);
            const dbUser = userResult.rows[0];

            // *******************************************************
            // PRÜFUNG: Wenn User nicht existiert ODER gesperrt ist
            // *******************************************************
            if (!dbUser || dbUser.is_blocked) {
                console.log(`Zugriff verweigert (gesperrt/gelöscht) für User ID: ${user.id}`);
                // 403 Forbidden
                return res.status(403).json({ 
                    error: "Ihr Konto wurde gesperrt. Bitte kontaktieren Sie den Support." 
                });
            }

            // Wenn der User existiert und nicht gesperrt ist:
            req.user = user;
            next();
            
        } catch (dbError) {
            console.error("DB-Fehler bei Token-Prüfung:", dbError);
            return res.status(500).json({ error: 'Interner Serverfehler bei der Authentifizierung.' });
        }
    });
}

// Login Route (Korrigiert)
app.post('/api/auth/login', rateLimiter, async (req, res) => {
    try {
        const { username, accessCode, deviceId } = req.body;
        
        // 1. User UND Lizenz-Infos abrufen (JOIN)
        // Wir holen uns direkt das 'expires_at' aus der license_keys Tabelle
        const userRes = await dbQuery(`
            SELECT u.*, l.expires_at 
            FROM users u
            LEFT JOIN license_keys l ON u.license_key_id = l.id
            WHERE u.username = $1
        `, [username]);

        if (userRes.rows.length === 0) {
            return res.status(401).json({ success: false, error: "Benutzer nicht gefunden" });
        }

        const user = userRes.rows[0];

        // 2. Zugangscode prüfen (Hash Vergleich)
        const match = await bcrypt.compare(accessCode, user.access_code_hash);
        if (!match) {
            return res.status(401).json({ success: false, error: "Falscher Zugangscode" });
        }

        // 3. Geräte-Bindung prüfen
        if (user.allowed_device_id && user.allowed_device_id !== deviceId) {
            return res.status(403).json({ success: false, error: "Dieses Gerät ist nicht für den Account autorisiert." });
        }

        // Falls noch kein Gerät gebunden ist (erster Login), binden wir es jetzt
        if (!user.allowed_device_id) {
            await dbQuery("UPDATE users SET allowed_device_id = $1 WHERE id = $2", [deviceId, user.id]);
        }

        // 4. Token erstellen
        const token = jwt.sign(
            { id: user.id, username: user.username }, 
            process.env.JWT_SECRET || 'secret_fallback_key', 
            { expiresIn: '24h' }
        );

        // 5. Update: Letzter Login
        await dbQuery("UPDATE users SET last_login = NOW() WHERE id = $1", [user.id]);

        // 6. ERFOLG: Wir senden jetzt auch das Ablaufdatum mit!
        res.json({ 
            success: true, 
            token, 
            username: user.username,
            expiresAt: user.expires_at // <--- Das fehlte vorher!
        });

    } catch (err) {
        console.error("Login Error:", err);
        res.status(500).json({ success: false, error: "Serverfehler" });
    }
});

// Logout
app.post('/api/auth/logout', authenticateUser, async (req, res) => {
    try {
        await dbQuery('UPDATE users SET is_online = $1 WHERE id = $2', 
            [(isPostgreSQL ? false : 0), req.user.id]);
        res.json({ success: true });
    } catch(e) { res.status(500).json({ error: 'Logout Fehler' }); }
});

// Activate License (Register)
app.post('/api/auth/activate', async (req, res) => {
    const { licenseKey, username, accessCode, deviceId } = req.body; // <--- deviceId kommt vom Frontend

    if (!deviceId) return res.status(400).json({ error: 'Geräte-ID fehlt. Bitte Seite neu laden.' });
    
    try {
        // ... (Key und User Checks wie vorher) ...
        const keyRes = await dbQuery('SELECT * FROM license_keys WHERE key_code = $1', [licenseKey]);
        const key = keyRes.rows[0];
        if (!key) return res.status(404).json({ error: 'Key nicht gefunden' });
        if (key.activated_at) return res.status(403).json({ error: 'Key bereits benutzt' });
        
        const userRes = await dbQuery('SELECT id FROM users WHERE username = $1', [username]);
        if (userRes.rows.length > 0) return res.status(409).json({ error: 'Username vergeben' });

        // User erstellen MIT Device ID Binding
        const hash = await bcrypt.hash(accessCode, 10);
        await dbQuery(
            'INSERT INTO users (username, access_code_hash, license_key_id, allowed_device_id, registered_at) VALUES ($1, $2, $3, $4, $5)',
            [username, hash, key.id, deviceId, new Date().toISOString()]
        );
        
        // Key updaten
        await dbQuery(
            'UPDATE license_keys SET is_active = $1, activated_at = $2, username = $3 WHERE id = $4',
            [(isPostgreSQL ? true : 1), new Date().toISOString(), username, key.id]
        );

        res.json({ success: true });

    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Aktivierung fehlgeschlagen' });
    }
});

// Check Access (Frontend Ping)
app.get('/api/checkAccess', authenticateUser, async (req, res) => {
    try {
        const userRes = await dbQuery('SELECT * FROM users WHERE id = $1', [req.user.id]);
        const user = userRes.rows[0];
        if (!user) return res.json({ status: 'banned' });

        const blocked = isPostgreSQL ? user.is_blocked : (user.is_blocked === 1);
        if (blocked) return res.json({ status: 'banned' });

        const keyRes = await dbQuery('SELECT * FROM license_keys WHERE id = $1', [user.license_key_id]);
        const key = keyRes.rows[0];
        
        if (key && key.expires_at) {
            if (new Date(key.expires_at) < new Date()) return res.json({ status: 'expired' });
        }

        res.json({ status: 'active' });
    } catch (e) {
        res.status(500).json({ error: 'Error' });
    }
});

// Delete Account
app.delete('/api/auth/delete-account', authenticateUser, async (req, res) => {
    try {
        // Erst Key deaktivieren
        await dbQuery('UPDATE license_keys SET is_active = $1, username = NULL WHERE id = (SELECT license_key_id FROM users WHERE id = $2)',
            [(isPostgreSQL ? false : 0), req.user.id]);
        // Dann User löschen
        await dbQuery('DELETE FROM users WHERE id = $1', [req.user.id]);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: 'Fehler beim Löschen' });
    }
});

// Validate Token
app.post('/api/auth/validate', async (req, res) => {
    const { token } = req.body;
    if (!token) return res.json({ valid: false });

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret_fallback_key');
        
        // Prüfen ob User noch existiert und Lizenzstatus holen
        const userRes = await dbQuery(`
            SELECT u.*, l.expires_at 
            FROM users u
            LEFT JOIN license_keys l ON u.license_key_id = l.id
            WHERE u.id = $1
        `, [decoded.id]);
        
        if (userRes.rows.length > 0) {
            // Token ist valide, wir senden aktuelle Daten zurück
            res.json({ 
                valid: true, 
                username: userRes.rows[0].username,
                expiresAt: userRes.rows[0].expires_at // <--- Auch beim Refresh aktualisieren
            });
        } else {
            res.json({ valid: false });
        }
    } catch (e) {
        res.json({ valid: false });
    }
});


// ==================================================================
// 4. ADMIN DASHBOARD ROUTES (NEW & FIXED)
// ==================================================================

// Middleware für Admin Routes
const requireAdmin = (req, res, next) => {
    const { password } = req.body;
    if (password !== ADMIN_PASSWORD) return res.status(403).json({ success: false, error: 'Admin Auth Failed' });
    next();
};

// A) STATS
app.post('/api/admin/stats', requireAdmin, async (req, res) => {
    try {
        const usersCount = await dbQuery(`SELECT COUNT(*) as c FROM users WHERE is_blocked = ${isPostgreSQL ? 'false' : '0'}`);
        const keysCount = await dbQuery(`SELECT COUNT(*) as c FROM license_keys`);
        const sessionsCount = await dbQuery(`SELECT COUNT(*) as c FROM license_keys WHERE is_active = ${isPostgreSQL ? 'true' : '1'}`);
        
        res.json({
            success: true,
            stats: {
                activeUsers: usersCount.rows[0].c,
                totalKeys: keysCount.rows[0].c,
                activeSessions: sessionsCount.rows[0].c,
                recentRegistrations: 0 // Optional
            }
        });
    } catch (e) {
        console.error(e);
        res.json({ success: false, error: 'DB Error' });
    }
});

// B) USERS (Fixed Joins)
app.post('/api/admin/users', requireAdmin, async (req, res) => {
    try {
        const sql = `
            SELECT u.id, u.username, u.is_blocked, u.registered_at, u.last_login, u.is_online, u.allowed_device_id, -- <--- HINZUGEFÜGT
                   k.key_code 
            FROM users u
            LEFT JOIN license_keys k ON u.license_key_id = k.id
            ORDER BY u.registered_at DESC LIMIT 100
        `;
        const result = await dbQuery(sql);
        
        const users = result.rows.map(r => ({
            id: r.id,
            username: r.username,
            name: r.username, 
            license_key: r.key_code,
            key_code: r.key_code, 
            is_blocked: isPostgreSQL ? r.is_blocked : (r.is_blocked === 1),
            is_online: isPostgreSQL ? r.is_online : (r.is_online === 1),
            registered_at: r.registered_at,
            last_login: r.last_login,
            allowed_device_id: r.allowed_device_id // <--- HINZUGEFÜGT
        }));

        res.json({ success: true, users });
    } catch (e) {
        console.error(e);
        res.status(500).json({ success: false, error: e.message });
    }
});

// C) GENERATE KEYS (Fixed Loop)
app.post('/api/admin/generate-keys', requireAdmin, async (req, res) => {
    try {
        const { count, product } = req.body;
        const qty = parseInt(count) || 1;
        const keys = [];

        for(let i=0; i<qty; i++) {
            // Generate Code
            const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
            let s = '';
            for(let j=0; j<15; j++) s += chars[Math.floor(Math.random() * chars.length)];
            const code = s.match(/.{1,5}/g).join('-');
            const hash = await bcrypt.hash(code, 10);
            
            // Calc Expiry
            let expiresAt = null;
            const now = new Date();
            if(product === '1m') expiresAt = new Date(now.setMonth(now.getMonth()+1));
            if(product === '3m') expiresAt = new Date(now.setMonth(now.getMonth()+3));
            if(product === '12m') expiresAt = new Date(now.setFullYear(now.getFullYear()+1));

            const isoExp = expiresAt ? expiresAt.toISOString() : null;

            await dbQuery(
                `INSERT INTO license_keys (key_code, key_hash, product_code, is_active, created_at, expires_at) 
                 VALUES ($1, $2, $3, $4, $5, $6)`,
                // FIX: `product_code` wird direkt als `$3` übergeben
                [code, hash, product, (isPostgreSQL?false:0), new Date().toISOString(), isoExp]
            );
          
            keys.push(code);
        }
        res.json({ success: true, keys });
    } catch (e) {
        console.error(e);
        res.status(500).json({ success: false, error: 'Gen Error' });
    }
});

// D) ALL KEYS (Filtered)
app.post('/api/admin/keys', requireAdmin, async (req, res) => {
    try {
        const { filter } = req.body;
        console.log(`🔍 Admin lädt Keys (Filter: ${filter})...`);

        let where = "";
        // SQL-Datumskonvertierung ist je nach DB kritisch.
        const now = isPostgreSQL ? 'NOW()' : 'DATETIME("now")'; 
        
        if (filter === 'active') where = `WHERE is_active = ${isPostgreSQL ? 'true' : '1'}`;
        if (filter === 'inactive') where = `WHERE is_active = ${isPostgreSQL ? 'false' : '0'}`;
        
        // FIX: Abgelaufene Keys werden anhand des expires_at Datums geprüft.
        if (filter === 'expired') where = `WHERE expires_at IS NOT NULL AND expires_at < ${now}`;

        // Wir nutzen die korrekten Spaltennamen product_code und expires_at.
        // Das Backend muss den `username` über einen JOIN aus der `users` Tabelle holen, da er nicht in `license_keys` steht.
        // WICHTIG: Laut deinem Schema steht der Username NICHT in license_keys! (Siehe unten).
        
        const sql = `
            SELECT k.id, k.key_code, k.product_code, k.is_active, k.created_at, k.activated_at, k.expires_at,
                   u.username
            FROM license_keys k
            LEFT JOIN users u ON u.license_key_id = k.id -- JOIN, um den Usernamen zu bekommen
            ${where}
            ORDER BY k.created_at DESC 
            LIMIT 100
        `;

        const result = await dbQuery(sql);
        console.log(`✅ ${result.rows.length} Keys gefunden.`);
        
        // Daten mappen für Frontend
        const keys = result.rows.map(r => ({
            id: r.id,
            key_code: r.key_code,
            product_code: r.product_code, // Korrekter Spaltenname
            is_active: isPostgreSQL ? r.is_active : (r.is_active === 1), 
            username: r.username || '—', // Kommt vom JOIN
            created_at: r.created_at,
            activated_at: r.activated_at,
            expires_at: r.expires_at
        }));

        res.json({ success: true, keys });
    } catch (e) {
        console.error("❌ Fehler beim Laden der Keys:", e);
        res.status(500).json({ success: false, error: e.message });
    }
});

app.delete('/api/admin/keys/:id', requireAdmin, async (req, res) => {
    await dbQuery('DELETE FROM license_keys WHERE id = $1', [req.params.id]);
    res.json({ success: true });
});

// E) PURCHASES (Reading from Metadata for better details)
app.post('/api/admin/purchases', requireAdmin, async (req, res) => {
    try {
        // Wir holen Daten aus der 'payments' Tabelle, die wir in confirm-session füllen
        const sql = `
            SELECT payment_id, amount, currency, status, completed_at, metadata
            FROM payments ORDER BY completed_at DESC LIMIT 100
        `;
        const result = await dbQuery(sql);
        
        const purchases = result.rows.map(r => {
            let meta = {};
            try { meta = (typeof r.metadata === 'string') ? JSON.parse(r.metadata) : r.metadata; } catch(e){}
            
            return {
                id: r.payment_id,
                email: meta.email || '?',
                amount: r.amount,
                currency: r.currency,
                date: r.completed_at,
                keys: meta.keys_generated || [],
                status: r.status
            };
        });
        
        res.json({ success: true, purchases });
    } catch (e) {
        console.error(e);
        // Fallback: Leere Liste statt Error, damit UI nicht crasht
        res.json({ success: true, purchases: [] });
    }
});

// User Actions (Block/Unblock)
app.post('/api/admin/block-user/:id', requireAdmin, async (req, res) => {
    try {
        const userId = req.params.id;

        // 1. Benutzer sperren
        await dbQuery("UPDATE users SET is_blocked = TRUE WHERE id = $1", [userId]);

        // 2. WICHTIG: Alle aktiven Sitzungen des Benutzers sofort beenden (Logout erzwingen)
        // Wir löschen alle Token aus der user_sessions Tabelle für diesen User.
        await dbQuery("DELETE FROM user_sessions WHERE user_id = $1", [userId]);

        res.json({ success: true, message: 'User blockiert und abgemeldet.' });
    } catch (e) {
        // ... (Fehlerbehandlung)
    }
});

app.post('/api/admin/unblock-user/:id', requireAdmin, async (req, res) => {
    await dbQuery(`UPDATE users SET is_blocked = ${isPostgreSQL ? 'false' : '0'} WHERE id = $1`, [req.params.id]);
    res.json({ success: true });
});

// Device connection Reset
app.post('/api/admin/reset-device/:id', requireAdmin, async (req, res) => {
    try {
        // Setzt die Geräte-ID auf NULL, damit das nächste Gerät, das sich einloggt, als neues Standardgerät gilt
        // ODER du löschst es, damit der User sich beim nächsten Login neu binden muss (dazu müsste Login-Logik "update device if null" erlauben)
        // Einfacher: Wir setzen es auf NULL. Der User muss uns dann kontaktieren.
        // Bessere UX: Wir löschen es. Beim nächsten Login des Users speichern wir die NEUE Device ID.
        
        // Logik für Server.js Login Anpassung (Optional für Auto-Rebind):
        // if (user.allowed_device_id === null) { update user set allowed_device_id = newDeviceId }
        
        // Für jetzt einfach löschen:
        await dbQuery("UPDATE users SET allowed_device_id = NULL WHERE id = $1", [req.params.id]);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false });
    }
});

// ==================================================================
// 5. EXTERNAL ROUTES (PAYMENT)
// ==================================================================

// Wir nutzen die Payment Routes für Stripe Callbacks
// HINWEIS: Die Admin-Routes in payment.js werden hiermit durch die
// oben definierten "Server.js"-Routes überschrieben, da Express
// die obigen zuerst matcht (wenn sie vor app.use kommen).
// Um sicher zu gehen, definieren wir Admin-Routes oben.
app.use('/api', paymentRoutes);


// ==================================================================
// 6. START
// ==================================================================

app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => {
    console.log(`🚀 Server running on Port ${PORT}`);
});
