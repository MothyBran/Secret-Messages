// AUTO-LOGIN SYSTEM - Fügen Sie diesen Code in Ihre app.js ein

// Globale Variablen
let userToken = null;
let isAuthenticated = false;

// ==================================================
// AUTO-LOGIN SYSTEM
// ==================================================

// Beim Laden der Seite prüfen, ob Benutzer bereits authentifiziert ist
document.addEventListener('DOMContentLoaded', async function() {
    console.log('🔍 Checking authentication status...');
    
    // Prüfen, ob bereits ein Token vorhanden ist
    const savedToken = getStoredToken();
    
    if (savedToken) {
        console.log('🔑 Found saved token, validating...');
        
        // Token validieren
        const isValid = await validateToken(savedToken);
        
        if (isValid) {
            console.log('✅ Token is valid, auto-login successful');
            userToken = savedToken;
            isAuthenticated = true;
            
            // Direkt zur Hauptseite weiterleiten
            showMainApplication();
            return;
        } else {
            console.log('❌ Token is invalid, removing...');
            removeStoredToken();
        }
    }
    
    console.log('📝 No valid token found, showing license key screen');
    // Kein gültiger Token -> License Key Screen anzeigen
    showLicenseKeyScreen();
});

// ==================================================
// TOKEN MANAGEMENT
// ==================================================

// Token sicher speichern
function storeToken(token) {
    try {
        // In production verwenden Sie localStorage
        // WARNUNG: localStorage funktioniert nicht in Claude.ai Artifacts!
        localStorage.setItem('secret_messages_token', token);
        
        // Backup: Als Cookie speichern (funktioniert in Claude.ai)
        document.cookie = `sm_token=${token}; max-age=2592000; secure; samesite=strict`;
        
        console.log('💾 Token stored successfully');
    } catch (error) {
        console.warn('⚠️ Could not store token in localStorage, using cookie only');
        document.cookie = `sm_token=${token}; max-age=2592000; secure; samesite=strict`;
    }
}

// Gespeicherten Token abrufen
function getStoredToken() {
    try {
        // Zuerst localStorage prüfen
        const token = localStorage.getItem('secret_messages_token');
        if (token) return token;
    } catch (error) {
        console.warn('⚠️ localStorage not available, checking cookies');
    }
    
    // Fallback: Cookie prüfen
    const cookies = document.cookie.split(';');
    for (let cookie of cookies) {
        const [name, value] = cookie.trim().split('=');
        if (name === 'sm_token') {
            return value;
        }
    }
    
    return null;
}

// Token entfernen
function removeStoredToken() {
    try {
        localStorage.removeItem('secret_messages_token');
    } catch (error) {
        console.warn('⚠️ localStorage not available for removal');
    }
    
    // Cookie entfernen
    document.cookie = 'sm_token=; max-age=0; secure; samesite=strict';
    
    userToken = null;
    isAuthenticated = false;
    
    console.log('🗑️ Token removed successfully');
}

// ==================================================
// TOKEN VALIDATION
// ==================================================

// Token beim Server validieren
async function validateToken(token) {
    try {
        const response = await fetch('/api/auth/validate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: token })
        });
        
        const result = await response.json();
        return result.success && result.valid;
        
    } catch (error) {
        console.error('❌ Token validation failed:', error);
        return false;
    }
}

// ==================================================
// UI MANAGEMENT
// ==================================================

// License Key Screen anzeigen
function showLicenseKeyScreen() {
    // Alle Sections verstecken
    hideAllSections();
    
    // License Section anzeigen
    const licenseSection = document.getElementById('licenseSection');
    if (licenseSection) {
        licenseSection.style.display = 'block';
        licenseSection.classList.add('fade-in');
    }
    
    // Titel und Design für Authentifizierung
    updatePageForAuth();
    
    console.log('📝 License key screen displayed');
}

// Hauptanwendung anzeigen
function showMainApplication() {
    // Alle Sections verstecken
    hideAllSections();
    
    // Hauptanwendung anzeigen
    const encryptionSection = document.getElementById('encryptionSection');
    if (encryptionSection) {
        encryptionSection.style.display = 'block';
        encryptionSection.classList.add('fade-in');
    }
    
    // Titel und Design für Hauptanwendung
    updatePageForApp();
    
    console.log('🎉 Main application displayed');
}

