// payment.js – Secure Stripe Webhook Integration (Rebuild)
const express = require('express');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const crypto = require('crypto');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const { sendLicenseEmail } = require('./email/mailer');

const router = express.Router();

console.log("Stripe Secret Key Loaded:", process.env.STRIPE_SECRET_KEY ? "YES (****)" : "NO");
console.log("Stripe Webhook Secret Loaded:", process.env.STRIPE_WEBHOOK_SECRET ? "YES (****)" : "NO");

// 1. DATA FOUNDATION & PRICES
const PRICES = {
  "1m":           { amount: 199,   currency: "eur", name: "1 Monat Zugang",            durationDays: 30,  keyCount: 1 },
  "3m":           { amount: 495,   currency: "eur", name: "3 Monate Zugang",           durationDays: 90,  keyCount: 1 },
  "12m":          { amount: 1790,  currency: "eur", name: "12 Monate Zugang",          durationDays: 360, keyCount: 1 },
  "unlimited":    { amount: 5999,  currency: "eur", name: "Unbegrenzter Zugang",       durationDays: null, keyCount: 1 },
  "bundle_1m_2":  { amount: 379,   currency: "eur", name: "2x Keys (1 Monat)",      durationDays: 30,  keyCount: 2 },
  "bundle_3m_5":  { amount: 1980,  currency: "eur", name: "5x Keys (3 Monate)",     durationDays: 90,  keyCount: 5 },
  "bundle_3m_2":  { amount: 899,   currency: "eur", name: "2x Keys (3 Monate)",      durationDays: 90,  keyCount: 2 },
  "bundle_1y_10": { amount: 14999, currency: "eur", name: "10x Keys (12 Monate)",    durationDays: 360, keyCount: 10 }
};

// 2. DATABASE SETUP & ABSTRACTION
let pool;
if (process.env.DATABASE_URL && process.env.DATABASE_URL.includes('postgresql')) {
    pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }
    });
} else {
    // SQLite Fallback
    const sqlite3 = require('sqlite3').verbose();
    // Use USER_DATA_PATH if available (Electron), else relative
    const path = require('path');
    const dbPath = process.env.USER_DATA_PATH
        ? path.join(process.env.USER_DATA_PATH, 'secret_messages.db')
        : './secret_messages.db';

    const db = new sqlite3.Database(dbPath);

    // SQLite Pool Wrapper
    pool = {
        query: (text, params) => {
            return new Promise((resolve, reject) => {
                const sql = text.replace(/\$\d+/g, '?'); // Convert $1 to ?
                if (text.trim().toLowerCase().startsWith('select')) {
                    db.all(sql, params, (err, rows) => {
                        if (err) reject(err); else resolve({ rows });
                    });
                } else {
                    db.run(sql, params, function(err) {
                        if (err) reject(err); else resolve({ rowCount: this.changes });
                    });
                }
            });
        }
    };
}

// Transaction Client Helper
async function getTransactionClient() {
    if (process.env.DATABASE_URL && process.env.DATABASE_URL.includes('postgresql')) {
        const client = await pool.connect();
        return client;
    } else {
        // SQLite Mock Client (Serialized by nature of SQLite in Node single thread usually, but explicit locking not fully supported in this simple wrapper)
        // We simulate the client interface
        return {
            query: async (text, params) => await pool.query(text, params),
            release: () => {}
        };
    }
}

// Helpers
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
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

// 3. CHECKOUT SESSION
router.post("/create-checkout-session", async (req, res) => {
  try {
    console.log("[PAYMENT-INIT] Creating Session...");
    const { product_type, customer_email } = req.body;

    const product = PRICES[product_type];
    if (!product) return res.status(400).json({ error: 'Invalid product' });

    // AUTH EXTRACTION
    let userId = '';
    const authHeader = req.headers['authorization'];
    if (authHeader) {
        try {
            const token = authHeader.split(' ')[1];
            if (token) {
                const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret_fallback_key');
                userId = String(decoded.id);
            }
        } catch (e) {
            console.warn("Invalid Token in Checkout:", e.message);
        }
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      customer_email,
      line_items: [{
        price_data: {
          currency: product.currency,
          unit_amount: product.amount,
          product_data: { name: product.name }
        },
        quantity: 1
      }],
      metadata: {
        product_type,
        key_count: String(product.keyCount),
        user_id: userId, // "123" or ""
        duration_days: product.durationDays === null ? 'unlimited' : String(product.durationDays)
      },
      success_url: `${process.env.FRONTEND_URL || 'https://www.secure-msg.app'}/shop?success=true&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.FRONTEND_URL || 'https://www.secure-msg.app'}/shop?canceled=true`
    });

    res.json({ success: true, checkout_url: session.url });
  } catch (err) {
    console.error("Create Session Error:", err);
    res.status(500).json({ error: err.message });
  }
});

