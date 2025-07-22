/**
 * Payment Processing Module for Secret Messages
 * Handles Stripe integration, key generation, and email delivery
 */

require('dotenv').config();
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const nodemailer = require('nodemailer');

// Initialize Stripe (only if configured)
let stripe = null;
if (process.env.STRIPE_SECRET_KEY) {
    stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
}

// Email transporter setup
let emailTransporter = null;
if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
    emailTransporter = nodemailer.createTransporter({
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT) || 587,
        secure: parseInt(process.env.SMTP_PORT) === 465,
        auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS
        }
    });
}

// Product pricing configuration
const PRICING = {
    single_key: {
        price: 999, // €9.99 in cents
        keys: 1,
        name: 'Single License Key',
        description: 'One license key for personal use'
    },
    bundle_5: {
        price: 3999, // €39.99 in cents  
        keys: 5,
        name: '5-Key Bundle',
        description: 'Five license keys with 20% discount',
        discount: 20
    },
    bundle_10: {
        price: 6999, // €69.99 in cents
        keys: 10,
        name: '10-Key Bundle', 
        description: 'Ten license keys with 30% discount',
        discount: 30
    }
};

// Utility functions
function log(message, level = 'info') {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [PAYMENT] [${level.toUpperCase()}] ${message}`);
}

function generateLicenseKey() {
    const parts = [];
    for (let i = 0; i < 3; i++) {
        const part = crypto.randomBytes(3).toString('hex').toUpperCase().substring(0, 5);
        parts.push(part);
    }
    return parts.join('-');
}

function hashKey(key) {
    return bcrypt.hashSync(key, 10);
}

// Database helper (assumes external db connection)
let dbConnection = null;

function setDatabaseConnection(db) {
    dbConnection = db;
}

async function executeQuery(query, params = []) {
    if (!dbConnection) {
        throw new Error('Database connection not initialized');
    }
    
    // This assumes the database connection is passed from server.js
    if (typeof dbConnection.query === 'function') {
        // PostgreSQL
        const result = await dbConnection.query(query, params);
        return result;
    } else {
        // SQLite
        return new Promise((resolve, reject) => {
            dbConnection.run(query, params, function(err) {
                if (err) {
                    reject(err);
                } else {
                    resolve({ lastID: this.lastID, changes: this.changes });
                }
            });
        });
    }
}

// Payment Intent Creation
async function createPaymentIntent(productType, customerEmail, quantity = 1) {
    if (!stripe) {
        throw new Error('Stripe not configured');
    }
    
    if (!PRICING[productType]) {
        throw new Error('Invalid product type');
    }
    
    const product = PRICING[productType];
    const totalAmount = product.price * (quantity || 1);
    const keyCount = product.keys * (quantity || 1);
    
    try {
        const paymentIntent = await stripe.paymentIntents.create({
            amount: totalAmount,
            currency: 'eur',
            customer_email: customerEmail,
            metadata: {
                product_type: productType,
                key_count: keyCount.toString(),
                customer_email: customerEmail,
                created_at: new Date().toISOString()
            },
            description: `Secret Messages - ${product.name}`,
            receipt_email: customerEmail
        });
        
        // Store payment intent in database
        await executeQuery(
            'INSERT INTO payments (stripe_payment_id, amount, currency, customer_email, status, key_count, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [paymentIntent.id, totalAmount, 'EUR', customerEmail, 'pending', keyCount, new Date().toISOString()]
        );
        
        log(`Payment intent created: ${paymentIntent.id} for ${customerEmail}`);
        
        return {
            success: true,
            client_secret: paymentIntent.client_secret,
            payment_id: paymentIntent.id,
            amount: totalAmount,
            currency: 'eur',
            key_count: keyCount,
            product_name: product.name
        };
        
    } catch (error) {
        log(`Payment intent creation failed: ${error.message}`, 'error');
        throw error;
    }
}

// Payment Confirmation and Key Generation
async function confirmPayment(paymentIntentId) {
    if (!stripe) {
        throw new Error('Stripe not configured');
    }
    
    try {
        // Retrieve payment intent from Stripe
        const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
        
        if (paymentIntent.status !== 'succeeded') {
            throw new Error(`Payment not completed. Status: ${paymentIntent.status}`);
        }
        
        const keyCount = parseInt(paymentIntent.metadata.key_count);
        const customerEmail = paymentIntent.metadata.customer_email;
        
        // Generate license keys
        const generatedKeys = [];
        for (let i = 0; i < keyCount; i++) {
            const keyCode = generateLicenseKey();
            const keyHash = hashKey(keyCode);
            
            // Insert key into database
            const result = await executeQuery(
                'INSERT INTO license_keys (key_code, key_hash, created_by) VALUES (?, ?, ?)',
                [keyCode, keyHash, 'payment']
            );
            
            generatedKeys.push({
                id: result.lastID || result.insertId,
                key: keyCode,
                created_at: new Date().toISOString()
            });
        }
        
        // Update payment record
        await executeQuery(
            'UPDATE payments SET status = ?, generated_keys = ?, completed_at = ? WHERE stripe_payment_id = ?',
            ['completed', JSON.stringify(generatedKeys), new Date().toISOString(), paymentIntentId]
        );
        
        log(`Payment confirmed: ${paymentIntentId}, generated ${keyCount} keys for ${customerEmail}`);
        
        // Send keys via email
        let emailSent = false;
        if (emailTransporter && customerEmail) {
            try {
                await sendKeysEmail(customerEmail, generatedKeys, paymentIntent.metadata.product_type);
                emailSent = true;
                log(`Keys emailed to: ${customerEmail}`);
            } catch (emailError) {
                log(`Email send failed: ${emailError.message}`, 'error');
            }
        }
        
        return {
            success: true,
            message: 'Payment confirmed and keys generated',
            key_count: keyCount,
            keys: generatedKeys.map(k => k.key),
            email_sent: emailSent
        };
        
    } catch (error) {
        log(`Payment confirmation failed: ${error.message}`, 'error');
        throw error;
    }
}

// Email Key Delivery
async function sendKeysEmail(customerEmail, keys, productType) {
    if (!emailTransporter) {
        throw new Error('Email not configured');
    }
    
    const product = PRICING[productType] || { name: 'License Keys' };
    const keyList = keys.map(k => k.key).join('\n');
    
    const emailHTML = `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <title>Your Secret Messages License Keys</title>
        <style>
            body { font-family: Arial, sans-serif; background-color: #0d0d0d; color: #00ff41; margin: 0; padding: 20px; }
            .container { max-width: 600px; margin: 0 auto; background-color: #1a1a1a; border: 1px solid #00ff41; border-radius: 8px; padding: 30px; }
            .title { color: #00ff41; font-size: 24px; font-weight: bold; text-align: center; margin-bottom: 20px; }
            .key-box { background-color: #000; border: 1px solid #00cc33; border-radius: 4px; padding: 15px; margin: 10px 0; font-family: 'Courier New', monospace; }
            .key { font-size: 18px; font-weight: bold; color: #00ff41; text-align: center; }
            .instructions { background-color: #003300; border-radius: 4px; padding: 15px; margin: 20px 0; }
            .footer { text-align: center; margin-top: 30px; font-size: 12px; color: #888; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="title">🔐 Your Secret Messages License Keys</div>
            
            <p>Thank you for purchasing <strong>${product.name}</strong>!</p>
            <p>Your license keys are ready for use:</p>
            
            ${keys.map(k => `
                <div class="key-box">
                    <div class="key">${k.key}</div>
                </div>
            `).join('')}
            
            <div class="instructions">
                <strong>🚀 How to use your keys:</strong>
                <ol>
                    <li>Visit: <a href="${process.env.FRONTEND_URL}" style="color: #00cc33;">${process.env.FRONTEND_URL}</a></li>
                    <li>Enter one of your license keys</li>
                    <li>Start encrypting your messages securely!</li>
                </ol>
                
                <strong>⚠️ Important Notes:</strong>
                <ul>
                    <li>Each key can only be used on one device</li>
                    <li>Keys are valid for lifetime use</li>
                    <li>Keep your keys secure and private</li>
                </ul>
            </div>
            
            <p>If you have any questions, contact our support team.</p>
            
            <div class="footer">
                <p>Secret Messages - Enterprise Encryption</p>
                <p>This email contains sensitive information. Please keep it secure.</p>
            </div>
        </div>
    </body>
    </html>
    `;
    
    const emailText = `
    Secret Messages - Your License Keys
    ===================================
    
    Thank you for purchasing ${product.name}!
    
    Your License Keys:
    ${keyList}
    
    How to use:
    1. Visit: ${process.env.FRONTEND_URL}
    2. Enter your license key
    3. Start encrypting securely!
    
    Important: Each key works on one device only and is valid for lifetime use.
    
    Support: support@secretmessages.dev
    `;
    
    const mailOptions = {
        from: `"Secret Messages" <${process.env.SMTP_USER}>`,
        to: customerEmail,
        subject: `🔐 Your Secret Messages License Keys (${keys.length} keys)`,
        text: emailText,
        html: emailHTML,
        attachments: [
            {
                filename: 'license-keys.txt',
                content: keyList,
                contentType: 'text/plain'
            }
        ]
    };
    
    const result = await emailTransporter.sendMail(mailOptions);
    log(`Email sent to ${customerEmail}: ${result.messageId}`);
    
    return result;
}

// Webhook Handler
async function handleWebhook(body, signature) {
    if (!stripe) {
        throw new Error('Stripe not configured');
    }
    
    let event;
    
    try {
        event = stripe.webhooks.constructEvent(
            body,
            signature,
            process.env.STRIPE_WEBHOOK_SECRET
        );
    } catch (err) {
        log(`Webhook signature verification failed: ${err.message}`, 'error');
        throw new Error('Webhook signature verification failed');
    }
    
    log(`Received webhook: ${event.type}`);
    
    try {
        switch (event.type) {
            case 'payment_intent.succeeded':
                const paymentIntent = event.data.object;
                await confirmPayment(paymentIntent.id);
                break;
                
            case 'payment_intent.payment_failed':
                const failedPayment = event.data.object;
                await executeQuery(
                    'UPDATE payments SET status = ? WHERE stripe_payment_id = ?',
                    ['failed', failedPayment.id]
                );
                log(`Payment failed: ${failedPayment.id}`, 'error');
                break;
                
            case 'payment_intent.canceled':
                const canceledPayment = event.data.object;
                await executeQuery(
                    'UPDATE payments SET status = ? WHERE stripe_payment_id = ?',
                    ['canceled', canceledPayment.id]
                );
                log(`Payment canceled: ${canceledPayment.id}`);
                break;
                
            default:
                log(`Unhandled webhook event type: ${event.type}`);
        }
        
        return { success: true, processed: event.type };
        
    } catch (error) {
        log(`Webhook processing error: ${error.message}`, 'error');
        throw error;
    }
}

// Payment Status Check
async function getPaymentStatus(paymentIntentId) {
    if (!stripe) {
        throw new Error('Stripe not configured');
    }
    
    try {
        const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
        
        return {
            success: true,
            payment_id: paymentIntent.id,
            status: paymentIntent.status,
            amount: paymentIntent.amount,
            currency: paymentIntent.currency,
            created: new Date(paymentIntent.created * 1000).toISOString(),
            completed: paymentIntent.status === 'succeeded' ? new Date().toISOString() : null
        };
        
    } catch (error) {
        log(`Payment status check failed: ${error.message}`, 'error');
        throw error;
    }
}

// Manual Key Generation (for admin)
async function generateKeysManually(quantity, expiryDays = null, createdBy = 'manual') {
    const keys = [];
    const expiresAt = expiryDays ? new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000) : null;
    
    for (let i = 0; i < quantity; i++) {
        const keyCode = generateLicenseKey();
        const keyHash = hashKey(keyCode);
        
        const result = await executeQuery(
            'INSERT INTO license_keys (key_code, key_hash, expires_at, created_by) VALUES (?, ?, ?, ?)',
            [keyCode, keyHash, expiresAt ? expiresAt.toISOString() : null, createdBy]
        );
        
        keys.push({
            id: result.lastID || result.insertId,
            key: keyCode,
            expires_at: expiresAt,
            created_at: new Date().toISOString()
        });
    }
    
    log(`Manually generated ${quantity} keys`);
    return keys;
}

// Configuration check
function checkConfiguration() {
    const config = {
        stripe_configured: !!stripe,
        email_configured: !!emailTransporter,
        webhook_secret_configured: !!process.env.STRIPE_WEBHOOK_SECRET,
        frontend_url: process.env.FRONTEND_URL || 'Not configured'
    };
    
    log(`Payment configuration: ${JSON.stringify(config)}`);
    return config;
}

module.exports = {
    setDatabaseConnection,
    createPaymentIntent,
    confirmPayment,
    sendKeysEmail,
    handleWebhook,
    getPaymentStatus,
    generateKeysManually,
    checkConfiguration,
    PRICING
};
