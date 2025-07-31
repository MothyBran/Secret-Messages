// app.js - Frontend JavaScript für Secret Messages mit Benutzer-Login

import { encryptFull, decryptFull, base64Encode, base64Decode } from './cryptoLayers.js';

// Configuration
const API_BASE = '/api';
let currentUser = null;
let authToken = null;

// ================================================================
// INITIALIZATION
// ================================================================

document.addEventListener('DOMContentLoaded', function() {
    console.log('🚀 Secret Messages App initialisiert');
    
    // Matrix Rain Effect
    createMatrixRain();
    
    // Event Listeners hinzufügen
    setupEventListeners();
    
    // Check for existing session
    checkExistingSession();
});

// ================================================================
// EVENT LISTENERS SETUP
// ================================================================

function setupEventListeners() {
    // Login Form
    const loginForm = document.getElementById('loginForm');
    if (loginForm) {
        loginForm.addEventListener('submit', handleLogin);
    }
    
    // Activation Form
    const activationForm = document.getElementById('activationForm');
    if (activationForm) {
        activationForm.addEventListener('submit', handleActivation);
    }
    
    // Navigation Links
    const showActivationLink = document.getElementById('showActivationLink');
    if (showActivationLink) {
        showActivationLink.addEventListener('click', function(e) {
            e.preventDefault();
            showActivationSection();
        });
    }
    
    const showLoginLink = document.getElementById('showLoginLink');
    if (showLoginLink) {
        showLoginLink.addEventListener('click', function(e) {
            e.preventDefault();
            showLoginSection();
        });
    }
    
    // Main App Buttons
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', handleLogout);
    }
    
    const encryptBtn = document.getElementById('encryptBtn');
    if (encryptBtn) {
        encryptBtn.addEventListener('click', encryptMessage);
    }
    
    const decryptBtn = document.getElementById('decryptBtn');
    if (decryptBtn) {
        decryptBtn.addEventListener('click', decryptMessage);
    }
    
    const copyBtn = document.getElementById('copyBtn');
    if (copyBtn) {
        copyBtn.addEventListener('click', copyToClipboard);
    }
    
    const deleteAccountBtn = document.getElementById('deleteAccountBtn');
    if (deleteAccountBtn) {
        deleteAccountBtn.addEventListener('click', confirmDeleteAccount);
    }
    
    // Input Formatters
    setupInputFormatters();
    
    // Keyboard Shortcuts
    setupKeyboardShortcuts();
}

// ================================================================
// INPUT FORMATTERS
// ================================================================

function setupInputFormatters() {
    // License Key Formatter
    const licenseKeyInput = document.getElementById('licenseKey');
    if (licenseKeyInput) {
        licenseKeyInput.addEventListener('input', function(e) {
            let value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
            let formatted = '';
            
            for (let i = 0; i < value.length && i < 15; i++) {
                if (i > 0 && i % 5 === 0) {
                    formatted += '-';
                }
                formatted += value[i];
            }
            
            e.target.value = formatted;
        });
    }
    
    // Access Code Formatters (nur Zahlen)
    const accessCodeInputs = ['accessCode', 'newAccessCode'];
    accessCodeInputs.forEach(id => {
        const input = document.getElementById(id);
        if (input) {
            input.addEventListener('input', function(e) {
                e.target.value = e.target.value.replace(/[^0-9]/g, '');
            });
        }
    });
    
    // Message Code Formatter
    const messageCode = document.getElementById('messageCode');
    if (messageCode) {
        messageCode.addEventListener('input', function(e) {
            e.target.value = e.target.value.substring(0, 5);
        });
    }
}

// ================================================================
// KEYBOARD SHORTCUTS
// ================================================================

function setupKeyboardShortcuts() {
    document.addEventListener('keydown', function(e) {
        // Ctrl/Cmd + Enter in message input
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            const messageInput = document.getElementById('messageInput');
            if (messageInput && document.activeElement === messageInput) {
                encryptMessage();
            }
        }
        
        // Enter in login/activation forms
        if (e.key === 'Enter') {
            if (document.activeElement.id === 'accessCode') {
                const loginBtn = document.getElementById('loginBtn');
                if (loginBtn && !loginBtn.disabled) {
                    loginBtn.click();
                }
            }
        }
    });
}

