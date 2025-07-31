// server.js — Secret Messages Backend (überarbeitet für neues Schema)

const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const app = express();
app.set('trust proxy', 1);
app.use(helmet());
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const DATABASE_URL = process.env.DATABASE_URL;

let db;
let isPostgres = false;

/** Helper: Führe eine DB-Query aus **/
function dbQuery(sql, params = []) {
  if (isPostgres) {
    return db.query(sql, params);
  } else {
    return new Promise((resolve, reject) =>
      db.all(sql, params, (err, rows) => err ? reject(err) : resolve({ rows }))
    );
  }
}

/** Schema-Erstellung **/
async function createTablesPostgres() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS license_keys (
      id SERIAL PRIMARY KEY,
      key_code VARCHAR(17) UNIQUE NOT NULL,
      key_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      activated_at TIMESTAMPTZ,
      expires_at TIMESTAMPTZ,
      is_active BOOLEAN DEFAULT FALSE,
      product_code TEXT,
      assigned_user_id INTEGER UNIQUE REFERENCES users(id) ON DELETE SET NULL
    );
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username VARCHAR(50) UNIQUE NOT NULL,
      access_code_hash TEXT NOT NULL,
      is_blocked BOOLEAN DEFAULT FALSE,
      registered_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      last_login TIMESTAMPTZ,
      license_key_id INTEGER UNIQUE REFERENCES license_keys(id) ON DELETE SET NULL
    );
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS user_sessions (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      session_token TEXT UNIQUE NOT NULL,
      ip_address VARCHAR(45),
      user_agent TEXT,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      expires_at TIMESTAMPTZ,
      is_active BOOLEAN DEFAULT TRUE
    );
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS purchases (
      id SERIAL PRIMARY KEY,
      buyer VARCHAR(255) NOT NULL,
      license VARCHAR(17) NOT NULL,
      price DECIMAL(10,2) NOT NULL,
      date TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );
  `);
}
function createTablesSQLite() {
  db.serialize(() => {
    db.run(`
      CREATE TABLE IF NOT EXISTS license_keys (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key_code VARCHAR(17) UNIQUE NOT NULL,
        key_hash TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        activated_at DATETIME,
        expires_at DATETIME,
        is_active INTEGER DEFAULT 0,
        product_code TEXT,
        assigned_user_id INTEGER UNIQUE
      );
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username VARCHAR(50) UNIQUE NOT NULL,
        access_code_hash TEXT NOT NULL,
        is_blocked INTEGER DEFAULT 0,
        registered_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_login DATETIME,
        license_key_id INTEGER UNIQUE
      );
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS user_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        session_token TEXT UNIQUE NOT NULL,
        ip_address VARCHAR(45),
        user_agent TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        expires_at DATETIME,
        is_active INTEGER DEFAULT 1
      );
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS purchases (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        buyer VARCHAR(255) NOT NULL,
        license VARCHAR(17) NOT NULL,
        price REAL NOT NULL,
        date DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);
  });
}

/** DB initialisieren **/
async function initDb() {
  if (DATABASE_URL && DATABASE_URL.includes('postgres')) {
    const { Pool } = require('pg');
    db = new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false }});
    isPostgres = true;
    await db.query('SELECT NOW()');
    await createTablesPostgres();
  } else {
    const sqlite3 = require('sqlite3').verbose();
    db = new sqlite3.Database('./secret_messages.db');
    isPostgres = false;
    createTablesSQLite();
  }
}
initDb().catch(err => {
  console.error('DB-Init-Error:', err);
  process.exit(1);
});

/** Rate Limiter **/
const authLimiter = rateLimit({ windowMs:15*60*1000, max:10 });

/** Utility: Generiere zufälligen Key-Teil **/
function keyPart() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-';
  let s = '';
  for (let i = 0; i < 5; i++) {
    s += chars[Math.floor(Math.random()*chars.length)];
  }
  return s;
}

/** ---- API ENDPOINTS ---- **/

// Health Check
app.get('/api/health', (req, res) => {
  res.json({ status:'ok', timestamp: new Date().toISOString() });
});

