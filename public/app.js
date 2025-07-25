// ================================================================
// SECRET MESSAGES - KORRIGIERTE APP.JS MIT AUTO-LOGIN
// Funktioniert mit der korrigierten HTML-Struktur
// ================================================================

// Globale Variablen
if (typeof userToken === 'undefined') {
    var userToken = null;
}
if (typeof isAuthenticated === 'undefined') {
    var isAuthenticated = false;
}

console.log('🚀 Secret Messages App starting...');

// ================================================================
// TOKEN MANAGEMENT
// ================================================================

function storeToken(token) {
    console.log('💾 Storing token...');
    
    try {
        document.cookie = "sm_token=" + token + "; max-age=2592000; path=/";
        console.log('✅ Token stored in cookie');
    } catch (error) {
        console.error('❌ Cookie storage failed:', error);
    }
    
    try {
        localStorage.setItem('sm_token', token);
        console.log('✅ Token stored in localStorage');
    } catch (error) {
        console.warn('⚠️ localStorage not available');
    }
}

function getStoredToken() {
    console.log('🔍 Retrieving token...');
    
    try {
        var token = localStorage.getItem('sm_token');
        if (token) {
            console.log('✅ Token found in localStorage');
            return token;
        }
    } catch (error) {
        console.warn('⚠️ localStorage access failed');
    }
    
    try {
        var cookies = document.cookie.split(';');
        for (var i = 0; i < cookies.length; i++) {
            var cookie = cookies[i].trim();
            if (cookie.indexOf('sm_token=') === 0) {
                var tokenValue = cookie.substring(9);
                console.log('✅ Token found in cookie');
                return tokenValue;
            }
        }
    } catch (error) {
        console.error('❌ Cookie access failed:', error);
    }
    
    console.log('❌ No token found');
    return null;
}

function removeStoredToken() {
    console.log('🗑️ Removing token...');
    
    try {
        localStorage.removeItem('sm_token');
    } catch (error) {
        console.warn('localStorage removal failed');
    }
    
    try {
        document.cookie = "sm_token=; max-age=0; path=/";
    } catch (error) {
        console.warn('Cookie removal failed');
    }
    
    userToken = null;
    isAuthenticated = false;
    console.log('✅ Token removed');
}

// ================================================================
// TOKEN VALIDATION
// ================================================================

async function validateToken(token) {
    console.log('🔍 Validating token...');
    
    try {
        var response = await fetch('/api/auth/validate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: token })
        });
        
        if (!response.ok) {
            console.error('❌ Server error:', response.status);
            return false;
        }
        
        var result = await response.json();
        
        if (result.success && result.valid) {
            console.log('✅ Token validation successful');
            return true;
        } else {
            console.log('❌ Token invalid:', result.error);
            return false;
        }
        
    } catch (error) {
        console.error('❌ Validation failed:', error);
        return false;
    }
}

// ================================================================
// UI MANAGEMENT
// ================================================================

function showLoadingScreen() {
    var loadingScreen = document.getElementById('loadingScreen');
    if (loadingScreen) {
        loadingScreen.style.display = 'flex';
    }
}

function hideLoadingScreen() {
    var loadingScreen = document.getElementById('loadingScreen');
    if (loadingScreen) {
        loadingScreen.style.display = 'none';
    }
}

function showLicenseKeyScreen() {
    console.log('📝 Showing license key screen');
    
    hideAllSections();
    
    var licenseSection = document.getElementById('licenseSection');
    if (licenseSection) {
        licenseSection.style.display = 'block';
    }
    
    var logoutBtn = document.querySelector('.logout-btn');
    if (logoutBtn) {
        logoutBtn.style.display = 'none';
    }
    
    document.title = 'Secret Messages - Authentication Required';
}

function showMainApplication() {
    console.log('🎉 Showing main application');
    
    hideAllSections();
    
    var encryptionSection = document.getElementById('encryptionSection');
    if (encryptionSection) {
        encryptionSection.style.display = 'block';
    }
    
    var logoutBtn = document.querySelector('.logout-btn');
    if (logoutBtn) {
        logoutBtn.style.display = 'block';
    }
    
    document.title = 'Secret Messages - Encryption Tool';
}

function hideAllSections() {
    var sections = ['licenseSection', 'encryptionSection'];
    for (var i = 0; i < sections.length; i++) {
        var section = document.getElementById(sections[i]);
        if (section) {
            section.style.display = 'none';
        }
    }
}

// ================================================================
// AUTO-LOGIN SYSTEM
// ================================================================

