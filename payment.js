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
            // Metadata direkt am Session-Objekt, nicht in payment_intent_data
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

        // EARLY RECORD: Create pending record immediately to prevent polling race condition
        const client = await getTransactionClient();
        try {
            const now = new Date().toISOString();
            const metaObj = {
                ...metadata,
                user_id: userId,
                email: userEmail || session.customer_details?.email,
                is_renewal: (!!is_renewal && !!userId)
            };
            const finalMeta = isPostgreSQL() ? metaObj : JSON.stringify(metaObj);

            await client.query(
                `INSERT INTO payments (payment_id, payment_intent_id, status, amount, currency, payment_method, metadata)
                 VALUES ($1, $2, 'pending', $3, 'eur', 'stripe', $4)`,
                [session.id, session.payment_intent, product.price, finalMeta]
            );
        } catch(e) {
            console.warn("Early Record Insert Failed:", e.message);
        } finally {
            client.release();
        }

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
    console.log(">>> STRIPE WEBHOOK HIT <<<");
    const sig = req.headers['stripe-signature'];
    let event;

    try {
        // Hier passiert oft der Fehler:
        event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
        console.log("✅ Webhook-Signatur verifiziert! Typ:", event.type);
    } catch (err) {
        // Wenn das im Railway-Log erscheint, ist der Raw-Body oder das Secret falsch!
        console.error(`❌ Webhook Signature Error: ${err.message}`);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    switch (event.type) {
        case 'checkout.session.completed':
            const session = event.data.object;
            console.log(`🎯 Checkout Session beendet: ${session.id}`);
            try {
                await handleSuccessfulPayment(session);
            } catch (err) {
                console.error("❌ Fehler bei handleSuccessfulPayment:", err);
            }
            break;

        case 'payment_intent.succeeded':
            // Wir ignorieren PI succeeded, da wir alles über session.completed steuern,
            // um ID-Konflikte (pi_ vs cs_) zu vermeiden.
            console.log(`ℹ️ PaymentIntent succeeded (ignoriert): ${event.data.object.id}`);
            break;

        case 'payment_intent.payment_failed':
            const failedIntent = event.data.object;
            console.error(`❌ Zahlung fehlgeschlagen: ${failedIntent.last_payment_error?.message}`);
            // Optional: DB-Update auf 'failed'
            try {
                await dbQuery("UPDATE payments SET status = 'failed' WHERE payment_id = $1", [failedIntent.id]);
            } catch(e) { console.error("DB Error on fail update:", e); }
            break;

        case 'checkout.session.expired':
            console.warn(`🕒 Checkout abgelaufen: ${event.data.object.id}`);
            try {
                await dbQuery("UPDATE payments SET status = 'expired' WHERE payment_id = $1", [event.data.object.id]);
            } catch(e) { console.error("DB Error on expire update:", e); }
            break;

        default:
            console.log(`ℹ️ Unbehandeltes Event: ${event.type}`);
    }

    res.json({ received: true });
});

/**
 * Handle Successful Payment
 */
