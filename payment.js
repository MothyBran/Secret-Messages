// payment.js - Centralized Payment System

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { getTransactionClient, dbQuery, isPostgreSQL } = require('./database/db');
const { sendLicenseEmail, sendRenewalConfirmation } = require('./email/mailer');
require('dotenv').config();

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const DOMAIN = process.env.DOMAIN || 'https://www.secure-msg.app';

// =======================================================
// CONFIGURATION
// =======================================================

// Unified Price Configuration
// Maps internal IDs to Display Name, Price, and Duration (months)
const PRICES = {
    "1m":           { name: "1 Monat Zugang",            price: 199,   months: 1 },
    "3m":           { name: "3 Monate Zugang",           price: 495,   months: 3 },
    "12m":          { name: "12 Monate Zugang",          price: 1790,  months: 12 },
    "unlimited":    { name: "Unbegrenzter Zugang",       price: 5999,  months: 0 }, // 0 = Lifetime

    // Bundles (months applies to each key)
    "bundle_1m_2":  { name: "2x Keys (1 Monat)",         price: 379,   months: 1, keys: 2 },
    "bundle_3m_5":  { name: "5x Keys (3 Monate)",        price: 1980,  months: 3, keys: 5 },
    "bundle_3m_2":  { name: "2x Keys (3 Monate)",        price: 899,   months: 3, keys: 2 },
    "bundle_1y_10": { name: "10x Keys (12 Monate)",      price: 14999, months: 12, keys: 10 }
};

// =======================================================
// HELPERS
// =======================================================

function calculateNewExpiration(currentExpirationStr, extensionMonths) {
    if (!extensionMonths || extensionMonths <= 0) return null; // Logic error or lifetime

    let baseDate = new Date();
    // Parse DB Date
    let currentExpiry = null;
    if(currentExpirationStr) {
        currentExpiry = new Date(currentExpirationStr);
        if(isNaN(currentExpiry.getTime())) currentExpiry = null;
    }

    // Master Formula: MAX(NOW, Expiry)
    if (currentExpiry && currentExpiry > baseDate) {
        baseDate = currentExpiry;
    }

    const newDate = new Date(baseDate.getTime());
    newDate.setMonth(newDate.getMonth() + extensionMonths);
    return newDate.toISOString();
}

// =======================================================
// ROUTES
// =======================================================

/**
 * POST /api/create-checkout-session
 * Handles Session Creation for both Guests and Logged-in Users (Renewals/Add-ons)
 */
