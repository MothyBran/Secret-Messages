// payment.js – Secure Stripe Webhook Integration
const express = require('express');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const crypto = require('crypto');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const { sendLicenseEmail } = require('./email/mailer');
const path = require('path');

const router = express.Router();

// DB Connection Setup
let pool;
let isPostgreSQL = false;
let nedb = {};

if (process.env.DATABASE_URL && process.env.DATABASE_URL.includes('postgresql')) {
    isPostgreSQL = true;
    pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }
    });
} else {
    // Fallback für Local Mode (NeDB) - Mock Pool für Kompatibilität
    // Wenn Shop lokal läuft (unwahrscheinlich aber der Code muss kompilieren)
    const Datastore = require('nedb-promises');
    const fs = require('fs');

    let dbPath = './data';
    if (!fs.existsSync(dbPath)){ fs.mkdirSync(dbPath); }

    nedb.payments = Datastore.create({ filename: path.join(dbPath, 'payments.db'), autoload: true });
    nedb.license_keys = Datastore.create({ filename: path.join(dbPath, 'license_keys.db'), autoload: true });
    nedb.settings = Datastore.create({ filename: path.join(dbPath, 'settings.db'), autoload: true });
    nedb.users = Datastore.create({ filename: path.join(dbPath, 'users.db'), autoload: true });

    pool = {
        query: async (text, params) => {
            // Very limited adapter for specific queries used in payment.js
            // NOTE: Ideally payments run on Cloud only.
            const t = text.trim().toLowerCase();

            if(t.includes("from settings where key =")) {
                const res = await nedb.settings.findOne({ key: params[0] });
                return { rows: res ? [res] : [] };
            }
            if(t.includes("from users where id =")) {
                const res = await nedb.users.findOne({ id: params[0] });
                return { rows: res ? [res] : [] };
            }
            if(t.includes("from payments where payment_id =")) {
                const res = await nedb.payments.findOne({ payment_id: params[0] });
                return { rows: res ? [res] : [] };
            }
            if(t.includes("from license_keys where id =")) {
                const res = await nedb.license_keys.findOne({ id: params[0] });
                return { rows: res ? [res] : [] };
            }
            if(t.startsWith("update license_keys set")) {
                // Mock Update: UPDATE license_keys SET expires_at = $1, is_active = $2 WHERE id = $3
                await nedb.license_keys.update({ id: params[2] }, { $set: { expires_at: params[0], is_active: params[1] } });
                return { rowCount: 1 };
            }
            if(t.startsWith("insert into license_keys")) {
                // INSERT INTO license_keys (key_code, key_hash, created_at, expires_at, is_active, product_code) VALUES ...
                await nedb.license_keys.insert({
                    key_code: params[0], key_hash: params[1], created_at: params[2],
                    expires_at: params[3], is_active: params[4], product_code: params[5],
                    id: Math.floor(Math.random() * 1000000) // Mock ID
                });
                return { rowCount: 1 };
            }
            if(t.startsWith("insert into payments")) {
                // INSERT INTO payments ...
                await nedb.payments.insert({
                    payment_id: params[0], amount: params[1], currency: params[2],
                    status: params[3], payment_method: params[4], completed_at: new Date().toISOString(),
                    metadata: params[5]
                });
                return { rowCount: 1 };
            }

            console.warn("Unhandled NeDB Query in payment.js:", text);
            return { rows: [] };
        }
    };
}

// Helper Functions
const PRICES = {
  "1m":        { amount: 199,  currency: "eur", name: "1 Monat Zugang",            durationDays: 30,  keyCount: 1 },
  "3m":        { amount: 449,  currency: "eur", name: "3 Monate Zugang",           durationDays: 90,  keyCount: 1 },
  "12m":       { amount: 1499, currency: "eur", name: "12 Monate Zugang",          durationDays: 360, keyCount: 1 },
  "unlimited": { amount: 4999, currency: "eur", name: "Unbegrenzter Zugang",       durationDays: null, keyCount: 1 },
  // Bundles hier bei Bedarf ergänzen...
};

function generateKeyCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  while (out.length < 15) {
    const byte = crypto.randomBytes(1)[0];
    const max = 256 - (256 % chars.length);
    if (byte < max) out += chars[byte % chars.length];
  }
  return out.slice(0,5)+'-'+out.slice(5,10)+'-'+out.slice(10,15);
}

