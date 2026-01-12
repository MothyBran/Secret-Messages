const { Resend } = require('resend');
require('dotenv').config();

const resend = process.env.RESEND_API_KEY
    ? new Resend(process.env.RESEND_API_KEY)
    : { emails: { send: async () => { console.log(">> MOCK MAIL SENT (No API Key)"); return { id: 'mock', data: { id: 'mock' } }; } } };

/**
 * Sends a license email to the customer.
 * @param {string} toEmail - Recipient email.
 * @param {string|string[]} licenseKey - The license key(s).
 * @param {string} productType - Description of the product.
 */
async function sendLicenseEmail(toEmail, licenseKey, productType) {
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
    }
}

/**
 * Sends a renewal confirmation email to the customer.
 * @param {string} toEmail - Recipient email.
 * @param {string} newDate - New expiration date (formatted).
 * @param {string} username - Username.
 */
async function sendRenewalConfirmation(toEmail, newDate, username) {
    if (!toEmail) return;

    try {
        const { data, error } = await resend.emails.send({
            from: 'support@secure-msg.app',
            to: toEmail,
            subject: 'Lizenz erfolgreich verlängert',
            html: `
                <h3>Hallo ${username},</h3>
                <p>Ihre Lizenz wurde erfolgreich verlängert!</p>
                <div style="background-color: #e6fffa; padding: 15px; border-left: 5px solid #00ff41; margin: 20px 0;">
                    <strong>Neues Ablaufdatum:</strong> ${newDate}
                </div>
                <p>Sie müssen nichts weiter tun. Ihr Account ist sofort freigeschaltet.</p>
                <br>
                <p>Mit freundlichen Grüßen,<br>Ihr Secure Messages Team</p>
            `
        });

        if (error) {
            console.error("Resend API Error (Renewal):", error);
        } else {
            console.log(`Renewal Email sent: ${data.id}`);
        }
    } catch (error) {
        console.error("Error sending renewal email:", error);
    }
}

module.exports = { sendLicenseEmail, sendRenewalConfirmation };
