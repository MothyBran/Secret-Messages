// server.js - Erweiterte Version mit Benutzer-basierter Authentifizierung
const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();

// Environment Variables
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const DATABASE_URL = process.env.DATABASE_URL;

// Database Setup
let db, isPostgreSQL = false;

if (DATABASE_URL && DATABASE_URL.startsWith('postgresql')) {
    const { Pool } = require('pg');
    db = new Pool({ connectionString: DATABASE_URL });

// ====================================
// ADMIN ENDPOINTS
// ====================================

// Admin Stats with User Info
app.post('/api/admin/stats', async (req, res) => {
    const { password } = req.body;
    
    if (password !== ADMIN_PASSWORD) {
        return res.status(403).json({ 
            success: false, 
            error: 'Ungültiges Admin-Passwort' 
        });
    }
    
    try {
        const stats = {};
        
        // Total keys
        const totalKeys = await dbQuery('SELECT COUNT(*) as count FROM license_keys');
        stats.totalKeys = parseInt(totalKeys.rows[0].count);
        
        // Active users (keys with username)
        const activeUsers = await dbQuery(
            isPostgreSQL
                ? 'SELECT COUNT(*) as count FROM license_keys WHERE is_active = true AND username IS NOT NULL'
                : 'SELECT COUNT(*) as count FROM license_keys WHERE is_active = 1 AND username IS NOT NULL'
        );
        stats.activeUsers = parseInt(activeUsers.rows[0].count);
        
        // Active sessions
        const activeSessions = await dbQuery(
            isPostgreSQL
                ? 'SELECT COUNT(*) as count FROM user_sessions WHERE is_active = true AND expires_at > NOW()'
                : 'SELECT COUNT(*) as count FROM user_sessions WHERE is_active = 1 AND expires_at > datetime("now")'
        );
        stats.activeSessions = parseInt(activeSessions.rows[0].count || 0);
        
        // Recent registrations (last 7 days)
        const recentRegs = await dbQuery(
            isPostgreSQL
                ? "SELECT COUNT(*) as count FROM license_keys WHERE user_created_at > NOW() - INTERVAL '7 days'"
                : "SELECT COUNT(*) as count FROM license_keys WHERE user_created_at > datetime('now', '-7 days')"
        );
        stats.recentRegistrations = parseInt(recentRegs.rows[0].count || 0);
        
        res.json({ success: true, stats });
        
    } catch (error) {
        console.error('Stats error:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Fehler beim Abrufen der Statistiken' 
        });
    }
});

// List Users (for Admin)
app.post('/api/admin/users', async (req, res) => {
    const { password, page = 1, limit = 20 } = req.body;
    
    if (password !== ADMIN_PASSWORD) {
        return res.status(403).json({ 
            success: false, 
            error: 'Ungültiges Admin-Passwort' 
        });
    }
    
    try {
        const offset = (page - 1) * limit;
        
        const query = isPostgreSQL
            ? `SELECT 
                   key_code,
                   username,
                   is_active,
                   created_at,
                   activated_at,
                   last_used_at,
                   activated_ip
               FROM license_keys 
               ORDER BY created_at DESC 
               LIMIT $1 OFFSET $2`
            : `SELECT 
                   key_code,
                   username,
                   is_active,
                   created_at,
                   activated_at,
                   last_used_at,
                   activated_ip
               FROM license_keys 
               ORDER BY created_at DESC 
               LIMIT ? OFFSET ?`;
               
        const result = await dbQuery(query, [limit, offset]);
        
        res.json({
            success: true,
            users: result.rows || [],
            page,
            limit
        });
        
    } catch (error) {
        console.error('List users error:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Fehler beim Abrufen der Benutzerliste' 
        });
    }
    isPostgreSQL = true;
    console.log('📦 Using PostgreSQL database');
} else {
    const sqlite3 = require('sqlite3').verbose();
    db = new sqlite3.Database('./secret_messages.db');
    console.log('📁 Using SQLite database');
}

