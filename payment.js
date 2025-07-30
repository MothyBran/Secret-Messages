// payment.js - Stripe Payment Integration (updated for timed keys + auto-expire)
const express = require('express');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const sqlite3 = require('sqlite3').verbose();
const crypto = require('crypto');
const nodemailer = require('nodemailer');

const router = express.Router();

// -------------------------------
// Email Configuration (bugfix: createTransport)
// -------------------------------
const emailTransporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: false,
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
    }
});

// -------------------------------
// SQLite DB
// -------------------------------
const db = new sqlite3.Database('./secret_messages.db');

// -------------------------------
// Product & Pricing
// amounts are in euro-cents
// durationDays: 1 Monat = 30 Tage | 3 Monate = 90 Tage | 12 Monate = 360 Tage | unlimited = null
// keyCount: Anzahl Keys, die erzeugt werden
// -------------------------------
const PRICES = {
    "1m":        { amount: 199,  currency: "eur", name: "1 Monat Zugang",            durationDays: 30,  keyCount: 1 },
    "3m":        { amount: 449,  currency: "eur", name: "3 Monate Zugang",           durationDays: 90,  keyCount: 1 },
    "12m":       { amount: 1499, currency: "eur", name: "12 Monate Zugang",          durationDays: 360, keyCount: 1 },
    "unlimited": { amount: 4999, currency: "eur", name: "Unbegrenzter Zugang",       durationDays: null, keyCount: 1 },
    "bundle_1m_2":  { amount: 379,  currency: "eur", name: "2× 1 Monat Zugang",     durationDays: 30,  keyCount: 2 },
    "bundle_3m_2":  { amount: 799,  currency: "eur", name: "2× 3 Monate Zugang",    durationDays: 90,  keyCount: 2 },
    "bundle_3m_5":  { amount: 1999, currency: "eur", name: "5× 3 Monate Zugang",    durationDays: 90,  keyCount: 5 },
    "bundle_1y_10": { amount: 12999,currency: "eur", name: "10× 12 Monate Zugang",  durationDays: 360, keyCount: 10 },
};

// Helper to get product or throw
function requireProduct(code) {
    const p = PRICES[code];
    if (!p) {
        const err = new Error('Invalid product type');
        err.statusCode = 400;
        throw err;
    }
    return p;
}

// -------------------------------
// Utilities
// -------------------------------
function generateKeyCode() {
    // Format: XXXXX-XXXXX-XXXXX (A–Z + digits without ambiguous chars)
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I, O, 0, 1
    const total = 15;
    let out = '';
    while (out.length < total) {
        const byte = crypto.randomBytes(1)[0];
        const max = 256 - (256 % alphabet.length); // unbiased selection
        if (byte < max) {
            out += alphabet[byte % alphabet.length];
        }
    }
    return out.slice(0,5) + '-' + out.slice(5,10) + '-' + out.slice(10,15);
}


function hashKey(keyCode) {
    return crypto.createHash('sha256').update(keyCode).digest('hex');
}

function nowIso() {
    return new Date().toISOString();
}

function addDays(date, days) {
    const d = new Date(date);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString();
}

// -------------------------------
// Auto-expire job
// Marks keys as expired in metadata if expires_at < now
// This does not change schema; it updates metadata JSON only.
// -------------------------------
async function expireOldKeys() {
    return new Promise((resolve) => {
        const selectSql = `SELECT id, metadata FROM license_keys WHERE metadata IS NOT NULL`;
        db.all(selectSql, [], (err, rows) => {
            if (err) {
                console.error('expireOldKeys: select error', err);
                return resolve();
            }
            const now = Date.now();
            let updates = 0;
            const updateOne = (id, newMeta) => new Promise((res) => {
                const sql = `UPDATE license_keys SET metadata = ? WHERE id = ?`;
                db.run(sql, [JSON.stringify(newMeta), id], (uErr) => {
                    if (uErr) console.error('expireOldKeys: update error', uErr);
                    updates++;
                    res();
                });
            });

            const work = rows.map(async (r) => {
                try {
                    const meta = JSON.parse(r.metadata);
                    if (!meta) return;
                    if (meta.status === 'expired') return;
                    if (meta.expires_at) {
                        const exp = Date.parse(meta.expires_at);
                        if (!Number.isNaN(exp) && exp < now) {
                            meta.status = 'expired';
                            await updateOne(r.id, meta);
                        }
                    }
                } catch (e) {
                    // ignore bad JSON
                }
            });

            Promise.all(work).then(() => {
                if (updates > 0) {
                    console.log(`expireOldKeys: marked ${updates} keys as expired`);
                }
                resolve();
            });
        });
    });
}