async function initializeAutoLogin() {
    console.log('🔍 Starting auto-login process...');
    
    try {
        showLoadingScreen();
        
        var savedToken = getStoredToken();
        
        if (!savedToken) {
            console.log('📝 No token found, showing login screen');
            hideLoadingScreen();
            showLicenseKeyScreen();
            return;
        }
        
        console.log('🔑 Token found, validating...');
        var isValid = await validateToken(savedToken);
        
        if (isValid) {
            console.log('✅ Auto-login successful');
            userToken = savedToken;
            isAuthenticated = true;
            hideLoadingScreen();
            showMainApplication();
        } else {
            console.log('❌ Token invalid, showing login screen');
            removeStoredToken();
            hideLoadingScreen();
            showLicenseKeyScreen();
        }
        
    } catch (error) {
        console.error('❌ Auto-login failed:', error);
        hideLoadingScreen();
        showLicenseKeyScreen();
    }
}

// ================================================================
// LICENSE KEY ACTIVATION
// ================================================================

async function activateLicenseKey() {
    var licenseInput = document.getElementById('authLicenseKey'); // Korrigierte ID
    var activateBtn = document.getElementById('authActivateBtn'); // Korrigierte ID
    
    if (!licenseInput || !activateBtn) {
        console.error('❌ License elements not found');
        return;
    }
    
    var licenseKey = licenseInput.value.trim();
    if (!licenseKey) {
        showError('Bitte geben Sie einen License Key ein');
        return;
    }
    
    var originalText = activateBtn.textContent;
    activateBtn.textContent = 'AUTHENTIFIZIERE...';
    activateBtn.disabled = true;
    
    try {
        console.log('🔑 Activating license key:', licenseKey);
        
        var response = await fetch('/api/auth/activate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ licenseKey: licenseKey })
        });
        
        var result = await response.json();
        
        if (result.success) {
            console.log('✅ License activated successfully');
            
            userToken = result.token;
            isAuthenticated = true;
            
            storeToken(result.token);
            
            showSuccess('✅ Authentifizierung erfolgreich! Weiterleitung...');
            
            setTimeout(function() {
                showMainApplication();
            }, 1500);
            
        } else {
            console.error('❌ License activation failed:', result.error);
            showError('❌ ' + result.error);
        }
        
    } catch (error) {
        console.error('❌ Activation request failed:', error);
        showError('Verbindungsfehler: ' + error.message);
    } finally {
        activateBtn.textContent = originalText;
        activateBtn.disabled = false;
    }
}

// ================================================================
// ENCRYPTION/DECRYPTION FUNCTIONS
// ================================================================

// AES Encryption using Web Crypto API
async function encryptMessage() {
    var messageInput = document.getElementById('encryptMessageInput');
    var codeInput = document.getElementById('encryptCodeInput');
    var output = document.getElementById('encryptedOutput');
    
    if (!messageInput || !codeInput || !output) {
        showError('Eingabefelder nicht gefunden');
        return;
    }
    
    var message = messageInput.value.trim();
    var code = codeInput.value.trim();
    
    if (!message) {
        showError('Bitte geben Sie eine Nachricht ein');
        return;
    }
    
    if (!code || code.length !== 5 || !/^\d{5}$/.test(code)) {
        showError('Bitte geben Sie einen 5-stelligen numerischen Code ein');
        return;
    }
    
    try {
        // Create a key from the 5-digit code
        var keyMaterial = await crypto.subtle.importKey(
            'raw',
            new TextEncoder().encode(code.padEnd(32, '0')),
            { name: 'AES-GCM' },
            false,
            ['encrypt']
        );
        
        // Generate a random IV
        var iv = crypto.getRandomValues(new Uint8Array(12));
        
        // Encrypt the message
        var encryptedBuffer = await crypto.subtle.encrypt(
            { name: 'AES-GCM', iv: iv },
            keyMaterial,
            new TextEncoder().encode(message)
        );
        
        // Combine IV and encrypted data
        var combined = new Uint8Array(iv.length + encryptedBuffer.byteLength);
        combined.set(iv);
        combined.set(new Uint8Array(encryptedBuffer), iv.length);
        
        // Convert to base64
        var encrypted = btoa(String.fromCharCode.apply(null, combined));
        
        output.value = encrypted;
        showSuccess('✅ Nachricht erfolgreich verschlüsselt');
        
        // Log activity
        logActivity('encrypt_message', {
            messageLength: message.length,
            codeLength: code.length
        });
        
    } catch (error) {
        console.error('Encryption error:', error);
        showError('❌ Verschlüsselung fehlgeschlagen');
    }
}

