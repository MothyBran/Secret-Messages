// payment.js - Korrigierte Version
const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { getTransactionClient, dbQuery, isPostgreSQL } = require('./database/db');
// Sicherstellen, dass Mailer-Fehler den Prozess nicht stoppen
let mailer = { sendLicenseEmail: async () => {}, sendRenewalConfirmation: async () => {} };
try { mailer = require('./email/mailer'); } catch (e) { console.warn("Mailer nicht gefunden, E-Mails werden übersprungen"); }

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const DOMAIN = process.env.DOMAIN || 'https://www.secure-msg.app';

const PRICES = {
    "1m": { name: "1 Monat Zugang", price: 199, months: 1 },
    "3m": { name: "3 Monate Zugang", price: 495, months: 3 },
    "12m": { name: "12 Monate Zugang", price: 1790, months: 12 },
    "unlimited": { name: "Unbegrenzter Zugang", price: 5999, months: 0 },
    "bundle_1m_2": { name: "2x Keys (1 Monat)", price: 379, months: 1, keys: 2 },
    "bundle_3m_5": { name: "5x Keys (3 Monate)", price: 1980, months: 3, keys: 5 },
    "bundle_3m_2": { name: "2x Keys (3 Monate)", price: 899, months: 3, keys: 2 },
    "bundle_1y_10": { name: "10x Keys (12 Monate)", price: 14999, months: 12, keys: 10 }
};

router.post('/create-checkout-session', async (req, res) => {
    try {
        const { product_type, customer_email, is_renewal } = req.body;
        const product = PRICES[product_type];
        if (!product) return res.status(400).json({ error: "Invalid Product" });

        let userId = null;
        const authHeader = req.headers['authorization'];
        if (authHeader) {
            try {
                const jwt = require('jsonwebtoken');
                const decoded = jwt.verify(authHeader.split(' ')[1], process.env.JWT_SECRET || 'secret_fallback_key');
                userId = decoded.id;
            } catch(e) { if(is_renewal) return res.status(401).json({ error: "Session expired" }); }
        }

        // FIX: Metadaten MÜSSEN Strings sein
        const metadata = {
            product_type: String(product_type),
            keys_count: String(product.keys || 1),
            duration_months: String(product.months),
            is_renewal: String(!!is_renewal && !!userId)
        };

        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card', 'paypal'],
            line_items: [{
                price_data: {
                    currency: 'eur',
                    product_data: { name: product.name },
                    unit_amount: product.price,
                },
                quantity: 1,
            }],
            mode: 'payment',
            metadata: metadata,
            client_reference_id: userId ? String(userId) : undefined,
            customer_email: customer_email || undefined,
            success_url: `${DOMAIN}/shop?session_id={CHECKOUT_SESSION_ID}&success=true`,
            cancel_url: `${DOMAIN}/shop?canceled=true`,
        });

        // Datenbank-Eintrag (Pending)
        const metaForDb = JSON.stringify({ ...metadata, user_id: userId, email: customer_email });
        await dbQuery(
            `INSERT INTO payments (payment_id, status, amount, currency, metadata) VALUES ($1, 'pending', $2, 'eur', $3)`,
            [session.id, product.price, metaForDb]
        );

        res.json({ success: true, checkout_url: session.url });
    } catch (error) {
        console.error("Stripe Session Error:", error);
        res.status(500).json({ error: error.message });
    }
});

router.post('/webhook', async (req, res) => {
    const sig = req.headers['stripe-signature'];
    let event;
    try {
        // req.body muss hier ein Buffer sein (kommt via express.raw in server.js)
        event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
        console.error(`❌ Webhook Fehler: ${err.message}`);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type === 'checkout.session.completed') {
        await handleSuccessfulPayment(event.data.object);
    }
    res.json({ received: true });
});

/**
 * Hilfsfunktion zur Berechnung des neuen Ablaufdatums.
 * Addiert Monate auf das aktuelle Datum ODER das bestehende Ablaufdatum (falls in der Zukunft).
 */
function calculateNewExpiration(currentExpirationStr, extensionMonths) {
    const months = parseInt(extensionMonths);
    if (isNaN(months) || months <= 0) return null; // Lifetime/Unbegrenzt

    let baseDate = new Date();
    
    // Falls ein gültiges Ablaufdatum existiert und in der Zukunft liegt, nimm dieses als Basis
    if (currentExpirationStr) {
        const currentExpiry = new Date(currentExpirationStr);
        if (!isNaN(currentExpiry.getTime()) && currentExpiry > baseDate) {
            baseDate = currentExpiry;
        }
    }

    const newDate = new Date(baseDate.getTime());
    newDate.setMonth(newDate.getMonth() + months);
    return newDate.toISOString();
}