// Alle Sections verstecken
function hideAllSections() {
    const sections = ['licenseSection', 'encryptionSection'];
    sections.forEach(sectionId => {
        const section = document.getElementById(sectionId);
        if (section) {
            section.style.display = 'none';
            section.classList.remove('fade-in');
        }
    });
}

// Page-Design für Authentifizierung anpassen
function updatePageForAuth() {
    // Titel ändern
    document.title = 'Secret Messages - Secure Backend Authentication';
    
    // Header-Text ändern falls vorhanden
    const headerTitle = document.querySelector('h1');
    if (headerTitle) {
        headerTitle.textContent = '🔐 SECURE BACKEND-AUTHENTIFIZIERUNG';
    }
    
    // Beschreibung hinzufügen
    const licenseSection = document.getElementById('licenseSection');
    if (licenseSection && !licenseSection.querySelector('.auth-description')) {
        const description = document.createElement('div');
        description.className = 'auth-description';
        description.innerHTML = `
            <p style="margin-bottom: 20px; color: #666; text-align: center;">
                🛡️ Sichere Backend-Authentifizierung erforderlich<br>
                <small>Geben Sie Ihren License Key ein, um fortzufahren</small>
            </p>
        `;
        licenseSection.insertBefore(description, licenseSection.firstChild);
    }
}

// Page-Design für Hauptanwendung anpassen
function updatePageForApp() {
    // Titel ändern
    document.title = 'Secret Messages - Encryption Tool';
    
    // Header-Text ändern falls vorhanden
    const headerTitle = document.querySelector('h1');
    if (headerTitle) {
        headerTitle.textContent = '🔐 Secret Messages';
    }
    
    // Logout-Button hinzufügen falls nicht vorhanden
    addLogoutButton();
}

// Logout-Button hinzufügen
function addLogoutButton() {
    const encryptionSection = document.getElementById('encryptionSection');
    if (encryptionSection && !encryptionSection.querySelector('.logout-btn')) {
        const logoutBtn = document.createElement('button');
        logoutBtn.className = 'logout-btn';
        logoutBtn.innerHTML = '🚪 Abmelden';
        logoutBtn.style.cssText = `
            position: absolute;
            top: 20px;
            right: 20px;
            background: #ff6b6b;
            color: white;
            border: none;
            padding: 8px 16px;
            border-radius: 5px;
            cursor: pointer;
            font-size: 14px;
            z-index: 1000;
        `;
        
        logoutBtn.addEventListener('click', logout);
        document.body.appendChild(logoutBtn);
    }
}

// ==================================================
// MODIFIED LICENSE ACTIVATION
// ==================================================

// Modifizierte activateLicenseKey Funktion
async function activateLicenseKey() {
    const licenseInput = document.getElementById('licenseKey');
    const activateBtn = document.getElementById('activateBtn');
    
    if (!licenseInput || !activateBtn) return;
    
    const licenseKey = licenseInput.value.trim();
    const originalText = activateBtn.textContent;
    
    if (!licenseKey) {
        showError('Bitte geben Sie einen License Key ein');
        return;
    }
    
    // Loading state
    activateBtn.textContent = 'AUTHENTIFIZIERE...';
    activateBtn.disabled = true;
    
    try {
        const response = await fetch('/api/auth/activate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ licenseKey })
        });
        
        const result = await response.json();
        
        if (result.success) {
            userToken = result.token;
            isAuthenticated = true;
            
            // Token speichern für automatisches Login
            storeToken(result.token);
            
            showSuccess('✅ Authentifizierung erfolgreich! Weiterleitung...');
            
            // Log activity
            logActivity('license_activated', { keyId: result.keyId });
            
            // Nach kurzer Verzögerung zur Hauptanwendung wechseln
            setTimeout(() => {
                showMainApplication();
            }, 1500);
            
        } else {
            showError('❌ ' + result.error);
        }
        
    } catch (error) {
        showError('Verbindungsfehler: ' + error.message);
    } finally {
        activateBtn.textContent = originalText;
        activateBtn.disabled = false;
    }
}

// ==================================================
// LOGOUT FUNCTION
// ==================================================

