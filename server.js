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
      
      // WICHTIG: Hier müssen die QR-Code Bibliotheken erlaubt werden!
      scriptSrc: [
          "'self'", 
          "https://js.stripe.com", 
          "https://cdnjs.cloudflare.com", 
          "https://unpkg.com"
      ],
      scriptSrcElem: [
          "'self'", 
          "https://js.stripe.com", 
          "https://cdnjs.cloudflare.com", 
          "https://unpkg.com"
      ],
      
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
            expiresAt: user.expires_at || 'lifetime'
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

app.post('/api/users/exists', authenticateUser, async (req, res) => {
    try {
        const { targetUsername } = req.body;
        
        if (!targetUsername) return res.json({ exists: false });

        // Wir trimmen Leerzeichen weg, um Fehler bei Copy-Paste zu vermeiden
        const searchName = targetUsername.trim();

        console.log(`🔎 Suche User (Strikt): '${searchName}'`);

        // 1. Wir holen den User NUR anhand des Namens (Case-Sensitive!)
        // Wir holen auch 'is_blocked', um es im Server-Log zu sehen.
        const query = `SELECT id, username, is_blocked FROM users WHERE username = $1`;
        
        const result = await dbQuery(query, [searchName]);

        // A) User gar nicht gefunden
        if (result.rows.length === 0) {
            console.log(`❌ Datenbank meldet: Kein Eintrag für '${searchName}' gefunden.`);
            return res.json({ exists: false });
        }

        const user = result.rows[0];
        console.log(`✅ User gefunden. ID: ${user.id}, Blocked-Status in DB: ${user.is_blocked}`);

        // B) User gefunden -> Jetzt prüfen wir, ob er blockiert ist
        // Wir prüfen tolerant auf 'true', 1 oder '1'
        const isBlocked = (user.is_blocked === true || user.is_blocked === 1 || user.is_blocked === '1');

        if (isBlocked) {
            console.log(`⛔ User existiert, ist aber blockiert.`);
            return res.json({ exists: false }); // Wir sagen "existiert nicht", um keine Infos preiszugeben
        }

        // C) Alles OK
        console.log(`👍 User gültig und verfügbar.`);
        res.json({ exists: true });

    } catch (e) {
        console.error("User Check Error:", e);
        res.status(500).json({ error: "Serverfehler beim Prüfen des Benutzers" });
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
// 4. ADMIN DASHBOARD ROUTES (UPDATED)
// ==================================================================

// Middleware für Admin Routes
const requireAdmin = (req, res, next) => {
    const { password } = req.headers['x-admin-password']; // Header bevorzugen
    // Fallback auf Body (für alte Versionen)
    const pass = password || req.body.password || req.headers['x-admin-password'];
    
    if (pass !== ADMIN_PASSWORD) return res.status(403).json({ success: false, error: 'Admin Auth Failed' });
    next();
};

// A) EXTENDED STATS
app.get('/api/admin/stats', requireAdmin, async (req, res) => {
    try {
        const now = isPostgreSQL ? 'NOW()' : 'DATETIME("now")';
        
        // 1. User Stats
        const activeUsers = await dbQuery(`SELECT COUNT(*) as c FROM users WHERE is_blocked = ${isPostgreSQL ? 'false' : '0'}`);
        const blockedUsers = await dbQuery(`SELECT COUNT(*) as c FROM users WHERE is_blocked = ${isPostgreSQL ? 'true' : '1'}`);
        
        // 2. Key Stats
        // Aktiv = is_active true AND expires_at > now
        const activeKeys = await dbQuery(`SELECT COUNT(*) as c FROM license_keys WHERE is_active = ${isPostgreSQL ? 'true' : '1'} AND (expires_at IS NULL OR expires_at > ${now})`);
        const expiredKeys = await dbQuery(`SELECT COUNT(*) as c FROM license_keys WHERE expires_at IS NOT NULL AND expires_at <= ${now}`);
        
        // 3. Financial Stats (aus payments Tabelle)
        const totalPurchases = await dbQuery(`SELECT COUNT(*) as c FROM payments WHERE status = 'completed'`);
        const totalRevenue = await dbQuery(`SELECT SUM(amount) as s FROM payments WHERE status = 'completed'`);
        
        res.json({
            success: true,
            stats: {
                users_active: activeUsers.rows[0].c,
                users_blocked: blockedUsers.rows[0].c,
                keys_active: activeKeys.rows[0].c,
                keys_expired: expiredKeys.rows[0].c,
                purchases_count: totalPurchases.rows[0].c,
                revenue_total: (totalRevenue.rows[0].s || 0) // Cent Betrag
            }
        });
    } catch (e) {
        console.error("Stats Error:", e);
        res.json({ success: false, error: 'DB Error' });
    }
});

// B) KEYS (GET & UPDATE)
app.get('/api/admin/keys', requireAdmin, async (req, res) => {
    try {
        // JOIN mit users, um die User ID zu bekommen
        const sql = `
            SELECT k.id, k.key_code, k.product_code, k.is_active, k.created_at, k.activated_at, k.expires_at,
                   u.username, u.id as user_id
            FROM license_keys k
            LEFT JOIN users u ON u.license_key_id = k.id 
            ORDER BY k.created_at DESC 
            LIMIT 200
        `;
        const result = await dbQuery(sql);
        
        const keys = result.rows.map(r => ({
            id: r.id,
            key_code: r.key_code,
            product_code: r.product_code,
            is_active: isPostgreSQL ? r.is_active : (r.is_active === 1), 
            username: r.username,
            user_id: r.user_id, // <--- WICHTIG: Die User ID
            created_at: r.created_at,
            activated_at: r.activated_at,
            expires_at: r.expires_at
        }));

        res.json(keys);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Key Update (Edit Mode)
app.put('/api/admin/keys/:id', requireAdmin, async (req, res) => {
    const keyId = req.params.id;
    const { expires_at, user_id } = req.body; // user_id kann eine ID sein oder leer (unbind)

    try {
        // 1. Key Daten aktualisieren (Typ auf 'man' setzen)
        await dbQuery(
            `UPDATE license_keys SET expires_at = $1, product_code = 'man' WHERE id = $2`,
            [expires_at || null, keyId]
        );

        // 2. User Verknüpfung behandeln
        // Zuerst: Alte Verknüpfung lösen (Sicherheitshalber)
        await dbQuery(`UPDATE users SET license_key_id = NULL WHERE license_key_id = $1`, [keyId]);

        // Dann: Neue Verknüpfung setzen (wenn User ID angegeben)
        if (user_id) {
            // Prüfen ob User existiert
            const userCheck = await dbQuery(`SELECT id, username FROM users WHERE id = $1`, [user_id]);
            if (userCheck.rows.length > 0) {
                const u = userCheck.rows[0];
                // User mit Key verknüpfen
                await dbQuery(`UPDATE users SET license_key_id = $1 WHERE id = $2`, [keyId, user_id]);
                // Auch den Username im Key cachen (für Anzeige-Konsistenz)
                await dbQuery(`UPDATE license_keys SET username = $1, is_active = ${isPostgreSQL ? 'true' : '1'}, activated_at = COALESCE(activated_at, NOW()) WHERE id = $2`, [u.username, keyId]);
            }
        } else {
            // Wenn User ID leer ist -> Key "Freigeben" (optional, oder nur User entfernen)
            await dbQuery(`UPDATE license_keys SET username = NULL WHERE id = $1`, [keyId]);
        }

        res.json({ success: true });
    } catch (e) {
        console.error("Update Key Error:", e);
        res.status(500).json({ success: false, error: e.message });
    }
});

// C) USERS
app.get('/api/admin/users', requireAdmin, async (req, res) => {
    try {
        const sql = `
            SELECT u.*, k.key_code 
            FROM users u
            LEFT JOIN license_keys k ON u.license_key_id = k.id
            ORDER BY u.registered_at DESC LIMIT 100
        `;
        const result = await dbQuery(sql);
        // Mapping fixen für boolesche Werte
        const users = result.rows.map(r => ({
            ...r,
            is_blocked: isPostgreSQL ? r.is_blocked : (r.is_blocked === 1),
            is_online: isPostgreSQL ? r.is_online : (r.is_online === 1)
        }));
        res.json(users);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// D) PURCHASES (Full Table Data)
app.get('/api/admin/purchases', requireAdmin, async (req, res) => {
    try {
        const sql = `SELECT * FROM payments ORDER BY completed_at DESC LIMIT 100`;
        const result = await dbQuery(sql);
        
        const purchases = result.rows.map(r => {
            let meta = {};
            try { meta = (typeof r.metadata === 'string') ? JSON.parse(r.metadata) : r.metadata; } catch(e){}
            return {
                id: r.payment_id,
                email: meta.customer_email || '?',
                product: meta.product_type || '?',
                amount: r.amount,
                currency: r.currency,
                date: r.completed_at,
                status: r.status
            };
        });
        res.json(purchases);
    } catch (e) {
        console.error(e);
        res.json([]);
    }
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
// 5. ADMIN API ROUTES (Fehlte wahrscheinlich)
// ==================================================================

// Middleware: Prüft das Admin Passwort aus Railway Variables
const adminAuth = (req, res, next) => {
    const sentPassword = req.headers['x-admin-password'];
    // Hier holen wir das Passwort aus den Railway Variables
    const realPassword = process.env.ADMIN_PASSWORD || 'admin123'; // Fallback falls Variable fehlt

    if (sentPassword === realPassword) {
        next(); // Passwort stimmt -> Weiter
    } else {
        res.status(401).json({ error: "Falsches Admin Passwort" });
    }
};

// Route: Alle User laden
app.get('/api/admin/users', adminAuth, async (req, res) => {
    try {
        const result = await dbQuery("SELECT * FROM users ORDER BY id DESC");
        res.json(result.rows);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Route: User Blockieren/Entsperren
app.post('/api/admin/users/:id/block', adminAuth, async (req, res) => {
    try {
        const { block } = req.body; // true oder false
        await dbQuery("UPDATE users SET is_blocked = $1 WHERE id = $2", [block, req.params.id]);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Route: Gerätebindung aufheben (Reset Device)
app.post('/api/admin/users/:id/reset-device', adminAuth, async (req, res) => {
    try {
        await dbQuery("UPDATE users SET allowed_device_id = NULL WHERE id = $1", [req.params.id]);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Route: Alle Keys laden
app.get('/api/admin/keys', adminAuth, async (req, res) => {
    try {
        const result = await dbQuery("SELECT * FROM license_keys ORDER BY created_at DESC");
        res.json(result.rows);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Route: Neue Keys generieren
app.post('/api/admin/generate-keys', adminAuth, async (req, res) => {
    try {
        const { productCode, count } = req.body; 
        const amount = parseInt(count) || 1;
        const newKeys = [];

        // Dauer berechnen
        let durationDays = 30;
        if(productCode === '3m') durationDays = 90;
        if(productCode === '12m') durationDays = 365;
        if(productCode === 'unlimited') durationDays = 99999; // Lifetime

        // Loop zum Erstellen
        for(let i=0; i < amount; i++) {
            // Zufälliger Key XXXX-XXXX-XXXX-XXXX
            const keyRaw = crypto.randomBytes(8).toString('hex').toUpperCase().match(/.{1,4}/g).join('-');
            
            // Hash erstellen (für die DB)
            const keyHash = crypto.createHash('sha256').update(keyRaw).digest('hex');
            
            // Ablaufdatum berechnen (ab Aktivierung, hier setzen wir es aber erst bei Aktivierung)
            // ABER: In diesem Admin-Tool generieren wir "frische" Keys.
            // In der DB speichern wir NULL bei activated_at.
            
            await dbQuery(`
                INSERT INTO license_keys (key_code, key_hash, product_code, is_active)
                VALUES ($1, $2, $3, true)
            `, [keyRaw, keyHash, productCode]); // Wir speichern keyRaw hier nur zur Anzeige, normalerweise hash!
            // Hinweis: Für Admin Generierung speichern wir oft den Raw Key, damit du ihn kopieren kannst.
            // Falls deine DB Struktur 'key_code' als Klartext erlaubt:
            
            newKeys.push(keyRaw);
        }

        res.json({ success: true, keys: newKeys });

    } catch (e) {
        console.error(e);
        res.status(500).json({ error: "Fehler beim Generieren" });
    }
});

// ==================================================================
// PAYMENTS STRIPE
// ==================================================================

app.use('/api', paymentRoutes);


// ==================================================================
// 6. START
// ==================================================================

app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => {
    console.log(`🚀 Server running on Port ${PORT}`);
});
