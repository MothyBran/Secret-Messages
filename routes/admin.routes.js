// routes/admin.routes.js
const express = require("express");
const router = express.Router();
const db = require("../database/db"); // deine DB-Verbindung
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

// Käufe abrufen
router.post("/purchases", async (req, res) => {
  const { password } = req.body;

  if (password !== ADMIN_PASSWORD) {
    return res.status(403).json({ success: false, error: "Zugriff verweigert" });
  }

  try {
    const result = await db.query(
      "SELECT buyer, license, price, date FROM purchases ORDER BY date DESC LIMIT 100"
    );
    res.json({ success: true, purchases: result.rows });
  } catch (err) {
    console.error("Fehler bei /purchases:", err);
    res.status(500).json({ success: false, error: "Datenbankfehler" });
  }
});

module.exports = router;
