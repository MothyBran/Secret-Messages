// email/templates.js - Professional Email Template System
const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');

class EmailTemplateService {
    constructor() {
        this.transporter = nodemailer.createTransporter({
            host: process.env.SMTP_HOST,
            port: process.env.SMTP_PORT,
            secure: false,
            auth: {
                user: process.env.SMTP_USER,
                pass: process.env.SMTP_PASS,
            },
            tls: {
                rejectUnauthorized: false
            }
        });
        
        this.templates = this.loadTemplates();
    }
    
    loadTemplates() {
        return {
            keyDelivery: this.getKeyDeliveryTemplate(),
            welcome: this.getWelcomeTemplate(),
            support: this.getSupportTemplate(),
            receipt: this.getReceiptTemplate(),
            expiry: this.getExpiryTemplate(),
            security: this.getSecurityTemplate()
        };
    }
    
    // Main template wrapper
    getBaseTemplate() {
        return `
<!DOCTYPE html>
<html lang="de">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Secret Messages</title>
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Courier+New:wght@400;700&display=swap');
        
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: 'Courier New', monospace;
            background: linear-gradient(135deg, #0d0d0d 0%, #1a1a1a 50%, #0d0d0d 100%);
            color: #00ff41;
            line-height: 1.6;
            padding: 20px;
        }
        
        .container {
            max-width: 600px;
            margin: 0 auto;
            background: rgba(0, 0, 0, 0.9);
            border: 2px solid #00ff41;
            border-radius: 12px;
            overflow: hidden;
            box-shadow: 0 0 30px rgba(0, 255, 65, 0.3);
        }
        
        .header {
            background: linear-gradient(45deg, #003300, #006600);
            padding: 30px;
            text-align: center;
            border-bottom: 2px solid #00ff41;
        }
        
        .logo {
            font-size: 2.5rem;
            font-weight: bold;
            color: #00ff41;
            text-shadow: 0 0 20px #00ff41;
            margin-bottom: 10px;
        }
        
        .tagline {
            color: #00cc33;
            font-size: 1rem;
            letter-spacing: 2px;
            text-transform: uppercase;
        }
        
        .content {
            padding: 40px 30px;
        }
        
        .title {
            font-size: 1.8rem;
            color: #00ff41;
            margin-bottom: 20px;
            text-align: center;
            border-bottom: 1px solid #333;
            padding-bottom: 15px;
        }
        
        .message {
            color: #cccccc;
            margin-bottom: 25px;
            line-height: 1.8;
        }
        
        .highlight-box {
            background: rgba(0, 255, 65, 0.1);
            border: 1px solid #00ff41;
            border-radius: 8px;
            padding: 20px;
            margin: 25px 0;
            text-align: center;
        }
        
        .key-box {
            background: rgba(0, 0, 0, 0.8);
            border: 2px solid #00ff41;
            border-radius: 8px;
            padding: 20px;
            margin: 20px 0;
            font-family: 'Courier New', monospace;
        }
        
        .key-title {
            color: #00ff41;
            font-size: 1.2rem;
            margin-bottom: 15px;
            text-align: center;
        }
        
        .key-item {
            background: rgba(0, 255, 65, 0.1);
            border: 1px solid #00cc33;
            border-radius: 4px;
            padding: 12px;
            margin: 8px 0;
            font-size: 1.1rem;
            font-weight: bold;
            text-align: center;
            letter-spacing: 2px;
        }
        
        .instructions {
            background: rgba(0, 20, 0, 0.8);
            border: 1px solid #00cc33;
            border-radius: 8px;
            padding: 20px;
            margin: 25px 0;
        }
        
        .instructions-title {
            color: #00ff41;
            font-size: 1.3rem;
            margin-bottom: 15px;
        }
        
        .step {
            margin: 10px 0;
            padding-left: 25px;
            position: relative;
        }
        
        .step::before {
            content: counter(step-counter);
            counter-increment: step-counter;
            position: absolute;
            left: 0;
            top: 0;
            background: #00ff41;
            color: #000;
            width: 20px;
            height: 20px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 0.8rem;
            font-weight: bold;
        }
        
        .steps {
            counter-reset: step-counter;
        }
        
        .button {
            display: inline-block;
            background: linear-gradient(45deg, #003300, #006600);
            color: #00ff41;
            padding: 15px 30px;
            border: 2px solid #00ff41;
            border-radius: 8px;
            text-decoration: none;
            font-family: 'Courier New', monospace;
            font-weight: bold;
            text-transform: uppercase;
            letter-spacing: 1px;
            margin: 20px 0;
            transition: all 0.3s ease;
        }
        
        .button:hover {
            background: linear-gradient(45deg, #004400, #008800);
            box-shadow: 0 0 20px rgba(0, 255, 65, 0.5);
        }
        
        .security-notice {
            background: rgba(255, 255, 0, 0.1);
            border: 1px solid #ffff00;
            border-radius: 8px;
            padding: 20px;
            margin: 25px 0;
            color: #ffff00;
        }
        
        .security-title {
            font-weight: bold;
            margin-bottom: 10px;
        }
        
        .footer {
            background: rgba(0, 0, 0, 0.5);
            padding: 30px;
            text-align: center;
            border-top: 1px solid #333;
            color: #888;
        }
        
        .footer-links {
            margin-bottom: 20px;
        }
        
        .footer-links a {
            color: #00cc33;
            text-decoration: none;
            margin: 0 15px;
        }
        
        .footer-links a:hover {
            color: #00ff41;
        }
        
        .social-links {
            margin: 20px 0;
        }
        
        .social-link {
            display: inline-block;
            margin: 0 10px;
            color: #00cc33;
            text-decoration: none;
        }
        
        @media only screen and (max-width: 600px) {
            .container {
                margin: 10px;
                border-radius: 8px;
            }
            
            .header {
                padding: 20px;
            }
            
            .logo {
                font-size: 2rem;
            }
            
            .content {
                padding: 20px 15px;
            }
            
            .title {
                font-size: 1.5rem;
            }
            
            .footer {
                padding: 20px;
            }
            
            .footer-links a {
                display: block;
                margin: 10px 0;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <div class="logo">🔐 SECRET MESSAGES</div>
            <div class="tagline">Militärgrad-sichere Verschlüsselung</div>
        </div>
        
        <div class="content">
            {{CONTENT}}
        </div>
        
        <div class="footer">
            <div class="footer-links">
                <a href="{{FRONTEND_URL}}">Secret Messages</a>
                <a href="{{FRONTEND_URL}}/support">Support</a>
                <a href="{{FRONTEND_URL}}/privacy">Datenschutz</a>
            </div>
            
            <div class="social-links">
                <a href="#" class="social-link">📧 support@secretmessages.dev</a>
                <a href="#" class="social-link">🌐 secretmessages.dev</a>
            </div>
            
            <p>&copy; 2024 Secret Messages. Alle Rechte vorbehalten.</p>
            <p style="font-size: 0.8rem; margin-top: 10px;">
                Diese E-Mail wurde automatisch generiert. Bitte antworten Sie nicht direkt auf diese E-Mail.
            </p>
        </div>
    </div>
</body>
</html>`;
    }
    