// run at startup and hourly
expireOldKeys();
setInterval(expireOldKeys, 60 * 60 * 1000);

// -------------------------------
/**
 * POST /create-payment-intent
 * body: { product_type, customer_email }
 * returns: client_secret, payment_id, amount, currency, key_count
 */
// -------------------------------
router.post('/create-payment-intent', async (req, res) => {
    try {
        const { product_type, customer_email } = req.body || {};

        if (!customer_email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer_email)) {
            return res.status(400).json({ error: 'Valid email address required' });
        }

        const product = requireProduct(product_type);

        const paymentIntent = await stripe.paymentIntents.create({
            amount: product.amount,
            currency: product.currency,
            automatic_payment_methods: { enabled: true },
            receipt_email: customer_email,
            metadata: {
                product_type,
                key_count: String(product.keyCount),
                duration_days: product.durationDays === null ? 'null' : String(product.durationDays)
            }
        });

        // store a payment record (optional table: payments)
        db.run(
            `INSERT INTO payments (payment_id, amount, currency, status, payment_method, metadata) 
             VALUES (?, ?, ?, ?, ?, ?)`,
            [
                paymentIntent.id,
                product.amount,
                product.currency,
                'created',
                'stripe',
                JSON.stringify({
                    product_type,
                    key_count: product.keyCount,
                    duration_days: product.durationDays,
                    customer_email
                })
            ],
            (err) => {
                if (err) console.error('store payment error:', err);
            }
        );

        res.json({
            success: true,
            client_secret: paymentIntent.client_secret,
            payment_id: paymentIntent.id,
            amount: product.amount,
            currency: product.currency,
            key_count: product.keyCount
        });
    } catch (err) {
        console.error('create-payment-intent error:', err);
        res.status(err.statusCode || 500).json({ error: err.message || 'Payment creation failed' });
    }
});

// -------------------------------
/**
 * POST /confirm-payment
 * body: { payment_intent_id }
 * Confirms payment, generates keys with expires_at, emails user.
 */