// 4. WEBHOOK CORE
router.post('/webhook', async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    console.log('HEADERS:', JSON.stringify(req.headers));
    // req.body is now a Buffer due to express.raw() in server.js
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    console.log(`[WEBHOOK-RECEIVED] Event: ${event.type}`);
  } catch (err) {
    console.error(`STRIPE ERROR: ${err.message}`);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    try {
        await handleSuccessfulPayment(session);
    } catch (e) {
        console.error("DB ERROR:", e.detail || e.message);
        console.error("STACK:", e.stack);
        return res.status(500).send("Processing Error");
    }
  }

  res.json({received: true});
});

async function handleSuccessfulPayment(session) {
    const { product_type, user_id, key_count, duration_days } = session.metadata;
    const paymentId = session.id;
    const isPostgres = process.env.DATABASE_URL && process.env.DATABASE_URL.includes('postgresql');

    const totalKeys = parseInt(key_count) || 1;
    const duration = duration_days === 'unlimited' ? null : parseInt(duration_days);

    console.log(`[PAYMENT-PROC] ID: ${paymentId}, User: ${user_id || 'GUEST'}, Keys: ${totalKeys}, Type: ${product_type}`);

    // Check Idempotency
    const existing = await pool.query('SELECT id FROM payments WHERE payment_id = $1', [paymentId]);
    if (existing.rows && existing.rows.length > 0) {
        console.log('[PAYMENT-SKIP] Already processed.');
        return;
    }

    const client = await getTransactionClient();
    const generatedKeys = [];
    let renewalPerformed = false;

    // Fix: Parse user_id to Integer
    const userIdInt = user_id ? parseInt(user_id) : null;

    try {
        console.log('[DB-TRANSACTION-START]');
        await client.query('BEGIN');

        const createdAt = new Date().toISOString();
        const unlimitedDate = '2099-12-31T23:59:59.000Z';

        for (let i = 0; i < totalKeys; i++) {
            const newCode = generateKeyCode();
            const newHash = crypto.createHash('sha256').update(newCode).digest('hex');

            // Branch A: Logged-In User AND First Key -> Auto-Renew
            if (userIdInt && i === 0) {
                console.log(`[BRANCH A] Auto-Renewing User ${userIdInt}`);

                // Fetch User Current State
                const userRes = await client.query('SELECT username, license_expiration, license_key_id FROM users WHERE id = $1', [userIdInt]);

                if (userRes.rows.length > 0) {
                    const user = userRes.rows[0];
                    let newExpiresAt;

                    // Calculate Expiration
                    if (duration === null) {
                        newExpiresAt = unlimitedDate;
                        console.log(`[MATH] Unlimited License -> ${newExpiresAt}`);
                    } else {
                        let baseDate = new Date();
                        const currentExp = user.license_expiration ? new Date(user.license_expiration) : null;

                        // Valid current license? Extend from there.
                        if (currentExp && !isNaN(currentExp.getTime()) && currentExp > baseDate) {
                            baseDate = currentExp;
                        }

                        newExpiresAt = addDays(baseDate.toISOString(), duration);
                        console.log(`[MATH] Extending to: ${newExpiresAt}`);
                    }

                    // 1. Archive Old Key (if exists)
                    if (user.license_key_id) {
                        await client.query(
                            `UPDATE license_keys SET is_active = $1, assigned_user_id = $2 WHERE id = $3`,
                            [(isPostgres ? false : 0), user.username, user.license_key_id]
                        );
                    }

                    // 2. Insert New Key (Activated)
                    await client.query(
                        `INSERT INTO license_keys (key_code, key_hash, created_at, expires_at, is_active, product_code, origin, assigned_user_id, activated_at)
                         VALUES ($1, $2, $3, $4, $5, $6, 'shop', $7, $8)`,
                        [newCode, newHash, createdAt, newExpiresAt, (isPostgres ? true : 1), product_type, user.username, createdAt]
                    );

                    // Get ID
                    const keyIdRes = await client.query('SELECT id FROM license_keys WHERE key_code = $1', [newCode]);
                    const newKeyId = keyIdRes.rows[0].id;

                    console.log(`[DB-UPDATE-USERS] Updating User ${userIdInt} Expiration to ${newExpiresAt}`);
                    // 3. Update User (Source of Truth) - Prioritized before Payment Insert
                    await client.query(
                        `UPDATE users SET license_key_id = $1, license_expiration = $2 WHERE id = $3`,
                        [newKeyId, newExpiresAt, userIdInt]
                    );

                    // (License Renewals table insert removed to simplify transaction)

                    console.log('[USER-EXPIRY-UPDATED]');
                    renewalPerformed = true;

                } else {
                    console.warn(`[WARN] User ${userIdInt} not found. Fallback to Guest (Key Generation).`);
                    // Fallback: Generate valid unused key
                    const exp = duration === null ? unlimitedDate : addDays(createdAt, duration);
                    await client.query(
                        `INSERT INTO license_keys (key_code, key_hash, created_at, expires_at, is_active, product_code, origin)
                         VALUES ($1, $2, $3, $4, $5, $6, 'shop')`,
                        [newCode, newHash, createdAt, null, (isPostgres ? false : 0), product_type] // expires_at null for unused key
                    );
                    generatedKeys.push(newCode);
                }
            } else {
                // Branch B: Guest OR Additional Bundle Keys
                console.log(`[BRANCH B] Generating Extra/Guest Key ${i+1}`);
                await client.query(
                    `INSERT INTO license_keys (key_code, key_hash, created_at, expires_at, is_active, product_code, origin)
                     VALUES ($1, $2, $3, $4, $5, $6, 'shop')`,
                    [newCode, newHash, createdAt, null, (isPostgres ? false : 0), product_type]
                );
                generatedKeys.push(newCode);
            }
        }

        // Record Payment
        const metadataForRecord = {
            product_type,
            user_id,
            keys_generated: generatedKeys,
            renewed: renewalPerformed,
            email: session.customer_details ? session.customer_details.email : null,
            session_id: session.id // Fix: Save Session ID
        };

        console.log(`[DB-INSERT-PAYMENT] Recording Payment ${paymentId}`);
        await client.query(
            `INSERT INTO payments (payment_id, amount, currency, status, payment_method, completed_at, metadata)
             VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP, $6)`,
            [
                session.id,
                session.amount_total,
                session.currency,
                'succeeded', // STRICT STATUS
                'stripe',
                // completed_at handled by DB
                JSON.stringify(metadataForRecord)
            ]
        );

        await client.query('COMMIT');
        console.log(`[COMMIT] Transaction Complete. Keys: ${generatedKeys.length}, Renewed: ${renewalPerformed}`);

        // Email
        const customerEmail = session.customer_details ? session.customer_details.email : null;
        if (customerEmail) {
            // Send ALL keys (even the auto-applied one if we wanted, but logic above only pushed extra keys to array for logged in user)
            // Wait, if I auto-renew, I didn't push the first key to `generatedKeys`.
            // So email only gets the "extra" keys.
            // Requirement check: "1x Auto-Verlängerung + Rest als Codes anzeigen"
            // Usually the email should say "Your account was extended" + "Here are your extra keys".
            // The `sendLicenseEmail` function might need keys.
            // If `generatedKeys` is empty (Single renewal), we might want to send a different email?
            // For now, I will use the existing mailer. It expects keys.
            // If I have extra keys, I send them.
            if (generatedKeys.length > 0) {
                 await sendLicenseEmail(customerEmail, generatedKeys, product_type);
            }
        }

    } catch (err) {
        await client.query('ROLLBACK');
        console.error("[TRANS-FAIL] Rollback initiated.", err);
        throw err;
    } finally {
        client.release();
    }
}