// Middleware
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
            fontSrc: ["'self'", "https://fonts.gstatic.com"],
            scriptSrc: ["'self'"],
            imgSrc: ["'self'", "data:", "https:"],
            connectSrc: ["'self'"]
        }
    }
}));
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Rate Limiting
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5,
    message: 'Zu viele Login-Versuche. Bitte versuchen Sie es später erneut.'
});

const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100
});

app.use('/api/', apiLimiter);
app.use('/api/auth/login', loginLimiter);
app.use('/api/auth/activate', loginLimiter);

// Helper Functions
const dbQuery = (query, params = []) => {
    if (isPostgreSQL) {
        return db.query(query, params);
    } else {
        return new Promise((resolve, reject) => {
            if (query.toLowerCase().startsWith('select')) {
                db.all(query, params, (err, rows) => {
                    if (err) reject(err);
                    else resolve({ rows });
                });
            } else {
                db.run(query, params, function(err) {
                    if (err) reject(err);
                    else resolve({ rows: [{ id: this.lastID }] });
                });
            }
        });
    }
};

// ====================================
// HEALTH CHECK ENDPOINT
// ====================================

app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        version: '2.0.0',
        uptime: process.uptime(),
        environment: process.env.NODE_ENV || 'development'
    });
});

// ====================================
// USER AUTHENTICATION ENDPOINTS
// ====================================

// User Login Endpoint
app.post('/api/auth/login', async (req, res) => {
    const { username, accessCode } = req.body;
    const clientIP = req.ip;
    
    // Validation
    if (!username || !accessCode) {
        return res.status(400).json({ 
            success: false, 
            error: 'Benutzername und Zugangscode erforderlich' 
        });
    }
    
    if (!/^\d{5}$/.test(accessCode)) {
        return res.status(400).json({ 
            success: false, 
            error: 'Zugangscode muss 5 Ziffern enthalten' 
        });
    }
    
    try {
        // Find user by username
        const userQuery = isPostgreSQL
            ? 'SELECT * FROM license_keys WHERE username = $1 AND is_active = true'
            : 'SELECT * FROM license_keys WHERE username = ? AND is_active = 1';
            
        const result = await dbQuery(userQuery, [username]);
        const user = result.rows[0];
        
        if (!user) {
            return res.status(401).json({ 
                success: false, 
                error: 'Ungültiger Benutzername oder Zugangscode' 
            });
        }
        
        // Verify access code
        const isValidCode = await bcrypt.compare(accessCode, user.access_code_hash);
        
        if (!isValidCode) {
            return res.status(401).json({ 
                success: false, 
                error: 'Ungültiger Benutzername oder Zugangscode' 
            });
        }
        
        // Generate JWT token
        const token = jwt.sign(
            { 
                username: user.username,
                keyId: user.id,
                licenseKey: user.key_code
            },
            JWT_SECRET,
            { expiresIn: '30d' }
        );
        
        // Create session
        const sessionQuery = isPostgreSQL
            ? `INSERT INTO user_sessions 
               (session_token, username, license_key_id, ip_address, user_agent, expires_at) 
               VALUES ($1, $2, $3, $4, $5, $6)`
            : `INSERT INTO user_sessions 
               (session_token, username, license_key_id, ip_address, user_agent, expires_at) 
               VALUES (?, ?, ?, ?, ?, ?)`;
               
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 30);
        
        await dbQuery(sessionQuery, [
            token,
            username,
            user.id,
            clientIP,
            req.headers['user-agent'] || 'Unknown',
            expiresAt.toISOString()
        ]);
        
        res.json({
            success: true,
            message: 'Anmeldung erfolgreich',
            token,
            username: user.username
        });
        
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Interner Serverfehler' 
        });
    }
});