// Logout-Funktion
function logout() {
    if (confirm('Möchten Sie sich wirklich abmelden?')) {
        console.log('👋 User logging out...');
        
        // Token entfernen
        removeStoredToken();
        
        // Zurück zum License Key Screen
        showLicenseKeyScreen();
        
        // Eingabefelder leeren
        const licenseInput = document.getElementById('licenseKey');
        if (licenseInput) licenseInput.value = '';
        
        const messageInput = document.getElementById('messageInput');
        if (messageInput) messageInput.value = '';
        
        const codeInput = document.getElementById('codeInput');
        if (codeInput) codeInput.value = '';
        
        // Outputs leeren
        const outputs = ['encryptedOutput', 'decryptedOutput'];
        outputs.forEach(id => {
            const element = document.getElementById(id);
            if (element) element.value = '';
        });
        
        // Success-Message anzeigen
        showSuccess('✅ Erfolgreich abgemeldet');
        
        console.log('✅ Logout completed');
    }
}

// ==================================================
// UTILITY FUNCTIONS
// ==================================================

// CSS für Fade-In Animation hinzufügen
if (!document.querySelector('#fade-in-styles')) {
    const style = document.createElement('style');
    style.id = 'fade-in-styles';
    style.textContent = `
        .fade-in {
            animation: fadeIn 0.5s ease-in;
        }
        
        @keyframes fadeIn {
            from { opacity: 0; transform: translateY(20px); }
            to { opacity: 1; transform: translateY(0); }
        }
        
        .auth-description {
            text-align: center;
            margin-bottom: 30px;
            padding: 20px;
            background: #f8f9fa;
            border-radius: 8px;
            border-left: 4px solid #007bff;
        }
    `;
    document.head.appendChild(style);
}

console.log('🚀 Auto-login system initialized');

// app.js - Secret Messages Frontend JavaScript
let userToken = null;
let isConnected = false;

// Event Listeners für CSP-Kompatibilität
document.addEventListener('DOMContentLoaded', function() {
    // License Key Activation Button
    const activateBtn = document.getElementById('activateBtn');
    if (activateBtn) activateBtn.addEventListener('click', activateLicense);
    
    // Demo Key Button
    const demoBtn = document.getElementById('demoBtn');
    if (demoBtn) demoBtn.addEventListener('click', showDemoKey);
    
    // Encrypt Button
    const encryptBtn = document.getElementById('encryptBtn');
    if (encryptBtn) encryptBtn.addEventListener('click', encryptMessage);
    
    // Decrypt Button
    const decryptBtn = document.getElementById('decryptBtn');
    if (decryptBtn) decryptBtn.addEventListener('click', decryptMessage);
    
    // Copy Buttons
    const copyEncryptedBtn = document.getElementById('copyEncryptedBtn');
    if (copyEncryptedBtn) copyEncryptedBtn.addEventListener('click', () => copyToClipboard('encryptedOutput'));
    
    const copyDecryptedBtn = document.getElementById('copyDecryptedBtn');
    if (copyDecryptedBtn) copyDecryptedBtn.addEventListener('click', () => copyToClipboard('decryptedOutput'));
    
    // Clear Buttons
    const clearBtn = document.getElementById('clearBtn');
    if (clearBtn) clearBtn.addEventListener('click', clearAll);
    
    // Enter-Taste für License Key
    const licenseInput = document.getElementById('licenseKey');
    if (licenseInput) {
        licenseInput.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                activateLicense();
            }
        });
    }
    
    // Enter-Taste für Message Input
    const messageInput = document.getElementById('messageInput');
    if (messageInput) {
        messageInput.addEventListener('keypress', function(e) {
            if (e.key === 'Enter' && e.ctrlKey) {
                encryptMessage();
            }
        });
    }
    
    // Enter-Taste für Encrypted Input
    const encryptedInput = document.getElementById('encryptedInput');
    if (encryptedInput) {
        encryptedInput.addEventListener('keypress', function(e) {
            if (e.key === 'Enter' && e.ctrlKey) {
                decryptMessage();
            }
        });
    }
    
    // Enter-Taste für Code Input
    const codeInput = document.getElementById('codeInput');
    if (codeInput) {
        codeInput.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                // Focus auf Message Input wenn Code eingegeben
                const messageInput = document.getElementById('messageInput');
                if (messageInput) messageInput.focus();
            }
        });
    }
    
    // Server-Verbindung prüfen
    checkServerConnection();
    
    // Auto-Verbindungscheck alle 30 Sekunden
    setInterval(checkServerConnection, 30000);
});

