// payment.js – Secure Stripe Webhook Integration (Rewritten)
const express = require('express');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const crypto = require('crypto');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const { sendLicenseEmail } = require('./email/mailer');

const router = express.Router();

console.log("Stripe Secret Key Loaded:", process.env.STRIPE_SECRET_KEY ? "YES (****)" : "NO");
console.log("Stripe Webhook Secret Loaded:", process.env.STRIPE_WEBHOOK_SECRET ? "YES (****)" : "NO");

// 1. DATABASE SETUP & ABSTRACTION
let pool;
if (process.env.DATABASE_URL && process.env.DATABASE_URL.includes('postgresql')) {
    pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }
    });
} else {
    // SQLite Fallback
    const sqlite3 = require('sqlite3').verbose();
    const db = new sqlite3.Database('./secret_messages.db');
    pool = {
        query: (text, params) => {
            return new Promise((resolve, reject) => {
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

// Transaction Client Helper
async function getTransactionClient() {
    if (process.env.DATABASE_URL && process.env.DATABASE_URL.includes('postgresql')) {
        const client = await pool.connect();
        return client;
    } else {
        // SQLite Mock Client (Single Connection, No real trans isolation but sequential)
        return {
            query: async (text, params) => await pool.query(text, params),
            release: () => {}
        };
    }
}

// Helpers
const PRICES = {
  // Einzel-Lizenzen (Preise korrigiert)
  "1m":        { amount: 199,  currency: "eur", name: "1 Monat Zugang",            durationDays: 30,  keyCount: 1 },
  "3m":        { amount: 449,  currency: "eur", name: "3 Monate Zugang",           durationDays: 90,  keyCount: 1 },
  "12m":       { amount: 1499, currency: "eur", name: "12 Monate Zugang",          durationDays: 360, keyCount: 1 },
  "unlimited": { amount: 4999, currency: "eur", name: "Unbegrenzter Zugang",       durationDays: null, keyCount: 1 },

  // Bundles (Neu hinzugefügt)
  "bundle_1m_2": { amount: 379,   currency: "eur", name: "Bundle: 2x Keys (1 Monat)",  durationDays: 30,  keyCount: 2 },
  "bundle_3m_2": { amount: 799,   currency: "eur", name: "Bundle: 2x Keys (3 Monate)", durationDays: 90,  keyCount: 2 },
  "bundle_3m_5": { amount: 1999,  currency: "eur", name: "Bundle: 5x Keys (3 Monate)", durationDays: 90,  keyCount: 5 },
  "bundle_1y_10": { amount: 12999, currency: "eur", name: "Bundle: 10x Keys (12 Monate)", durationDays: 360, keyCount: 10 }
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

// 2. CHECKOUT SESSION (Creation)
router.post("/create-checkout-session", async (req, res) => {
  try {
    const { product_type, customer_email } = req.body;

    // Optional: Shop Status Check could go here

    const product = PRICES[product_type];
    if (!product) return res.status(400).json({ error: 'Invalid product' });

    // AUTH EXTRACTION
    let userId = null;
    const authHeader = req.headers['authorization'];
    if (authHeader) {
        try {
            const token = authHeader.split(' ')[1];
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            userId = decoded.id;
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
          product_data: { name: `${product.name}` }
        },
        quantity: 1
      }],
      // METADATA INJECTION (Essential for Webhook)
      metadata: {
        product_type,
        duration_days: product.durationDays === null ? 'null' : String(product.durationDays),
        key_count: String(product.keyCount),
        user_id: userId ? String(userId) : '' // Empty string if guest
      },
      payment_intent_data: {
        metadata: {
          product_type,
          duration_days: product.durationDays === null ? 'null' : String(product.durationDays),
          key_count: String(product.keyCount),
          user_id: userId ? String(userId) : ''
        }
      },
      success_url: `${process.env.FRONTEND_URL}/shop?success=true&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.FRONTEND_URL}/shop?canceled=true`
    });

    res.json({ success: true, checkout_url: session.url });
  } catch (err) {
    console.error("Create Session Error:", err);
    res.status(500).json({ error: err.message });
  }
});

// 3. WEBHOOK CORE
router.post('/webhook', async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error(`Webhook Signature Error: ${err.message}`);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    await handleSuccessfulPayment(session);
  }

  res.json({received: true});
});

async function handleSuccessfulPayment(session) {
    const { product_type, duration_days, user_id, key_count } = session.metadata;
    const paymentId = session.payment_intent;
    const isPostgres = process.env.DATABASE_URL && process.env.DATABASE_URL.includes('postgresql');

    // Parse loop count
    const totalKeys = parseInt(key_count) || 1;

    console.log(`[TRANS] Processing Payment ${paymentId} for User: ${user_id || 'GUEST'}. Count: ${totalKeys}`);

    // Idempotency Check
    const existing = await pool.query('SELECT id FROM payments WHERE payment_id = $1', [paymentId]);
    if (existing.rows && existing.rows.length > 0) {
        console.log('[TRANS] Skipped (Already Processed)');
        return;
    }

    const client = await getTransactionClient();
    const generatedKeys = []; // For logging/email

    try {
        await client.query('BEGIN');

        const durationDays = duration_days === 'null' ? null : Number(duration_days);
        const createdAt = new Date().toISOString();

        // LOOP FOR BUNDLES
        for (let i = 0; i < totalKeys; i++) {
            // Generate Key Data per iteration
            const newCode = generateKeyCode();
            const newHash = crypto.createHash('sha256').update(newCode).digest('hex');
            let newExpiresAt = durationDays ? addDays(createdAt, durationDays) : null;

            // LOGIC FOR FIRST KEY IN AUTH MODE
            if (user_id && i === 0) {
                // === BRANCH A: AUTHENTICATED RENEWAL (1st Key Only) ===
                console.log(`[BRANCH A] Renewal for User ${user_id} (Key ${i+1}/${totalKeys})`);

                // 1. Get Current Expiration
                const userRes = await client.query('SELECT username, license_expiration, license_key_id FROM users WHERE id = $1', [user_id]);

                if (userRes.rows.length > 0) {
                    const user = userRes.rows[0];

                    // 2. MASTER FORMULA
                    let baseDate = new Date();
                    const currentExpiry = user.license_expiration ? new Date(user.license_expiration) : null;

                    if (currentExpiry && !isNaN(currentExpiry.getTime()) && currentExpiry > baseDate) {
                        baseDate = currentExpiry;
                        console.log(`[MATH] Extending from Current Expiry: ${baseDate.toISOString()}`);
                    } else {
                        console.log(`[MATH] Extending from NOW: ${baseDate.toISOString()}`);
                    }

                    newExpiresAt = durationDays ? addDays(baseDate.toISOString(), durationDays) : null;
                    console.log(`[MATH] New Expiration: ${newExpiresAt}`);

                    // 3. Archive Old Key (Optional but good for history)
                    if (user.license_key_id) {
                        await client.query(
                            `UPDATE license_keys SET is_active = $1, assigned_user_id = $2 WHERE id = $3`,
                            [(isPostgres ? false : 0), user.username, user.license_key_id]
                        );
                    }

                    // 4. Insert New Key (Activated)
                    await client.query(
                        `INSERT INTO license_keys (key_code, key_hash, created_at, expires_at, is_active, product_code, origin, assigned_user_id, activated_at)
                         VALUES ($1, $2, $3, $4, $5, $6, 'shop', $7, $8)`,
                        [newCode, newHash, createdAt, newExpiresAt, (isPostgres ? true : 1), product_type, user.username, createdAt]
                    );

                    // Get New Key ID
                    const keyIdRes = await client.query('SELECT id FROM license_keys WHERE key_code = $1', [newCode]);
                    const newKeyId = keyIdRes.rows[0].id;

                    // 5. UPDATE USER (SOURCE OF TRUTH)
                    // STRICT: Only update expiration and link. NO PIK CHANGE.
                    await client.query(
                        `UPDATE users SET license_key_id = $1, license_expiration = $2 WHERE id = $3`,
                        [newKeyId, newExpiresAt, user_id]
                    );
                    console.log(`[DB] User ${user_id} updated successfully.`);

                    // Log Renewal
                    await client.query(
                        'INSERT INTO license_renewals (user_id, key_code_hash, extended_until, used_at) VALUES ($1, $2, $3, $4)',
                        [user_id, newHash, newExpiresAt, createdAt]
                    );
                } else {
                    console.error(`[ERR] User ${user_id} not found! Falling back to Guest logic to save Key.`);
                    // Fallback -> Treat as Guest to ensure customer gets a key
                    await client.query(
                        `INSERT INTO license_keys (key_code, key_hash, created_at, expires_at, is_active, product_code, origin)
                         VALUES ($1, $2, $3, $4, $5, $6, 'shop')`,
                        [newCode, newHash, createdAt, newExpiresAt, (isPostgres ? false : 0), product_type]
                    );
                }
            } else {
                // === BRANCH B (or A > 1): ADDITIONAL KEYS / GUEST ===
                console.log(`[BRANCH B] Extra Key / Guest (Key ${i+1}/${totalKeys})`);

                // Just Insert Inactive Key (Available for friends/team)
                await client.query(
                    `INSERT INTO license_keys (key_code, key_hash, created_at, expires_at, is_active, product_code, origin)
                     VALUES ($1, $2, $3, $4, $5, $6, 'shop')`,
                    [newCode, newHash, createdAt, newExpiresAt, (isPostgres ? false : 0), product_type]
                );
            }
            generatedKeys.push(newCode);
        }

        // Record Payment
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
                    user_id,
                    keys_generated: generatedKeys,
                    email: session.customer_details ? session.customer_details.email : null
                })
            ]
        );

        await client.query('COMMIT');
        console.log(`[COMMIT] Transaction Successful. Keys Generated: ${generatedKeys.join(', ')}`);

        // Send Email
        const customerEmail = session.customer_details ? session.customer_details.email : null;
        if (customerEmail) {
            await sendLicenseEmail(customerEmail, generatedKeys, product_type);
        }

    } catch (err) {
        await client.query('ROLLBACK');
        console.error("[TRANS] Failed:", err);
        throw err;
    } finally {
        client.release();
    }
}

