const express = require('express');
const router = express.Router();
const path = require('path');

module.exports = (dbQuery) => {
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