// Server-Verbindung prüfen
async function checkServerConnection() {
    const statusEl = document.getElementById('connectionStatus');
    const statusText = document.getElementById('statusText');
    
    try {
        const response = await fetch('/api/health', {
            method: 'GET',
            headers: { 'Accept': 'application/json' }
        });
        
        if (response.ok) {
            const data = await response.json();
            if (data.status === 'ok') {
                isConnected = true;
                if (statusEl) {
                    statusEl.style.display = 'none';
                }
                
                // Features aktivieren
                enableFeatures();
            } else {
                throw new Error('Server not ready');
            }
        } else {
            throw new Error('Server unreachable');
        }
    } catch (error) {
        isConnected = false;
        if (statusEl) {
            statusEl.style.display = 'block';
            if (statusText) {
                statusText.textContent = 'Verbindung zum Server wird geprüft...';
            }
        }
        
        // Features deaktivieren
        disableFeatures();
    }
}

// Features aktivieren
function enableFeatures() {
    const buttons = document.querySelectorAll('.encrypt-btn, .decrypt-btn, .activate-btn, .demo-btn');
    buttons.forEach(btn => {
        btn.disabled = false;
        btn.style.opacity = '1';
    });
    
    const inputs = document.querySelectorAll('input, textarea');
    inputs.forEach(input => {
        input.disabled = false;
    });
}

// Features deaktivieren
function disableFeatures() {
    const buttons = document.querySelectorAll('.encrypt-btn, .decrypt-btn');
    buttons.forEach(btn => {
        btn.disabled = true;
        btn.style.opacity = '0.5';
    });
}

// License Key aktivieren
async function activateLicense() {
    const licenseKey = document.getElementById('licenseKey').value;
    const activateBtn = document.getElementById('activateBtn');
    const originalText = activateBtn ? activateBtn.textContent : '';
    
    if (!licenseKey) {
        showError('Bitte geben Sie einen License Key ein');
        return;
    }
    
    if (!isConnected) {
        showError('Keine Verbindung zum Server');
        return;
    }
    
    // Loading state
    if (activateBtn) activateBtn.textContent = 'AKTIVIERE...';
    
    try {
        const response = await fetch('/api/auth/activate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ licenseKey })
        });
        
        const result = await response.json();
        
        if (result.success) {
            userToken = result.token;
            showSuccess('✅ ' + result.message);
            
            // License Key Bereich ausblenden
            const licenseSection = document.getElementById('licenseSection');
            if (licenseSection) licenseSection.style.display = 'none';
            
            // Encryption Bereich anzeigen
            const encryptionSection = document.getElementById('encryptionSection');
            if (encryptionSection) {
                encryptionSection.style.display = 'block';
                encryptionSection.classList.add('fade-in');
            }
            
            // Log activity
            logActivity('license_activated', { keyId: result.keyId });
            
        } else {
            showError('❌ ' + result.error);
        }
        
    } catch (error) {
        showError('Verbindungsfehler: ' + error.message);
    } finally {
        if (activateBtn) activateBtn.textContent = originalText;
    }
}

// Demo Key anzeigen
function showDemoKey() {
    const licenseInput = document.getElementById('licenseKey');
    if (licenseInput) {
        // Demo Keys (diese sollten in der Admin-Panel generiert werden)
        const demoKeys = [
            '7CE4A-71263-380DC',
            '7F2DC-9EF07-E6584',
            '54EA3-98607-DF13A'
        ];
        
        const randomKey = demoKeys[Math.floor(Math.random() * demoKeys.length)];
        licenseInput.value = randomKey;
        
        // Info anzeigen
        showInfo('ℹ️ Demo Key eingefügt. Klicken Sie "ZUGANG AKTIVIEREN" zum Testen.');
    }
}

