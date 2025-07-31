// server.js - Secret Messages Backend Refactored
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
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Environment
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const DATABASE_URL = process.env.DATABASE_URL;

// Database
let db;
let isPostgreSQL = false;

async function initDB() {
  if (DATABASE_URL && DATABASE_URL.includes('postgres')) {
    const { Pool } = require('pg');
    db = new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
    isPostgreSQL = true;
  } else {
    const sqlite3 = require('sqlite3').verbose();
    db = new sqlite3.Database('./secret_messages.db');
  }
  await createTables();
  await insertDemoKeys();
}

async function createTables() {
  if (isPostgreSQL) {
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
      )
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
      )
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
      )
    `);
    await db.query(`
      CREATE TABLE IF NOT EXISTS purchases (
        id SERIAL PRIMARY KEY,
        buyer VARCHAR(255) NOT NULL,
        license VARCHAR(17) NOT NULL,
        price DECIMAL(10,2) NOT NULL,
        date TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_keys_code ON license_keys(key_code)`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_users_name ON users(username)`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_sessions_token ON user_sessions(session_token)`);
  } else {
    db.run(`
      CREATE TABLE IF NOT EXISTS license_keys (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key_code VARCHAR(17) UNIQUE NOT NULL,
        key_hash TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        activated_at DATETIME,
        expires_at DATETIME,
        is_active BOOLEAN DEFAULT 0,
        product_code TEXT,
        assigned_user_id INTEGER
      )
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username VARCHAR(50) UNIQUE NOT NULL,
        access_code_hash TEXT NOT NULL,
        is_blocked BOOLEAN DEFAULT 0,
        registered_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_login DATETIME,
        license_key_id INTEGER
      )
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
        is_active BOOLEAN DEFAULT 1
      )
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS purchases (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        buyer VARCHAR(255) NOT NULL,
        license VARCHAR(17) NOT NULL,
        price DECIMAL(10,2) NOT NULL,
        date DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
  }
}

async function insertDemoKeys() {
  const demo = [
    ['SM001-ALPHA-BETA1','$2b$10$...'],
    ['SM002-GAMMA-DELT2','$2b$10$...'],
    ['SM003-ECHO-FOXTR3','$2b$10$...']
  ];
  for (const [code, hash] of demo) {
    if (isPostgreSQL) {
      await db.query(
        'INSERT INTO license_keys (key_code,key_hash,created_at) VALUES ($1,$2,NOW()) ON CONFLICT DO NOTHING',
        [code,hash]
      );
    } else {
      db.run(
        'INSERT OR IGNORE INTO license_keys (key_code,key_hash,created_at) VALUES (?,?,CURRENT_TIMESTAMP)',
        [code,hash]
      );
    }
  }
}

function dbQuery(query, params=[]) {
  if (isPostgreSQL) return db.query(query, params);
  return new Promise((resolve, reject) => {
    if (/^\s*select/i.test(query)) {
      db.all(query, params, (err, rows) => err ? reject(err) : resolve({rows}));
    } else {
      db.run(query, params, function(err) {
        err ? reject(err) : resolve({lastID: this.lastID});
      });
    }
  });
}

// Initialize
initDB().catch(console.error);

// Health
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date(), version: '2.0.0' });
});

// Activate
app.post('/api/auth/activate', async (req, res) => {
  const { licenseKey, username, accessCode } = req.body;
  if (!licenseKey || !username || !accessCode) return res.status(400).json({error:'Missing'});
  const keyRes = await dbQuery('SELECT id,is_active FROM license_keys WHERE key_code=$1', [licenseKey]);
  const key = keyRes.rows[0];
  if (!key || key.is_active) return res.status(400).json({error:'Invalid Key'});
  const accessHash = await bcrypt.hash(accessCode,10);
  const userRes = await dbQuery(
    'INSERT INTO users (username,access_code_hash,license_key_id) VALUES ($1,$2,$3) RETURNING id',
    [username,accessHash,key.id]
  );
  await dbQuery(
    'UPDATE license_keys SET assigned_user_id=$1,is_active=true,activated_at=NOW() WHERE id=$2',
    [userRes.rows[0].id, key.id]
  );
  res.json({success:true});
});

// Login
app.post('/api/auth/login', async (req, res) => {
  const { username, accessCode } = req.body;
  const userRes = await dbQuery('SELECT id,access_code_hash,is_blocked,license_key_id FROM users WHERE username=$1', [username]);
  const user = userRes.rows[0];
  if (!user || user.is_blocked) return res.status(401).json({error:'Invalid User'});
  const valid = await bcrypt.compare(accessCode, user.access_code_hash);
  if (!valid) return res.status(401).json({error:'Invalid Credentials'});
  const token = jwt.sign({userId:user.id}, JWT_SECRET, {expiresIn:'30d'});
  const expiresAt = new Date(Date.now()+30*24*3600*1000).toISOString();
  await dbQuery(
    'INSERT INTO user_sessions (user_id,session_token,ip_address,user_agent,expires_at) VALUES ($1,$2,$3,$4,$5)',
    [user.id, token, req.ip, req.headers['user-agent']||'', expiresAt]
  );
  await dbQuery('UPDATE users SET last_login=NOW() WHERE id=$1', [user.id]);
  res.json({token,username});
});

// Validate
app.post('/api/auth/validate', (req, res) => {
  const token = req.headers.authorization?.split(' ')[1] || req.body.token;
  if (!token) return res.status(401).json({valid:false});
  try {
    jwt.verify(token, JWT_SECRET);
    res.json({valid:true});
  } catch {
    res.json({valid:false});
  }
});