// License Key Activation with User Creation
app.post('/api/auth/activate', async (req, res) => {
    const { licenseKey, username, accessCode } = req.body;
    const clientIP = req.ip;
    
    // Validation
    if (!licenseKey || !username || !accessCode) {
        return res.status(400).json({ 
            success: false, 
            error: 'Alle Felder sind erforderlich' 
        });
    }
    
    if (!/^[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}$/.test(licenseKey)) {
        return res.status(400).json({ 
            success: false, 
            error: 'Ungültiges License-Key Format' 
        });
    }
    
    if (!/^[a-zA-Z0-9_-]+$/.test(username) || username.length < 3 || username.length > 20) {
        return res.status(400).json({ 
            success: false, 
            error: 'Benutzername muss 3-20 Zeichen lang sein (nur Buchstaben, Zahlen, _, -)' 
        });
    }
    
    if (!/^\d{5}$/.test(accessCode)) {
        return res.status(400).json({ 
            success: false, 
            error: 'Zugangscode muss genau 5 Ziffern enthalten' 
        });
    }
    
    try {
        // Check if username already exists
        const usernameCheck = await dbQuery(
            isPostgreSQL
                ? 'SELECT id FROM license_keys WHERE username = $1'
                : 'SELECT id FROM license_keys WHERE username = ?',
            [username]
        );
        
        if (usernameCheck.rows && usernameCheck.rows.length > 0) {
            return res.status(409).json({ 
                success: false, 
                error: 'Benutzername bereits vergeben' 
            });
        }
        
        // Find license key
        const keyQuery = isPostgreSQL
            ? 'SELECT * FROM license_keys WHERE key_code = $1'
            : 'SELECT * FROM license_keys WHERE key_code = ?';
            
        const result = await dbQuery(keyQuery, [licenseKey]);
        const keyData = result.rows[0];
        
        if (!keyData) {
            return res.status(404).json({ 
                success: false, 
                error: 'License-Key nicht gefunden' 
            });
        }
        
        // Check if key is already activated
        if (keyData.is_active || keyData.username) {
            return res.status(403).json({ 
                success: false, 
                error: 'License-Key wurde bereits aktiviert' 
            });
        }
        
        // Hash access code
        const accessCodeHash = await bcrypt.hash(accessCode, 10);
        
        // Activate key with user data
        const activateQuery = isPostgreSQL
            ? `UPDATE license_keys 
               SET username = $1, 
                   access_code_hash = $2, 
                   is_active = true, 
                   activated_at = CURRENT_TIMESTAMP,
                   activated_ip = $3,
                   user_created_at = CURRENT_TIMESTAMP
               WHERE id = $4`
            : `UPDATE license_keys 
               SET username = ?, 
                   access_code_hash = ?, 
                   is_active = 1, 
                   activated_at = CURRENT_TIMESTAMP,
                   activated_ip = ?,
                   user_created_at = CURRENT_TIMESTAMP
               WHERE id = ?`;
               
        await dbQuery(activateQuery, [username, accessCodeHash, clientIP, keyData.id]);
        
        res.json({
            success: true,
            message: 'Zugang erfolgreich erstellt! Sie können sich jetzt anmelden.',
            username
        });
        
    } catch (error) {
        console.error('Activation error:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Interner Serverfehler' 
        });
    }
});

// Validate Token
app.post('/api/auth/validate', async (req, res) => {
    const token = req.headers.authorization?.replace('Bearer ', '') || req.body.token;
    
    if (!token) {
        return res.status(401).json({ 
            success: false, 
            valid: false, 
            error: 'Token erforderlich' 
        });
    }
    
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        
        // Check if session exists and is active
        const sessionQuery = isPostgreSQL
            ? 'SELECT * FROM user_sessions WHERE session_token = $1 AND is_active = true'
            : 'SELECT * FROM user_sessions WHERE session_token = ? AND is_active = 1';
            
        const result = await dbQuery(sessionQuery, [token]);
        
        if (!result.rows || result.rows.length === 0) {
            return res.json({ 
                success: false, 
                valid: false, 
                error: 'Session abgelaufen' 
            });
        }
        
        res.json({
            success: true,
            valid: true,
            username: decoded.username
        });
        
    } catch (error) {
        res.json({ 
            success: false, 
            valid: false, 
            error: 'Ungültiger Token' 
        });
    }
});

