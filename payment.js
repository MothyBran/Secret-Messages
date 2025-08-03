// payment.js - Stripe Payment Integration (PostgreSQL version) const express = require('express'); const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY); const crypto = require('crypto'); const nodemailer = require('nodemailer'); const { Pool } = require('pg');

const router = express.Router(); const pool = new Pool();

// Email configuration const emailTransporter = nodemailer.createTransport({ host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT || 587), secure: false, auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } });

// Pricing table const PRICES = { "1m":        { amount: 199,  currency: "eur", name: "1 Monat Zugang",            durationDays: 30,  keyCount: 1 }, "3m":        { amount: 449,  currency: "eur", name: "3 Monate Zugang",           durationDays: 90,  keyCount: 1 }, "12m":       { amount: 1499, currency: "eur", name: "12 Monate Zugang",          durationDays: 360, keyCount: 1 }, "unlimited": { amount: 4999, currency: "eur", name: "Unbegrenzter Zugang",       durationDays: null, keyCount: 1 }, "bundle_1m_2":  { amount: 379,  currency: "eur", name: "2× 1 Monat Zugang",     durationDays: 30,  keyCount: 2 }, "bundle_3m_2":  { amount: 799,  currency: "eur", name: "2× 3 Monate Zugang",    durationDays: 90,  keyCount: 2 }, "bundle_3m_5":  { amount: 1999, currency: "eur", name: "5× 3 Monate Zugang",    durationDays: 90,  keyCount: 5 }, "bundle_1y_10": { amount: 12999,currency: "eur", name: "10× 12 Monate Zugang",  durationDays: 360, keyCount: 10 }, };

function requireProduct(code) { const p = PRICES[code]; if (!p) throw new Error('Invalid product type'); return p; }

function generateKeyCode() { const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let out = ''; while (out.length < 15) { const byte = crypto.randomBytes(1)[0]; const max = 256 - (256 % chars.length); if (byte < max) out += chars[byte % chars.length]; } return out.slice(0,5)+'-'+out.slice(5,10)+'-'+out.slice(10,15); }

function hashKey(code) { return crypto.createHash('sha256').update(code).digest('hex'); }

function nowIso() { return new Date().toISOString(); }

function addDays(iso, days) { const d = new Date(iso); d.setUTCDate(d.getUTCDate() + days); return d.toISOString(); }

router.post('/create-payment-intent', async (req, res) => { try { const { product_type, customer_email } = req.body; if (!customer_email || !/^[^\s@]+@[^\s@]+.[^\s@]+$/.test(customer_email)) { return res.status(400).json({ error: 'Valid email required' }); } const product = requireProduct(product_type);

const intent = await stripe.paymentIntents.create({
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

await pool.query(`INSERT INTO payments (payment_id, amount, currency, status, payment_method, metadata)
  VALUES ($1, $2, $3, 'created', 'stripe', $4)`, [
  intent.id, product.amount, product.currency,
  JSON.stringify({ product_type, key_count: product.keyCount, duration_days: product.durationDays, customer_email })
]);

res.json({ success: true, client_secret: intent.client_secret });

} catch (err) { console.error('Stripe intent error:', err); res.status(500).json({ error: err.message }); } });

router.post('/confirm-payment', async (req, res) => { try { const { payment_intent_id } = req.body; const intent = await stripe.paymentIntents.retrieve(payment_intent_id); if (intent.status !== 'succeeded') return res.status(400).json({ error: 'Payment not completed' });

const { product_type, duration_days, key_count } = intent.metadata;
const durationDays = duration_days === 'null' ? null : Number(duration_days);
const keyCount = Number(key_count) || 1;
const product = requireProduct(product_type);
const createdAt = nowIso();
const expiresAt = durationDays ? addDays(createdAt, durationDays) : null;
const keys = [];

for (let i = 0; i < keyCount; i++) {
  const code = generateKeyCode();
  const hash = hashKey(code);
  const metadata = {
    product_type,
    product_name: product.name,
    duration_days: durationDays,
    created_at: createdAt,
    expires_at: expiresAt,
    status: 'active',
    revoked: false
  };
  await pool.query(`INSERT INTO license_keys (key_code, key_hash, metadata) VALUES ($1, $2, $3)`, [
    code, hash, JSON.stringify(metadata)
  ]);
  keys.push(code);
}

await pool.query(`UPDATE payments SET status = 'completed', completed_at = NOW(), metadata = $1 WHERE payment_id = $2`, [
  JSON.stringify({ ...intent.metadata, keys_generated: keys.length }), payment_intent_id
]);

const email = intent.receipt_email || intent.charges?.data?.[0]?.billing_details?.email;
if (email) {
  await emailTransporter.sendMail({
    from: `${process.env.MAIL_FROM_NAME || 'Secret Messages'} <${process.env.MAIL_FROM || process.env.SMTP_USER}>`,
    to: email,
    subject: `Ihre Lizenz-Keys (${product.name})`,
    html: `<p>Ihre Keys:</p><ul>${keys.map(k => `<li>${k}</li>`).join('')}</ul>`
  });
}

res.json({ success: true, keys, expires_at: expiresAt });

} catch (err) { console.error('Confirm payment error:', err); res.status(500).json({ error: err.message }); } });

module.exports = router;