    // License Key Delivery Template
    getKeyDeliveryTemplate() {
        const content = `
            <h1 class="title">🎉 Ihre Lizenz-Keys sind bereit!</h1>
            
            <div class="message">
                <p>Vielen Dank für Ihren Kauf! Ihre exklusiven Secret Messages Lizenz-Keys wurden erfolgreich generiert und sind sofort einsatzbereit.</p>
            </div>
            
            <div class="key-box">
                <div class="key-title">🔑 Ihre Lizenz-Keys:</div>
                {{KEYS_LIST}}
            </div>
            
            <div class="highlight-box">
                <h3 style="color: #00ff41; margin-bottom: 10px;">📋 Bestelldetails</h3>
                <p><strong>Bestellnummer:</strong> {{ORDER_ID}}</p>
                <p><strong>Anzahl Keys:</strong> {{KEY_COUNT}}</p>
                <p><strong>Betrag:</strong> €{{AMOUNT}}</p>
                <p><strong>Datum:</strong> {{DATE}}</p>
            </div>
            
            <div class="instructions">
                <h3 class="instructions-title">🚀 So nutzen Sie Ihre Keys:</h3>
                <div class="steps">
                    <div class="step">Öffnen Sie Secret Messages in Ihrem Browser</div>
                    <div class="step">Geben Sie einen Ihrer Keys in das Eingabefeld ein</div>
                    <div class="step">Der Key wird automatisch an Ihr Gerät gebunden</div>
                    <div class="step">Beginnen Sie sofort mit der sicheren Verschlüsselung!</div>
                </div>
            </div>
            
            <div style="text-align: center;">
                <a href="{{FRONTEND_URL}}" class="button">🔐 Jetzt Secret Messages nutzen</a>
            </div>
            
            <div class="security-notice">
                <div class="security-title">🛡️ Wichtige Sicherheitshinweise:</div>
                <ul style="list-style: none; padding-left: 0;">
                    <li>• Jeder Key funktioniert nur einmal und wird an Ihr Gerät gebunden</li>
                    <li>• Bewahren Sie Ihre Keys sicher auf</li>
                    <li>• Teilen Sie Ihre Keys nur mit vertrauenswürdigen Personen</li>
                    <li>• Bei Verlust eines Keys kontaktieren Sie unseren Support</li>
                </ul>
            </div>
        `;
        
        return this.getBaseTemplate().replace('{{CONTENT}}', content);
    }
    
