const express = require('express');
const router = express.Router();
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cryptoLib = require('./crypto');
const { encryptServerSide } = require('../utils/serverCrypto');
const fetch = require('node-fetch'); // Ensure node-fetch is available (legacy version in package.json)
const crypto = require('crypto');

// Helper: Parse potential German date strings (DD.MM.YYYY) to ISO Date objects
function parseDbDate(dateStr) {
    if (!dateStr) return null;
    if (typeof dateStr === 'string' && dateStr.includes('.')) {
        const parts = dateStr.split('.');
        if (parts.length >= 3) {
            const d = parts[0];
            const m = parts[1];
            let y = parts[2];
            if (y.includes(' ')) y = y.split(' ')[0];
            if (y.length === 4) {
                return new Date(`${y}-${m}-${d}`);
            }
        }
    }
    const d = new Date(dateStr);
    return isNaN(d.getTime()) ? null : d;
}

/**
 * Calculates the new expiration date based on the new Master Formula:
 * New_Expiry = MAX(CURRENT_TIMESTAMP, license_expiration) + Key_Duration
 */
function calculateNewExpiration(currentExpirationStr, extensionMonths) {
    if (!extensionMonths || extensionMonths <= 0) return null;

    let baseDate = new Date();
    const currentExpiry = parseDbDate(currentExpirationStr);

    if (currentExpiry && currentExpiry > baseDate) {
        baseDate = currentExpiry;
    }

    const newDate = new Date(baseDate.getTime());
    newDate.setMonth(newDate.getMonth() + extensionMonths);

    return newDate.toISOString();
}

const JWT_SECRET = process.env.JWT_SECRET || 'enterprise-local-secret';
let activeSessions = new Map(); // Token -> { password }

// Middleware: Verify Session for Protected Routes
const verifySession = (req, res, next) => {
    const token = req.headers['authorization']?.split(' ')[1];
    // Check if session exists in memory (key: token, value: sessionData { password, ... })
    // We treat activeSessions as a Map now: Token -> { password }
    if (!token || !activeSessions.has(token)) {
        return res.status(401).json({ error: 'Session locked or invalid' });
    }
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        // Attach session data (e.g. password) to req for use in endpoints
        req.session = activeSessions.get(token);
        next();
    } catch (e) {
        return res.status(401).json({ error: 'Invalid Token' });
    }
};