function addDays(iso, days) {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}

// 1. Session erstellen (Frontend ruft dies auf)
router.post("/create-checkout-session", async (req, res) => {
  try {
    const { product_type, customer_email, is_renewal } = req.body;

    // Check Shop Status
    try {
        const sRes = await pool.query("SELECT value FROM settings WHERE key = 'shop_active'", ['shop_active']);
        if (sRes.rows.length > 0 && sRes.rows[0].value === 'false') {
             return res.status(503).json({ error: 'Shop is currently offline.' });
        }
    } catch(e) { console.warn("Shop check failed", e); }

    const product = PRICES[product_type];
    
    if (!product) return res.status(400).json({ error: 'Invalid product' });

    let licenseKeyId = null;
    let type = 'new';

    // RENEWAL LOGIC
    if (is_renewal) {
        const authHeader = req.headers['authorization'];
        const token = authHeader && authHeader.split(' ')[1];
        if (!token) return res.status(401).json({ error: 'Renewal requires auth' });

        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            const userRes = await pool.query('SELECT license_key_id FROM users WHERE id = $1', [decoded.id]);
            if (userRes.rows.length === 0) return res.status(404).json({ error: 'User not found' });

            licenseKeyId = userRes.rows[0].license_key_id;
            type = 'renewal';
        } catch (e) {
            return res.status(403).json({ error: 'Invalid token' });
        }
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      customer_email, // Stripe füllt das Feld für den User vor
      line_items: [{
        price_data: {
          currency: product.currency,
          unit_amount: product.amount,
          product_data: { name: `${product.name}` }
        },
        quantity: 1
      }],
      // Add metadata to session as well, so we can access it in checkout.session.completed
      metadata: {
        product_type,
        duration_days: product.durationDays === null ? 'null' : String(product.durationDays),
        key_count: String(product.keyCount),
        type: type,
        license_key_id: licenseKeyId ? String(licenseKeyId) : ''
      },
      payment_intent_data: {
        metadata: {
          product_type, // Wichtig für den Webhook später
          duration_days: product.durationDays === null ? 'null' : String(product.durationDays),
          key_count: String(product.keyCount),
          type: type,
          license_key_id: licenseKeyId ? String(licenseKeyId) : ''
        }
      },
      // Wir leiten den User zurück zur Store-Seite mit der Session ID
      success_url: `${process.env.FRONTEND_URL}/shop?success=true&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.FRONTEND_URL}/shop?canceled=true`
    });

    res.json({ success: true, checkout_url: session.url });
  } catch (err) {
    console.error("Create Session Error:", err);
    res.status(500).json({ error: err.message });
  }
});

// 2. WEBHOOK - Hier passiert die echte Verarbeitung (Sicher!)
router.post('/webhook', async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    // WICHTIG: Hier brauchen wir req.rawBody (siehe server.js Änderung)
    event = stripe.webhooks.constructEvent(req.rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error(`Webhook Signature Error: ${err.message}`);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Handle the event
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    console.log(`💰 Session abgeschlossen: ${session.id}`);
    
    // Use session object which has customer_details.email
    await handleSuccessfulPayment(session);
  } else if (event.type === 'payment_intent.succeeded') {
     // Legacy/Backup handler - usually checkout.session.completed is better for Checkout
     console.log(`ℹ️ Payment Intent succeeded: ${event.data.object.id}`);
  }

  res.json({received: true});
});