// ================================================================
// MATRIX RAIN EFFECT
// ================================================================

function createMatrixRain() {
    const matrixBg = document.getElementById('matrixBg');
    if (!matrixBg) return;
    
    const columns = Math.floor(window.innerWidth / 20);
    
    for (let i = 0; i < columns; i++) {
        const column = document.createElement('div');
        column.className = 'matrix-column';
        column.style.left = i * 20 + 'px';
        column.style.animationDuration = Math.random() * 15 + 10 + 's';
        column.style.animationDelay = Math.random() * 5 + 's';
        
        // Random binary characters
        let text = '';
        for (let j = 0; j < 100; j++) {
            text += Math.random() > 0.5 ? '0' : '1';
        }
        column.textContent = text;
        
        matrixBg.appendChild(column);
    }
}

// ================================================================
// SECTION NAVIGATION
// ================================================================

function showSection(sectionId) {
    document.querySelectorAll('.section').forEach(section => {
        section.classList.remove('active');
    });
    
    const targetSection = document.getElementById(sectionId);
    if (targetSection) {
        targetSection.classList.add('active');
    }
}

function showLoginSection() {
    showSection('loginSection');
    document.getElementById('username').focus();
}

function showActivationSection() {
    showSection('activationSection');
    document.getElementById('licenseKey').focus();
}

function showMainSection() {
    showSection('mainSection');
    if (currentUser) {
        document.getElementById('userInfo').textContent = `Benutzer: ${currentUser}`;
    }
}

// ================================================================
// STATUS MESSAGES
// ================================================================

function showStatus(statusId, message, type) {
    const status = document.getElementById(statusId);
    if (!status) return;
    
    status.textContent = message;
    status.className = `status ${type} show`;
    
    if (type === 'error') {
        setTimeout(() => {
            status.classList.remove('show');
        }, 5000);
    }
}

// ================================================================
// LOGIN HANDLER
// ================================================================

async function handleLogin(event) {
    event.preventDefault();
    
    const username = document.getElementById('username').value;
    const accessCode = document.getElementById('accessCode').value;
    const loginBtn = document.getElementById('loginBtn');
    const loginBtnText = document.getElementById('loginBtnText');
    
    // Validation
    if (!username || !accessCode) {
        showStatus('loginStatus', 'Bitte alle Felder ausfüllen', 'error');
        return;
    }
    
    if (!/^\d{5}$/.test(accessCode)) {
        showStatus('loginStatus', 'Zugangscode muss 5 Ziffern enthalten', 'error');
        return;
    }
    
    // Disable button
    loginBtn.disabled = true;
    loginBtnText.innerHTML = '<span class="spinner"></span>Anmeldung läuft...';
    
    try {
        const response = await fetch(`${API_BASE}/auth/login`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ username, accessCode })
        });
        
        const data = await response.json();
        
        if (data.success) {
            currentUser = username;
            authToken = data.token;
            
            // Save to localStorage
            localStorage.setItem('secretMessages_token', authToken);
            localStorage.setItem('secretMessages_user', username);
            
            showStatus('loginStatus', 'Anmeldung erfolgreich!', 'success');
            
            // Log activity
            logActivity('login_success', { username });
            
            setTimeout(() => {
                showMainSection();
            }, 1500);
        } else {
            showStatus('loginStatus', data.error || 'Anmeldung fehlgeschlagen', 'error');
        }
    } catch (error) {
        console.error('Login error:', error);
        showStatus('loginStatus', 'Verbindungsfehler zum Server', 'error');
    } finally {
        loginBtn.disabled = false;
        loginBtnText.textContent = 'ANMELDEN';
    }
}

// ================================================================
// ACTIVATION HANDLER
// ================================================================