// Logout
app.post('/api/auth/logout', (req, res) => res.json({success:true}));

// Delete Account
app.delete('/api/auth/delete-account', async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({error:'No Token'});
  try {
    const {userId} = jwt.decode(token);
    await dbQuery('DELETE FROM users WHERE id=$1', [userId]);
    res.json({success:true});
  } catch (e) {
    res.status(500).json({error:'Error'});
  }
});

// Activity log
app.post('/api/activity/log', (req, res) => {
  console.log('[ACT]', req.body);
  res.json({logged:true});
});

// Admin: Stats
app.post('/api/admin/stats', async (req, res) => {
  const {password} = req.body;
  if (password!==ADMIN_PASSWORD) return res.status(403).json({error:'Forbidden'});
  const totalKeys = await dbQuery('SELECT COUNT(*) FROM license_keys');
  const activeUsers = await dbQuery('SELECT COUNT(*) FROM users WHERE is_blocked=false');
  const activeSessions = await dbQuery('SELECT COUNT(*) FROM user_sessions WHERE is_active=TRUE AND expires_at>NOW()');
  const recentRegs = await dbQuery("SELECT COUNT(*) FROM users WHERE registered_at>=NOW()-INTERVAL '7 days'");
  res.json({
    stats: {
      totalKeys: parseInt(totalKeys.rows[0].count),
      activeUsers: parseInt(activeUsers.rows[0].count),
      activeSessions: parseInt(activeSessions.rows[0].count),
      recentRegistrations: parseInt(recentRegs.rows[0].count)
    }
  });
});

// Admin: Users
app.post('/api/admin/users', async (req, res) => {
  const {password, page=1, limit=50} = req.body;
  if (password!==ADMIN_PASSWORD) return res.status(403).json({error:'Forbidden'});
  const offset = (page-1)*limit;
  const result = await dbQuery(
    `SELECT u.id,u.username,u.registered_at,u.last_login,u.is_blocked,lk.key_code,lk.product_code,lk.expires_at
     FROM users u
     LEFT JOIN license_keys lk ON lk.id=u.license_key_id
     ORDER BY u.registered_at DESC LIMIT $1 OFFSET $2`, [limit,offset]
  );
  res.json({users: result.rows});
});

// Admin: License Keys
app.post('/api/admin/license-keys', async (req, res) => {
  const {password, page=1, limit=100} = req.body;
  if (password!==ADMIN_PASSWORD) return res.status(403).json({error:'Forbidden'});
  const offset = (page-1)*limit;
  const result = await dbQuery(
    `SELECT lk.id,lk.key_code,lk.created_at,lk.activated_at,lk.expires_at,lk.is_active,lk.product_code,u.username AS assigned_user
     FROM license_keys lk
     LEFT JOIN users u ON u.id=lk.assigned_user_id
     ORDER BY lk.created_at DESC LIMIT $1 OFFSET $2`, [limit,offset]
  );
  res.json({keys: result.rows});
});

// Admin: Purchases
app.post('/api/admin/purchases', async (req, res) => {
  const {password} = req.body;
  if (password!==ADMIN_PASSWORD) return res.status(403).json({error:'Forbidden'});
  const result = await dbQuery('SELECT * FROM purchases ORDER BY date DESC LIMIT 100');
  res.json({purchases: result.rows});
});

// Admin: Generate Key
app.post('/api/admin/generate-key', async (req, res) => {
  const {password, quantity=1} = req.body;
  if (password!==ADMIN_PASSWORD) return res.status(403).json({error:'Forbidden'});
  const keys = [];
  for (let i=0; i<quantity; i++) {
    const part = () => {
      const chars='ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-';
      let p=''; for (let j=0;j<5;j++) p+=chars.charAt(Math.floor(Math.random()*chars.length));
      return p;
    };
    const code = `${part()}-${part()}-${part()}`;
    const hash = await bcrypt.hash(code,10);
    await dbQuery('INSERT INTO license_keys (key_code,key_hash,created_at) VALUES ($1,$2,NOW())',[code,hash]);
    keys.push(code);
  }
  res.json({keys});
});

// Admin: Key actions
function safeAdmin(req){ return req.body.password===ADMIN_PASSWORD; }
app.post('/api/admin/keys/:id/disable', async (req,res)=>{
  if(!safeAdmin(req)) return res.status(403).json({error:'Forbidden'});
  await dbQuery('UPDATE license_keys SET is_active=false WHERE id=$1',[req.params.id]); res.json({});
});
app.post('/api/admin/keys/:id/enable', async (req,res)=>{
  if(!safeAdmin(req)) return res.status(403).json({error:'Forbidden'});
  await dbQuery('UPDATE license_keys SET is_active=true WHERE id=$1',[req.params.id]); res.json({});
});
app.post('/api/admin/keys/:id/activate', async (req,res)=>{
  if(!safeAdmin(req)) return res.status(403).json({error:'Forbidden'});
  const {product_code}=req.body; const map={'1m':30,'3m':90,'unl':null};
  if(!(product_code in map)) return res.status(400).json({error:'Invalid'});
  const now=new Date(); let exp=null; if(map[product_code]){exp=new Date(now);exp.setDate(exp.getDate()+map[product_code]);exp=exp.toISOString();}
  await dbQuery('UPDATE license_keys SET is_active=true,expires_at=$1,product_code=$2 WHERE id=$3',[exp,product_code,req.params.id]);
  res.json({expires_at:exp});
});

// Serve Admin UI
app.get('/admin', (req,res)=>res.sendFile(path.join(__dirname,'public','admin.html')));

// Start
app.listen(PORT, ()=>console.log(`Listening on ${PORT}`));
