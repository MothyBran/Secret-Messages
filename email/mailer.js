const { Resend } = require('resend');
require('dotenv').config();

// DETECT OFFLINE MODE
// We assume offline if explicitly set or if critical API keys are missing in production
const IS_OFFLINE = process.env.IS_OFFLINE === 'true' || process.env.IS_ENTERPRISE === 'true';

let resend;
if (!IS_OFFLINE && process.env.RESEND_API_KEY) {
    resend = new Resend(process.env.RESEND_API_KEY);
} else {
    // If offline or no key, we might mock, but this file exports `sendLicenseEmail`.
    // We'll handle the mock logic inside the function if needed,
    // OR we rely on the caller to swap the module.
    // But since `require` is cached, swapping modules is tricky.
    // Better to handle it here.
    if(IS_OFFLINE) console.log("⚠️ Mailer initialized in OFFLINE/MOCK mode.");
}

/**
 * Sends a license email to the customer.
 * @param {string} toEmail - Recipient email.
 * @param {string|string[]} licenseKey - The license key(s).
 * @param {string} productType - Description of the product.
 */
async function sendLicenseEmail(toEmail, licenseKey, productType) {
    if (IS_OFFLINE || !resend) {
        // Fallback to Mock
        const { sendLicenseEmail: mockSend } = require('./mock-mailer');
        return await mockSend(toEmail, licenseKey, productType);
    }

    if (!toEmail) {
        console.warn("sendLicenseEmail: No recipient email provided.");
        return;
    }

    const keys = Array.isArray(licenseKey) ? licenseKey.join('<br>') : licenseKey;
    // Singular/Plural distinction for German
    const keyLabel = Array.isArray(licenseKey) && licenseKey.length > 1 ? 'Ihre Lizenzschlüssel' : 'Ihr Lizenzschlüssel';

    try {
        const { data, error } = await resend.emails.send({
            from: 'support@secure-msg.app',
            to: toEmail,
            subject: 'Ihre Secure Messages Lizenz',
            html: `
                <h3>Vielen Dank für Ihren Kauf!</h3>
                <p>Hier ist ${keyLabel}:</p>
                <div style="background-color: #f4f4f4; padding: 15px; border-left: 5px solid #00BFFF; margin: 20px 0; font-family: monospace; font-size: 1.2em;">
                    ${keys}
                </div>
                <p><strong>Produkt:</strong> ${productType}</p>
                <hr>
                <h4>Anleitung:</h4>
                <ol>
                    <li>Gehen Sie auf <a href="https://secure-msg.app">https://secure-msg.app</a>.</li>
                    <li>Klicken Sie auf <strong>"Lizenzschlüssel aktivieren"</strong>.</li>
                    <li>Erstellen Sie Ihren Account und binden Sie den Schlüssel an Ihr Gerät.</li>
                </ol>
                <br>
                <p>Mit freundlichen Grüßen,<br>Ihr Secure Messages Team</p>
            `
        });

        if (error) {
            console.error("Resend API Error:", error);
            return;
        }

        console.log(`Email sent: ${data.id}`);
        return data;
    } catch (error) {
        console.error("Error sending license email:", error);
        // We log the error but do not throw it to ensure payment processing completes.
    }
}

module.exports = { sendLicenseEmail };