// 5. ORDER STATUS (Smart Polling)
router.get("/order-status", async (req, res) => {
    const { session_id } = req.query;
    if (!session_id) return res.status(400).json({ error: "No session_id" });

    try {
        const result = await pool.query(
            'SELECT * FROM payments WHERE payment_id = $1',
            [session_id]
        );

        if (result.rows.length === 0) {
            return res.json({ success: true, status: 'processing' });
        }

        const row = result.rows[0];
        const isSuccess = row.status === 'succeeded' || row.status === 'completed';

        if (!isSuccess) {
            return res.json({ success: true, status: 'processing' });
        }

        // 2. Parse Metadata
        let meta = {};
        try {
            meta = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : (row.metadata || {});
        } catch (e) {
            console.error("Metadata Parse Error:", e);
        }

        // 3. User Sync Check (Double Safety for Logged-In Users)
        if (meta.user_id && meta.renewed) {
             const uRes = await pool.query('SELECT license_expiration FROM users WHERE id = $1', [parseInt(meta.user_id, 10)]);
             if (uRes.rows.length > 0) {
                 const userExp = uRes.rows[0].license_expiration ? new Date(uRes.rows[0].license_expiration) : null;
                 const payTime = new Date(row.completed_at);

                 // Double Safety: Expiration must be NEWER than the payment time.
                 if (!userExp || userExp <= payTime) {
                     return res.json({ success: true, status: 'processing_user_sync' });
                 }
             }
        }

        // 4. Success
        return res.json({
            success: true,
            status: 'completed',
            keys: meta.keys_generated || [],
            renewed: !!meta.renewed,
            customer_email: meta.email
        });

    } catch (err) {
        console.error("DETAILED ORDER STATUS ERROR:", err.message, err.stack);
        res.json({ success: false, status: 'error' });
    }
});

module.exports = router;
