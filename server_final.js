
const express = require("express");
const rateLimit = require("express-rate-limit");
const path = require("path");

const app = express();

// 🛡️ Trust Proxy für Railway/Vercel/Heroku
app.set("trust proxy", 1);

// 📊 Rate Limiting aktivieren
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 Minuten
  max: 100, // max 100 Requests pro IP
  standardHeaders: true,
  legacyHeaders: false
});
app.use(limiter);

// 📁 Statische Dateien aus dem "public"-Ordner
app.use(express.static(path.join(__dirname, "public")));

// 📄 index.html ausliefern
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// 🟢 Server starten
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("🚀 Server läuft auf Port", PORT);
});