    // Welcome Template
    getWelcomeTemplate() {
        const content = `
            <h1 class="title">🎉 Willkommen bei Secret Messages!</h1>
            
            <div class="message">
                <p>Herzlich willkommen in der Welt der militärgrad-sicheren Verschlüsselung! Sie haben soeben Zugang zu einem der fortschrittlichsten Kryptographie-Systeme der Welt erhalten.</p>
            </div>
            
            <div class="highlight-box">
                <h3 style="color: #00ff41; margin-bottom: 15px;">🔐 Was macht Secret Messages so besonders?</h3>
                <ul style="list-style: none; padding: 0; text-align: left;">
                    <li style="margin: 10px 0;">🛡️ <strong>AES-256 Hybrid-Verschlüsselung</strong> - Unknackbar selbst für Supercomputer</li>
                    <li style="margin: 10px 0;">⚡ <strong>Doppelte Sicherheit</strong> - Zwei Verschlüsselungszyklen für maximalen Schutz</li>
                    <li style="margin: 10px 0;">🌐 <strong>Universell kompatibel</strong> - Funktioniert mit allen Messengern</li>
                    <li style="margin: 10px 0;">🔒 <strong>Keine Backdoors</strong> - Vollständig transparente Sicherheit</li>
                </ul>
            </div>
            
            <div class="instructions">
                <h3 class="instructions-title">📚 Erste Schritte:</h3>
                <div class="steps">
                    <div class="step">Besuchen Sie Secret Messages in Ihrem Browser</div>
                    <div class="step">Geben Sie Ihren Lizenz-Key ein</div>
                    <div class="step">Wählen Sie "Verschlüsseln" oder "Entschlüsseln"</div>
                    <div class="step">Geben Sie Ihre Nachricht und einen 5-stelligen Code ein</div>
                    <div class="step">Teilen Sie den verschlüsselten Text sicher mit anderen</div>
                </div>
            </div>
            
            <div style="text-align: center;">
                <a href="{{FRONTEND_URL}}" class="button">🚀 Secret Messages öffnen</a>
            </div>
            
            <div class="security-notice">
                <div class="security-title">💡 Pro-Tipp:</div>
                <p>Verwenden Sie unterschiedliche 5-stellige Codes für verschiedene Unterhaltungen. 
                Nur Personen mit dem gleichen Code können Ihre Nachrichten entschlüsseln!</p>
            </div>
        `;
        
        return this.getBaseTemplate().replace('{{CONTENT}}', content);
    }
    