// 4. ORDER STATUS (Smart Polling)
router.get("/order-status", async (req, res) => {
    const { session_id } = req.query;
    if (!session_id) return res.status(400).json({ error: "No session_id" });

    try {
        const session = await stripe.checkout.sessions.retrieve(session_id);
        const paymentIntentId = session.payment_intent;

        const result = await pool.query(
            'SELECT metadata, completed_at FROM payments WHERE payment_id = $1',
            [paymentIntentId]
        );

        if (result.rows.length > 0) {
            const row = result.rows[0];
            const meta = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata;
            const userId = meta.user_id;

            // SMART CHECK
            if (userId) {
                // Branch A: Check User Table
                const uRes = await pool.query('SELECT license_expiration FROM users WHERE id = $1', [userId]);
                if (uRes.rows.length > 0) {
                    const currentExp = uRes.rows[0].license_expiration;
                    const completedAt = new Date(row.completed_at).getTime();
                    const expDate = currentExp ? new Date(currentExp) : null;

                    // If Expiry is missing or older than payment time -> Wait
                    if (!expDate || expDate <= new Date(completedAt)) {
                        return res.json({ success: true, status: 'processing_user_sync' });
                    }
                }
            }

            // Branch B (Guest) or Synced Branch A -> Success
            return res.json({
                success: true,
                status: 'completed',
                keys: meta.keys_generated,
                renewed: !!userId,
                customer_email: session.customer_email
            });

        } else {
            return res.json({ success: true, status: 'processing' });
        }

    } catch (err) {
        console.error("Order Status Error:", err);
        res.json({ success: false, status: 'error' });
    }
});

module.exports = router;
