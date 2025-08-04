// payment.js – Stripe Checkout Integration (PostgreSQL)
const express = require('express');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const { Pool } = require('pg');

const router = express.Router();
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Email configuration
const emailTransporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

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

function requireProduct(code) {
  const p = PRICES[code];
  if (!p) throw new Error('Invalid product type');
  return p;
}

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

function hashKey(code) {
  return crypto.createHash('sha256').update(code).digest('hex');
}

function addDays(iso, days) {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}

// Stripe Checkout Session erstellen
router.post("/create-checkout-session", async (req, res) => {
  try {
    const { product_type, customer_email } = req.body;

    console.log("📨 Request Body:", req.body);

    const product = requireProduct(product_type);

    console.log("🚀 creating session with:", {
      product_type,
      customer_email,
      key_count: product.keyCount,
      duration_days: product.durationDays
    });

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      line_items: [{
        price_data: {
          currency: product.currency,
          unit_amount: product.amount,
          product_data: {
            name: `${product.name} (${product_type})`
          }
        },
        quantity: 1
      }],
      customer_email,
      payment_intent_data: {
        metadata: {
          product_type,
          key_count: String(product.keyCount),
          duration_days: product.durationDays === null ? 'null' : String(product.durationDays)
        }
      },
      success_url: `${process.env.FRONTEND_URL}/store.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.FRONTEND_URL}/store.html`
    });

    res.json({ success: true, checkout_url: session.url });

  } catch (err) {
    console.error("create-checkout-session error:", err);
    res.status(500).json({ error: "Checkout-Session konnte nicht erstellt werden." });
  }
});

// Nach erfolgreicher Zahlung Lizenz-Keys generieren
router.post("/confirm-session", async (req, res) => {
  try {
    console.log("📥 Session ID:", req.body?.session_id);
    const { session_id } = req.body;
    const session = await stripe.checkout.sessions.retrieve(session_id);
    const intent = await stripe.paymentIntents.retrieve(session.payment_intent);
    console.log("📦 Stripe Metadata:", intent.metadata);
    if (intent.status !== 'succeeded') return res.status(400).json({ error: 'Payment not completed' });

    const { product_type, duration_days, key_count } = intent.metadata;
    const durationDays = duration_days === 'null' ? null : Number(duration_days);
    const keyCount = Number(key_count) || 1;
    const product = requireProduct(product_type);
    const createdAt = new Date().toISOString();
    const expiresAt = durationDays ? addDays(createdAt, durationDays) : null;
    const keys = [];

    for (let i = 0; i < keyCount; i++) {
      const code = generateKeyCode();
      const hash = hashKey(code);
      await pool.query(
        `INSERT INTO license_keys (key_code, key_hash, created_at, expires_at, is_active, product_code)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [code, hash, createdAt, expiresAt, true, product_type]
      );
      keys.push(code);
    }

    await pool.query(`INSERT INTO payments (payment_id, amount, currency, status, payment_method, completed_at, metadata)
      VALUES ($1, $2, $3, $4, $5, NOW(), $6)`, [
      intent.id,
      intent.amount,
      intent.currency,
      'completed',
      'stripe',
      JSON.stringify({ ...intent.metadata, keys_generated: keys.length, email: session.customer_email })
    ]);

    if (session.customer_email) {
      const emailService = require('./email/templates');

      await emailService.sendKeyDeliveryEmail(
        session.customer_email,
        keys,
        {
          payment_id: intent.id,
          amount: intent.amount,
          product_type,
          keyCount,
          date: new Date().toISOString()
        }
      );
    }

    res.json({ success: true, keys, expires_at: expiresAt });
  } catch (err) {
    console.error("confirm-session error:", err);
    res.status(500).json({ error: "Zahlung konnte nicht bestätigt werden." });
  }
});

module.exports = router;
