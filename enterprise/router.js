const express = require('express');
const router = express.Router();
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cryptoLib = require('./crypto');
const fetch = require('node-fetch'); // Ensure node-fetch is available (legacy version in package.json)

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

module.exports = (dbQuery) => {

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

            // Store User (Local Admin)
            await dbQuery(
                `INSERT INTO users (username, password, is_admin, department, role_title, registered_at) VALUES ($1, $2, 1, 'Management', 'System Administrator', datetime('now'))`,
                [username, hash]
            );

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
            const { recipientId, payload } = req.body;
            if (!recipientId || !payload) return res.status(400).json({ error: "Missing Data" });

            // 1. Get Key Supplement (Use as Base Key for compatibility with External Users)
            const mkRes = await dbQuery("SELECT value FROM settings WHERE key = 'key_supplement'");
            if (mkRes.rows.length === 0) throw new Error("System Integrity Error: No Supplement Key");
            const baseKey = mkRes.rows[0].value;

            // 2. Get Password from Session
            const password = req.session.password;
            if (!password) return res.status(401).json({ error: "Session Invalid (No Context)" });

            // 3. Derive Key
            const senderId = req.user.username; // Use username as ID for Enterprise
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
