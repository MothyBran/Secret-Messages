// payment.js – Secure Stripe Webhook Integration
const express = require('express');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const crypto = require('crypto');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const { sendLicenseEmail } = require('./email/mailer');

const router = express.Router();

// DB Connection Setup (identisch zu vorher)
let pool;
if (process.env.DATABASE_URL && process.env.DATABASE_URL.includes('postgresql')) {
    pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }
    });
} else {
    // Fallback für SQLite (Development) - Mock Pool für Kompatibilität
    const sqlite3 = require('sqlite3').verbose();
    const db = new sqlite3.Database('./secret_messages.db');
    pool = {
        query: (text, params) => {
            return new Promise((resolve, reject) => {
                // Einfacher Wrapper für SQLite damit der Code unten gleich bleibt
                if (text.trim().toLowerCase().startsWith('select')) {
                    db.all(text.replace(/\$\d/g, '?'), params, (err, rows) => {
                        if (err) reject(err); else resolve({ rows });
                    });
                } else {
                    db.run(text.replace(/\$\d/g, '?'), params, function(err) {
                        if (err) reject(err); else resolve({ rowCount: this.changes });
                    });
                }
            });
        }
    };
}

// Helper: Get Transaction Client (Abstraction for PG vs SQLite)
async function getTransactionClient() {
    if (process.env.DATABASE_URL && process.env.DATABASE_URL.includes('postgresql')) {
        // PostgreSQL: Get dedicated client from pool
        const client = await pool.connect();
        return client;
    } else {
        // SQLite: Return dummy client that delegates to pool (single connection)
        return {
            query: async (text, params) => await pool.query(text, params),
            release: () => {} // No-op
        };
    }
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
        const sRes = await pool.query("SELECT value FROM settings WHERE key = 'shop_active'");
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

  // START TRANSACTION
  const client = await getTransactionClient();
  try {
      // For PG: This starts a transaction block
      // For SQLite Mock: It executes 'BEGIN', which works for SQLite too
      await client.query('BEGIN');

      const durationDays = duration_days === 'null' ? null : Number(duration_days);
      const createdAt = new Date().toISOString();

      const keys = [];

      // UPDATE VS INSERT LOGIC
      if (type === 'renewal' && license_key_id) {
          console.log(`🔄 RENEWAL START for Key ID: ${license_key_id}`);

          // 1. Fetch User Info (We need the User linked to this key to update them)
          const userRes = await client.query('SELECT id, username, license_expiration FROM users WHERE license_key_id = $1', [license_key_id]);

          if (userRes.rows.length > 0) {
              const user = userRes.rows[0];
              const userId = user.id;
              const username = user.username;
              const currentExpiryStr = user.license_expiration;

              // 2. Calculate New Expiration: MAX(NOW, Old) + Duration
              let baseDate = new Date();
              const currentExpiry = currentExpiryStr ? new Date(currentExpiryStr) : null;
              if (currentExpiry && !isNaN(currentExpiry.getTime()) && currentExpiry > baseDate) {
                  baseDate = currentExpiry;
              }
              const newExpiresAt = durationDays ? addDays(baseDate.toISOString(), durationDays) : null;

              // 3. Generate NEW Key (Requirements: New Key for History, Auto-Assign)
              const newCode = generateKeyCode();
              const newHash = crypto.createHash('sha256').update(newCode).digest('hex');

              // 4. Archive OLD Key (Ensure it keeps assigned_user_id for history, but inactive)
              await client.query(
                  `UPDATE license_keys SET is_active = $1, assigned_user_id = $2 WHERE id = $3`,
                  [(process.env.DATABASE_URL && process.env.DATABASE_URL.includes('postgresql') ? false : 0), username, license_key_id]
              );

              // 5. Insert NEW Key (Active & Assigned)
              await client.query(
                `INSERT INTO license_keys (key_code, key_hash, created_at, expires_at, is_active, product_code, origin, assigned_user_id, activated_at)
                 VALUES ($1, $2, $3, $4, $5, $6, 'shop', $7, $8)`,
                [
                    newCode,
                    newHash,
                    createdAt,
                    newExpiresAt,
                    (process.env.DATABASE_URL && process.env.DATABASE_URL.includes('postgresql') ? true : 1),
                    product_type,
                    username,
                    createdAt
                ]
              );

              // Fetch new Key ID
              const newKeyRes = await client.query('SELECT id FROM license_keys WHERE key_code = $1', [newCode]);
              const newKeyId = newKeyRes.rows[0].id;

              // 6. Update User (Critical Fix: Update users table expiration)
              await client.query(
                  `UPDATE users SET license_key_id = $1, license_expiration = $2 WHERE id = $3`,
                  [newKeyId, newExpiresAt, userId]
              );

              // 7. Log Renewal
              await client.query(
                  'INSERT INTO license_renewals (user_id, key_code_hash, extended_until, used_at) VALUES ($1, $2, $3, $4)',
                  [userId, newHash, newExpiresAt, createdAt]
              );

              keys.push(newCode); // Add to keys list for email/display
              console.log(`✅ Renewal Success: New Key ${newCode} assigned to ${username}. Valid until ${newExpiresAt}`);

          } else {
              console.error("❌ Renewal failed: User not found for license_key_id " + license_key_id);
              // Fallback: Generate fresh key so user gets something
              const count = Number(key_count) || 1;
              const expiresAt = durationDays ? addDays(createdAt, durationDays) : null;
              for (let i = 0; i < count; i++) {
                const code = generateKeyCode();
                const hash = crypto.createHash('sha256').update(code).digest('hex');
                await client.query(
                  `INSERT INTO license_keys (key_code, key_hash, created_at, expires_at, is_active, product_code, origin)
                   VALUES ($1, $2, $3, $4, $5, $6, 'shop')`,
                  [code, hash, createdAt, expiresAt, false, product_type]
                );
                keys.push(code);
              }
          }
      } else {
          // NORMALER KAUF (NEUE KEYS)
          const count = Number(key_count) || 1;
          const expiresAt = durationDays ? addDays(createdAt, durationDays) : null;

          for (let i = 0; i < count; i++) {
            const code = generateKeyCode();
            const hash = crypto.createHash('sha256').update(code).digest('hex'); // Hash für DB

            // In DB speichern
            await client.query(
              `INSERT INTO license_keys (key_code, key_hash, created_at, expires_at, is_active, product_code, origin)
               VALUES ($1, $2, $3, $4, $5, $6, 'shop')`,
              [code, hash, createdAt, expiresAt, (process.env.DATABASE_URL && process.env.DATABASE_URL.includes('postgresql') ? false : 0), product_type]
            );
            keys.push(code);
          }
      }

      // 3. Zahlung protokollieren
      await client.query(
        `INSERT INTO payments (payment_id, amount, currency, status, payment_method, completed_at, metadata)
         VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP, $6)`,
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

      await client.query('COMMIT');

  } catch (err) {
      await client.query('ROLLBACK');
      console.error("Payment Transaction Failed (Rolled Back):", err);
      throw err; // Re-throw to trigger 500 in Webhook Handler
  } finally {
      client.release();
  }

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
