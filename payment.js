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
// Reconfigured to use 'extensionMonths'
const PRICES = {
  "1m":           { amount: 199,   currency: "eur", name: "1 Monat Zugang",            extensionMonths: 1,  keyCount: 1 },
  "3m":           { amount: 495,   currency: "eur", name: "3 Monate Zugang",           extensionMonths: 3,  keyCount: 1 },
  "12m":          { amount: 1790,  currency: "eur", name: "12 Monate Zugang",          extensionMonths: 12, keyCount: 1 },
  "unlimited":    { amount: 5999,  currency: "eur", name: "Unbegrenzter Zugang",       extensionMonths: 0,  keyCount: 1 }, // 0 indicates Unlimited/Special
  "bundle_1m_2":  { amount: 379,   currency: "eur", name: "2x Keys (1 Monat)",      extensionMonths: 1,  keyCount: 2 },
  "bundle_3m_5":  { amount: 1980,  currency: "eur", name: "5x Keys (3 Monate)",     extensionMonths: 3,  keyCount: 5 },
  "bundle_3m_2":  { amount: 899,   currency: "eur", name: "2x Keys (3 Monate)",      extensionMonths: 3,  keyCount: 2 },
  "bundle_1y_10": { amount: 14999, currency: "eur", name: "10x Keys (12 Monate)",    extensionMonths: 12, keyCount: 10 }
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
        },
        connect: async () => {
             return {
                 query: async (text, params) => pool.query(text, params),
                 release: () => {}
             };
        }
    };
}