// Logout
app.post('/api/auth/logout', async (req, res) => {
    const token = req.headers.authorization?.replace('Bearer ', '') || req.body.token;
    
    if (token) {
        try {
            const updateQuery = isPostgreSQL
                ? 'UPDATE user_sessions SET is_active = false WHERE session_token = $1'
                : 'UPDATE user_sessions SET is_active = 0 WHERE session_token = ?';
                
            await dbQuery(updateQuery, [token]);
        } catch (error) {
            console.error('Logout error:', error);
        }
    }
    
    res.json({ success: true, message: 'Erfolgreich abgemeldet' });
});

// Delete Account
app.delete('/api/auth/delete-account', async (req, res) => {
    const token = req.headers.authorization?.replace('Bearer ', '');
    
    if (!token) {
        return res.status(401).json({ 
            success: false, 
            error: 'Nicht autorisiert' 
        });
    }
    
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const { username, keyId } = decoded;
        
        // Log account deletion
        const logQuery = isPostgreSQL
            ? `INSERT INTO account_deletions 
               (username, license_key_code, deletion_ip) 
               SELECT username, key_code, $1 
               FROM license_keys WHERE id = $2`
            : `INSERT INTO account_deletions 
               (username, license_key_code, deletion_ip) 
               SELECT username, key_code, ? 
               FROM license_keys WHERE id = ?`;
               
        await dbQuery(logQuery, [req.ip, keyId]);
        
        // Deactivate all sessions
        const sessionsQuery = isPostgreSQL
            ? 'UPDATE user_sessions SET is_active = false WHERE license_key_id = $1'
            : 'UPDATE user_sessions SET is_active = 0 WHERE license_key_id = ?';
            
        await dbQuery(sessionsQuery, [keyId]);
        
        // Delete the license key
        const deleteQuery = isPostgreSQL
            ? 'DELETE FROM license_keys WHERE id = $1'
            : 'DELETE FROM license_keys WHERE id = ?';
            
        await dbQuery(deleteQuery, [keyId]);
        
        res.json({
            success: true,
            message: 'Account erfolgreich gelöscht'
        });
        
    } catch (error) {
        console.error('Delete account error:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Fehler beim Löschen des Accounts' 
        });
    }
});