router.post('/create-checkout-session', async (req, res) => {
    try {
        const { product_type, customer_email, is_renewal } = req.body;

        // 1. Validate Product
        const product = PRICES[product_type];
        if (!product) return res.status(400).json({ error: "Invalid Product" });

        // 2. Identify User (if logged in)
        let userId = null;
        let userEmail = customer_email;

        // Check Auth Header manually (since this route might be public or protected)
        const authHeader = req.headers['authorization'];
        if (authHeader) {
            const token = authHeader.split(' ')[1];
            try {
                const jwt = require('jsonwebtoken');
                const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret_fallback_key');
                userId = decoded.id;
            } catch(e) {
                // Token invalid/expired? If renewal requested, this is critical.
                if(is_renewal) return res.status(401).json({ error: "Session expired" });
            }
        }

        // 3. Build Metadata
        const metadata = {
            product_type: product_type,
            keys_count: product.keys || 1,
            duration_months: product.months,
            is_renewal: (!!is_renewal && !!userId).toString() // Only true if user exists
        };

        // 4. Construct Line Items (Ad-Hoc Price)
        // We use ad-hoc prices based on our internal Config to ensure consistency
        const line_items = [{
            price_data: {
                currency: 'eur',
                product_data: {
                    name: product.name,
                    description: product.keys ? `${product.keys} Lizenzschlüssel` : 'Secure Messages Lizenz',
                },
                unit_amount: product.price,
            },
            quantity: 1,
        }];

        // 5. Create Session
        const sessionConfig = {
            payment_method_types: ['card', 'paypal'], // PayPal requires activation in Stripe Dashboard
            line_items: line_items,
            mode: 'payment',
            success_url: `${DOMAIN}/shop?session_id={CHECKOUT_SESSION_ID}&success=true`,
            cancel_url: `${DOMAIN}/shop?canceled=true`,
            metadata: metadata,
        };

        // If user is known, track them
        if (userId) {
            sessionConfig.client_reference_id = userId.toString();
        }

        // Prefill Email if provided
        if (userEmail) {
            sessionConfig.customer_email = userEmail;
        }

        const session = await stripe.checkout.sessions.create(sessionConfig);

        res.json({ success: true, checkout_url: session.url });

    } catch (error) {
        console.error("Checkout Error:", error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/webhook
 * Central Logic Switch
 * Note: express.raw parsing is handled globally in server.js for /api/webhook
 */
router.post('/webhook', async (req, res) => {
    const sig = req.headers['stripe-signature'];
    let event;

    try {
        event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
        console.error(`Webhook Error: ${err.message}`);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type === 'checkout.session.completed') {
        const session = event.data.object;
        await handleCheckoutCompleted(session);
    }

    res.json({ received: true });
});

/**
 * Handle Successful Payment
 */
async function handleCheckoutCompleted(session) {
    console.log(`>>> PROCESSING PAYMENT: ${session.id}`);

    const client = await getTransactionClient();
    let keysGenerated = [];

    try {
        // --- 1. EXTRACT DATA ---
        const meta = session.metadata || {};
        const userId = session.client_reference_id ? parseInt(session.client_reference_id, 10) : null;
        const isRenewal = meta.is_renewal === 'true';
        const productType = meta.product_type || 'unknown';
        const product = PRICES[productType];

        console.log('Webhook Step 1: Data extracted', userId, productType);

        // Safety check on product config
        if (!product) throw new Error("Unknown Product Config in Webhook");

        const count = parseInt(meta.keys_count) || 1;
        const months = parseInt(meta.duration_months) || 0;
        const customerEmail = session.customer_details?.email || session.customer_email;
        const paymentAmount = session.amount_total; // in cents

        // --- 2. START TRANSACTION ---
        // Unified BEGIN for both PG and SQLite
        await client.query('BEGIN');
        console.log('Webhook Step 2: Transaction started');

        // --- 3. LOG PAYMENT ---
        // We log first to have a record.
        const paymentSql = `
            INSERT INTO payments (payment_id, amount, currency, status, payment_method, completed_at, metadata)
            VALUES ($1, $2, 'eur', 'completed', 'stripe', $3, $4)
            ${isPostgreSQL ? 'RETURNING id' : ''}
        `;
        // Metadata needs to include user_id if present for analytics
        const finalMeta = JSON.stringify({ ...meta, user_id: userId, email: customerEmail });
        const now = new Date().toISOString();

        await client.query(paymentSql, [session.id, paymentAmount, now, finalMeta]);

        // --- 4. LOGIC SWITCH ---

        // CASE 2: RENEWAL (User Logged In AND Requested Renewal)
        if (userId && isRenewal) {
            console.log(`>> MODE: RENEWAL (User ${userId})`);

            // Fetch User
            const userRes = await client.query('SELECT username, license_expiration FROM users WHERE id = $1', [userId]);
            if (userRes.rows.length === 0) throw new Error("User not found for renewal");
            const user = userRes.rows[0];

            // Master Formula
            let newExpiry = null;
            if (months > 0) { // Not Lifetime
                newExpiry = calculateNewExpiration(user.license_expiration, months);
            }
            // If Lifetime (months=0), newExpiry stays null (conceptually) or we set a far future date?
            // Existing logic often used NULL for lifetime. Let's stick to NULL or '2099'.
            // "Unlimited" in PRICES has months: 0.
            // If months=0, we assume Lifetime.
            if (months === 0) newExpiry = null; // Lifetime

            // Update User
            await client.query('UPDATE users SET license_expiration = $1 WHERE id = $2', [newExpiry, userId]);

            // Log Renewal Event
            await client.query('INSERT INTO license_renewals (user_id, extended_until, used_at) VALUES ($1, $2, $3)',
                [userId, newExpiry, now]);

            // Inbox Message
            const msgSubject = "Lizenz verlängert";
            const msgBody = `Vielen Dank! Ihre Lizenz wurde erfolgreich verlängert bis: ${newExpiry ? new Date(newExpiry).toLocaleDateString('de-DE') : 'Unbegrenzt'}.`;
            await client.query(
                `INSERT INTO messages (recipient_id, subject, body, type, is_read, created_at) VALUES ($1, $2, $3, 'automated', ${isPostgreSQL ? 'false' : '0'}, $4)`,
                [userId, msgSubject, msgBody, now]
            );

            console.log('Webhook Step 3: DB Updates finished');

            // Commit here for Renewal
            await client.query('COMMIT');
            console.log('Webhook Step 4: Transaction Committed');
            console.log(`[SUCCESS] DB updated for User ${userId}`);

            // Send Email
            await sendRenewalConfirmation(customerEmail, newExpiry ? new Date(newExpiry).toLocaleDateString('de-DE') : 'Unbegrenzt', user.username);

        } else {
            // CASE 1 (Guest) OR CASE 3 (User buying extra keys)
            console.log(`>> MODE: GENERATE KEYS (User: ${userId || 'Guest'})`);

            for(let i=0; i<count; i++) {
                const keyRaw = crypto.randomBytes(6).toString('hex').toUpperCase().match(/.{1,4}/g).join('-');
                const keyHash = crypto.createHash('sha256').update(keyRaw).digest('hex');

                // Determine origin
                const origin = userId ? 'shop_addon' : 'shop_guest';

                await client.query(
                    `INSERT INTO license_keys (key_code, key_hash, product_code, is_active, origin, created_at) VALUES ($1, $2, $3, ${isPostgreSQL ? 'false' : '0'}, $4, $5)`,
                    [keyRaw, keyHash, productType, origin, now]
                );
                keysGenerated.push(keyRaw);
            }

            // Update Payment Metadata with generated keys (for polling)
            // We need to update the payment record we just inserted?
            // Or easier: Just return them in the polling endpoint by querying license_keys created recently?
            // Safer: Store them in a temporary "order" table or update the payment metadata.
            // Let's update the payment metadata.
            const updatedMeta = JSON.stringify({ ...meta, user_id: userId, email: customerEmail, generated_keys: keysGenerated });
            await client.query('UPDATE payments SET metadata = $1 WHERE payment_id = $2', [updatedMeta, session.id]);

            console.log('Webhook Step 3: DB Updates finished');

            await client.query('COMMIT');
            console.log('Webhook Step 4: Transaction Committed');
            console.log(`[SUCCESS] Keys generated for User ${userId || 'Guest'}`);

            // Send Email
            await sendLicenseEmail(customerEmail, keysGenerated, product.name);
        }

    } catch (e) {
        console.error("Payment Transaction Error:", e);
        // Unified ROLLBACK for both PG and SQLite
        await client.query('ROLLBACK');
    } finally {
        client.release();
    }
}

/**
 * GET /api/order-status
 * Polling Endpoint
 */
router.get('/order-status', async (req, res) => {
    const { session_id } = req.query;
    if (!session_id) return res.status(400).json({ error: "Missing Session ID" });

    try {
        const client = await getTransactionClient(); // Just need query

        // 1. Check Payment Status
        const payRes = await client.query('SELECT status, metadata, completed_at FROM payments WHERE payment_id = $1', [session_id]);
        if (payRes.rows.length === 0) return res.json({ status: 'pending' }); // Not yet hooked

        const payment = payRes.rows[0];

        // Ensure "processing" is returned if exists but not completed
        if (payment.status !== 'completed' && payment.status !== 'succeeded') {
             return res.json({ status: payment.status || 'processing' });
        }

        const meta = JSON.parse(payment.metadata || '{}');
        const isRenewal = meta.is_renewal === 'true';
        const userId = meta.user_id;

        // 2. Simplified Verification Logic (Atomic Trust)
        if (isRenewal && userId) {
            // We trust the transaction has committed if status is completed/succeeded
            return res.json({ success: true, status: 'completed', renewed: true });
        } else {
            // Return Keys
            const keys = meta.generated_keys || [];
            return res.json({ success: true, status: 'completed', keys: keys, renewed: false });
        }

    } catch (e) {
        console.error("Polling Error:", e);
        res.status(500).json({ error: "Server Error" });
    }
});

module.exports = router;
