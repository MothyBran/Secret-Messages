const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
    service: 'Gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

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

    const mailOptions = {
        from: `"Secure Messages Team" <${process.env.EMAIL_USER}>`,
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
    };

    try {
        const info = await transporter.sendMail(mailOptions);
        console.log(`Email sent: ${info.messageId}`);
        return info;
    } catch (error) {
        console.error("Error sending license email:", error);
        // We log the error but do not throw it to ensure payment processing completes.
    }
}

module.exports = { sendLicenseEmail };