async function handleSuccessfulPayment(session) {
    console.log(`Processing Payment: ${session.id}`);
    const client = await getTransactionClient();
    try {
        await client.query('BEGIN');
        
        const meta = session.metadata || {};
        const userId = session.client_reference_id ? parseInt(session.client_reference_id) : null;
        const isRenewal = meta.is_renewal === 'true';
        const count = parseInt(meta.keys_count) || 1;
        const months = parseInt(meta.duration_months) || 0;
        const keysGenerated = [];
        const now = new Date().toISOString();
        const userEmail = session.customer_details?.email;
        const productType = meta.product_type || "Lizenz";

        if (userId) {
            // --- EINGELOGGT ---
            if (isRenewal) {
                // --- FALL 2 (RENEWAL: Neuer Key generiert) ---
                const userRes = await client.query(`
                    SELECT u.username, u.license_key_id, l.expires_at
                    FROM users u
                    LEFT JOIN license_keys l ON u.license_key_id = l.id
                    WHERE u.id = $1
                `, [userId]);

                if (userRes.rows.length > 0) {
                    const userData = userRes.rows[0];
                    const currentExpiry = userData.expires_at;
                    const username = userData.username;
                    const oldKeyId = userData.license_key_id;

                    // Berechne neues Datum (Master-Formel: Max(Now, Expiry) + Monate)
                    const newExpiry = calculateNewExpiration(currentExpiry, months);

                    // 0. Alten Key deaktivieren (Historie)
                    if (oldKeyId) {
                         const inActiveVal = isPostgreSQL() ? false : 0;
                         await client.query(`UPDATE license_keys SET is_active = ${inActiveVal} WHERE id = $1`, [oldKeyId]);
                    }

                    // 1. Neuen Key generieren
                    const key = crypto.randomBytes(6).toString('hex').toUpperCase().match(/.{1,4}/g).join('-');
                    const hash = crypto.createHash('sha256').update(key).digest('hex');
                    const isActiveVal = isPostgreSQL() ? true : 1;

                    // Insert new key (active)
                    const insertKeyRes = await client.query(
                        `INSERT INTO license_keys (key_code, key_hash, product_code, is_active, created_at, expires_at, assigned_user_id)
                         VALUES ($1, $2, $3, ${isActiveVal}, NOW(), $4, $5) ${isPostgreSQL() ? 'RETURNING id' : ''}`,
                        [key, hash, productType, newExpiry, username]
                    );

                    let newKeyId;
                    if (isPostgreSQL()) {
                        newKeyId = insertKeyRes.rows[0].id;
                    } else {
                        // SQLite hack to get lastID if needed, but we can query by key_code if lastID is not reliable in this mock
                        // However, server.js handles SQLite ID retrieval via this.lastID in the callback.
                        // The getTransactionClient mock for SQLite returns a promise.
                        // Ideally we query back the ID.
                        const kRes = await client.query('SELECT id FROM license_keys WHERE key_code = $1', [key]);
                        newKeyId = kRes.rows[0].id;
                    }

                    // 2. User Update (Link new key)
                    await client.query(
                        'UPDATE users SET license_key_id = $1 WHERE id = $2',
                        [newKeyId, userId]
                    );

                    // 3. Renewal Log (Mit STRIPE_RENEWAL Marker)
                    await client.query(
                        'INSERT INTO license_renewals (user_id, extended_until, used_at, key_code_hash) VALUES ($1, $2, $3, $4)',
                        [userId, newExpiry, now, 'STRIPE_RENEWAL']
                    );

                    // 4. Interne Nachricht (Jetzt mit neuem Key Code!)
                    const msgSubject = "✅ Lizenz verlängert";
                    const msgBody = `Deine Lizenz wurde erfolgreich verlängert. Dein neuer Key lautet: ${key}. Er wurde automatisch aktiviert. Gültig bis: ${new Date(newExpiry).toLocaleDateString('de-DE')}`;

                    await client.query(
                        `INSERT INTO messages (recipient_id, subject, body, type, is_read, created_at)
                         VALUES ($1, $2, $3, 'automated', ${isPostgreSQL() ? 'false' : '0'}, NOW())`,
                        [userId, msgSubject, msgBody]
                    );

                    // 5. E-Mail Senden (Benutze sendLicenseEmail, da wir jetzt einen Key haben, oder RenewalConf mit Key?)
                    // User bat um: "Sende den neuen Key-Code sowohl per E-Mail als auch als interne Nachricht"
                    // mailer.sendLicenseEmail supports list of keys.
                    mailer.sendLicenseEmail(userEmail, [key], productType).catch(console.error);

                    console.log(`✅ User ${userId} verlängert. Neuer Key: ${key} bis: ${newExpiry || 'Lifetime'}`);
                }
            } else {
                // --- FALL 2/3 (AKTIV ABER NEUER KEY) ---
                const keyExpiry = calculateNewExpiration(null, months);

                for(let i=0; i<count; i++) {
                    const key = crypto.randomBytes(6).toString('hex').toUpperCase().match(/.{1,4}/g).join('-');
                    const hash = crypto.createHash('sha256').update(key).digest('hex');

                    await client.query(
                        `INSERT INTO license_keys (key_code, key_hash, product_code, is_active, created_at, expires_at)
                         VALUES ($1, $2, $3, ${isPostgreSQL() ? 'false' : '0'}, NOW(), $4)`,
                        [key, hash, meta.product_type, keyExpiry]
                    );
                    keysGenerated.push(key);
                }

                // Interne Nachricht mit Keys
                const msgSubject = "🔑 Neuer Key erworben";
                const msgBody = `Du hast einen neuen Key erworben: ${keysGenerated.join(', ')}`;

                await client.query(
                    `INSERT INTO messages (recipient_id, subject, body, type, is_read, created_at)
                     VALUES ($1, $2, $3, 'automated', ${isPostgreSQL() ? 'false' : '0'}, NOW())`,
                    [userId, msgSubject, msgBody]
                );

                // E-Mail Senden
                mailer.sendLicenseEmail(userEmail, keysGenerated, productType).catch(console.error);

                console.log(`✅ ${keysGenerated.length} neue Keys für User ${userId} generiert.`);
            }
        } else {
            // --- FALL 1 (GAST) ---
            const keyExpiry = calculateNewExpiration(null, months);

            for(let i=0; i<count; i++) {
                const key = crypto.randomBytes(6).toString('hex').toUpperCase().match(/.{1,4}/g).join('-');
                const hash = crypto.createHash('sha256').update(key).digest('hex');
                
                await client.query(
                    `INSERT INTO license_keys (key_code, key_hash, product_code, is_active, created_at, expires_at) 
                     VALUES ($1, $2, $3, ${isPostgreSQL() ? 'false' : '0'}, NOW(), $4)`, 
                    [key, hash, meta.product_type, keyExpiry]
                );
                keysGenerated.push(key);
            }

            // Nur E-Mail Senden (Kein User -> Keine interne Nachricht)
            mailer.sendLicenseEmail(userEmail, keysGenerated, productType).catch(console.error);
            console.log(`✅ ${keysGenerated.length} neue Keys für Gast generiert.`);
        }

        // --- FINALES UPDATE DES ZAHLUNGSSTATUS ---
        const finalMeta = JSON.stringify({ 
            ...meta, 
            generated_keys: keysGenerated, 
            email: session.customer_details?.email 
        });

        await client.query(
            `UPDATE payments SET status = 'completed', completed_at = NOW(), metadata = $1, payment_intent_id = $2 WHERE payment_id = $3`,
            [finalMeta, session.payment_intent, session.id]
        );

        await client.query('COMMIT');
        console.log(`✅ Payment ${session.id} erfolgreich in DB abgeschlossen.`);

    } catch (e) {
        await client.query('ROLLBACK');
        console.error("❌ Webhook Transaction Error:", e);
    } finally {
        client.release();
    }
}

router.get('/order-status', async (req, res) => {
    const { session_id } = req.query;
    try {
        const result = await dbQuery('SELECT status, metadata FROM payments WHERE payment_id = $1', [session_id]);
        if (result.rows.length === 0) return res.json({ status: 'pending' });
        
        const payment = result.rows[0];
        if (payment.status === 'completed') {
            const meta = typeof payment.metadata === 'string' ? JSON.parse(payment.metadata) : payment.metadata;
            return res.json({ success: true, status: 'completed', keys: meta.generated_keys || [], renewed: meta.is_renewal === 'true' });
        }
        res.json({ status: 'processing' });
    } catch (e) { res.status(500).json({ error: "Server Error" }); }
});

module.exports = router;