    // Support Template
    getSupportTemplate() {
        const content = `
            <h1 class="title">🛠️ Support-Bestätigung</h1>
            
            <div class="message">
                <p>Vielen Dank für Ihre Support-Anfrage! Wir haben Ihr Anliegen erhalten und werden uns so schnell wie möglich bei Ihnen melden.</p>
            </div>
            
            <div class="highlight-box">
                <h3 style="color: #00ff41; margin-bottom: 10px;">📋 Ihre Anfrage</h3>
                <p><strong>Ticket-Nummer:</strong> {{TICKET_ID}}</p>
                <p><strong>Betreff:</strong> {{SUBJECT}}</p>
                <p><strong>Priorität:</strong> {{PRIORITY}}</p>
                <p><strong>Eingereicht am:</strong> {{DATE}}</p>
            </div>
            
            <div class="instructions">
                <h3 class="instructions-title">⏱️ Was passiert als Nächstes?</h3>
                <div class="steps">
                    <div class="step">Unser Support-Team prüft Ihre Anfrage</div>
                    <div class="step">Sie erhalten eine erste Antwort innerhalb von 24 Stunden</div>
                    <div class="step">Wir arbeiten an einer Lösung für Ihr Problem</div>
                    <div class="step">Sie erhalten regelmäßige Updates über den Fortschritt</div>
                </div>
            </div>
            
            <div class="security-notice">
                <div class="security-title">📞 Weitere Hilfe:</div>
                <p>Bei dringenden Sicherheitsproblemen oder wenn Sie verdächtige Aktivitäten bemerken, 
                kontaktieren Sie uns sofort unter: <strong>security@secretmessages.dev</strong></p>
            </div>
        `;
        
        return this.getBaseTemplate().replace('{{CONTENT}}', content);
    }
    
    // Receipt Template
    getReceiptTemplate() {
        const content = `
            <h1 class="title">📄 Kaufbestätigung</h1>
            
            <div class="message">
                <p>Vielen Dank für Ihren Kauf! Hier ist Ihre offizielle Rechnung für den Erwerb von Secret Messages Lizenz-Keys.</p>
            </div>
            
            <div class="highlight-box">
                <h3 style="color: #00ff41; margin-bottom: 15px;">🧾 Rechnungsdetails</h3>
                <table style="width: 100%; border-collapse: collapse; color: #cccccc;">
                    <tr style="border-bottom: 1px solid #333;">
                        <td style="padding: 10px; text-align: left;"><strong>Rechnungsnummer:</strong></td>
                        <td style="padding: 10px; text-align: right;">{{INVOICE_ID}}</td>
                    </tr>
                    <tr style="border-bottom: 1px solid #333;">
                        <td style="padding: 10px; text-align: left;"><strong>Datum:</strong></td>
                        <td style="padding: 10px; text-align: right;">{{DATE}}</td>
                    </tr>
                    <tr style="border-bottom: 1px solid #333;">
                        <td style="padding: 10px; text-align: left;"><strong>Produkt:</strong></td>
                        <td style="padding: 10px; text-align: right;">{{PRODUCT_NAME}}</td>
                    </tr>
                    <tr style="border-bottom: 1px solid #333;">
                        <td style="padding: 10px; text-align: left;"><strong>Anzahl:</strong></td>
                        <td style="padding: 10px; text-align: right;">{{QUANTITY}}</td>
                    </tr>
                    <tr style="border-bottom: 2px solid #00ff41;">
                        <td style="padding: 10px; text-align: left;"><strong>Gesamtbetrag:</strong></td>
                        <td style="padding: 10px; text-align: right; color: #00ff41; font-weight: bold;">€{{TOTAL}}</td>
                    </tr>
                </table>
            </div>
            
            <div class="instructions">
                <h3 class="instructions-title">💳 Zahlungsinformationen</h3>
                <p><strong>Zahlungsmethode:</strong> {{PAYMENT_METHOD}}</p>
                <p><strong>Transaktions-ID:</strong> {{TRANSACTION_ID}}</p>
                <p><strong>Status:</strong> <span style="color: #00ff41;">✅ Bezahlt</span></p>
            </div>
            
            <div class="security-notice">
                <div class="security-title">📋 Wichtige Informationen:</div>
                <ul style="list-style: none; padding-left: 0;">
                    <li>• Diese Rechnung dient als Nachweis für Ihren Kauf</li>
                    <li>• Ihre Lizenz-Keys wurden in einer separaten E-Mail gesendet</li>
                    <li>• Bewahren Sie diese Rechnung für Ihre Unterlagen auf</li>
                    <li>• Bei Fragen kontaktieren Sie unseren Kundensupport</li>
                </ul>
            </div>
        `;
        
        return this.getBaseTemplate().replace('{{CONTENT}}', content);
    }
    