// License-Key Aktivierung
app.post('/api/auth/activate', authLimiter, async (req, res) => {
  const { licenseKey, username, accessCode } = req.body;
  if (!licenseKey || !username || !accessCode) return res.status(400).json({ success:false, error:'Alle Felder erforderlich' });
  if (!/^[A-Z0-9_-]{5}-[A-Z0-9_-]{5}-[A-Z0-9_-]{5}$/.test(licenseKey)) return res.status(400).json({ success:false, error:'Ungültiges License-Key Format' });
  if (!/^[a-zA-Z0-9._-]{3,20}$/.test(username)) return res.status(400).json({ success:false, error:'Ungültiger Benutzername' });
  if (!/^\d{5}$/.test(accessCode)) return res.status(400).json({ success:false, error:'AccessCode muss 5 Ziffern sein' });

  try {
    // Key-Daten prüfen
    let keyRes = await dbQuery(isPostgres
      ? 'SELECT id, is_active, assigned_user_id FROM license_keys WHERE key_code=$1'
      : 'SELECT id, is_active, assigned_user_id FROM license_keys WHERE key_code=?',
      [licenseKey]
    );
    const key = keyRes.rows[0];
    if (!key) return res.status(404).json({ success:false, error:'Key nicht gefunden' });
    if (key.assigned_user_id) return res.status(403).json({ success:false, error:'Key bereits vergeben' });

    // Hash generieren & User anlegen
    const hash = await bcrypt.hash(accessCode, 10);
    let userRes = await dbQuery(isPostgres
      ? 'INSERT INTO users (username, access_code_hash, license_key_id) VALUES($1,$2,$3) RETURNING id,registered_at'
      : 'INSERT INTO users (username, access_code_hash, license_key_id) VALUES(?,?,?) RETURNING id,registered_at',
      [username, hash, key.id]
    );
    const user = userRes.rows?.[0] || { id: null };

    // Key updaten
    await dbQuery(isPostgres
      ? 'UPDATE license_keys SET assigned_user_id=$1,is_active=true,activated_at=CURRENT_TIMESTAMP WHERE id=$2'
      : 'UPDATE license_keys SET assigned_user_id=?,is_active=1,activated_at=CURRENT_TIMESTAMP WHERE id=?',
      [user.id, key.id]
    );

    res.json({ success:true, message:'Registrierung erfolgreich', userId:user.id });
  } catch (e) {
    console.error('Activation error:', e);
    res.status(500).json({ success:false, error:'Serverfehler' });
  }
});

// User-Login
app.post('/api/auth/login', authLimiter, async (req, res) => {
  const { username, accessCode } = req.body;
  if (!username || !accessCode) return res.status(400).json({ success:false, error:'Benutzername & Code erforderlich' });

  try {
    // User abrufen
    let uRes = await dbQuery(isPostgres
      ? 'SELECT id,access_code_hash,is_blocked,license_key_id FROM users WHERE username=$1'
      : 'SELECT id,access_code_hash,is_blocked,license_key_id FROM users WHERE username=?',
      [username]
    );
    const user = uRes.rows[0];
    if (!user || user.is_blocked) return res.status(401).json({ success:false, error:'Ungültiger Login' });

    // Code prüfen
    const valid = await bcrypt.compare(accessCode, user.access_code_hash);
    if (!valid) return res.status(401).json({ success:false, error:'Ungültiger Login' });

    // Token erstellen
    const payload = { userId:user.id, username, licenseKeyId:user.license_key_id };
    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '30d' });

    // Session speichern
    const expiresAt = new Date(Date.now()+30*24*3600*1000).toISOString();
    await dbQuery(isPostgres
      ? `INSERT INTO user_sessions (user_id,session_token,ip_address,user_agent,expires_at)
         VALUES($1,$2,$3,$4,$5)`
      : `INSERT INTO user_sessions (user_id,session_token,ip_address,user_agent,expires_at)
         VALUES(?,?,?,?,?)`,
      [user.id, token, req.ip, req.headers['user-agent'], expiresAt]
    );

    // last_login updaten
    await dbQuery(isPostgres
      ? `UPDATE users SET last_login=CURRENT_TIMESTAMP WHERE id=$1`
      : `UPDATE users SET last_login=datetime('now') WHERE id=?`,
      [user.id]
    );

    res.json({ success:true, token, username });
  } catch (e) {
    console.error('Login error:', e);
    res.status(500).json({ success:false, error:'Serverfehler' });
  }
});

// Token-Validate
app.post('/api/auth/validate', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ','') || req.body.token;
  if (!token) return res.status(401).json({ success:false, valid:false, error:'Token fehlt' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    // Prüfe Sperrstatus
    let uRes = await dbQuery(isPostgres
      ? 'SELECT is_blocked FROM users WHERE id=$1'
      : 'SELECT is_blocked FROM users WHERE id=?',
      [decoded.userId]
    );
    if (uRes.rows[0].is_blocked) return res.json({ success:true, valid:false });
    res.json({ success:true, valid:true, username:decoded.username });
  } catch {
    res.json({ success:false, valid:false });
  }
});

// Logout (Session deaktivieren)
app.post('/api/auth/logout', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ','');
  if (token) {
    await dbQuery(isPostgres
      ? 'UPDATE user_sessions SET is_active=false WHERE session_token=$1'
      : 'UPDATE user_sessions SET is_active=0 WHERE session_token=?',
      [token]
    );
  }
  res.json({ success:true });
});