// Nachricht verschlüsseln
async function encryptMessage() {
    const message = document.getElementById('messageInput').value;
    const code = document.getElementById('codeInput').value;
    const output = document.getElementById('encryptedOutput');
    const encryptBtn = document.getElementById('encryptBtn');
    
    if (!message) {
        showError('Bitte geben Sie eine Nachricht ein');
        return;
    }
    
    if (!code || code.length !== 5) {
        showError('Bitte geben Sie einen 5-stelligen Code ein');
        return;
    }
    
    if (!userToken) {
        showError('Bitte aktivieren Sie zuerst einen License Key');
        return;
    }
    
    // Loading state
    const originalText = encryptBtn ? encryptBtn.textContent : '';
    if (encryptBtn) encryptBtn.textContent = 'VERSCHLÜSSELE...';
    
    try {
        // Lokale AES-Verschlüsselung (Frontend)
        const encrypted = performEncryption(message, code);
        
        if (output) {
            output.value = encrypted;
            output.style.display = 'block';
        }
        
        // Show copy button
        const copyBtn = document.getElementById('copyEncryptedBtn');
        if (copyBtn) copyBtn.style.display = 'inline-block';
        
        showSuccess('✅ Nachricht erfolgreich verschlüsselt');
        
        // Log activity
        await logActivity('message_encrypted', { 
            messageLength: message.length,
            codeUsed: code 
        });
        
    } catch (error) {
        showError('Verschlüsselungsfehler: ' + error.message);
    } finally {
        if (encryptBtn) encryptBtn.textContent = originalText;
    }
}

// Nachricht entschlüsseln
async function decryptMessage() {
    const encryptedText = document.getElementById('encryptedInput').value;
    const code = document.getElementById('codeInput').value;
    const output = document.getElementById('decryptedOutput');
    const decryptBtn = document.getElementById('decryptBtn');
    
    if (!encryptedText) {
        showError('Bitte geben Sie verschlüsselten Text ein');
        return;
    }
    
    if (!code || code.length !== 5) {
        showError('Bitte geben Sie einen 5-stelligen Code ein');
        return;
    }
    
    if (!userToken) {
        showError('Bitte aktivieren Sie zuerst einen License Key');
        return;
    }
    
    // Loading state
    const originalText = decryptBtn ? decryptBtn.textContent : '';
    if (decryptBtn) decryptBtn.textContent = 'ENTSCHLÜSSELE...';
    
    try {
        // Lokale AES-Entschlüsselung (Frontend)
        const decrypted = performDecryption(encryptedText, code);
        
        if (output) {
            output.value = decrypted;
            output.style.display = 'block';
        }
        
        // Show copy button
        const copyBtn = document.getElementById('copyDecryptedBtn');
        if (copyBtn) copyBtn.style.display = 'inline-block';
        
        showSuccess('✅ Nachricht erfolgreich entschlüsselt');
        
        // Log activity
        await logActivity('message_decrypted', { 
            encryptedLength: encryptedText.length,
            codeUsed: code 
        });
        
    } catch (error) {
        showError('Entschlüsselungsfehler: Falscher Code oder beschädigter Text');
    } finally {
        if (decryptBtn) decryptBtn.textContent = originalText;
    }
}

// AES-Verschlüsselung (vereinfacht für Demo)
function performEncryption(message, code) {
    try {
        // Basis64 + XOR mit Code (vereinfachte Demo-Verschlüsselung)
        const key = generateKey(code);
        const encrypted = xorEncrypt(message, key);
        return btoa(encrypted); // Base64 encode
    } catch (error) {
        throw new Error('Verschlüsselung fehlgeschlagen');
    }
}

// AES-Entschlüsselung (vereinfacht für Demo)
function performDecryption(encryptedText, code) {
    try {
        const key = generateKey(code);
        const decoded = atob(encryptedText); // Base64 decode
        return xorDecrypt(decoded, key);
    } catch (error) {
        throw new Error('Entschlüsselung fehlgeschlagen');
    }
}

// Schlüssel generieren
function generateKey(code) {
    let key = '';
    for (let i = 0; i < 256; i++) {
        key += code.charAt(i % code.length);
    }
    return key;
}

// XOR Verschlüsselung
function xorEncrypt(text, key) {
    let result = '';
    for (let i = 0; i < text.length; i++) {
        const charCode = text.charCodeAt(i) ^ key.charCodeAt(i % key.length);
        result += String.fromCharCode(charCode);
    }
    return result;
}

// XOR Entschlüsselung
function xorDecrypt(encryptedText, key) {
    return xorEncrypt(encryptedText, key); // XOR ist symmetrisch
}

