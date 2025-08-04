// email/templates.js – sauberes Email-System mit Templates & Ethereal-Support
const nodemailer = require('nodemailer');
const path = require('path');

class EmailTemplateService {
  constructor() {
    this.transporter = null;
    this.templates = this.loadTemplates();
  }

  // 🧠 Dynamischer HTML-Absender
  getSender(label = 'Secret Messages') {
    return `"${label}" <${process.env.MAIL_FROM || 'no-reply@secret-messages.local'}>`;
  }

  loadTemplates() {
    return {
      keyDelivery: this.getKeyDeliveryTemplate()
    };
  }

  getKeyDeliveryTemplate() {
    return `
      <h1 style="font-family: monospace; color: #00ff41;">🎉 Ihre Lizenz-Keys</h1>
      <p>Vielen Dank für Ihren Kauf bei Secret Messages.</p>
      <p>🔑 <strong>Keys:</strong></p>
      <pre style="background:#000;padding:10px;border:1px solid #0f0;">{{KEYS}}</pre>
      <p>📦 Produkt: <strong>{{PRODUCT}}</strong></p>
      <p>📅 Datum: {{DATE}}</p>
      <hr>
      <p style="font-size: 0.8rem;">Jeder Key ist nur einmal gültig und wird an Ihr Gerät gebunden.</p>
      <p>🔒 <a href="{{FRONTEND_URL}}">SecretMessages.dev jetzt öffnen</a></p>
    `;
  }

  async sendKeyDeliveryEmail(to, keys, details = {}) {
    const keyList = keys.map(k => k.key_code).join('\n');
    const html = this.templates.keyDelivery
      .replace('{{KEYS}}', keyList)
      .replace('{{PRODUCT}}', details.product_type)
      .replace('{{DATE}}', new Date().toLocaleDateString('de-DE'))
      .replace(/{{FRONTEND_URL}}/g, process.env.FRONTEND_URL || 'https://secretmessages.dev');

    const mailOptions = {
      from: this.getSender(),
      to,
      subject: '🔐 Ihre Secret Messages Lizenz-Keys',
      html,
      text: `
Ihre Lizenz-Keys

${keyList}

Produkt: ${details.product_type}
Datum: ${new Date().toLocaleDateString('de-DE')}
${process.env.FRONTEND_URL || 'https://secretmessages.dev'}
      `.trim()
    };

    const info = await this.transporter.sendMail(mailOptions);
    console.log("✅ Mail gesendet:", info.messageId);

    // Ethereal Vorschau (nur in DEV)
    if (process.env.NODE_ENV !== 'production') {
      const url = nodemailer.getTestMessageUrl(info);
      if (url) console.log("🔍 Vorschau-Link:", url);
    }

    return info;
  }
}

// 📦 Initialisierung (mit Ethereal fallback)
const instance = new EmailTemplateService();
const ready = (async () => {
  if (!process.env.SMTP_HOST) {
    const testAccount = await nodemailer.createTestAccount();
    instance.transporter = nodemailer.createTransport({
      host: testAccount.smtp.host,
      port: testAccount.smtp.port,
      secure: testAccount.smtp.secure,
      auth: {
        user: testAccount.user,
        pass: testAccount.pass
      }
    });
    console.log("📧 Ethereal Test-Mail aktiv:", testAccount.user);
  } else {
    instance.transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: false,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    });
  }
})();

// Asynchroner Zugriff auf Instanz
module.exports = {
  get ready() {
    return ready.then(() => instance);
  }
};