async function handleSuccessfulPayment(session) {
    console.log(`>>> PROCESSING PAYMENT: ${session.id}`);

    const client = await getTransactionClient();
    let keysGenerated = [];

    try {
        // --- 1. EXTRACT DATA ---
        // Ensure metadata is pulled directly (as configured in create-checkout-session)
        const meta = session.metadata || {};
        const userId = session.client_reference_id ? parseInt(session.client_reference_id, 10) : null;
        const isRenewal = meta.is_renewal === true || meta.is_renewal === 'true';
        const productType = meta.product_type || 'unknown';
        const product = PRICES[productType];

        console.log('Webhook Step 1: Data extracted', userId, productType);

        if (!product) throw new Error("Unknown Product Config in Webhook");

        const count = parseInt(meta.keys_count, 10) || 1;
        const months = parseInt(meta.duration_months, 10) || 0;
        const customerEmail = session.customer_details?.email || session.customer_email;
        const paymentAmount = session.amount_total; // in cents
        const now = new Date().toISOString();

        // --- 2. START TRANSACTION ---
        await client.query('BEGIN');
        console.log('Webhook Step 2: Transaction started');

        // --- 3. PREPARE METADATA & UPDATE ---
        // Common metadata
        const metaObj = {
            ...meta,
            user_id: userId,
            email: customerEmail,
            is_renewal: !!isRenewal,
            // Will append keys later if generated
        };

        // --- 4. LOGIC SWITCH ---

        // CASE 2: RENEWAL
        if (userId && isRenewal) {
            console.log(`>> MODE: RENEWAL (User ${userId})`);

            // Fetch User
            const userRes = await client.query('SELECT username, license_expiration FROM users WHERE id = $1', [userId]);
            if (userRes.rows.length === 0) throw new Error("User not found for renewal");
            const user = userRes.rows[0];

            // Master Formula
            let newExpiry = null;
            if (months > 0) {
                newExpiry = calculateNewExpiration(user.license_expiration, months);
            }
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
                `INSERT INTO messages (recipient_id, subject, body, type, is_read, created_at) VALUES ($1, $2, $3, 'automated', ${isPostgreSQL() ? 'false' : '0'}, $4)`,
                [userId, msgSubject, msgBody, now]
            );

            // Send Email
            await sendRenewalConfirmation(customerEmail, newExpiry ? new Date(newExpiry).toLocaleDateString('de-DE') : 'Unbegrenzt', user.username);

        } else {
            // CASE 1 & 3: GENERATE KEYS
            console.log(`>> MODE: GENERATE KEYS (User: ${userId || 'Guest'})`);

            for(let i=0; i<count; i++) {
                const keyRaw = crypto.randomBytes(6).toString('hex').toUpperCase().match(/.{1,4}/g).join('-');
                const keyHash = crypto.createHash('sha256').update(keyRaw).digest('hex');
                const origin = userId ? 'shop_addon' : 'shop_guest';

                await client.query(
                    `INSERT INTO license_keys (key_code, key_hash, product_code, is_active, origin, created_at) VALUES ($1, $2, $3, ${isPostgreSQL() ? 'false' : '0'}, $4, $5)`,
                    [keyRaw, keyHash, productType, origin, now]
                );
                keysGenerated.push(keyRaw);
            }

            metaObj.generated_keys = keysGenerated;

            // Send Email
            await sendLicenseEmail(customerEmail, keysGenerated, product.name);
        }

        // --- 5. FINAL UPDATE (The crucial fix) ---
        // We update based on payment_id (which is session.id).
        // We explicitly set status to 'completed' and save the PI ID.

        const finalMeta = isPostgreSQL() ? metaObj : JSON.stringify(metaObj);

        const updateRes = await client.query(
            `UPDATE payments
             SET status = 'completed',
                 completed_at = $1,
                 metadata = $2,
                 payment_intent_id = $3
             WHERE payment_id = $4`,
            [now, finalMeta, session.payment_intent, session.id]
        );

        if (isPostgreSQL() ? updateRes.rowCount === 0 : updateRes.changes === 0) {
            console.warn("⚠️ Warning: Early Record not found for update, inserting new.");
             await client.query(
                `INSERT INTO payments (payment_id, payment_intent_id, amount, currency, status, payment_method, completed_at, metadata)
                 VALUES ($1, $2, $3, 'eur', 'completed', 'stripe', $4, $5)`,
                [session.id, session.payment_intent, paymentAmount, now, finalMeta]
            );
        }

        await client.query('COMMIT');
        console.log('Webhook Step 4: Transaction Committed');

    } catch (e) {
        console.error("Payment Transaction Error:", e);
        await client.query('ROLLBACK');
    } finally {
        client.release();
    }
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
    // Cache-Killer Headers
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    const { session_id } = req.query;
    if (!session_id) return res.status(400).json({ error: "Missing Session ID" });

    let client;
    try {
        client = await getTransactionClient(); 

        const payRes = await client.query('SELECT status, metadata FROM payments WHERE payment_id = $1', [session_id]);
        
        if (payRes.rows.length === 0) {
            return res.json({ status: 'pending' });
        }

        const payment = payRes.rows[0];

        // Granulares Feedback
        if (payment.status === 'succeeded') {
            return res.json({
                success: false,
                status: 'succeeded',
                message: 'Zahlung bestätigt, erstelle Zugang...'
            });
        }

        // Prüfe auf echten Abschluss (completed = Keys generiert)
        const isFinished = payment.status === 'completed';

        if (!isFinished) {
             return res.json({ status: 'processing' });
        }

        // SICHERES PARSING: Erkennt, ob metadata schon ein Objekt ist oder noch Text
        let meta = {};
        try {
            meta = (typeof payment.metadata === 'string') ? JSON.parse(payment.metadata) : (payment.metadata || {});
        } catch (e) {
            console.error("Metadata Parse Error:", e);
        }

        // SICHERER VERGLEICH: Erkennt 'true' als Text UND als echten Boolean
        const isRenewal = meta.is_renewal === true || meta.is_renewal === 'true';

        return res.json({ 
            success: true, 
            status: 'completed', 
            renewed: !!isRenewal, // Ensure strict boolean for frontend
            keys: meta.generated_keys || []
        });

    } catch (e) {
        console.error("Polling Error:", e);
        res.status(500).json({ error: "Server Error" });
    } finally {
        if (client) client.release(); // WICHTIG: Gibt die Verbindung sofort frei
    }
});

module.exports = router;
