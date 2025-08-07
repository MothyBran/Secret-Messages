// database/db.js
const { Pool } = require("pg");
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

module.exports = {
  query: (text, params) => pool.query(text, params)
};

// Datenbankverbindung
const db = new sqlite3.Database(path.resolve(__dirname, 'database.sqlite'));

// Benutzer anhand ID laden
function getUserById(id) {
  return new Promise((resolve, reject) => {
    db.get('SELECT * FROM users WHERE id = ?', [id], (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

// Lizenz anhand Lizenz-ID laden (aus users.license_key_id)
function getLicenseById(id) {
  return new Promise((resolve, reject) => {
    db.get('SELECT * FROM license_keys WHERE id = ?', [id], (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

// Exportieren
module.exports = {
  getUserById,
  getLicenseById,
};
