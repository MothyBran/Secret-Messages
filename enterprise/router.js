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
                `INSERT INTO users (username, password, is_admin, registered_at) VALUES ($1, $2, 1, datetime('now'))`,
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
            if (result.rows.length === 0) return res.status(401).json({ error: 'Invalid Credentials' });

            const user = result.rows[0];
            // Check password column first, fallback to access_code_hash for migration safety
            const dbHash = user.password || user.access_code_hash;
            const match = await bcrypt.compare(password, dbHash);

            if (!match) return res.status(401).json({ error: 'Invalid Credentials' });

            // Success -> Generate Token
            const token = jwt.sign({ id: user.id, username: user.username, isAdmin: user.is_admin }, JWT_SECRET, { expiresIn: '8h' });

            // Store password in memory session for encryption operations
            activeSessions.set(token, { password: password });

            // Redirect based on Role (Unified Login)
            const redirectPath = (user.is_admin === 1) ? '/portal.html' : '/app';
            res.json({ success: true, token, redirect: redirectPath });

        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    // 3. LOCK API
    router.post('/api/lock', verifySession, (req, res) => {
        const token = req.headers['authorization']?.split(' ')[1];
        if (token) activeSessions.delete(token);
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