// -------------------------------
router.post('/confirm-payment', async (req, res) => {
    try {
        const { payment_intent_id } = req.body || {};
        if (!payment_intent_id) {
            return res.status(400).json({ error: 'Payment intent ID required' });
        }

        const paymentIntent = await stripe.paymentIntents.retrieve(payment_intent_id);
        if (paymentIntent.status !== 'succeeded') {
            return res.status(400).json({ error: 'Payment not completed' });
        }

        // Extract metadata
        const product_type = paymentIntent.metadata?.product_type;
        const durationDaysStr = paymentIntent.metadata?.duration_days;
        const keyCountStr = paymentIntent.metadata?.key_count;
        const durationDays = durationDaysStr === 'null' ? null : Number(durationDaysStr);
        const keyCount = Number(keyCountStr) || 1;
        const product = requireProduct(product_type);

        // Prepare keys
        const createdAt = nowIso();
        const expiresAt = durationDays ? addDays(createdAt, durationDays) : null;

        const generatedKeys = [];
        for (let i = 0; i < keyCount; i++) {
            const keyCode = generateKeyCode();
            const keyHash = hashKey(keyCode);
            const keyMeta = {
                product_type,
                product_name: product.name,
                duration_days: product.durationDays,
                created_at: createdAt,
                expires_at: expiresAt,
                status: 'active',
                revoked: false
            };

            await new Promise((resolve, reject) => {
                db.run(
                    `INSERT INTO license_keys (key_code, key_hash, metadata) VALUES (?, ?, ?)`,
                    [keyCode, keyHash, JSON.stringify(keyMeta)],
                    function (err) {
                        if (err) {
                            console.error('insert key error:', err);
                            reject(err);
                        } else {
                            generatedKeys.push({ id: this.lastID, key_code: keyCode });
                            resolve();
                        }
                    }
                );
            });
        }

        // update payment status
        await new Promise((resolve) => {
            db.run(
                `UPDATE payments SET status = ?, completed_at = CURRENT_TIMESTAMP, metadata = ? WHERE payment_id = ?`,
                ['completed', JSON.stringify({ ...(paymentIntent.metadata || {}), keys_generated: generatedKeys.length }), paymentIntent.id],
                (err) => {
                    if (err) console.error('update payment error:', err);
                    resolve();
                }
            );
        });

        // Send email with keys
        const toEmail = paymentIntent.receipt_email || paymentIntent.charges?.data?.[0]?.billing_details?.email;
        if (toEmail) {
            try {
                await emailTransporter.sendMail({
                    from: `${process.env.MAIL_FROM_NAME || 'Secret Messages'} <${process.env.MAIL_FROM || process.env.SMTP_USER}>`,
                    to: toEmail,
                    subject: `Ihre Lizenz-Keys (${product.name})`,
                    html: `
                    <div style="font-family:Arial,Helvetica,sans-serif;background:#0b0b0b;color:#e5e5e5;padding:24px">
                      <h2 style="margin:0 0 12px 0">Vielen Dank für Ihren Kauf!</h2>
                      <p style="margin:0 0 16px 0">Produkt: <strong>${product.name}</strong></p>
                      <p style="margin:0 0 16px 0">Anzahl Keys: <strong>${generatedKeys.length}</strong></p>
                      ${expiresAt ? `<p style="margin:0 0 16px 0">Ablaufdatum je Key: <strong>${new Date(expiresAt).toLocaleString('de-DE')}</strong></p>` : `<p style="margin:0 0 16px 0"><strong>Keine Ablaufzeit (unbegrenzt)</strong></p>`}
                      <hr style="border:none;border-top:1px solid #333;margin:16px 0"/>
                      <h3 style="margin:0 0 8px 0">Ihre Keys:</h3>
                      <ul>
                        ${generatedKeys.map(k => `<li style="font-family:monospace">${k.key_code}</li>`).join('')}
                      </ul>
                      <p style="margin-top:16px">Web-App: <a href="${process.env.FRONTEND_URL}" style="color:#00ff41">${process.env.FRONTEND_URL || ''}</a></p>
                      <p style="margin-top:8px;font-size:12px;color:#aaa">Hinweis: Abgelaufene Keys werden automatisch gesperrt.</p>
                    </div>`
                });
            } catch (mailErr) {
                console.error('email send error:', mailErr);
            }
        }

        res.json({
            success: true,
            message: 'Payment confirmed and keys generated',
            key_count: generatedKeys.length,
            keys: generatedKeys.map(k => k.key_code),
            expires_at: expiresAt,
            email_sent: !!toEmail
        });

    } catch (err) {
        console.error('confirm-payment error:', err);
        res.status(err.statusCode || 500).json({ error: err.message || 'Payment confirmation failed' });
    }
});

// -------------------------------
// GET /pricing - expose pricing table to frontend
// -------------------------------
router.get('/pricing', (req, res) => {
    const out = {};
    Object.keys(PRICES).forEach(code => {
        const p = PRICES[code];
        out[code] = {
            name: p.name,
            price_eur: (p.amount / 100).toFixed(2) + ' €',
            duration_days: p.durationDays,
            key_count: p.keyCount
        };
    });
    res.json(out);
});

// -------------------------------
// Admin: POST /admin/payment-stats (optional, preserved interface)
// returns simple aggregates
// -------------------------------
router.post('/admin/payment-stats', (req, res) => {
    const sql = `SELECT status, COUNT(*) as count FROM payments GROUP BY status`;
    db.all(sql, [], (err, rows) => {
        if (err) {
            console.error('Payment stats error:', err);
            return res.status(500).json({ error: 'Failed to fetch payment statistics' });
        }
        res.json({ stats: rows });
    });
});

module.exports = router;