    // Key Expiry Warning Template
    getExpiryTemplate() {
        const content = `
            <h1 class="title">⚠️ Lizenz-Key läuft ab</h1>
            
            <div class="message">
                <p>Wir möchten Sie daran erinnern, dass einer Ihrer Secret Messages Lizenz-Keys bald abläuft.</p>
            </div>
            
            <div class="highlight-box">
                <h3 style="color: #ffff00; margin-bottom: 10px;">⏰ Ablaufinformationen</h3>
                <p><strong>Key:</strong> {{KEY_CODE}}</p>
                <p><strong>Läuft ab am:</strong> {{EXPIRY_DATE}}</p>
                <p><strong>Verbleibende Zeit:</strong> {{DAYS_LEFT}} Tage</p>
            </div>
            
            <div class="instructions">
                <h3 class="instructions-title">🔄 Was können Sie tun?</h3>
                <div class="steps">
                    <div class="step">Sichern Sie alle wichtigen verschlüsselten Nachrichten</div>
                    <div class="step">Erwägen Sie den Kauf eines neuen Lizenz-Keys</div>
                    <div class="step">Informieren Sie Ihre Kontakte über den bevorstehenden Wechsel</div>
                    <div class="step">Migrieren Sie zu einem neuen Key vor Ablauf</div>
                </div>
            </div>
            
            <div style="text-align: center;">
                <a href="{{FRONTEND_URL}}/store" class="button">🛒 Neuen Key kaufen</a>
            </div>
            
            <div class="security-notice">
                <div class="security-title">🛡️ Hinweis:</div>
                <p>Nach Ablauf des Keys können Sie keine neuen Nachrichten mehr verschlüsseln, 
                aber bereits verschlüsselte Nachrichten können weiterhin entschlüsselt werden.</p>
            </div>
        `;
        
        return this.getBaseTemplate().replace('{{CONTENT}}', content);
    }
    
    // Security Alert Template
    getSecurityTemplate() {
        const content = `
            <h1 class="title">🚨 Sicherheitsbenachrichtigung</h1>
            
            <div class="message">
                <p>Wir haben ungewöhnliche Aktivitäten in Bezug auf Ihren Secret Messages Account festgestellt und möchten Sie darüber informieren.</p>
            </div>
            
            <div class="highlight-box" style="border-color: #ff4444; background: rgba(255, 68, 68, 0.1);">
                <h3 style="color: #ff4444; margin-bottom: 15px;">⚠️ Erkannte Aktivität</h3>
                <p><strong>Ereignis:</strong> {{EVENT_TYPE}}</p>
                <p><strong>Zeitpunkt:</strong> {{EVENT_TIME}}</p>
                <p><strong>IP-Adresse:</strong> {{IP_ADDRESS}}</p>
                <p><strong>Standort:</strong> {{LOCATION}}</p>
            </div>
            
            <div class="instructions">
                <h3 class="instructions-title">🛡️ Empfohlene Maßnahmen:</h3>
                <div class="steps">
                    <div class="step">Überprüfen Sie, ob Sie die Aktivität selbst verursacht haben</div>
                    <div class="step">Ändern Sie Ihre Passwörter, falls erforderlich</div>
                    <div class="step">Überprüfen Sie Ihre Lizenz-Keys auf unautorisierte Nutzung</div>
                    <div class="step">Kontaktieren Sie den Support bei verdächtigen Aktivitäten</div>
                </div>
            </div>
            
            <div style="text-align: center;">
                <a href="{{FRONTEND_URL}}/support" class="button">🆘 Support kontaktieren</a>
            </div>
            
            <div class="security-notice">
                <div class="security-title">🔒 Sicherheitstipps:</div>
                <ul style="list-style: none; padding-left: 0;">
                    <li>• Verwenden Sie starke, einzigartige Passwörter</li>
                    <li>• Teilen Sie Ihre Lizenz-Keys niemals mit Unbekannten</li>
                    <li>• Melden Sie verdächtige E-Mails oder Nachrichten</li>
                    <li>• Halten Sie Ihre Browser und Geräte auf dem neuesten Stand</li>
                </ul>
            </div>
        `;
        
        return this.getBaseTemplate().replace('{{CONTENT}}', content);
    }
    
