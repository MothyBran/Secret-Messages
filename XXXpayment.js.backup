// payment.js - Stripe Payment Integration
const express = require('express');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const sqlite3 = require('sqlite3').verbose();
const crypto = require('crypto');
const nodemailer = require('nodemailer');

const router = express.Router();

// Email Configuration
const emailTransporter = nodemailer.createTransporter({
    host: process.env.SMTP_HOST,
    port: process.env.SMTP_PORT,
    secure: false,
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
    },
});

// Database connection
const db = new sqlite3.Database('./secret_messages.db');

// Price Configuration
const PRICES = {
    single_key: {
        price: 999, // 9.99 EUR in cents
        currency: 'eur',
        name: 'Secret Messages License Key',
        description: 'Ein Lizenz-Key für Secret Messages AES Encryption System'
    },
    bundle_5: {
        price: 3999, // 39.99 EUR for 5 keys
        currency: 'eur',
        name: '5x Secret Messages License Keys',
        description: 'Fünf Lizenz-Keys für Secret Messages (20% Rabatt)'
    },
    bundle_10: {
        price: 6999, // 69.99 EUR for 10 keys
        currency: 'eur', 
        name: '10x Secret Messages License Keys',
        description: 'Zehn Lizenz-Keys für Secret Messages (30% Rabatt)'
    }
};

// Utility Functions
function generateLicenseKey() {
    const parts = [];
    for (let i = 0; i < 3; i++) {
        const part = crypto.randomBytes(3).toString('hex').toUpperCase().substring(0, 5);
        parts.push(part);
    }
    return parts.join('-');
}

function hashKey(key) {
    const bcrypt = require('bcrypt');
    return bcrypt.hashSync(key, 10);
}