// Activity loggen
async function logActivity(action, metadata = {}) {
    if (!userToken) return;
    
    try {
        await fetch('/api/activity/log', {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${userToken}`
            },
            body: JSON.stringify({ action, metadata })
        });
    } catch (error) {
        console.error('Activity logging failed:', error);
    }
}

// Text kopieren
function copyToClipboard(elementId) {
    const element = document.getElementById(elementId);
    if (!element || !element.value) {
        showError('Nichts zum Kopieren vorhanden');
        return;
    }
    
    element.select();
    element.setSelectionRange(0, 99999); // Für mobile
    
    try {
        document.execCommand('copy');
        showSuccess('✅ Text in Zwischenablage kopiert');
        
        // Visual feedback auf Button
        const button = elementId === 'encryptedOutput' ? 
            document.getElementById('copyEncryptedBtn') : 
            document.getElementById('copyDecryptedBtn');
            
        if (button) {
            const originalText = button.textContent;
            button.textContent = '✅ KOPIERT';
            setTimeout(() => {
                button.textContent = originalText;
            }, 2000);
        }
        
    } catch (error) {
        // Fallback für moderne Browser
        navigator.clipboard.writeText(element.value).then(() => {
            showSuccess('✅ Text in Zwischenablage kopiert');
        }).catch(() => {
            showError('Kopieren fehlgeschlagen');
        });
    }
}

// Alle Felder leeren
function clearAll() {
    const inputs = [
        'messageInput', 'encryptedInput', 'codeInput',
        'encryptedOutput', 'decryptedOutput'
    ];
    
    inputs.forEach(id => {
        const element = document.getElementById(id);
        if (element) element.value = '';
    });
    
    // Output-Bereiche verstecken
    const outputs = ['encryptedOutput', 'decryptedOutput'];
    outputs.forEach(id => {
        const element = document.getElementById(id);
        if (element) element.style.display = 'none';
    });
    
    // Copy-Buttons verstecken
    const copyBtns = ['copyEncryptedBtn', 'copyDecryptedBtn'];
    copyBtns.forEach(id => {
        const element = document.getElementById(id);
        if (element) element.style.display = 'none';
    });
    
    showInfo('ℹ️ Alle Felder geleert');
}

// Hilfsfunktionen für Nachrichten
function showError(message) {
    showMessage(message, 'error');
}

function showSuccess(message) {
    showMessage(message, 'success');
}

function showInfo(message) {
    showMessage(message, 'info');
}

function showMessage(message, type) {
    // Existing message entfernen
    const existing = document.querySelector('.message-popup');
    if (existing) existing.remove();
    
    // Neue Message erstellen
    const popup = document.createElement('div');
    popup.className = `message-popup ${type}`;
    popup.textContent = message;
    
    // Styling
    popup.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 15px 20px;
        border-radius: 5px;
        color: #fff;
        font-family: 'Courier New', monospace;
        font-weight: bold;
        z-index: 10000;
        max-width: 400px;
        word-wrap: break-word;
        animation: slideIn 0.3s ease-out;
    `;
    
    // Typ-spezifische Farben
    switch(type) {
        case 'error':
            popup.style.background = 'linear-gradient(45deg, #ff4444, #cc0000)';
            break;
        case 'success':
            popup.style.background = 'linear-gradient(45deg, #00ff41, #00cc33)';
            popup.style.color = '#000';
            break;
        case 'info':
            popup.style.background = 'linear-gradient(45deg, #0088ff, #0066cc)';
            break;
    }
    
    document.body.appendChild(popup);
    
    // Auto-remove nach 4 Sekunden
    setTimeout(() => {
        if (popup.parentNode) {
            popup.style.animation = 'slideOut 0.3s ease-in';
            setTimeout(() => popup.remove(), 300);
        }
    }, 4000);
    
    // Click to dismiss
    popup.addEventListener('click', () => {
        popup.style.animation = 'slideOut 0.3s ease-in';
        setTimeout(() => popup.remove(), 300);
    });
}

// CSS für Animationen
const style = document.createElement('style');
style.textContent = `
    @keyframes slideIn {
        from { 
            transform: translateX(100%); 
            opacity: 0; 
        }
        to { 
            transform: translateX(0); 
            opacity: 1; 
        }
    }
    
    @keyframes slideOut {
        from { 
            transform: translateX(0); 
            opacity: 1; 
        }
        to { 
            transform: translateX(100%); 
            opacity: 0; 
        }
    }
    
    .fade-in {
        animation: fadeIn 0.5s ease-in;
    }
    
    @keyframes fadeIn {
        from { opacity: 0; transform: translateY(20px); }
        to { opacity: 1; transform: translateY(0); }
    }
`;
document.head.appendChild(style);
