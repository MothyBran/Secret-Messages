// app.js - Secret Messages Frontend JavaScript
let userToken = null;
let isConnected = false;
let currentMode = 'encrypt';

// Event Listeners für CSP-Kompatibilität
document.addEventListener('DOMContentLoaded', function() {
    console.log('🚀 Secret Messages App Loading...');
    
    // Initialize connection check
    checkServerConnection();
    
    // Login Screen Event Listeners
    const activateBtn = document.getElementById('activateBtn');
    if (activateBtn) activateBtn.addEventListener('click', activateLicense);
    
    const demoKeysBtn = document.getElementById('demoKeysBtn');
    if (demoKeysBtn) demoKeysBtn.addEventListener('click', showDemoKeys);
    
    // Main App Event Listeners
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) logoutBtn.addEventListener('click', logout);
    
    const helpBtn = document.getElementById('helpBtn');
    if (helpBtn) helpBtn.addEventListener('click', showHelp);
    
    // Mode Switch Buttons
    const encryptModeBtn = document.getElementById('encryptModeBtn');
    if (encryptModeBtn) encryptModeBtn.addEventListener('click', () => switchMode('encrypt'));
    
    const decryptModeBtn = document.getElementById('decryptModeBtn');
    if (decryptModeBtn) decryptModeBtn.addEventListener('click', () => switchMode('decrypt'));
    
    // Encrypt/Decrypt Buttons
    const encryptBtn = document.getElementById('encryptBtn');
    if (encryptBtn) encryptBtn.addEventListener('click', encryptMessage);
    
    const decryptBtn = document.getElementById('decryptBtn');
    if (decryptBtn) decryptBtn.addEventListener('click', decryptMessage);
    
    // Copy Buttons
    const copyEncryptedBtn = document.getElementById('copyEncryptedBtn');
    if (copyEncryptedBtn) copyEncryptedBtn.addEventListener('click', () => copyToClipboard('encryptedOutput'));
    
    const copyDecryptedBtn = document.getElementById('copyDecryptedBtn');
    if (copyDecryptedBtn) copyDecryptedBtn.addEventListener('click', () => copyToClipboard('decryptedOutput'));
    
    // Clear Button
    const clearBtn = document.getElementById('clearBtn');
    if (clearBtn) clearBtn.addEventListener('click', clearAll);
    
    // Destroy Button
    const destroyBtn = document.getElementById('destroyBtn');
    if (destroyBtn) destroyBtn.addEventListener('click', destroyKey);
    
    // Enter-Taste für License Key
    const licenseInput = document.getElementById('licenseKey');
    if (licenseInput) {
        licenseInput.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                activateLicense();
            }
        });
        
        // Auto-format license key input
        licenseInput.addEventListener('input', function(e) {
            let value = e.target.value.replace(/[^A-Z0-9]/g, '');
            if (value.length > 5) {
                value = value.substring(0, 5) + '-' + value.substring(5);
            }
            if (value.length > 11) {
                value = value.substring(0, 11) + '-' + value.substring(11);
            }
            if (value.length > 17) {
                value = value.substring(0, 17);
            }
            e.target.value = value;
        });
    }
    
    // Enter-Taste für Code-Inputs
    const encryptCodeInput = document.getElementById('encryptCodeInput');
    if (encryptCodeInput) {
        encryptCodeInput.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                encryptMessage();
            }
        });
        
        // Nur Zahlen erlauben
        encryptCodeInput.addEventListener('input', function(e) {
            e.target.value = e.target.value.replace(/[^0-9]/g, '');
        });
    }
    
    const decryptCodeInput = document.getElementById('decryptCodeInput');
    if (decryptCodeInput) {
        decryptCodeInput.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                decryptMessage();
            }
        });
        
        // Nur Zahlen erlauben
        decryptCodeInput.addEventListener('input', function(e) {
            e.target.value = e.target.value.replace(/[^0-9]/g, '');
        });
    }
});

// Server Connection Check
async function checkServerConnection() {
    try {
        const response = await fetch('/api/health', {
            method: 'GET',
            timeout: 5000
        });
        
        if (response.ok) {
            const data = await response.json();
            if (data.status === 'ok') {
                isConnected = true;
                console.log('✅ Server connection established');
            }
        }
    } catch (error) {
        isConnected = false;
        console.warn('⚠️ Server connection failed, using offline mode');
    }
}

