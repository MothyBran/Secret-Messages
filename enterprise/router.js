const express = require('express');
const router = express.Router();
const path = require('path');
const bcrypt = require('bcryptjs');

module.exports = (dbQuery) => {
    // Setup Endpoint
    router.post('/api/setup', async (req, res) => {
        try {
            const { username, password } = req.body;
            if (!username || !password) {
                return res.status(400).json({ error: 'Missing credentials' });
            }

            // Check if admin already exists to prevent takeover
            const check = await dbQuery("SELECT COUNT(*) as c FROM users");
            if (check.rows[0].c > 0) {
                return res.status(403).json({ error: 'System already initialized' });
            }

            const hash = await bcrypt.hash(password, 10);

            await dbQuery(
                `INSERT INTO users (username, access_code_hash, is_admin, registered_at) VALUES ($1, $2, 1, datetime('now'))`,
                [username, hash]
            );

            res.json({ success: true });
        } catch (e) {
            console.error("Setup Error:", e);
            res.status(500).json({ error: e.message });
        }
    });

    // Root Logic: Check if system is initialized (Admin exists)
    router.get('/', async (req, res) => {
        try {
            // Check if any user exists in the database
            const result = await dbQuery("SELECT COUNT(*) as c FROM users");
            const count = result.rows[0].c;

            if (count > 0) {
                // System initialized -> Login/Portal
                res.redirect('/portal.html');
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