    // Send Key Delivery Email
    async sendKeyDeliveryEmail(customerEmail, keys, orderDetails) {
        try {
            const keysList = keys.map((key, index) => 
                `<div class="key-item">${index + 1}. ${key.key_code}</div>`
            ).join('');
            
            let template = this.templates.keyDelivery;
            template = template.replace('{{KEYS_LIST}}', keysList);
            template = template.replace('{{ORDER_ID}}', orderDetails.payment_id);
            template = template.replace('{{KEY_COUNT}}', keys.length);
            template = template.replace('{{AMOUNT}}', (orderDetails.amount / 100).toFixed(2));
            template = template.replace('{{DATE}}', new Date().toLocaleDateString('de-DE'));
            template = template.replace(/{{FRONTEND_URL}}/g, process.env.FRONTEND_URL || 'https://secretmessages.dev');
            
            const mailOptions = {
                from: `Secret Messages <${process.env.SMTP_USER}>`,
                to: customerEmail,
                subject: '🔐 Ihre Secret Messages Lizenz-Keys sind bereit!',
                html: template,
                text: this.generateTextVersion(keys, orderDetails)
            };
            
            const result = await this.transporter.sendMail(mailOptions);
            console.log('Key delivery email sent successfully:', result.messageId);
            return result;
            
        } catch (error) {
            console.error('Failed to send key delivery email:', error);
            throw error;
        }
    }
    
    // Send Welcome Email
    async sendWelcomeEmail(customerEmail, keyCode) {
        try {
            let template = this.templates.welcome;
            template = template.replace(/{{FRONTEND_URL}}/g, process.env.FRONTEND_URL || 'https://secretmessages.dev');
            
            const mailOptions = {
                from: `Secret Messages <${process.env.SMTP_USER}>`,
                to: customerEmail,
                subject: '🎉 Willkommen bei Secret Messages!',
                html: template,
                text: 'Willkommen bei Secret Messages! Ihr Key: ' + keyCode
            };
            
            const result = await this.transporter.sendMail(mailOptions);
            console.log('Welcome email sent successfully:', result.messageId);
            return result;
            
        } catch (error) {
            console.error('Failed to send welcome email:', error);
            throw error;
        }
    }
    
    // Send Support Confirmation
    async sendSupportConfirmation(customerEmail, ticketDetails) {
        try {
            let template = this.templates.support;
            template = template.replace('{{TICKET_ID}}', ticketDetails.id);
            template = template.replace('{{SUBJECT}}', ticketDetails.subject);
            template = template.replace('{{PRIORITY}}', ticketDetails.priority);
            template = template.replace('{{DATE}}', new Date().toLocaleDateString('de-DE'));
            template = template.replace(/{{FRONTEND_URL}}/g, process.env.FRONTEND_URL || 'https://secretmessages.dev');
            
            const mailOptions = {
                from: `Secret Messages Support <${process.env.SMTP_USER}>`,
                to: customerEmail,
                subject: `🛠️ Support-Ticket #${ticketDetails.id} - ${ticketDetails.subject}`,
                html: template,
                text: `Support-Ticket erstellt: #${ticketDetails.id}`
            };
            
            const result = await this.transporter.sendMail(mailOptions);
            console.log('Support confirmation email sent successfully:', result.messageId);
            return result;
            
        } catch (error) {
            console.error('Failed to send support confirmation email:', error);
            throw error;
        }
    }
    