// License Key aktivieren
async function activateLicense() {
    const licenseKey = document.getElementById('licenseKey').value.trim();
    const activateBtn = document.getElementById('activateBtn');
    const activateBtnText = document.getElementById('activateBtnText');
    
    if (!licenseKey) {
        showError('Bitte geben Sie einen License Key ein');
        return;
    }
    
    // Validate format
    const keyPattern = /^[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}$/;
    if (!keyPattern.test(licenseKey)) {
        showError('Ungültiges License Key Format. Verwenden Sie: XXXXX-XXXXX-XXXXX');
        return;
    }
    
    // Loading state
    const originalText = activateBtnText ? activateBtnText.textContent : '';
    if (activateBtnText) activateBtnText.textContent = 'AKTIVIERE...';
    if (activateBtn) activateBtn.disabled = true;
    
    try {
        if (isConnected) {
            // Try server activation
            const response = await fetch('/api/auth/activate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ licenseKey })
            });
            
            const result = await response.json();
            
            if (result.success) {
                userToken = result.token;
                showSuccess('✅ ' + result.message);
                await switchToMainApp();
                await logActivity('license_activated', { keyId: result.keyId });
            } else {
                showError('❌ ' + result.error);
            }
        } else {
            // Offline demo mode
            const demoKeys = [
                'SM001-ALPHA-BETA1',
                'SM002-GAMMA-DELT2',
                'SM003-OMEGA-ZETA3',
                'DEMO1-12345-ABCDE',
                'TEST1-99999-ZZZZZ'
            ];
            
            if (demoKeys.includes(licenseKey)) {
                userToken = 'demo-token-' + Date.now();
                showSuccess('✅ Demo-Modus aktiviert');
                await switchToMainApp();
            } else {
                showError('❌ Ungültiger License Key (Demo-Modus)');
            }
        }
        
    } catch (error) {
        console.error('Activation error:', error);
        showError('❌ Verbindungsfehler: ' + error.message);
    } finally {
        if (activateBtnText) activateBtnText.textContent = originalText;
        if (activateBtn) activateBtn.disabled = false;
    }
}

// Demo Keys anzeigen
function showDemoKeys() {
    const licenseInput = document.getElementById('licenseKey');
    if (licenseInput) {
        const demoKeys = [
            'SM001-ALPHA-BETA1',
            'SM002-GAMMA-DELT2',
            'SM003-OMEGA-ZETA3',
            'DEMO1-12345-ABCDE',
            'TEST1-99999-ZZZZZ'
        ];
        
        const randomKey = demoKeys[Math.floor(Math.random() * demoKeys.length)];
        licenseInput.value = randomKey;
        licenseInput.classList.add('success-animation');
        
        setTimeout(() => {
            licenseInput.classList.remove('success-animation');
        }, 600);
        
        showInfo('ℹ️ Demo Key eingefügt. Klicken Sie "Lizenz Aktivieren" zum Testen.');
    }
}

// Switch to main app
async function switchToMainApp() {
    const loginScreen = document.getElementById('loginScreen');
    const mainApp = document.getElementById('mainApp');
    
    if (loginScreen) {
        loginScreen.style.display = 'none';
    }
    
    if (mainApp) {
        mainApp.style.display = 'block';
        mainApp.classList.add('fade-in');
    }
    
    // Initialize default mode
    switchMode('encrypt');
}

// Mode Switch
function switchMode(mode) {
    currentMode = mode;
    
    const encryptModeBtn = document.getElementById('encryptModeBtn');
    const decryptModeBtn = document.getElementById('decryptModeBtn');
    const encryptSection = document.getElementById('encryptSection');
    const decryptSection = document.getElementById('decryptSection');
    
    // Update button states
    if (encryptModeBtn && decryptModeBtn) {
        encryptModeBtn.classList.toggle('active', mode === 'encrypt');
        decryptModeBtn.classList.toggle('active', mode === 'decrypt');
    }
    
    // Show/hide sections
    if (encryptSection && decryptSection) {
        if (mode === 'encrypt') {
            encryptSection.classList.remove('hidden');
            decryptSection.classList.add('hidden');
        } else {
            encryptSection.classList.add('hidden');
            decryptSection.classList.remove('hidden');
        }
    }
    
    logActivity('mode_switched', { mode });
}