async function handleActivation(event) {
    event.preventDefault();
    
    const licenseKey = document.getElementById('licenseKey').value;
    const newUsername = document.getElementById('newUsername').value;
    const newAccessCode = document.getElementById('newAccessCode').value;
    const activateBtn = document.getElementById('activateBtn');
    const activateBtnText = document.getElementById('activateBtnText');
    
    // Validation
    if (!/^[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}$/.test(licenseKey)) {
        showStatus('activationStatus', 'Ungültiges License-Key Format', 'error');
        return;
    }
    
    if (!/^[a-zA-Z0-9_-]+$/.test(newUsername) || newUsername.length < 3) {
        showStatus('activationStatus', 'Gewünschter Benutzername muss mindestens 3 Zeichen lang sein (nur Buchstaben, Zahlen, _, -)', 'error');
        return;
    }
    
    if (!/^\d{5}$/.test(newAccessCode)) {
        showStatus('activationStatus', 'Zugangscode muss 5 Ziffern enthalten', 'error');
        return;
    }
    
    // Disable button
    activateBtn.disabled = true;
    activateBtnText.innerHTML = '<span class="spinner"></span>Aktivierung läuft...';
    
    try {
        const response = await fetch(`${API_BASE}/auth/activate`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ 
                licenseKey, 
                username: newUsername, 
                accessCode: newAccessCode 
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            showStatus('activationStatus', 'Zugang erfolgreich erstellt! Sie werden zum Login weitergeleitet...', 'success');
            
            // Auto-fill login form
            setTimeout(() => {
                showLoginSection();
                document.getElementById('username').value = newUsername;
                document.getElementById('accessCode').value = newAccessCode;
                document.getElementById('username').focus();
            }, 3000);
        } else {
            showStatus('activationStatus', data.error || 'Aktivierung fehlgeschlagen', 'error');
        }
    } catch (error) {
        console.error('Activation error:', error);
        showStatus('activationStatus', 'Verbindungsfehler zum Server', 'error');
    } finally {
        activateBtn.disabled = false;
        activateBtnText.textContent = 'ZUGANG ERSTELLEN';
    }
}

// ================================================================
// LOGOUT HANDLER
// ================================================================