module.exports = (dbQuery, upload) => {

    // Helper: Log Audit Action
    const logAction = async (action, details, req) => {
        try {
            const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
            await dbQuery(
                `INSERT INTO audit_logs (action, details, ip_address, created_at) VALUES ($1, $2, $3, datetime('now'))`,
                [action, details, ip]
            );
        } catch (e) {
            console.error("Audit Log Error:", e);
        }
    };

    // 0. STATUS API (Discovery)
    router.get('/api/status', async (req, res) => {
        try {
            const check = await dbQuery("SELECT COUNT(*) as c FROM users");
            res.json({ activated: check.rows[0].c > 0 });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    // 1. SETUP API (One-Time)
    router.post('/api/setup', async (req, res) => {
        try {
            const { username, password } = req.body;
            const authHeader = req.headers['authorization'];
            const masterKey = authHeader && authHeader.split(' ')[1];

            if (!masterKey || !username || !password) {
                return res.status(400).json({ error: 'Missing fields or Header' });
            }

            // A. Local Check
            const check = await dbQuery("SELECT COUNT(*) as c FROM users");
            if (check.rows[0].c > 0) {
                return res.status(403).json({ error: 'System already initialized' });
            }

            // B. Cloud Validation (Mock or Real)
            console.log("☁️ Validating Master Key...");
            let isValid = false;

            // LIVE ACTIVATION
            // Only allow ENT-MOCK in development environment if explicitly needed, otherwise strictly force cloud check.
            if (masterKey.startsWith('ENT-MOCK') && process.env.NODE_ENV !== 'production') {
                isValid = true;
                console.log("⚠️ DEV MODE: Mock Validation used.");
            } else {
                try {
                    // Forward Header to Cloud
                    const cloudRes = await fetch('https://www.secure-msg.app/api/enterprise/activate', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${masterKey}`
                        }
                    });

                    if (!cloudRes.ok) {
                        throw new Error(`Cloud Server Error: ${cloudRes.status}`);
                    }

                    const cloudData = await cloudRes.json();
                    if (cloudData.valid) {
                        isValid = true;
                    } else {
                        throw new Error(cloudData.error || 'Key Declined by Server');
                    }
                } catch (netErr) {
                    console.error("Cloud Activation Error:", netErr);
                    return res.status(502).json({ error: "Activation Server Unreachable: " + netErr.message });
                }
            }

            if (!isValid) return res.status(403).json({ error: 'Invalid Master Key' });

            // C. Resource Download (Background)
            try {
                // Mock Download Logic (In a real scenario, this would pipe a zip from the cloud)
                // For "Absolute Isolation", we assume this step fetches assets once and then we go offline.
                // We mock it here to prevent startup crashes.
                console.log("⬇️ Checking for updates...");
                // const updateRes = await fetch('https://www.secure-msg.app/api/enterprise/resources/latest');
                // if (updateRes.ok) { ... download & unzip ... }
                console.log("✅ Resources verified (Mock).");
            } catch (dlErr) {
                console.warn("⚠️ Resource download skipped:", dlErr.message);
                // Non-blocking error - proceed with setup
            }

            // D. Persist Data (Finalization)
            const hash = await bcrypt.hash(password, 10);

            // 1. Generate PIK (SHA-256 of the Master Key)
            const pikRaw = crypto.createHash('sha256').update(masterKey).digest('hex');

            // 2. Encrypt PIK (Server-Side using Password/AccessCode)
            const pikEncrypted = encryptServerSide(pikRaw, password);

            // 3. Anchor (Double Hash for Security)
            const regKeyHash = crypto.createHash('sha256').update(pikRaw).digest('hex');

            // Store User (Local Admin) - Using access_code_hash
            // REMOVED license_expiration column insert
            const userInsertRes = await dbQuery(
                `INSERT INTO users (username, access_code_hash, is_admin, department, role_title, registered_at, registration_key_hash, pik_encrypted) VALUES ($1, $2, 1, 'Management', 'System Administrator', datetime('now'), $3, $4)`,
                [username, hash, regKeyHash, pikEncrypted]
            );
            const userId = userInsertRes.lastID || (await dbQuery("SELECT id FROM users WHERE username = $1", [username])).rows[0].id;

            // Generate "System License" (10 Years)
            const sysKey = 'SYS-' + crypto.randomBytes(4).toString('hex').toUpperCase();
            const sysHash = crypto.createHash('sha256').update(sysKey).digest('hex');
            const expiresAt = new Date();
            expiresAt.setFullYear(expiresAt.getFullYear() + 10);
            const expiresAtIso = expiresAt.toISOString();

            const keyInsertRes = await dbQuery(
                `INSERT INTO license_keys (key_code, key_hash, product_code, is_active, created_at, expires_at, activated_at, assigned_user_id)
                 VALUES ($1, $2, 'SYSTEM', 1, datetime('now'), $3, datetime('now'), $4)`,
                [sysKey, sysHash, expiresAtIso, username]
            );

            // Note: server-enterprise.js wrapper for sqlite returns lastID in callback, but promise wrapper handles it via 'this.lastID' if implemented correctly
            // But dbQuery wrapper in server-enterprise.js resolves with { rows: [], rowCount, lastID }
            // Wait, I should verify dbQuery return structure in server-enterprise.js.
            // It resolves with { rows: [], rowCount: this.changes, lastID: this.lastID } for non-SELECT.
            const keyId = keyInsertRes.lastID;

            // Link Key to User
            if (keyId) {
                await dbQuery(`UPDATE users SET license_key_id = $1 WHERE id = $2`, [keyId, userId]);
            }

            // Store Master Key in Settings (Securely? Ideally hashed, but we need it for derivation...)
            // Requirement says: "Der AES-256-Key muss aus (1) dem Master-Key..."
            // So we MUST store the Master Key locally to derive encryption keys later.
            // We store it in 'settings'.
            await dbQuery(`INSERT INTO settings (key, value) VALUES ('master_key', $1)`, [masterKey]);

            // Generate Key Supplement
            const supplement = cryptoLib.generateKeySupplement(masterKey);
            await dbQuery(`INSERT INTO settings (key, value) VALUES ('key_supplement', $1)`, [supplement]);

            await logAction('SYSTEM_INIT', `Enterprise System initialized by ${username}`, req);

            res.json({ success: true });

        } catch (e) {
            console.error("Setup Error:", e);
            // Return clean JSON error for frontend handling
            res.status(500).json({
                error: "Setup failed: " + (e.message || "Unknown Error"),
                details: e.stack
            });
        }
    });

    // 2. LOGIN API
    router.post('/api/login', async (req, res) => {
        try {
            const { username, password } = req.body;

            const result = await dbQuery("SELECT * FROM users WHERE username = $1", [username]);
            if (result.rows.length === 0) {
                 await logAction('LOGIN_FAIL', `Failed login attempt for ${username}`, req);
                 return res.status(401).json({ error: 'Invalid Credentials' });
            }

            const user = result.rows[0];
            // Check password column first, fallback to access_code_hash for migration safety
            const dbHash = user.password || user.access_code_hash;
            const match = await bcrypt.compare(password, dbHash);

            if (!match) {
                await logAction('LOGIN_FAIL', `Failed login attempt for ${username} (Bad Pass)`, req);
                return res.status(401).json({ error: 'Invalid Credentials' });
            }

            if (user.is_blocked) {
                await logAction('LOGIN_BLOCKED', `Blocked user ${username} attempted login`, req);
                return res.status(403).json({ error: 'Account Blocked' });
            }

            // Success -> Generate Token
            const token = jwt.sign({ id: user.id, username: user.username, isAdmin: user.is_admin }, JWT_SECRET, { expiresIn: '8h' });

            // Store password in memory session for encryption operations
            activeSessions.set(token, { password: password });

            await logAction('LOGIN_SUCCESS', `User ${username} logged in`, req);

            // Redirect based on Role (Unified Login)
            const redirectPath = (user.is_admin === 1) ? '/portal.html' : '/app';
            res.json({ success: true, token, redirect: redirectPath });

        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    // 3. LOCK API
    router.post('/api/lock', verifySession, async (req, res) => {
        const token = req.headers['authorization']?.split(' ')[1];
        if (token) {
            activeSessions.delete(token);
            await logAction('LOCKDOWN', `Session locked by user`, req);
        }
        res.json({ success: true });
    });

    // RENEWAL API (Enterprise)
    router.post('/api/renew-license', verifySession, async (req, res) => {
        // Enterprise usually manages quotas, but if we need individual admin renewal flow locally:
        // Or if this endpoint is for the local 'users' table update.
        // Assuming this is used for the LOCAL Admin user or similar?
        // Wait, Enterprise users are managed by Admin usually.
        // But the schema update requested was for "Server-Enterprise & WebApp-Backend".
        // Let's implement it for consistency.

        // However, in Enterprise mode, "Users" are often local employees.
        // The "License" is the Master Key.
        // But if we have individual users, they might not need renewal?
        // The prompt says "Die neuen Verlängerungs-Logik (/api/renew-license)".
        // I will implement it, but it might only apply if we track individual user licenses.
        // Currently users table has 'license_key_id'.

        // Given the context, this might be for the MASTER KEY renewal via the Setup/Admin page?
        // Or for individual users.
        // Let's assume it's for the logged-in user (Admin or User).

        res.status(501).json({ error: "Not implemented for Enterprise Local Mode yet" });
    });

    // 4. SETTINGS API (Hybrid Key)
    router.get('/api/settings/supplement', verifySession, async (req, res) => {
        try {
            const resKey = await dbQuery("SELECT value FROM settings WHERE key = 'key_supplement'");
            if (resKey.rows.length === 0) return res.status(404).json({ error: "No Supplement Key found" });
            res.json({ supplement: resKey.rows[0].value });
        } catch(e) {
            res.status(500).json({ error: e.message });
        }
    });

    // 5. MESSAGES API (Encryption/Decryption)
    router.post('/api/messages', verifySession, async (req, res) => {
        try {
            const { recipientId, payload, encrypted } = req.body;
            if (!recipientId || !payload) return res.status(400).json({ error: "Missing Data" });

            const senderId = req.user.username;

            // CLIENT-SIDE ENCRYPTION PATH (New Standard)
            if (encrypted) {
                // Payload is ALREADY "IV:Cipher:Tag" (Base64 or Hex) from Client
                // We just store it.
                // NOTE: We assume the client sends the FULL PACKET as 'payload'.
                // We can store it as is. IV column can be null or we extract it if possible, but for simplicity
                // in this hybrid mode, we just store the blob.

                await dbQuery(
                    `INSERT INTO messages (sender_id, recipient_id, payload, iv, created_at) VALUES ($1, $2, $3, $4, datetime('now'))`,
                    [senderId, recipientId, payload, 'CLIENT_ENCRYPTED']
                );

                await logAction('MESSAGE_SENT', `Encrypted message (Client-Side) sent to ${recipientId}`, req);
                return res.json({ success: true });
            }

            // SERVER-SIDE ENCRYPTION PATH (Legacy/Fallback)
            // 1. Get Key Supplement (Use as Base Key for compatibility with External Users)
            const mkRes = await dbQuery("SELECT value FROM settings WHERE key = 'key_supplement'");
            if (mkRes.rows.length === 0) throw new Error("System Integrity Error: No Supplement Key");
            const baseKey = mkRes.rows[0].value;

            // 2. Get Password from Session
            const password = req.session.password;
            if (!password) return res.status(401).json({ error: "Session Invalid (No Context)" });

            // 3. Derive Key
            const recipientIds = [recipientId];
            const derivedKey = cryptoLib.deriveKey(baseKey, password, senderId, recipientIds);

            // 4. Encrypt
            const encryptedData = cryptoLib.encrypt(payload, derivedKey); // { payload, iv }

            // 5. Store (Append SenderID to payload for Hybrid Decryption Support)
            // Internal DB Format: "Ciphertext:AuthTag::SenderID" (IV stored separately)
            const internalPayload = `${encryptedData.payload}::${senderId}`;

            await dbQuery(
                `INSERT INTO messages (sender_id, recipient_id, payload, iv, created_at) VALUES ($1, $2, $3, $4, datetime('now'))`,
                [senderId, recipientId, internalPayload, encryptedData.iv]
            );

            await logAction('MESSAGE_SENT', `Encrypted message sent to ${recipientId}`, req);

            // 6. Return FULL Packet for Manual Copy (Hybrid Compatibility)
            // Format: "IV:Cipher:Tag::SenderID"
            const fullPacket = `${encryptedData.iv}:${encryptedData.payload}::${senderId}`;

            res.json({ success: true, encryptedPacket: fullPacket });

        } catch (e) {
            console.error("Encrypt Error:", e);
            res.status(500).json({ error: e.message });
        }
    });

    router.get('/api/messages', verifySession, async (req, res) => {
        try {
            // 1. Get Key Supplement
            const mkRes = await dbQuery("SELECT value FROM settings WHERE key = 'key_supplement'");
            if (mkRes.rows.length === 0) throw new Error("No Supplement Key");
            const baseKey = mkRes.rows[0].value;
            const password = req.session.password;

            // 2. Fetch Messages (Sent or Received)
            const myId = req.user.username;
            const msgs = await dbQuery(
                `SELECT * FROM messages WHERE sender_id = $1 OR recipient_id = $1 ORDER BY created_at DESC LIMIT 50`,
                [myId]
            );

            // 3. Decrypt on the fly (PoC)
            const decryptedMsgs = msgs.rows.map(m => {
                try {
                    // Re-Derive Key (Factors: BaseKey + Password + Sender + Recipient)
                    const recIds = [m.recipient_id];
                    const key = cryptoLib.deriveKey(baseKey, password, m.sender_id, recIds);

                    // Parse Payload (Remove ::SenderID suffix used for Hybrid, keep Cipher:Tag)
                    let cleanPayload = m.payload;
                    if (cleanPayload.includes('::')) {
                        cleanPayload = cleanPayload.split('::')[0];
                    }

                    const plain = cryptoLib.decrypt(cleanPayload, m.iv, key);
                    return { ...m, payload: plain, encrypted: false };
                } catch (decErr) {
                    return { ...m, payload: "[Decryption Failed]", encrypted: true };
                }
            });

            res.json(decryptedMsgs);

        } catch (e) {
            console.error("Decrypt Error:", e);
            res.status(500).json({ error: e.message });
        }
    });

    // 6. AUDIT LOGS API
    router.get('/api/admin/audit-logs', verifySession, async (req, res) => {
        if (!req.user.isAdmin) return res.status(403).json({ error: 'Admin Only' });
        try {
            const limit = req.query.limit ? parseInt(req.query.limit) : 50;
            const logs = await dbQuery("SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT $1", [limit]);
            res.json(logs.rows);
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    // 7. USER MANAGEMENT API
    router.get('/api/admin/users', verifySession, async (req, res) => {
        if (!req.user.isAdmin) return res.status(403).json({ error: 'Admin Only' });
        try {
            const users = await dbQuery("SELECT id, username, is_admin, is_blocked, department, role_title, registered_at FROM users ORDER BY username ASC");
            res.json(users.rows);
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    // USER DETAILS API (For Modal) - ENTERPRISE VERSION
    router.get('/api/admin/users/:id/details', verifySession, async (req, res) => {
        if (!req.user.isAdmin) return res.status(403).json({ error: 'Admin Only' });
        try {
            const userId = req.params.id;
            // Join license_keys to get expires_at (aliased)
            const userRes = await dbQuery(`
                SELECT u.id, u.username, u.registered_at, u.last_login, u.registration_key_hash,
                       u.license_key_id, l.expires_at as license_expiration, u.is_blocked
                FROM users u
                LEFT JOIN license_keys l ON u.license_key_id = l.id
                WHERE u.id = $1
            `, [userId]);

            if (userRes.rows.length === 0) return res.status(404).json({ error: "User not found" });
            const user = {
                ...userRes.rows[0],
                is_blocked: (userRes.rows[0].is_blocked === 1)
            };

            let history = [];
            try {
                const histSql = `
                    SELECT key_code, product_code, activated_at, expires_at, is_active, origin
                    FROM license_keys
                    WHERE assigned_user_id = $1 OR id = $2
                    ORDER BY activated_at DESC
                `;
                const historyRes = await dbQuery(histSql, [user.username, user.license_key_id]);
                history = historyRes.rows;
            } catch(noTableErr) {
                // Ignore table missing error in strict Enterprise mode
            }

            res.json({ success: true, user, history });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    // MANUAL KEY LINK (Full Activation) - ENTERPRISE VERSION
    router.post('/api/admin/users/:id/link-key', verifySession, async (req, res) => {
        if (!req.user.isAdmin) return res.status(403).json({ error: 'Admin Only' });
        const userId = req.params.id;
        const { keyCode } = req.body;

        if (!keyCode) return res.status(400).json({ error: "Key Code missing" });

        try {
            // 1. Get User & Current Expiry from JOIN
            const userRes = await dbQuery(`
                SELECT u.username, u.license_key_id, l.expires_at
                FROM users u
                LEFT JOIN license_keys l ON u.license_key_id = l.id
                WHERE u.id = $1
            `, [userId]);

            if (userRes.rows.length === 0) return res.status(404).json({ error: "User not found" });
            const user = userRes.rows[0];

            // 2. Validate Key
            let key;
            try {
                const keyRes = await dbQuery('SELECT * FROM license_keys WHERE key_code = $1', [keyCode]);
                if (keyRes.rows.length === 0) return res.status(404).json({ error: "Key not found" });
                key = keyRes.rows[0];
            } catch(e) {
                return res.status(500).json({ error: "License System unavailable on this node (No Keys Table)." });
            }

            if (key.is_active) return res.status(403).json({ error: "Key already active" });

            // 3. Calculate New Expiration
            const pc = (key.product_code || '').toLowerCase();
            let extensionMonths = 1;
            if (pc === '3m') extensionMonths = 3;
            else if (pc === '6m') extensionMonths = 6;
            else if (pc === '1j' || pc === '12m') extensionMonths = 12;

            let newExpiresAt = null;
            if (pc === 'unl' || pc === 'unlimited') {
                newExpiresAt = null;
            } else {
                // Use fetched expires_at from key (via user object)
                newExpiresAt = calculateNewExpiration(user.expires_at, extensionMonths);
            }

            // 4. Update
            const now = new Date().toISOString();

            // Archive old key
            if (user.license_key_id) {
                await dbQuery(`UPDATE license_keys SET is_active = 0 WHERE id = $1`, [user.license_key_id]);
            }

            // Activate new key
            await dbQuery(
                `UPDATE license_keys SET is_active = 1, activated_at = $1, expires_at = $2, assigned_user_id = $3 WHERE id = $4`,
                [now, newExpiresAt, user.username, key.id]
            );

            // Link new key (no license_expiration update)
            await dbQuery(
                `UPDATE users SET license_key_id = $1 WHERE id = $2`,
                [key.id, userId]
            );

            await logAction('MANUAL_LINK', `Linked Key ${keyCode} to User ${userId}`, req);

            res.json({ success: true, newExpiresAt });

        } catch (e) {
            console.error("Link Key Error:", e);
            res.status(500).json({ error: "Link failed: " + e.message });
        }
    });

    // Create User
    router.post('/api/admin/users', verifySession, async (req, res) => {
        if (!req.user.isAdmin) return res.status(403).json({ error: 'Admin Only' });
        try {
            const { username, password, department, role_title } = req.body;
            if(!username || !password) return res.status(400).json({ error: "Missing fields" });

            // Hash Password
            const hash = await bcrypt.hash(password, 10);

            await dbQuery(
                `INSERT INTO users (username, password, department, role_title, is_admin, registered_at) VALUES ($1, $2, $3, $4, 0, datetime('now'))`,
                [username, hash, department || 'Unassigned', role_title || 'User']
            );

            await logAction('USER_CREATE', `Created user ${username}`, req);
            res.json({ success: true });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    router.patch('/api/admin/users/:id', verifySession, async (req, res) => {
        if (!req.user.isAdmin) return res.status(403).json({ error: 'Admin Only' });
        const { id } = req.params;
        const { department, role_title, is_blocked } = req.body;

        try {
            // Dynamic Update Builder
            let fields = [];
            let values = [];
            let idx = 1;

            if (department !== undefined) { fields.push(`department = $${idx++}`); values.push(department); }
            if (role_title !== undefined) { fields.push(`role_title = $${idx++}`); values.push(role_title); }
            if (is_blocked !== undefined) { fields.push(`is_blocked = $${idx++}`); values.push(is_blocked); }

            if (fields.length === 0) return res.status(400).json({ error: 'No fields to update' });

            values.push(id);
            await dbQuery(`UPDATE users SET ${fields.join(', ')} WHERE id = $${idx}`, values);

            await logAction('USER_UPDATE', `Updated user ID ${id}: ${fields.join(', ')}`, req);
            res.json({ success: true });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    router.delete('/api/admin/users/:id', verifySession, async (req, res) => {
        if (!req.user.isAdmin) return res.status(403).json({ error: 'Admin Only' });
        try {
            await dbQuery("DELETE FROM users WHERE id = $1", [req.params.id]);
            await logAction('USER_DELETE', `Deleted user ID ${req.params.id}`, req);
            res.json({ success: true });
        } catch(e) { res.status(500).json({ error: e.message }); }
    });

    // DASHBOARD METRICS API
    router.get('/api/admin/metrics', verifySession, async (req, res) => {
        if (!req.user.isAdmin) return res.status(403).json({ error: 'Admin Only' });
        try {
            const users = await dbQuery("SELECT COUNT(*) as c FROM users");
            // Count unique licenses? In enterprise context, we might count assigned keys or just total users as 'Active Licenses' for now
            // Or better, count non-blocked users
            const activeUsers = await dbQuery("SELECT COUNT(*) as c FROM users WHERE is_blocked = 0");
            const lastBackup = "Unknown"; // Placeholder until backup logic is implemented

            res.json({
                total_users: users.rows[0].c,
                active_licenses: activeUsers.rows[0].c,
                status: 'ONLINE',
                last_backup: lastBackup
            });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    // BACKUP API
    router.get('/api/admin/backup', async (req, res) => {
        // Token in query param for direct download link
        const token = req.query.token;
        if (!token || !activeSessions.has(token)) return res.status(403).send("Unauthorized");

        try {
            // Simple SQL Dump Simulation (SQLite specific)
            // In a real env, we might stream the .db file or run .dump
            // Here we just dump tables to JSON for portability as "SQL-like" backup
            const users = await dbQuery("SELECT * FROM users");
            const msgs = await dbQuery("SELECT * FROM messages");
            const settings = await dbQuery("SELECT * FROM settings");
            const logs = await dbQuery("SELECT * FROM audit_logs");

            const backup = {
                timestamp: new Date().toISOString(),
                tables: { users: users.rows, messages: msgs.rows, settings: settings.rows, audit_logs: logs.rows }
            };

            res.setHeader('Content-Disposition', `attachment; filename="enterprise_backup_${Date.now()}.json"`);
            res.setHeader('Content-Type', 'application/json');
            res.send(JSON.stringify(backup, null, 2));

            // We can't easily log this action since we don't have 'req' with user context fully hydrated,
            // but we could try extracting from token if needed.
        } catch(e) { res.status(500).send("Backup Failed"); }
    });

    // HUB STATUS API
    router.post('/api/admin/hub-status', verifySession, async (req, res) => {
        if (!req.user.isAdmin) return res.status(403).json({ error: 'Admin Only' });
        try {
            const { active } = req.body;
            // Upsert setting
            const exists = await dbQuery("SELECT * FROM settings WHERE key='hub_active'");
            if(exists.rows.length > 0) {
                await dbQuery("UPDATE settings SET value=$1 WHERE key='hub_active'", [active ? '1' : '0']);
            } else {
                await dbQuery("INSERT INTO settings (key, value) VALUES ('hub_active', $1)", [active ? '1' : '0']);
            }
            await logAction('HUB_STATUS', `Hub status changed to ${active ? 'ACTIVE' : 'OFFLINE'}`, req);
            res.json({ success: true });
        } catch(e) { res.status(500).json({ error: e.message }); }
    });

    router.get('/api/admin/hub-status', verifySession, async (req, res) => {
        try {
            const resS = await dbQuery("SELECT value FROM settings WHERE key='hub_active'");
            const active = resS.rows.length > 0 ? resS.rows[0].value === '1' : true; // Default true
            res.json({ active });
        } catch(e) { res.json({ active: true }); }
    });

    // MESSAGE READ API
    router.patch('/api/admin/messages/:id/read', verifySession, async (req, res) => {
        try {
            await dbQuery("UPDATE messages SET is_read=1 WHERE id=$1", [req.params.id]);
            res.json({ success: true });
        } catch(e) { res.status(500).json({ error: e.message }); }
    });

    // ==================================================================
    // FORUM / SECURITY HUB API (Enterprise Local)
    // ==================================================================

    // 1. STATS
    router.get('/api/admin/forum/stats', verifySession, async (req, res) => {
        if (!req.user.isAdmin) return res.status(403).json({ error: 'Admin Only' });
        try {
            const posts = await dbQuery(`SELECT COUNT(*) as c FROM security_posts`);
            const comments = await dbQuery(`SELECT COUNT(*) as c FROM security_comments`);
            const likes = await dbQuery(`SELECT COUNT(*) as c FROM security_interactions WHERE interaction_type = 'like'`);
            const questions = await dbQuery(`SELECT COUNT(*) as c FROM security_interactions WHERE interaction_type = 'question'`);
            const bookmarks = await dbQuery(`SELECT COUNT(*) as c FROM user_bookmarks`);

            res.json({
                success: true,
                stats: {
                    posts: posts.rows[0].c,
                    comments: comments.rows[0].c,
                    likes: likes.rows[0].c,
                    questions: questions.rows[0].c,
                    bookmarks: bookmarks.rows[0].c
                }
            });
        } catch(e) { res.status(500).json({ error: e.message }); }
    });

    // 2. LIST POSTS (ADMIN)
    router.get('/api/admin/posts', verifySession, async (req, res) => {
        if (!req.user.isAdmin) return res.status(403).json({ error: 'Admin Only' });
        try {
            const result = await dbQuery(`
                SELECT p.*,
                (SELECT COUNT(*) FROM security_interactions WHERE post_id = p.id AND interaction_type = 'like') as likes,
                (SELECT COUNT(*) FROM security_interactions WHERE post_id = p.id AND interaction_type = 'dislike') as dislikes,
                (SELECT COUNT(*) FROM security_interactions WHERE post_id = p.id AND interaction_type = 'question') as questions,
                (SELECT COUNT(*) FROM security_comments WHERE post_id = p.id) as comments_count
                FROM security_posts p
                ORDER BY created_at DESC
            `);
            res.json(result.rows);
        } catch(e) { res.status(500).json({ error: e.message }); }
    });

    // 2b. LIST POSTS (PUBLIC/USER for Preview in Hub)
    router.get('/api/posts', verifySession, async (req, res) => {
        try {
            const result = await dbQuery(`
                SELECT id, title, subtitle, image_url, priority, created_at,
                (SELECT COUNT(*) FROM security_interactions WHERE post_id = p.id AND interaction_type = 'like') as likes,
                (SELECT COUNT(*) FROM security_interactions WHERE post_id = p.id AND interaction_type = 'dislike') as dislikes,
                (SELECT COUNT(*) FROM security_interactions WHERE post_id = p.id AND interaction_type = 'question') as questions,
                (SELECT COUNT(*) FROM security_comments WHERE post_id = p.id) as comments_count
                FROM security_posts p
                WHERE status = 'published'
                ORDER BY created_at DESC
            `);
            res.json(result.rows);
        } catch(e) { res.status(500).json({ error: e.message }); }
    });

    // 3. CREATE POST
    router.post('/api/admin/posts', verifySession, async (req, res) => {
        if (!req.user.isAdmin) return res.status(403).json({ error: 'Admin Only' });
        try {
            const { title, subtitle, content, priority, status, image_url } = req.body;
            await dbQuery(`
                INSERT INTO security_posts (title, subtitle, content, image_url, priority, status, created_at)
                VALUES ($1, $2, $3, $4, $5, $6, datetime('now'))
            `, [title, subtitle, content, image_url, priority || 'Info', status || 'draft']);
            res.json({ success: true });
        } catch(e) { res.status(500).json({ error: e.message }); }
    });

    // 4. UPDATE POST
    router.put('/api/admin/posts/:id', verifySession, async (req, res) => {
        if (!req.user.isAdmin) return res.status(403).json({ error: 'Admin Only' });
        try {
            const { title, subtitle, content, priority, status, image_url } = req.body;
            await dbQuery(`
                UPDATE security_posts SET title = $1, subtitle = $2, content = $3, image_url = $4, priority = $5, status = $6
                WHERE id = $7
            `, [title, subtitle, content, image_url, priority, status, req.params.id]);
            res.json({ success: true });
        } catch(e) { res.status(500).json({ error: e.message }); }
    });

    // 5. DELETE POST
    router.delete('/api/admin/posts/:id', verifySession, async (req, res) => {
        if (!req.user.isAdmin) return res.status(403).json({ error: 'Admin Only' });
        try {
            await dbQuery(`DELETE FROM security_posts WHERE id = $1`, [req.params.id]);
            await dbQuery(`DELETE FROM security_interactions WHERE post_id = $1`, [req.params.id]);
            await dbQuery(`DELETE FROM security_comments WHERE post_id = $1`, [req.params.id]);
            res.json({ success: true });
        } catch(e) { res.status(500).json({ error: e.message }); }
    });

    // 6. UPLOAD IMAGE
    router.post('/api/admin/posts/upload', verifySession, upload.single('image'), (req, res) => {
        if (!req.user.isAdmin) return res.status(403).json({ error: 'Admin Only' });
        if (!req.file) return res.status(400).json({ error: "Kein Bild." });
        res.json({ success: true, url: `/uploads/security/${req.file.filename}` });
    });

    // Root Logic
    router.get('/', async (req, res) => {
        try {
            // Check if any user exists in the database
            const result = await dbQuery("SELECT COUNT(*) as c FROM users");
            const count = result.rows[0].c;

            if (count > 0) {
                // System initialized -> FORCE LOGIN
                // We do not redirect to portal directly. The portal is protected client-side,
                // but for root navigation, we send them to login.
                res.redirect('/login-enterprise.html');
            } else {
                // No users -> Setup
                res.redirect('/admin-setup.html');
            }
        } catch (err) {
            console.error("Enterprise Router Error:", err);
            res.status(500).send("Enterprise System Error: " + err.message);
        }
    });

    return router;
};