// Nachricht verschlüsseln
async function encryptMessage() {
    const message = document.getElementById('messageInput').value.trim();
    const code = document.getElementById('encryptCodeInput').value.trim();
    const output = document.getElementById('encryptedOutput');
    const encryptBtn = document.getElementById('encryptBtn');
    
    if (!message) {
        showError('Bitte geben Sie eine Nachricht ein');
        return;
    }
    
    if (!code || code.length !== 5 || !/^\d{5}$/.test(code)) {
        showError('Bitte geben Sie einen 5-stelligen numerischen Code ein');
        return;
    }
    
    if (!userToken) {
        showError('Bitte aktivieren Sie zuerst einen License Key');
        return;
    }
    
    // Loading state
    const originalText = encryptBtn ? encryptBtn.textContent : '';
    if (encryptBtn) {
        encryptBtn.textContent = '🔐 VERSCHLÜSSELE...';
        encryptBtn.disabled = true;
    }
    
    try {
        // Perform encryption
        const encrypted = performEncryption(message, code);
        
        if (output) {
            output.value = encrypted;
        }
        
        showSuccess('✅ Nachricht erfolgreich verschlüsselt');
        
        // Log activity
        await logActivity('message_encrypted', { 
            messageLength: message.length,
            codeUsed: code.substring(0, 2) + '***' // Partial code for security
        });
        
    } catch (error) {
        console.error('Encryption error:', error);
        showError('❌ Verschlüsselungsfehler: ' + error.message);
    } finally {
        if (encryptBtn) {
            encryptBtn.textContent = originalText;
            encryptBtn.disabled = false;
        }
    }
}

// Nachricht entschlüsseln
async function decryptMessage() {
    const encryptedText = document.getElementById('encryptedInput').value.trim();
    const code = document.getElementById('decryptCodeInput').value.trim();
    const output = document.getElementById('decryptedOutput');
    const decryptBtn = document.getElementById('decryptBtn');
    
    if (!encryptedText) {
        showError('Bitte geben Sie verschlüsselten Text ein');
        return;
    }
    
    if (!code || code.length !== 5 || !/^\d{5}$/.test(code)) {
        showError('Bitte geben Sie einen 5-stelligen numerischen Code ein');
        return;
    }
    
    if (!userToken) {
        showError('Bitte aktivieren Sie zuerst einen License Key');
        return;
    }
    
    // Loading state
    const originalText = decryptBtn ? decryptBtn.textContent : '';
    if (decryptBtn) {
        decryptBtn.textContent = '🔓 ENTSCHLÜSSELE...';
        decryptBtn.disabled = true;
    }
    
    try {
        // Perform decryption
        const decrypted = performDecryption(encryptedText, code);
        
        if (output) {
            output.value = decrypted;
        }
        
        showSuccess('✅ Nachricht erfolgreich entschlüsselt');
        
        // Log activity
        await logActivity('message_decrypted', { 
            encryptedLength: encryptedText.length,
            codeUsed: code.substring(0, 2) + '***' // Partial code for security
        });
        
    } catch (error) {
        console.error('Decryption error:', error);
        showError('❌ Entschlüsselungsfehler: Falscher Code oder beschädigter Text');
    } finally {
        if (decryptBtn) {
            decryptBtn.textContent = originalText;
            decryptBtn.disabled = false;
        }
    }
}

// Copy to clipboard
async function copyToClipboard(elementId) {
    const element = document.getElementById(elementId);
    if (!element || !element.value) {
        showError('Nichts zum Kopieren vorhanden');
        return;
    }
    
    try {
        await navigator.clipboard.writeText(element.value);
        showSuccess('✅ In Zwischenablage kopiert');
        
        // Visual feedback
        element.classList.add('success-animation');
        setTimeout(() => {
            element.classList.remove('success-animation');
        }, 600);
        
        await logActivity('text_copied', { 
            elementId,
            textLength: element.value.length 
        });
        
    } catch (error) {
        console.error('Copy error:', error);
        
        // Fallback for older browsers
        element.select();
        document.execCommand('copy');
        showSuccess('✅ In Zwischenablage kopiert (Fallback)');
    }
}

// Clear all fields
function clearAll() {
    const fields = [
        'messageInput',
        'encryptCodeInput',
        'encryptedOutput',
        'encryptedInput',
        'decryptCodeInput',
        'decryptedOutput'
    ];
    
    fields.forEach(fieldId => {
        const field = document.getElementById(fieldId);
        if (field) {
            field.value = '';
        }
    });
    
    showInfo('🗑️ Alle Felder geleert');
    logActivity('fields_cleared');
}