async function sendEmailWithKeys(email, keys, orderDetails) {
    const keysList = keys.map((key, index) => 
        `${index + 1}. ${key.key_code}`
    ).join('\n');

    const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
        <style>
            body { font-family: 'Courier New', monospace; background: #000; color: #00ff41; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { text-align: center; border: 2px solid #00ff41; padding: 20px; margin-bottom: 20px; }
            .keys { background: rgba(0,255,65,0.1); padding: 20px; border: 1px solid #00ff41; }
            .key-item { margin: 10px 0; font-size: 1.2em; font-weight: bold; }
            .footer { margin-top: 30px; font-size: 0.8em; color: #00cc33; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>🔐 SECRET MESSAGES</h1>
                <h2>Ihre Lizenz-Keys sind bereit!</h2>
            </div>
            
            <p>Vielen Dank für Ihren Kauf!</p>
            <p>Hier sind Ihre exklusiven Lizenz-Keys für Secret Messages:</p>
            
            <div class="keys">
                <h3>🔑 Ihre Lizenz-Keys:</h3>
                ${keys.map((key, index) => 
                    `<div class="key-item">${index + 1}. ${key.key_code}</div>`
                ).join('')}
            </div>
            
            <h3>📋 Bestelldetails:</h3>
            <ul>
                <li>Bestellnummer: ${orderDetails.payment_id}</li>
                <li>Anzahl Keys: ${keys.length}</li>
                <li>Betrag: €${(orderDetails.amount / 100).toFixed(2)}</li>
                <li>Datum: ${new Date().toLocaleDateString('de-DE')}</li>
            </ul>
            
            <h3>🚀 So nutzen Sie Ihre Keys:</h3>
            <ol>
                <li>Öffnen Sie Secret Messages: <a href="${process.env.FRONTEND_URL}" style="color: #00ff41;">${process.env.FRONTEND_URL}</a></li>
                <li>Geben Sie einen Ihrer Keys ein</li>
                <li>Der Key wird automatisch an Ihr Gerät gebunden</li>
                <li>Genießen Sie militärgrad-sichere Verschlüsselung!</li>
            </ol>
            
            <div class="footer">
                <p>🛡️ Jeder Key funktioniert nur einmal und wird an Ihr Gerät gebunden.</p>
                <p>📧 Bei Fragen antworten Sie einfach auf diese E-Mail.</p>
                <p>⚡ Viel Spaß mit Secret Messages!</p>
            </div>
        </div>
    </body>
    </html>`;

    const mailOptions = {
        from: process.env.SMTP_USER,
        to: email,
        subject: '🔐 Ihre Secret Messages Lizenz-Keys sind bereit!',
        html: htmlContent,
        text: `Secret Messages - Ihre Lizenz-Keys\n\n${keysList}\n\nBestellnummer: ${orderDetails.payment_id}\nBetrag: €${(orderDetails.amount / 100).toFixed(2)}`
    };

    return emailTransporter.sendMail(mailOptions);
}

// Create Payment Intent
router.post('/create-payment-intent', async (req, res) => {
    try {
        const { product_type, quantity = 1, customer_email } = req.body;

        if (!PRICES[product_type]) {
            return res.status(400).json({ error: 'Invalid product type' });
        }

        if (!customer_email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer_email)) {
            return res.status(400).json({ error: 'Valid email address required' });
        }

        const productInfo = PRICES[product_type];
        let keyCount = 1;
        
        if (product_type === 'bundle_5') keyCount = 5;
        if (product_type === 'bundle_10') keyCount = 10;
        if (product_type === 'single_key' && quantity > 1) keyCount = quantity;

        const totalAmount = product_type === 'single_key' ? 
            productInfo.price * quantity : productInfo.price;

        // Create Stripe Payment Intent
        const paymentIntent = await stripe.paymentIntents.create({
            amount: totalAmount,
            currency: productInfo.currency,
            automatic_payment_methods: {
                enabled: true,
            },
            metadata: {
                product_type: product_type,
                key_count: keyCount,
                customer_email: customer_email,
                quantity: quantity
            },
            description: `${productInfo.name} - ${keyCount} License Key(s)`,
            receipt_email: customer_email,
        });

        // Store payment record
        db.run(
            `INSERT INTO payments (payment_id, amount, currency, status, payment_method, metadata) 
             VALUES (?, ?, ?, ?, ?, ?)`,
            [
                paymentIntent.id,
                totalAmount,
                productInfo.currency,
                'pending',
                'stripe',
                JSON.stringify({
                    product_type,
                    key_count: keyCount,
                    customer_email,
                    quantity
                })
            ],
            function(err) {
                if (err) {
                    console.error('Error storing payment record:', err);
                }
            }
        );

        res.json({
            success: true,
            client_secret: paymentIntent.client_secret,
            payment_id: paymentIntent.id,
            amount: totalAmount,
            currency: productInfo.currency,
            key_count: keyCount
        });

    } catch (error) {
        console.error('Payment intent creation error:', error);
        res.status(500).json({ error: 'Payment creation failed' });
    }
});

// Handle successful payment
router.post('/confirm-payment', async (req, res) => {
    try {
        const { payment_intent_id } = req.body;

        if (!payment_intent_id) {
            return res.status(400).json({ error: 'Payment intent ID required' });
        }

        // Retrieve payment intent from Stripe
        const paymentIntent = await stripe.paymentIntents.retrieve(payment_intent_id);

        if (paymentIntent.status !== 'succeeded') {
            return res.status(400).json({ error: 'Payment not completed' });
        }

        const metadata = paymentIntent.metadata;
        const keyCount = parseInt(metadata.key_count) || 1;
        const customerEmail = metadata.customer_email;

        // Generate license keys
        const generatedKeys = [];
        for (let i = 0; i < keyCount; i++) {
            const keyCode = generateLicenseKey();
            const keyHash = hashKey(keyCode);
            
            await new Promise((resolve, reject) => {
                db.run(
                    `INSERT INTO license_keys (key_code, key_hash, metadata) VALUES (?, ?, ?)`,
                    [keyCode, keyHash, JSON.stringify({ payment_id: payment_intent_id, customer_email: customerEmail })],
                    function(err) {
                        if (err) {
                            reject(err);
                        } else {
                            generatedKeys.push({
                                id: this.lastID,
                                key_code: keyCode
                            });
                            resolve();
                        }
                    }
                );
            });
        }

        // Update payment record
        await new Promise((resolve, reject) => {
            db.run(
                `UPDATE payments SET status = ?, completed_at = CURRENT_TIMESTAMP, 
                 metadata = ? WHERE payment_id = ?`,
                [
                    'completed',
                    JSON.stringify({
                        ...metadata,
                        keys_generated: generatedKeys.map(k => k.key_code),
                        generation_date: new Date().toISOString()
                    }),
                    payment_intent_id
                ],
                function(err) {
                    if (err) reject(err);
                    else resolve();
                }
            );
        });

        // Link keys to payment
        for (const key of generatedKeys) {
            await new Promise((resolve, reject) => {
                db.run(
                    `UPDATE license_keys SET key_id = ? WHERE id = ?`,
                    [payment_intent_id, key.id],
                    (err) => {
                        if (err) reject(err);
                        else resolve();
                    }
                );
            });
        }

        // Send email with keys
        try {
            await sendEmailWithKeys(customerEmail, generatedKeys, {
                payment_id: payment_intent_id,
                amount: paymentIntent.amount,
                currency: paymentIntent.currency
            });
            console.log(`Keys email sent to: ${customerEmail}`);
        } catch (emailError) {
            console.error('Email sending failed:', emailError);
            // Don't fail the entire process if email fails
        }

        res.json({
            success: true,
            message: 'Payment confirmed and keys generated',
            key_count: generatedKeys.length,
            keys: generatedKeys.map(k => k.key_code),
            email_sent: true
        });

    } catch (error) {
        console.error('Payment confirmation error:', error);
        res.status(500).json({ error: 'Payment confirmation failed' });
    }
});

// Stripe Webhook Handler
router.post('/webhook', express.raw({ type: 'application/json' }), (req, res) => {
    const sig = req.headers['stripe-signature'];
    const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

    let event;

    try {
        event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
    } catch (err) {
        console.error('Webhook signature verification failed:', err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // Handle the event
    switch (event.type) {
        case 'payment_intent.succeeded':
            const paymentIntent = event.data.object;
            console.log(`PaymentIntent ${paymentIntent.id} succeeded!`);
            
            // Update payment status in database
            db.run(
                `UPDATE payments SET status = 'webhook_confirmed' WHERE payment_id = ?`,
                [paymentIntent.id],
                (err) => {
                    if (err) console.error('Webhook DB update error:', err);
                }
            );
            break;

        case 'payment_intent.payment_failed':
            const failedPayment = event.data.object;
            console.log(`PaymentIntent ${failedPayment.id} failed!`);
            
            db.run(
                `UPDATE payments SET status = 'failed' WHERE payment_id = ?`,
                [failedPayment.id],
                (err) => {
                    if (err) console.error('Webhook DB update error:', err);
                }
            );
            break;

        default:
            console.log(`Unhandled event type ${event.type}`);
    }

    res.json({ received: true });
});

// Get payment status
router.get('/status/:payment_id', async (req, res) => {
    try {
        const { payment_id } = req.params;

        // Check local database first
        db.get(
            `SELECT * FROM payments WHERE payment_id = ?`,
            [payment_id],
            async (err, payment) => {
                if (err) {
                    console.error('Database error:', err);
                    return res.status(500).json({ error: 'Database error' });
                }

                if (!payment) {
                    return res.status(404).json({ error: 'Payment not found' });
                }

                // Also check Stripe for the latest status
                try {
                    const paymentIntent = await stripe.paymentIntents.retrieve(payment_id);
                    
                    res.json({
                        success: true,
                        payment_id: payment_id,
                        status: paymentIntent.status,
                        amount: paymentIntent.amount,
                        currency: paymentIntent.currency,
                        local_status: payment.status,
                        created: payment.created_at,
                        completed: payment.completed_at
                    });
                } catch (stripeError) {
                    res.json({
                        success: true,
                        payment_id: payment_id,
                        status: 'unknown',
                        local_status: payment.status,
                        created: payment.created_at,
                        completed: payment.completed_at,
                        note: 'Stripe status unavailable'
                    });
                }
            }
        );

    } catch (error) {
        console.error('Payment status error:', error);
        res.status(500).json({ error: 'Status check failed' });
    }
});

// Get pricing information
router.get('/pricing', (req, res) => {
    const pricing = {};
    
    for (const [key, value] of Object.entries(PRICES)) {
        pricing[key] = {
            price: value.price,
            currency: value.currency,
            name: value.name,
            description: value.description,
            price_formatted: `€${(value.price / 100).toFixed(2)}`
        };
    }

    res.json({
        success: true,
        pricing: pricing,
        currency: 'EUR'
    });
});

// Admin: Get payment statistics
router.post('/admin/payment-stats', (req, res) => {
    const { password } = req.body;
    
    if (password !== process.env.ADMIN_PASSWORD) {
        return res.status(401).json({ error: 'Admin authentication failed' });
    }

    const queries = [
        'SELECT COUNT(*) as total_payments FROM payments',
        'SELECT COUNT(*) as completed_payments FROM payments WHERE status = "completed"',
        'SELECT SUM(amount) as total_revenue FROM payments WHERE status = "completed"',
        'SELECT COUNT(*) as todays_payments FROM payments WHERE date(created_at) = date("now")',
        'SELECT COUNT(*) as pending_payments FROM payments WHERE status = "pending"'
    ];

    Promise.all(queries.map(query => 
        new Promise((resolve, reject) => {
            db.get(query, (err, result) => {
                if (err) reject(err);
                else resolve(result);
            });
        })
    )).then(results => {
        res.json({
            success: true,
            stats: {
                totalPayments: results[0].total_payments,
                completedPayments: results[1].completed_payments,
                totalRevenue: (results[2].total_revenue || 0) / 100, // Convert to EUR
                todaysPayments: results[3].todays_payments,
                pendingPayments: results[4].pending_payments
            }
        });
    }).catch(err => {
        console.error('Payment stats error:', err);
        res.status(500).json({ error: 'Failed to fetch payment statistics' });
    });
});

module.exports = router;