async function handleLogout() {
    if (authToken) {
        try {
            await fetch(`${API_BASE}/auth/logout`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${authToken}`
                }
            });
            
            logActivity('logout', { username: currentUser });
        } catch (error) {
            console.error('Logout error:', error);
        }
    }
    
    // Clear local data
    currentUser = null;
    authToken = null;
    localStorage.removeItem('secretMessages_token');
    localStorage.removeItem('secretMessages_user');
    
    // Clear form data
    document.getElementById('username').value = '';
    document.getElementById('accessCode').value = '';
    document.getElementById('messageInput').value = '';
    document.getElementById('messageOutput').value = '';
    document.getElementById('outputGroup').style.display = 'none';
    
    showLoginSection();
}

// ================================================================
// DELETE ACCOUNT HANDLER
// ================================================================

async function confirmDeleteAccount() {
    if (!confirm('WARNUNG: Diese Aktion ist unwiderruflich!\n\nMöchten Sie Ihren Zugang wirklich löschen?\n\nIhr Gewünschter Benutzername und License-Key werden permanent gelöscht.')) {
        return;
    }
    
    if (!confirm('Letzte Bestätigung:\n\nSind Sie ABSOLUT SICHER?')) {
        return;
    }
    
    try {
        const response = await fetch(`${API_BASE}/auth/delete-account`, {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            }
        });
        
        const data = await response.json();
        
        if (data.success) {
            alert('Ihr Zugang wurde erfolgreich gelöscht.');
            handleLogout();
        } else {
            alert('Fehler beim Löschen des Zugangs: ' + (data.error || 'Unbekannter Fehler'));
        }
    } catch (error) {
        console.error('Delete account error:', error);
        alert('Verbindungsfehler zum Server');
    }
}

// ================================================================
// ENCRYPTION/DECRYPTION (Simplified Demo)
// ================================================================

// ENCRYPTION (mit echter Verschlüsselung)
function encryptMessage() {
    const code = document.getElementById('messageCode').value;
    const message = document.getElementById('messageInput').value;

    if (!code || code.length !== 5) {
        alert('Bitte geben Sie einen 5-stelligen Sicherheitscode ein');
        return;
    }

    if (!message) {
        alert('Bitte geben Sie eine Nachricht ein');
        return;
    }

    // Log activity
    logActivity('encrypt_message', {
        messageLength: message.length,
        codeLength: code.length
    });

    // ✅ ECHTE Verschlüsselung
    const encrypted = encryptFull(message, code);

    document.getElementById('messageOutput').value = encrypted;
    document.getElementById('outputGroup').style.display = 'block';
}

// DECRYPTION (mit echter Entschlüsselung)
function decryptMessage() {
    const code = document.getElementById('messageCode').value;
    const encrypted = document.getElementById('messageInput').value;

    if (!code || code.length !== 5) {
        alert('Bitte geben Sie einen 5-stelligen Sicherheitscode ein');
        return;
    }

    if (!encrypted) {
        alert('Bitte geben Sie den verschlüsselten Text ein');
        return;
    }

    // Log activity
    logActivity('decrypt_message', {
        encryptedLength: encrypted.length,
        codeLength: code.length
    });

    try {
        const decrypted = decryptFull(encrypted, code);
        document.getElementById('messageOutput').value = decrypted;
        document.getElementById('outputGroup').style.display = 'block';
    } catch (error) {
        alert('Fehler beim Entschlüsseln');
    }
}

function copyToClipboard() {
    const output = document.getElementById('messageOutput');
    if (!output || !output.value) return;

    output.select();
    document.execCommand('copy');

    // Visual feedback
    const copyBtn = document.getElementById('copyBtn');
    const originalText = copyBtn.textContent;
    copyBtn.textContent = '✓ KOPIERT!';

    setTimeout(() => {
        copyBtn.textContent = originalText;
    }, 2000);

    // Log activity
    logActivity('copy_to_clipboard', { contentLength: output.value.length });
}

// ================================================================
// SESSION MANAGEMENT
// ================================================================

async function checkExistingSession() {
    const savedToken = localStorage.getItem('secretMessages_token');
    const savedUser = localStorage.getItem('secretMessages_user');
    
    if (!savedToken || !savedUser) {
        showLoginSection();
        return;
    }
    
    // Show loading state
    showStatus('loginStatus', 'Session wird überprüft...', 'loading');
    
    try {
        const response = await fetch(`${API_BASE}/auth/validate`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${savedToken}`
            }
        });
        
        const data = await response.json();
        
        if (data.valid) {
            currentUser = savedUser;
            authToken = savedToken;
            showMainSection();
            
            // Log activity
            logActivity('session_restored', { username: currentUser });
        } else {
            // Invalid session, clear and show login
            handleLogout();
        }
    } catch (error) {
        console.error('Session validation error:', error);
        handleLogout();
    }
}

// ================================================================
// ACTIVITY LOGGING
// ================================================================

async function logActivity(action, metadata = {}) {
    if (!authToken) return;
    
    try {
        await fetch(`${API_BASE}/activity/log`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({
                action,
                metadata: {
                    ...metadata,
                    timestamp: new Date().toISOString()
                }
            })
        });
    } catch (error) {
        console.error('Activity logging error:', error);
    }
}

// ================================================================
// DEMO FUNCTIONS
// ================================================================

function showDemoKeys() {
    alert('🔐 DEMO LIZENZ-KEYS ZUM TESTEN:\n\n' +
          '• SM001-ALPHA-BETA1\n' +
          '• SM002-GAMMA-DELT2\n' +
          '• SM003-ECHO-FOXTR3\n' +
          '• SM004-HOTEL-INDI4\n' +
          '• SM005-JULIET-KILO5\n\n' +
          '📝 Erstellen Sie einen Gewünschter Benutzernamen\n' +
          '🔢 Wählen Sie einen 5-stelligen Code\n\n' +
          '🔧 Admin Panel: /admin');
}

// Global function for demo link
window.showDemoKeys = showDemoKeys;

document.getElementById("clearFieldsBtn")?.addEventListener("click", () => {
    document.getElementById("messageCode").value = "";
    document.getElementById("messageInput").value = "";
    document.getElementById("messageOutput").value = "";
});