// Destroy key (dangerous operation)
async function destroyKey() {
    if (!userToken) {
        showError('Kein aktiver License Key vorhanden');
        return;
    }
    
    const confirmed = confirm('⚠️ WARNUNG: Dies wird Ihren License Key unwiderruflich vernichten!\n\nSind Sie sicher, dass Sie fortfahren möchten?');
    
    if (confirmed) {
        const doubleConfirm = confirm('🚨 LETZTE WARNUNG: Nach der Vernichtung können Sie diesen Key niemals wieder verwenden!\n\nWirklich fortfahren?');
        
        if (doubleConfirm) {
            try {
                if (isConnected) {
                    // Try server destruction
                    const response = await fetch('/api/auth/destroy', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${userToken}`
                        }
                    });
                    
                    const result = await response.json();
                    
                    if (result.success) {
                        showError('💣 License Key vernichtet!');
                    } else {
                        showError('❌ Vernichtung fehlgeschlagen: ' + result.error);
                    }
                } else {
                    // Offline mode - just clear local token
                    showError('💣 License Key vernichtet (Demo-Modus)!');
                }
                
                // Clear token and return to login
                userToken = null;
                setTimeout(() => {
                    logout();
                }, 2000);
                
                await logActivity('key_destroyed');
                
            } catch (error) {
                console.error('Destroy error:', error);
                showError('❌ Fehler bei der Vernichtung: ' + error.message);
            }
        }
    }
}

// Logout
function logout() {
    userToken = null;
    
    const loginScreen = document.getElementById('loginScreen');
    const mainApp = document.getElementById('mainApp');
    
    if (mainApp) mainApp.style.display = 'none';
    if (loginScreen) {
        loginScreen.style.display = 'flex';
        loginScreen.classList.add('fade-in');
    }
    
    // Clear license input
    const licenseInput = document.getElementById('licenseKey');
    if (licenseInput) licenseInput.value = '';
    
    // Clear all fields
    clearAll();
    
    showInfo('👋 Erfolgreich abgemeldet');
    logActivity('user_logged_out');
}

// Show help
function showHelp() {
    const helpText = `
🔐 SECRET MESSAGES - HILFE

VERSCHLÜSSELUNG:
1. Geben Sie Ihre Nachricht ein
2. Wählen Sie einen 5-stelligen Code (nur Zahlen)
3. Klicken Sie "Verschlüsseln"
4. Kopieren Sie den verschlüsselten Text

ENTSCHLÜSSELUNG:
1. Fügen Sie den verschlüsselten Text ein
2. Geben Sie den exakt gleichen 5-stelligen Code ein
3. Klicken Sie "Entschlüsseln"
4. Kopieren Sie die entschlüsselte Nachricht

SICHERHEIT:
- Verwenden Sie starke, unvorhersagbare Codes
- Teilen Sie Codes sicher mit dem Empfänger
- Verwenden Sie verschiedene Codes für verschiedene Nachrichten
- Vernichten Sie Ihren Key nur im Notfall (unwiderruflich!)

DEMO KEYS:
- SM001-ALPHA-BETA1
- SM002-GAMMA-DELT2
- SM003-OMEGA-ZETA3
- DEMO1-12345-ABCDE
- TEST1-99999-ZZZZZ
    `;
    
    alert(helpText);
    logActivity('help_viewed');
}

// Status message functions
function showSuccess(message) {
    showStatus(message, 'status-success');
}

function showError(message) {
    showStatus(message, 'status-error');
}

function showInfo(message) {
    showStatus(message, 'status-info');
}

function showStatus(message, className) {
    const statusEl = document.getElementById('loginStatus');
    if (statusEl) {
        statusEl.textContent = message;
        statusEl.className = 'login-status ' + className;
        
        // Auto-hide after 5 seconds
        setTimeout(() => {
            if (statusEl.textContent === message) {
                statusEl.textContent = '';
                statusEl.className = 'login-status';
            }
        }, 5000);
    }
}

// Activity logging
async function logActivity(action, metadata = {}) {
    if (!isConnected || !userToken) return;
    
    try {
        await fetch('/api/activity/log', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${userToken}`
            },
            body: JSON.stringify({
                action,
                metadata: {
                    ...metadata,
                    timestamp: new Date().toISOString(),
                    userAgent: navigator.userAgent
                }
            })
        });
    } catch (error) {
        console.warn('Activity logging failed:', error);
    }
}

// Encryption Functions (Simplified AES-like implementation)
function performEncryption(message, code) {
    try {
        // Convert message to bytes
        const messageBytes = new TextEncoder().encode(message);
        
        // Generate key from code
        const key = generateKey(code);
        
        // Perform multi-layer encryption
        let encrypted = messageBytes;
        
        // Layer 1: XOR with generated key
        encrypted = xorEncrypt(encrypted, key);
        
        // Layer 2: Shuffle bytes based on code
        encrypted = shuffleBytes(encrypted, code);
        
        // Layer 3: Advanced XOR with position-dependent key
        encrypted = advancedXOR(encrypted, code);
        
        // Convert to base64
        const base64 = btoa(String.fromCharCode.apply(null, encrypted));
        
        // Add checksum for integrity
        const checksum = calculateChecksum(base64);
        
        return `SM_${checksum}_${base64}`;
        
    } catch (error) {
        throw new Error('Verschlüsselung fehlgeschlagen: ' + error.message);
    }
}

function performDecryption(encryptedText, code) {
    try {
        // Validate format
        if (!encryptedText.startsWith('SM_')) {
            throw new Error('Ungültiges Format');
        }
        
        // Extract parts
        const parts = encryptedText.split('_');
        if (parts.length !== 3) {
            throw new Error('Ungültiges Format');
        }
        
        const [, checksum, base64] = parts;
        
        // Verify checksum
        if (calculateChecksum(base64) !== checksum) {
            throw new Error('Daten beschädigt');
        }
        
        // Decode from base64
        const encrypted = new Uint8Array(
            atob(base64).split('').map(char => char.charCodeAt(0))
        );
        
        // Generate key from code
        const key = generateKey(code);
        
        // Reverse multi-layer encryption
        let decrypted = encrypted;
        
        // Reverse Layer 3: Advanced XOR
        decrypted = reverseAdvancedXOR(decrypted, code);
        
        // Reverse Layer 2: Unshuffle bytes
        decrypted = unshuffleBytes(decrypted, code);
        
        // Reverse Layer 1: XOR with generated key
        decrypted = xorDecrypt(decrypted, key);
        
        // Convert back to string
        return new TextDecoder().decode(decrypted);
        
    } catch (error) {
        throw new Error('Entschlüsselung fehlgeschlagen: ' + error.message);
    }
}

// Helper functions for encryption
function generateKey(code) {
    const key = new Uint8Array(32); // 256-bit key
    const codeNum = parseInt(code);
    
    for (let i = 0; i < 32; i++) {
        key[i] = ((codeNum * (i + 1) * 7) + (codeNum >> (i % 8))) % 256;
    }
    
    return key;
}

function xorEncrypt(data, key) {
    const result = new Uint8Array(data.length);
    for (let i = 0; i < data.length; i++) {
        result[i] = data[i] ^ key[i % key.length];
    }
    return result;
}

function xorDecrypt(data, key) {
    return xorEncrypt(data, key); // XOR is symmetric
}

function shuffleBytes(data, code) {
    const result = new Uint8Array(data);
    const codeNum = parseInt(code);
    
    for (let i = result.length - 1; i > 0; i--) {
        const j = ((i * codeNum * 73) + (i * 19)) % (i + 1);
        [result[i], result[j]] = [result[j], result[i]];
    }
    
    return result;
}

function unshuffleBytes(data, code) {
    const result = new Uint8Array(data);
    const codeNum = parseInt(code);
    
    for (let i = 1; i < result.length; i++) {
        const j = ((i * codeNum * 73) + (i * 19)) % (i + 1);
        [result[i], result[j]] = [result[j], result[i]];
    }
    
    return result;
}

function advancedXOR(data, code) {
    const result = new Uint8Array(data.length);
    const codeNum = parseInt(code);
    
    for (let i = 0; i < data.length; i++) {
        let value = data[i];
        value ^= (codeNum + i) % 256;
        value ^= (i * 13 + 7) % 256;
        result[i] = ((value * 17) + (codeNum * 23)) % 256;
    }
    
    return result;
}

function reverseAdvancedXOR(data, code) {
    const result = new Uint8Array(data.length);
    const codeNum = parseInt(code);
    
    for (let i = 0; i < data.length; i++) {
        let value = data[i];
        
        // Reverse multiplication (find modular inverse)
        for (let test = 0; test < 256; test++) {
            if (((test * 17) + (codeNum * 23)) % 256 === value) {
                value = test;
                break;
            }
        }
        
        value ^= (i * 13 + 7) % 256;
        value ^= (codeNum + i) % 256;
        result[i] = value;
    }
    
    return result;
}

function calculateChecksum(data) {
    let checksum = 0;
    for (let i = 0; i < data.length; i++) {
        checksum = ((checksum << 5) - checksum + data.charCodeAt(i)) & 0xFFFF;
    }
    return checksum.toString(16).padStart(4, '0').toUpperCase();
}

console.log('✅ Secret Messages App loaded successfully');
