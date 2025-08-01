// server.js - Bereinigte Version (Nutzt ausschließlich 'users' für Benutzerverwaltung)

const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
app.set('trust proxy', 1);

// Konfiguration
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'secret';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const DATABASE_URL = process.env.DATABASE_URL;

let db, isPostgreSQL = false;

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Rate Limiting
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: 'Zu viele Login-Versuche. Bitte versuchen Sie es später erneut.'
});

app.use('/api/auth/login', loginLimiter);

// ================================
// Datenbank-Initialisierung
// ================================
const initializeDatabase = async () => {
  const { Pool } = require('pg');
  db = new Pool({
    connectionString: DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
  });
  await db.query('SELECT NOW()');
  isPostgreSQL = true;
};

const dbQuery = (query, params = []) => db.query(query, params);

initializeDatabase();

// ================================
// API ENDPOINTS
// ================================

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// LOGIN
app.post('/api/auth/login', async (req, res) => {
  const { username, accessCode } = req.body;
  if (!username || !accessCode) {
    return res.status(400).json({ success: false, error: 'Fehlende Daten' });
  }

  try {
    const result = await dbQuery('SELECT * FROM users WHERE username = $1 AND is_blocked = false', [username]);
    const user = result.rows[0];
    if (!user || !user.access_code_hash) return res.status(401).json({ success: false, error: 'Login fehlgeschlagen' });

    const match = await bcrypt.compare(accessCode, user.access_code_hash);
    if (!match) return res.status(401).json({ success: false, error: 'Falscher Code' });

    const token = jwt.sign({ username: user.username, userId: user.id }, JWT_SECRET, { expiresIn: '30d' });

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);

    await dbQuery(
      `INSERT INTO user_sessions (user_id, session_token, ip_address, user_agent, expires_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [user.id, token, req.ip, req.headers['user-agent'] || '', expiresAt.toISOString()]
    );

    res.json({ success: true, token, username: user.username });

  } catch (e) {
    console.error('Login error:', e);
    res.status(500).json({ success: false, error: 'Serverfehler' });
  }
});

// AKTIVIERUNG
app.post('/api/auth/activate', async (req, res) => {
  const { licenseKey, username, accessCode } = req.body;
  if (!licenseKey || !username || !accessCode) {
    return res.status(400).json({ success: false, error: 'Fehlende Daten' });
  }

  try {
    const existingUser = await dbQuery('SELECT id FROM users WHERE username = $1', [username]);
    if (existingUser.rows.length > 0) {
      return res.status(409).json({ success: false, error: 'Benutzername vergeben' });
    }

    const keyRes = await dbQuery('SELECT * FROM license_keys WHERE key_code = $1', [licenseKey]);
    const key = keyRes.rows[0];
    if (!key) return res.status(404).json({ success: false, error: 'Key nicht gefunden' });
    if (key.is_active) return res.status(403).json({ success: false, error: 'Key bereits verwendet' });

    const hash = await bcrypt.hash(accessCode, 10);

    await dbQuery('UPDATE license_keys SET is_active = true, activated_at = CURRENT_TIMESTAMP WHERE id = $1', [key.id]);

    await dbQuery(
      'INSERT INTO users (username, access_code_hash, license_key_id) VALUES ($1, $2, $3)',
      [username, hash, key.id]
    );

    res.json({ success: true, message: 'Aktivierung erfolgreich' });
  } catch (e) {
    console.error('Aktivierung Fehler:', e);
    res.status(500).json({ success: false, error: 'Serverfehler' });
  }
});

// VALIDATE SESSION
app.post('/api/auth/validate', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ success: false, valid: false, error: 'Token fehlt' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const sessionRes = await dbQuery(
      'SELECT * FROM user_sessions WHERE session_token = $1 AND is_active = true AND expires_at > NOW()',
      [token]
    );

    if (sessionRes.rows.length === 0) {
      return res.json({ success: false, valid: false, error: 'Session ungültig' });
    }

    res.json({ success: true, valid: true, username: decoded.username });
  } catch (e) {
    res.json({ success: false, valid: false, error: 'Token ungültig' });
  }
});

// LOGOUT
app.post('/api/auth/logout', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (token) {
    await dbQuery('UPDATE user_sessions SET is_active = false WHERE session_token = $1', [token]);
  }
  res.json({ success: true });
});

// ACCOUNT-LÖSCHUNG
app.delete('/api/auth/delete-account', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ success: false, error: 'Nicht autorisiert' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const userId = decoded.userId;

    await dbQuery('DELETE FROM user_sessions WHERE user_id = $1', [userId]);
    await dbQuery('DELETE FROM users WHERE id = $1', [userId]);

    res.json({ success: true, message: 'Account gelöscht' });
  } catch (e) {
    console.error('Account-Löschung Fehler:', e);
    res.status(500).json({ success: false, error: 'Serverfehler' });
  }
});

// Server starten
app.listen(PORT, () => {
  console.log(`✅ Server läuft auf http://localhost:${PORT}`);
});
