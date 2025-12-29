// email/mock-mailer.js
// Provides a mock implementation of the mailer for Offline/Enterprise mode

/**
 * Mocks sending a license email.
 * Logs the action to the console instead of sending a real email.
 */
async function sendLicenseEmail(toEmail, licenseKey, productType) {
    if (!toEmail) {
        console.warn("MockMailer: No recipient email provided.");
        return;
    }

    console.log("==========================================");
    console.log("🔒 [MOCK MAILER] Enterprise/Offline Mode");
    console.log(`📨 To: ${toEmail}`);
    console.log(`📦 Product: ${productType}`);
    console.log(`🔑 Key(s): ${Array.isArray(licenseKey) ? licenseKey.join(', ') : licenseKey}`);
    console.log("==========================================");

    // Simulate successful response
    return { id: 'mock-email-id-' + Date.now() };
}

module.exports = { sendLicenseEmail };