// User Login Endpoint
app.post('/api/auth/login', async (req, res) => {
    const { username, accessCode } = req.body;
    const clientIP = req.ip;
    
    // Validation
    if (!username || !accessCode) {
        return res.status(400).json({ 
            success: false, 
            error: 'Benutzername und Zugangscode erforderlich' 
        });
    }
    
    if (!/^\d{5}$/.test(accessCode)) {
        return res.status(400).json({ 
            success: false, 
            error: 'Zugangscode muss 5 Ziffern enthalten' 
        });
    }
    
    try {
        // Find user by username
        const userQuery = isPostgreSQL
            ? 'SELECT * FROM license_keys WHERE username = $1 AND is_active = true'
            : 'SELECT * FROM license_keys WHERE username = ? AND is_active = 1';
            
        const result = await dbQuery(userQuery, [username]);
        const user = result.rows[0];
        
        if (!user) {
            return res.status(401).json({ 
                success: false, 
                error: 'Ungültiger Benutzername oder Zugangscode' 
            });
        }
        
        // Verify access code
        const isValidCode = await bcrypt.compare(accessCode, user.access_code_hash);
        
        if (!isValidCode) {
            return res.status(401).json({ 
                success: false, 
                error: 'Ungültiger Benutzername oder Zugangscode' 
            });
        }
        
        // Generate JWT token
        const token = jwt.sign(
            { 
                username: user.username,
                keyId: user.id,
                licenseKey: user.key_code
            },
            JWT_SECRET,
            { expiresIn: '30d' }
        );
        
        // Create session
        const sessionQuery = isPostgreSQL
            ? `INSERT INTO user_sessions 
               (session_token, username, license_key_id, ip_address, user_agent, expires_at) 
               VALUES ($1, $2, $3, $4, $5, $6)`
            : `INSERT INTO user_sessions 
               (session_token, username, license_key_id, ip_address, user_agent, expires_at) 
               VALUES (?, ?, ?, ?, ?, ?)`;
               
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 30);
        
        await dbQuery(sessionQuery, [
            token,
            username,
            user.id,
            clientIP,
            req.headers['user-agent'] || 'Unknown',
            expiresAt.toISOString()
        ]);
        
        // Update last login
        const updateQuery = isPostgreSQL
            ? 'UPDATE license_keys SET last_used_at = CURRENT_TIMESTAMP, last_used_ip = $1 WHERE id = $2'
            : 'UPDATE license_keys SET last_used_at = CURRENT_TIMESTAMP, last_used_ip = ? WHERE id = ?';
            
        await dbQuery(updateQuery, [clientIP, user.id]);
        
        res.json({
            success: true,
            message: 'Anmeldung erfolgreich',
            token,
            username: user.username
        });
        
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Interner Serverfehler' 
        });
    }
});

// License Key Activation with User Creation
app.post('/api/auth/activate', async (req, res) => {
    const { licenseKey, username, accessCode } = req.body;
    const clientIP = req.ip;
    
    // Validation
    if (!licenseKey || !username || !accessCode) {
        return res.status(400).json({ 
            success: false, 
            error: 'Alle Felder sind erforderlich' 
        });
    }
    
    if (!/^[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}$/.test(licenseKey)) {
        return res.status(400).json({ 
            success: false, 
            error: 'Ungültiges License-Key Format' 
        });
    }
    
    if (!/^[a-zA-Z0-9_-]+$/.test(username) || username.length < 3 || username.length > 20) {
        return res.status(400).json({ 
            success: false, 
            error: 'Benutzername muss 3-20 Zeichen lang sein (nur Buchstaben, Zahlen, _, -)' 
        });
    }
    
    if (!/^\d{5}$/.test(accessCode)) {
        return res.status(400).json({ 
            success: false, 
            error: 'Zugangscode muss genau 5 Ziffern enthalten' 
        });
    }
    
    try {
        // Check if username already exists
        const usernameCheck = await dbQuery(
            isPostgreSQL
                ? 'SELECT id FROM license_keys WHERE username = $1'
                : 'SELECT id FROM license_keys WHERE username = ?',
            [username]
        );
        
        if (usernameCheck.rows.length > 0) {
            return res.status(409).json({ 
                success: false, 
                error: 'Benutzername bereits vergeben' 
            });
        }
        
        // Find license key
        const keyQuery = isPostgreSQL
            ? 'SELECT * FROM license_keys WHERE key_code = $1'
            : 'SELECT * FROM license_keys WHERE key_code = ?';
            
        const result = await dbQuery(keyQuery, [licenseKey]);
        const keyData = result.rows[0];
        
        if (!keyData) {
            return res.status(404).json({ 
                success: false, 
                error: 'License-Key nicht gefunden' 
            });
        }
        
        // Check if key is already activated
        if (keyData.is_active || keyData.username) {
            return res.status(403).json({ 
                success: false, 
                error: 'License-Key wurde bereits aktiviert' 
            });
        }
        
        // Hash access code
        const accessCodeHash = await bcrypt.hash(accessCode, 10);
        
        // Activate key with user data
        const activateQuery = isPostgreSQL
            ? `UPDATE license_keys 
               SET username = $1, 
                   access_code_hash = $2, 
                   is_active = true, 
                   activated_at = CURRENT_TIMESTAMP,
                   activated_ip = $3,
                   user_created_at = CURRENT_TIMESTAMP
               WHERE id = $4`
            : `UPDATE license_keys 
               SET username = ?, 
                   access_code_hash = ?, 
                   is_active = 1, 
                   activated_at = CURRENT_TIMESTAMP,
                   activated_ip = ?,
                   user_created_at = CURRENT_TIMESTAMP
               WHERE id = ?`;
               
        await dbQuery(activateQuery, [username, accessCodeHash, clientIP, keyData.id]);
        
        res.json({
            success: true,
            message: 'Zugang erfolgreich erstellt! Sie können sich jetzt anmelden.',
            username
        });
        
    } catch (error) {
        console.error('Activation error:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Interner Serverfehler' 
        });
    }
});