// Logik für erfolgreiche Zahlung (ausgelagert)
async function handleSuccessfulPayment(session) {
  // Extract data from Session (not PaymentIntent)
  const { product_type, duration_days, key_count, type, license_key_id } = session.metadata;
  
  // Use payment_intent ID as the unique identifier for our DB
  // session.payment_intent is the ID string
  const paymentId = session.payment_intent;

  // 1. Prüfen ob wir diese Zahlung schon bearbeitet haben (Idempotency)
  const existing = await pool.query('SELECT id FROM payments WHERE payment_id = $1', [paymentId]);
  if (existing.rows && existing.rows.length > 0) {
    console.log('⚠️ Zahlung bereits verarbeitet.');
    return;
  }

  const durationDays = duration_days === 'null' ? null : Number(duration_days);
  const createdAt = new Date().toISOString();

  const keys = [];

  // UPDATE VS INSERT LOGIC
  if (type === 'renewal' && license_key_id) {
      console.log(`🔄 RENEWAL START for Key ID: ${license_key_id}`);

      // Bestehenden Key holen
      const keyRes = await pool.query('SELECT * FROM license_keys WHERE id = $1', [license_key_id]);
      if (keyRes.rows.length > 0) {
          const key = keyRes.rows[0];

          // Neues Ablaufdatum berechnen
          let baseDate = new Date();
          if (key.expires_at && new Date(key.expires_at) > baseDate) {
              baseDate = new Date(key.expires_at); // Wenn noch gültig, addiere oben drauf
          }
          const newExpiresAt = durationDays ? addDays(baseDate.toISOString(), durationDays) : null;

          // Update
          await pool.query(
              `UPDATE license_keys SET expires_at = $1, is_active = $2 WHERE id = $3`,
              [newExpiresAt, (isPostgreSQL ? true : 1), license_key_id]
          );

          console.log(`✅ Lizenz verlängert bis ${newExpiresAt}`);
      } else {
          console.error("❌ Renewal failed: Key not found");
      }
  } else {
      // NORMALER KAUF (NEUE KEYS)
      const count = Number(key_count) || 1;
      const expiresAt = durationDays ? addDays(createdAt, durationDays) : null;

      for (let i = 0; i < count; i++) {
        const code = generateKeyCode();
        const hash = crypto.createHash('sha256').update(code).digest('hex'); // Hash für DB

        // In DB speichern
        await pool.query(
          `INSERT INTO license_keys (key_code, key_hash, created_at, expires_at, is_active, product_code)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [code, hash, createdAt, expiresAt, false, product_type] // is_active = false bis Aktivierung durch User
        );
        keys.push(code);
      }
  }

  // 3. Zahlung protokollieren
  await pool.query(
    `INSERT INTO payments (payment_id, amount, currency, status, payment_method, completed_at, metadata)
     VALUES ($1, $2, $3, $4, $5, NOW(), $6)`,
    [
      paymentId,
      session.amount_total,
      session.currency,
      'completed', 
      'stripe', 
      JSON.stringify({ 
        product_type, 
        keys_generated: keys,
        type: type || 'new',
        email: session.customer_details ? session.customer_details.email : null
      }) 
    ]
  );

  console.log(`✅ ${keys.length} Keys generiert für Payment ${paymentId}`);

  // 4. E-Mail Versand
  const customerEmail = session.customer_details ? session.customer_details.email : null;
  if (customerEmail) {
      // keys is an array of strings like ["XXXX-XXXX-XXXX", ...]
      // We pass it directly; the mailer handles arrays.
      await sendLicenseEmail(customerEmail, keys, product_type);
  }
}

// 3. Status Check für Frontend (Ersetzt confirm-session)
// Das Frontend pollt diesen Endpunkt, um die Keys anzuzeigen
router.get("/order-status", async (req, res) => {
  const { session_id } = req.query;
  if (!session_id) return res.status(400).json({ error: "No session_id" });

  try {
    // Session von Stripe holen um Payment Intent ID zu bekommen
    const session = await stripe.checkout.sessions.retrieve(session_id);
    const paymentIntentId = session.payment_intent;

    // Prüfen ob DB Eintrag existiert
    const result = await pool.query(
      'SELECT metadata FROM payments WHERE payment_id = $1', 
      [paymentIntentId]
    );

    if (result.rows.length > 0) {
      const metadata = result.rows[0].metadata;
      // Metadaten sind in Postgres JSONB oder Text, in SQLite Text. Parsen:
      const data = typeof metadata === 'string' ? JSON.parse(metadata) : metadata;
      
      return res.json({ 
        success: true, 
        status: 'completed', 
        keys: data.keys_generated,
        renewed: (data.type === 'renewal'),
        customer_email: session.customer_email
      });
    } else {
      // Noch nicht vom Webhook verarbeitet
      return res.json({ success: true, status: 'processing' });
    }

  } catch (err) {
    console.error("Order Status Error:", err);
    res.json({ success: false, status: 'error' });
  }
});

// Admin und andere Routen bleiben hier drunter erhalten...
module.exports = router;