    // Send Receipt
    async sendReceipt(customerEmail, invoiceDetails) {
        try {
            let template = this.templates.receipt;
            template = template.replace('{{INVOICE_ID}}', invoiceDetails.invoiceId);
            template = template.replace('{{DATE}}', new Date().toLocaleDateString('de-DE'));
            template = template.replace('{{PRODUCT_NAME}}', invoiceDetails.productName);
            template = template.replace('{{QUANTITY}}', invoiceDetails.quantity);
            template = template.replace('{{TOTAL}}', invoiceDetails.total);
            template = template.replace('{{PAYMENT_METHOD}}', invoiceDetails.paymentMethod);
            template = template.replace('{{TRANSACTION_ID}}', invoiceDetails.transactionId);
            template = template.replace(/{{FRONTEND_URL}}/g, process.env.FRONTEND_URL || 'https://secretmessages.dev');
            
            const mailOptions = {
                from: `Secret Messages <${process.env.SMTP_USER}>`,
                to: customerEmail,
                subject: `📄 Rechnung ${invoiceDetails.invoiceId} - Secret Messages`,
                html: template,
                text: `Rechnung: ${invoiceDetails.invoiceId}, Betrag: €${invoiceDetails.total}`
            };
            
            const result = await this.transporter.sendMail(mailOptions);
            console.log('Receipt email sent successfully:', result.messageId);
            return result;
            
        } catch (error) {
            console.error('Failed to send receipt email:', error);
            throw error;
        }
    }
    
    // Send Security Alert
    async sendSecurityAlert(customerEmail, securityEvent) {
        try {
            let template = this.templates.security;
            template = template.replace('{{EVENT_TYPE}}', securityEvent.type);
            template = template.replace('{{EVENT_TIME}}', securityEvent.timestamp);
            template = template.replace('{{IP_ADDRESS}}', securityEvent.ipAddress);
            template = template.replace('{{LOCATION}}', securityEvent.location || 'Unbekannt');
            template = template.replace(/{{FRONTEND_URL}}/g, process.env.FRONTEND_URL || 'https://secretmessages.dev');
            
            const mailOptions = {
                from: `Secret Messages Security <${process.env.SMTP_USER}>`,
                to: customerEmail,
                subject: '🚨 Secret Messages Sicherheitsbenachrichtigung',
                html: template,
                text: `Sicherheitsalarm: ${securityEvent.type} um ${securityEvent.timestamp}`,
                priority: 'high'
            };
            
            const result = await this.transporter.sendMail(mailOptions);
            console.log('Security alert email sent successfully:', result.messageId);
            return result;
            
        } catch (error) {
            console.error('Failed to send security alert email:', error);
            throw error;
        }
    }
    
    // Generate text version for accessibility
    generateTextVersion(keys, orderDetails) {
        const keysList = keys.map((key, index) => `${index + 1}. ${key.key_code}`).join('\n');
        
        return `
SECRET MESSAGES - Ihre Lizenz-Keys

Vielen Dank für Ihren Kauf!

Ihre Lizenz-Keys:
${keysList}

Bestelldetails:
- Bestellnummer: ${orderDetails.payment_id}
- Anzahl Keys: ${keys.length}
- Betrag: €${(orderDetails.amount / 100).toFixed(2)}
- Datum: ${new Date().toLocaleDateString('de-DE')}

So nutzen Sie Ihre Keys:
1. Öffnen Sie Secret Messages: ${process.env.FRONTEND_URL}
2. Geben Sie einen Key ein
3. Key wird an Ihr Gerät gebunden
4. Beginnen Sie mit der Verschlüsselung!

Wichtige Sicherheitshinweise:
- Jeder Key funktioniert nur einmal
- Bewahren Sie Keys sicher auf
- Teilen Sie Keys nur mit Vertrauenspersonen

Support: support@secretmessages.dev
Website: ${process.env.FRONTEND_URL}

© 2024 Secret Messages
        `.trim();
    }
    
    // Test email configuration
    async testEmailConfiguration() {
        try {
            const testResult = await this.transporter.verify();
            console.log('✅ Email configuration is valid');
            return testResult;
        } catch (error) {
            console.error('❌ Email configuration test failed:', error);
            throw error;
        }
    }
}

module.exports = EmailTemplateService;