// Validate Token
app.post('/api/auth/validate', async (req, res) => {
    const token = req.headers.authorization?.replace('Bearer ', '') || req.body.token;
    
    if (!token) {
        return res.status(401).json({ 
            success: false, 
            valid: false, 
            error: 'Token erforderlich' 
        });
    }
    
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        
        // Check if session exists and is active
        const sessionQuery = isPostgreSQL
            ? 'SELECT * FROM user_sessions WHERE session_token = $1 AND is_active = true'
            : 'SELECT * FROM user_sessions WHERE session_token = ? AND is_active = 1';
            
        const result = await dbQuery(sessionQuery, [token]);
        
        if (result.rows.length === 0) {
            return res.json({ 
                success: false, 
                valid: false, 
                error: 'Session abgelaufen' 
            });
        }
        
        res.json({
            success: true,
            valid: true,
            username: decoded.username
        });
        
    } catch (error) {
        res.json({ 
            success: false, 
            valid: false, 
            error: 'Ungültiger Token' 
        });
    }
});

// Logout
app.post('/api/auth/logout', async (req, res) => {
    const token = req.headers.authorization?.replace('Bearer ', '') || req.body.token;
    
    if (token) {
        try {
            const updateQuery = isPostgreSQL
                ? 'UPDATE user_sessions SET is_active = false WHERE session_token = $1'
                : 'UPDATE user_sessions SET is_active = 0 WHERE session_token = ?';
                
            await dbQuery(updateQuery, [token]);
        } catch (error) {
            console.error('Logout error:', error);
        }
    }
    
    res.json({ success: true, message: 'Erfolgreich abgemeldet' });
});

// Delete Account
app.delete('/api/auth/delete-account', async (req, res) => {
    const token = req.headers.authorization?.replace('Bearer ', '');
    
    if (!token) {
        return res.status(401).json({ 
            success: false, 
            error: 'Nicht autorisiert' 
        });
    }
    
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const { username, keyId } = decoded;
        
        // Log account deletion
        const logQuery = isPostgreSQL
            ? `INSERT INTO account_deletions 
               (username, license_key_code, deletion_ip) 
               SELECT username, key_code, $1 
               FROM license_keys WHERE id = $2`
            : `INSERT INTO account_deletions 
               (username, license_key_code, deletion_ip) 
               SELECT username, key_code, ? 
               FROM license_keys WHERE id = ?`;
               
        await dbQuery(logQuery, [req.ip, keyId]);
        
        // Deactivate all sessions
        const sessionsQuery = isPostgreSQL
            ? 'UPDATE user_sessions SET is_active = false WHERE license_key_id = $1'
            : 'UPDATE user_sessions SET is_active = 0 WHERE license_key_id = ?';
            
        await dbQuery(sessionsQuery, [keyId]);
        
        // Delete the license key (this will cascade delete related records)
        const deleteQuery = isPostgreSQL
            ? 'DELETE FROM license_keys WHERE id = $1'
            : 'DELETE FROM license_keys WHERE id = ?';
            
        await dbQuery(deleteQuery, [keyId]);
        
        res.json({
            success: true,
            message: 'Account erfolgreich gelöscht'
        });
        
    } catch (error) {
        console.error('Delete account error:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Fehler beim Löschen des Accounts' 
        });
    }
});