async function decryptMessage() {
    var messageInput = document.getElementById('decryptMessageInput');
    var codeInput = document.getElementById('decryptCodeInput');
    var output = document.getElementById('decryptedOutput');
    
    if (!messageInput || !codeInput || !output) {
        showError('Eingabefelder nicht gefunden');
        return;
    }
    
    var encryptedMessage = messageInput.value.trim();
    var code = codeInput.value.trim();
    
    if (!encryptedMessage) {
        showError('Bitte geben Sie eine verschlüsselte Nachricht ein');
        return;
    }
    
    if (!code || code.length !== 5 || !/^\d{5}$/.test(code)) {
        showError('Bitte geben Sie einen 5-stelligen numerischen Code ein');
        return;
    }
    
    try {
        // Decode from base64
        var combined = new Uint8Array(atob(encryptedMessage).split('').map(function(char) {
            return char.charCodeAt(0);
        }));
        
        // Extract IV and encrypted data
        var iv = combined.slice(0, 12);
        var encryptedData = combined.slice(12);
        
        // Create key from code
        var keyMaterial = await crypto.subtle.importKey(
            'raw',
            new TextEncoder().encode(code.padEnd(32, '0')),
            { name: 'AES-GCM' },
            false,
            ['decrypt']
        );
        
        // Decrypt
        var decryptedBuffer = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: iv },
            keyMaterial,
            encryptedData
        );
        
        // Convert back to text
        var decrypted = new TextDecoder().decode(decryptedBuffer);
        
        output.value = decrypted;
        showSuccess('✅ Nachricht erfolgreich entschlüsselt');
        
        // Log activity
        logActivity('decrypt_message', {
            messageLength: decrypted.length,
            codeLength: code.length
        });
        
    } catch (error) {
        console.error('Decryption error:', error);
        showError('❌ Entschlüsselung fehlgeschlagen - falscher Code oder beschädigte Nachricht');
    }
}

// ================================================================
// UTILITY FUNCTIONS
// ================================================================

function clearEncryption() {
    document.getElementById('encryptMessageInput').value = '';
    document.getElementById('encryptCodeInput').value = '';
    document.getElementById('encryptedOutput').value = '';
    showInfo('🗑️ Verschlüsselungs-Felder geleert');
}

function clearDecryption() {
    document.getElementById('decryptMessageInput').value = '';
    document.getElementById('decryptCodeInput').value = '';
    document.getElementById('decryptedOutput').value = '';
    showInfo('🗑️ Entschlüsselungs-Felder geleert');
}

async function copyToClipboard(elementId) {
    var element = document.getElementById(elementId);
    if (!element || !element.value) {
        showError('Nichts zum Kopieren vorhanden');
        return;
    }
    
    try {
        await navigator.clipboard.writeText(element.value);
        showSuccess('📋 In Zwischenablage kopiert');
        
        logActivity('copy_to_clipboard', {
            elementId: elementId,
            textLength: element.value.length
        });
    } catch (error) {
        // Fallback for older browsers
        element.select();
        document.execCommand('copy');
        showSuccess('📋 In Zwischenablage kopiert');
    }
}

function showDemoKey() {
    var licenseInput = document.getElementById('authLicenseKey');
    if (licenseInput) {
        var demoKeys = [
            '7CE4A-71263-380DC',
            '7F2DC-9EF07-E6584',
            '54EA3-98607-DF13A'
        ];
        var randomKey = demoKeys[Math.floor(Math.random() * demoKeys.length)];
        licenseInput.value = randomKey;
        
        showInfo('ℹ️ Demo Key eingefügt. Klicken Sie "ZUGANG AKTIVIEREN" zum Testen.');
    }
}

function logout() {
    if (confirm('Möchten Sie sich wirklich abmelden?')) {
        console.log('👋 Logging out...');
        
        removeStoredToken();
        showLicenseKeyScreen();
        
        // Clear all input fields
        var fields = [
            'authLicenseKey', 'encryptMessageInput', 'encryptCodeInput', 
            'encryptedOutput', 'decryptMessageInput', 'decryptCodeInput', 'decryptedOutput'
        ];
        
        for (var i = 0; i < fields.length; i++) {
            var field = document.getElementById(fields[i]);
            if (field) {
                field.value = '';
            }
        }
        
        showSuccess('✅ Erfolgreich abgemeldet');
        console.log('✅ Logout completed');
    }
}

// ================================================================
// STATUS MESSAGES
// ================================================================

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
    var container = document.getElementById('statusMessages');
    if (!container) {
        console.log('[' + type.toUpperCase() + '] ' + message);
        return;
    }
    
    var messageDiv = document.createElement('div');
    messageDiv.className = 'status-message status-' + type;
    messageDiv.textContent = message;
    
    container.appendChild(messageDiv);
    
    // Auto-remove after 5 seconds
    setTimeout(function() {
        if (messageDiv.parentNode) {
            messageDiv.parentNode.removeChild(messageDiv);
        }
    }, 5000);
}

// ================================================================
// ACTIVITY LOGGING
// ================================================================

async function logActivity(action, metadata) {
    if (!userToken || !isAuthenticated) {
        return;
    }
    
    try {
        await fetch('/api/activity/log', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + userToken
            },
            body: JSON.stringify({
                action: action,
                metadata: metadata
            })
        });
    } catch (error) {
        console.warn('Activity logging failed:', error);
    }
}

// ================================================================
// INITIALIZATION
// ================================================================

document.addEventListener('DOMContentLoaded', function() {
    console.log('📄 DOM loaded, starting auto-login...');
    initializeAutoLogin();
});

if (document.readyState !== 'loading') {
    console.log('📄 DOM already loaded, starting auto-login immediately...');
    initializeAutoLogin();
}

console.log('🚀 Secret Messages app loaded successfully');