// Transaction Client Helper
async function getTransactionClient() {
    if (process.env.DATABASE_URL && process.env.DATABASE_URL.includes('postgresql')) {
        const client = await pool.connect();
        return client;
    } else {
        return pool.connect();
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

// --- COPIED FROM SERVER.JS TO AVOID CIRCULAR DEPS ---
function parseDbDate(dateStr) {
    if (!dateStr) return null;
    if (typeof dateStr === 'string' && dateStr.includes('.')) {
        const parts = dateStr.split('.');
        if (parts.length >= 3) {
            const d = parts[0];
            const m = parts[1];
            let y = parts[2];
            if (y.includes(' ')) y = y.split(' ')[0];
            if (y.length === 4) {
                return new Date(`${y}-${m}-${d}`);
            }
        }
    }
    const d = new Date(dateStr);
    return isNaN(d.getTime()) ? null : d;
}

function calculateNewExpiration(currentExpirationStr, extensionMonths) {
    if (!extensionMonths || extensionMonths <= 0) return null;

    let baseDate = new Date();
    const currentExpiry = parseDbDate(currentExpirationStr);

    if (currentExpiry && currentExpiry > baseDate) {
        baseDate = currentExpiry;
    }

    const newDate = new Date(baseDate.getTime());
    newDate.setMonth(newDate.getMonth() + extensionMonths);

    return newDate.toISOString();
}
// ---------------------------------------------------


// 3. CHECKOUT SESSION
router.post("/create-checkout-session", async (req, res) => {
  try {
    const { product_type, customer_email } = req.body;

    const product = PRICES[product_type];
    if (!product) return res.status(400).json({ error: 'Invalid product' });

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

    const sessionParams = {
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
        product_type
        // user_id REMOVED from metadata as requested
      },
      success_url: `${process.env.FRONTEND_URL || 'https://www.secure-msg.app'}/shop?success=true&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.FRONTEND_URL || 'https://www.secure-msg.app'}/shop?canceled=true`
    };

    // Use client_reference_id for User ID if available
    if (userId) {
        sessionParams.client_reference_id = userId;
    }

    const session = await stripe.checkout.sessions.create(sessionParams);

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
    // Robust Secret Handling (Trim whitespace)
    const secret = (process.env.STRIPE_WEBHOOK_SECRET || '').trim();
    event = stripe.webhooks.constructEvent(req.body, sig, secret);
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
    const { product_type } = session.metadata || {};
    const paymentId = session.id; // STRICT: Use session.id
    const isPostgres = process.env.DATABASE_URL && process.env.DATABASE_URL.includes('postgresql');

    // Retrieve User ID from client_reference_id
    const user_id = session.client_reference_id;

    if (user_id) {
        console.log(`[WEBHOOK] Updating User ID: ${user_id}`);
    }

    const product = PRICES[product_type];
    if (!product) {
        console.error(`[PAYMENT-FAIL] Invalid Product Type: ${product_type}`);
        return;
    }

    const totalKeys = product.keyCount;
    const extensionMonths = product.extensionMonths;

    console.log(`[PAYMENT-PROC] ID: ${paymentId}, User: ${user_id || 'GUEST'}, Type: ${product_type}`);

    // Idempotency Check
    const existing = await pool.query('SELECT id FROM payments WHERE payment_id = $1', [paymentId]);
    if (existing.rows && existing.rows.length > 0) {
        console.log('[PAYMENT-SKIP] Already processed.');
        return;
    }

    const client = await getTransactionClient();
    const generatedKeys = [];
    let renewalPerformed = false;
    const userIdInt = user_id ? parseInt(user_id) : null;
    const unlimitedDate = '2099-12-31T23:59:59.000Z';

    try {
        await client.query('BEGIN');
        const createdAt = new Date().toISOString();

        // LOGIC BRANCHING
        // Branch A: Logged-in User -> Auto-renew first key
        if (userIdInt) {
            console.log(`[BRANCH A] User ${userIdInt} Purchase`);
            const userRes = await client.query('SELECT username, license_expiration, license_key_id FROM users WHERE id = $1', [userIdInt]);

            if (userRes.rows.length > 0) {
                const user = userRes.rows[0];
                let newExpiresAt;

                // 1. Calculate New Expiration
                if (extensionMonths === 0) { // Unlimited
                     newExpiresAt = unlimitedDate;
                } else {
                     newExpiresAt = calculateNewExpiration(user.license_expiration, extensionMonths);
                }

                console.log(`[MATH] New Expiry: ${newExpiresAt}`);

                // 2. Archive Old Key
                if (user.license_key_id) {
                     await client.query(
                         `UPDATE license_keys SET is_active = $1, assigned_user_id = $2 WHERE id = $3`,
                         [(isPostgres ? false : 0), user.username, user.license_key_id]
                     );
                }

                // 3. Create & Activate New Key (Consumed immediately)
                const renewCode = generateKeyCode();
                const renewHash = crypto.createHash('sha256').update(renewCode).digest('hex');

                await client.query(
                    `INSERT INTO license_keys (key_code, key_hash, created_at, expires_at, is_active, product_code, origin, assigned_user_id, activated_at)
                     VALUES ($1, $2, $3, $4, $5, $6, 'shop', $7, $8)`,
                    [renewCode, renewHash, createdAt, newExpiresAt, (isPostgres ? true : 1), product_type, user.username, createdAt]
                );

                const keyIdRes = await client.query('SELECT id FROM license_keys WHERE key_code = $1', [renewCode]);
                const newKeyId = keyIdRes.rows[0].id;

                // 4. Update User Source of Truth
                await client.query(
                    `UPDATE users SET license_key_id = $1, license_expiration = $2 WHERE id = $3`,
                    [newKeyId, newExpiresAt, userIdInt]
                );

                renewalPerformed = true;

                // 5. Generate REMAINING keys (if bundle)
                for (let i = 1; i < totalKeys; i++) {
                     const extraCode = generateKeyCode();
                     const extraHash = crypto.createHash('sha256').update(extraCode).digest('hex');
                     await client.query(
                        `INSERT INTO license_keys (key_code, key_hash, created_at, expires_at, is_active, product_code, origin)
                         VALUES ($1, $2, $3, NULL, $4, $5, 'shop')`,
                        [extraCode, extraHash, createdAt, (isPostgres ? false : 0), product_type]
                     );
                     generatedKeys.push(extraCode);
                }

            } else {
                // User ID passed but not found? Fallback to Guest
                 for (let i = 0; i < totalKeys; i++) {
                    const code = generateKeyCode();
                    const hash = crypto.createHash('sha256').update(code).digest('hex');
                    await client.query(
                        `INSERT INTO license_keys (key_code, key_hash, created_at, expires_at, is_active, product_code, origin)
                         VALUES ($1, $2, $3, NULL, $4, $5, 'shop')`,
                        [code, hash, createdAt, (isPostgres ? false : 0), product_type]
                    );
                    generatedKeys.push(code);
                }
            }

        } else {
            // Branch B: Guest
            console.log(`[BRANCH B] Guest Purchase`);
            for (let i = 0; i < totalKeys; i++) {
                const code = generateKeyCode();
                const hash = crypto.createHash('sha256').update(code).digest('hex');
                await client.query(
                    `INSERT INTO license_keys (key_code, key_hash, created_at, expires_at, is_active, product_code, origin)
                     VALUES ($1, $2, $3, NULL, $4, $5, 'shop')`,
                    [code, hash, createdAt, (isPostgres ? false : 0), product_type]
                );
                generatedKeys.push(code);
            }
        }

        // Record Payment
        // IMPORTANT: We store user_id in metadata HERE so order-status can find it
        const metadataForRecord = {
            product_type,
            user_id: userIdInt, // Store the resolved integer ID
            keys_generated: generatedKeys,
            renewed: renewalPerformed,
            email: session.customer_details ? session.customer_details.email : null,
            session_id: paymentId
        };

        let metaStr = '{}';
        try {
            metaStr = JSON.stringify(metadataForRecord);
        } catch(e) {
            console.error("Metadata Stringify Failed", e);
        }

        await client.query(
            `INSERT INTO payments (payment_id, amount, currency, status, payment_method, completed_at, metadata)
             VALUES ($1, $2, $3, 'succeeded', $4, CURRENT_TIMESTAMP, $5)`,
            [
                paymentId,
                session.amount_total,
                session.currency,
                'stripe',
                metaStr
            ]
        );

        await client.query('COMMIT');
        console.log(`[SUCCESS] Payment ${paymentId} processed.`);

        // Email Handling
        const customerEmail = session.customer_details ? session.customer_details.email : null;
        if (customerEmail && generatedKeys.length > 0) {
             try {
                await sendLicenseEmail(customerEmail, generatedKeys, product_type);
             } catch(e) {
                 console.error("Email send failed:", e.message);
             }
        }

    } catch (err) {
        await client.query('ROLLBACK');
        console.error("[TRANS-FAIL] Rollback:", err);
        throw err;
    } finally {
        client.release();
    }
}

// 5. ORDER STATUS (Strict User Check)
router.get("/order-status", async (req, res) => {
    const { session_id } = req.query;
    if (!session_id || !session_id.startsWith('cs_')) {
        return res.status(400).json({ error: "Invalid session_id" });
    }

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

        if (isSuccess) {
            let meta = {};
            try {
                if (row.metadata) {
                    meta = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata;
                }
            } catch (e) { console.error("Meta Parse Error", e); }

            // USER TABLE CHECK (Required for "Hänger" Fix)
            if (meta.user_id) {
                // It was a renewal. Verify User Table is strictly in future.
                const userRes = await pool.query('SELECT license_expiration FROM users WHERE id = $1', [meta.user_id]);
                if (userRes.rows.length > 0) {
                    const user = userRes.rows[0];
                    const expDate = user.license_expiration ? new Date(user.license_expiration) : null;
                    const now = new Date();

                    // If expiration is NOT in the future, we wait.
                    // This handles cases where payment exists but user transaction might have lagged (rare)
                    // or allows us to be 100% sure before UI reload.
                    if (!expDate || expDate <= now) {
                        return res.json({ success: true, status: 'processing' });
                    }
                }
            }

            return res.json({
                success: true,
                status: 'completed',
                keys: meta.keys_generated || [],
                renewed: !!meta.renewed
            });
        }

        return res.json({ success: true, status: 'processing' });

    } catch (err) {
        console.error("Order Status Error:", err);
        res.json({ success: false, status: 'error' });
    }
});

module.exports = router;