// ====================================
// ADMIN ENDPOINTS
// ====================================

// Admin Stats with User Info
app.post('/api/admin/stats', async (req, res) => {
    const { password } = req.body;
    
    if (password !== ADMIN_PASSWORD) {
        return res.status(403).json({ 
            success: false, 
            error: 'Ungültiges Admin-Passwort' 
        });
    }
    
    try {
        const stats = {};
        
        // Total keys
        const totalKeys = await dbQuery('SELECT COUNT(*) as count FROM license_keys');
        stats.totalKeys = parseInt(totalKeys.rows[0].count);
        
        // Active users
        const activeUsers = await dbQuery(
            isPostgreSQL
                ? 'SELECT COUNT(*) as count FROM license_keys WHERE is_active = true'
                : 'SELECT COUNT(*) as count FROM license_keys WHERE is_active = 1'
        );
        stats.activeUsers = parseInt(activeUsers.rows[0].count);
        
        // Active sessions
        const activeSessions = await dbQuery(
            isPostgreSQL
                ? 'SELECT COUNT(*) as count FROM user_sessions WHERE is_active = true'
                : 'SELECT COUNT(*) as count FROM user_sessions WHERE is_active = 1'
        );
        stats.activeSessions = parseInt(activeSessions.rows[0].count);
        
        // Recent registrations (last 7 days)
        const recentRegs = await dbQuery(
            isPostgreSQL
                ? "SELECT COUNT(*) as count FROM license_keys WHERE user_created_at > NOW() - INTERVAL '7 days'"
                : "SELECT COUNT(*) as count FROM license_keys WHERE user_created_at > datetime('now', '-7 days')"
        );
        stats.recentRegistrations = parseInt(recentRegs.rows[0].count);
        
        res.json({ success: true, stats });
        
    } catch (error) {
        console.error('Stats error:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Fehler beim Abrufen der Statistiken' 
        });
    }
});

// List Users (for Admin)
app.post('/api/admin/users', async (req, res) => {
    const { password, page = 1, limit = 20 } = req.body;
    
    if (password !== ADMIN_PASSWORD) {
        return res.status(403).json({ 
            success: false, 
            error: 'Ungültiges Admin-Passwort' 
        });
    }
    
    try {
        const offset = (page - 1) * limit;
        
        const query = isPostgreSQL
            ? `SELECT 
                   key_code,
                   username,
                   is_active,
                   created_at,
                   activated_at,
                   last_used_at,
                   activated_ip
               FROM license_keys 
               ORDER BY created_at DESC 
               LIMIT $1 OFFSET $2`
            : `SELECT 
                   key_code,
                   username,
                   is_active,
                   created_at,
                   activated_at,
                   last_used_at,
                   activated_ip
               FROM license_keys 
               ORDER BY created_at DESC 
               LIMIT ? OFFSET ?`;
               
        const result = await dbQuery(query, [limit, offset]);
        
        res.json({
            success: true,
            users: result.rows,
            page,
            limit
        });
        
    } catch (error) {
        console.error('List users error:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Fehler beim Abrufen der Benutzerliste' 
        });
    }
});

// ====================================
// STATIC FILE SERVING
// ====================================

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// ====================================
// SERVER START
// ====================================

app.listen(PORT, () => {
    console.log(`🚀 Server läuft auf Port ${PORT}`);
    console.log(`🔐 Admin Panel: http://localhost:${PORT}/admin`);
    console.log(`🏠 Hauptseite: http://localhost:${PORT}`);
});