// Admin Stats
app.post('/api/admin/stats', async (req, res) => {
  const { password } = req.body;
  if (password !== ADMIN_PASSWORD) return res.status(403).json({ success:false, error:'Zugriff verweigert' });
  try {
    const totalKeys = await dbQuery('SELECT COUNT(*) AS c FROM license_keys');
    const totalUsers = await dbQuery('SELECT COUNT(*) AS c FROM users');
    const blockedUsers = await dbQuery('SELECT COUNT(*) AS c FROM users WHERE is_blocked=true');
    const activeSessions = await dbQuery(isPostgres
      ? 'SELECT COUNT(*) AS c FROM user_sessions WHERE is_active=true AND expires_at>NOW()'
      : "SELECT COUNT(*) AS c FROM user_sessions WHERE is_active=1 AND datetime(expires_at)>datetime('now')"
    );
    res.json({
      success: true,
      stats: {
        totalKeys: parseInt(totalKeys.rows[0].c),
        totalUsers: parseInt(totalUsers.rows[0].c),
        blockedUsers: parseInt(blockedUsers.rows[0].c),
        activeSessions: parseInt(activeSessions.rows[0].c)
      }
    });
  } catch (e) {
    console.error('Stats error:', e);
    res.status(500).json({ success:false, error:'Serverfehler' });
  }
});

// Admin: List Users
app.post('/api/admin/users', async (req, res) => {
  const { password, page=1, limit=50 } = req.body;
  if (password !== ADMIN_PASSWORD) return res.status(403).json({ success:false, error:'Zugriff verweigert' });
  const offset = (Math.max(1,page)-1)*Math.max(1,limit);
  try {
    const sql = isPostgres
      ? `SELECT u.id, u.username, u.is_blocked, u.registered_at, u.last_login,
                 lk.key_code, lk.product_code, lk.expires_at
         FROM users u
         LEFT JOIN license_keys lk ON lk.id = u.license_key_id
         ORDER BY u.registered_at DESC
         LIMIT $1 OFFSET $2`
      : `SELECT u.id, u.username, u.is_blocked, u.registered_at, u.last_login,
                lk.key_code, lk.product_code, lk.expires_at
         FROM users u
         LEFT JOIN license_keys lk ON lk.id = u.license_key_id
         ORDER BY u.registered_at DESC
         LIMIT ? OFFSET ?`;
    const result = await dbQuery(sql, [limit, offset]);
    res.json({ success:true, users: result.rows });
  } catch (e) {
    console.error('List users error:', e);
    res.status(500).json({ success:false, error:'Serverfehler' });
  }
});

// Admin: List License Keys
app.post('/api/admin/license-keys', async (req, res) => {
  const { password, page=1, limit=100 } = req.body;
  if (password !== ADMIN_PASSWORD) return res.status(403).json({ success:false, error:'Zugriff verweigert' });
  const offset = (Math.max(1,page)-1)*Math.max(1,limit);
  try {
    const sql = isPostgres
      ? `SELECT lk.id, lk.key_code, lk.created_at, lk.activated_at,
                 lk.expires_at, lk.is_active, lk.product_code,
                 u.username AS assigned_user
         FROM license_keys lk
         LEFT JOIN users u ON u.id = lk.assigned_user_id
         ORDER BY lk.created_at DESC
         LIMIT $1 OFFSET $2`
      : `SELECT lk.id, lk.key_code, lk.created_at, lk.activated_at,
                lk.expires_at, lk.is_active, lk.product_code,
                u.username AS assigned_user
         FROM license_keys lk
         LEFT JOIN users u ON u.id = lk.assigned_user_id
         ORDER BY lk.created_at DESC
         LIMIT ? OFFSET ?`;
    const result = await dbQuery(sql, [limit, offset]);
    res.json({ success:true, keys: result.rows });
  } catch (e) {
    console.error('List keys error:', e);
    res.status(500).json({ success:false, error:'Serverfehler' });
  }
});

// Admin: Generate Keys
app.post('/api/admin/generate-key', async (req, res) => {
  const { password, quantity=1 } = req.body;
  if (password !== ADMIN_PASSWORD) return res.status(403).json({ success:false, error:'Zugriff verweigert' });
  if (quantity > 100) return res.status(400).json({ success:false, error:'Maximal 100 Keys' });
  try {
    const keys = [];
    for (let i = 0; i < quantity; i++) {
      const code = `${keyPart()}-${keyPart()}-${keyPart()}`;
      const hash = await bcrypt.hash(code, 10);
      await dbQuery(isPostgres
        ? 'INSERT INTO license_keys (key_code,key_hash) VALUES($1,$2)'
        : 'INSERT INTO license_keys (key_code,key_hash) VALUES(?,?)',
        [code, hash]
      );
      keys.push(code);
    }
    res.json({ success:true, keys, count: keys.length });
  } catch (e) {
    console.error('Generate key error:', e);
    res.status(500).json({ success:false, error:'Serverfehler' });
  }
});

// Server starten
app.listen(PORT, () => {
  console.log(`Server läuft auf Port ${PORT}`);
});
