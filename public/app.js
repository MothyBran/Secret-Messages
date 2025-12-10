// app.js - Frontend JavaScript für Secret Messages (Secure Edition)

import { encryptFull, decryptFull } from './cryptoLayers.js';

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
    startMatrixCanvas();
    
    // Event Listeners hinzufügen
    setupEventListeners();
    
    // --- HIER IST DIE ÄNDERUNG ---
    // Wir prüfen erst, ob der Nutzer vom Shop kommt (action=activate)
    const urlParams = new URLSearchParams(window.location.search);
    
    if (urlParams.get('action') === 'activate') {
        // Fall 1: Nutzer kommt vom Shop -> Direkt zur Aktivierungs-Seite
        console.log('🔄 Weiterleitung zur Aktivierung...');
        setTimeout(() => {
            showActivationSection(); 
        }, 100);
    } else {
        // Fall 2: Normaler Aufruf -> Prüfen ob eingeloggt
        requestAnimationFrame(() => {
            checkExistingSession();
        });
    }
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
        encryptBtn.addEventListener('click', () => {
            checkAccessAndRun(() => encryptMessage());
        });
    }
    
    const decryptBtn = document.getElementById('decryptBtn');
    if (decryptBtn) {
        decryptBtn.addEventListener('click', () => {
            checkAccessAndRun(() => decryptMessage());
        });
    }
    
    const copyBtn = document.getElementById('copyBtn');
    if (copyBtn) {
        copyBtn.addEventListener('click', copyToClipboard);
    }
    
    const deleteAccountBtn = document.getElementById('deleteAccountBtn');
    if (deleteAccountBtn) {
        deleteAccountBtn.addEventListener('click', confirmDeleteAccount);
    }

    const clearBtn = document.getElementById("clearFieldsBtn");
    if (clearBtn) {
        clearBtn.addEventListener("click", () => {
            document.getElementById("messageCode").value = "";
            document.getElementById("messageInput").value = "";
            document.getElementById("messageOutput").value = "";
            document.getElementById("outputGroup").style.display = "none";
        });
    }
    
    // Input Formatters
    setupInputFormatters();
    
    // Keyboard Shortcuts
    setupKeyboardShortcuts();
}

// ================================================================
// INPUT FORMATTERS & SHORTCUTS
// ================================================================

function setupInputFormatters() {
    // License Key Formatter
    const licenseKeyInput = document.getElementById('licenseKey');
    if (licenseKeyInput) {
        licenseKeyInput.addEventListener('input', function(e) {
            let value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
            let formatted = '';
            for (let i = 0; i < value.length && i < 15; i++) {
                if (i > 0 && i % 5 === 0) formatted += '-';
                formatted += value[i];
            }
            e.target.value = formatted;
        });
    }
    
    // Numbers Only
    ['accessCode', 'newAccessCode'].forEach(id => {
        const input = document.getElementById(id);
        if (input) {
            input.addEventListener('input', e => e.target.value = e.target.value.replace(/[^0-9]/g, ''));
        }
    });
    
    // Max Length for Code
    const messageCode = document.getElementById('messageCode');
    if (messageCode) {
        messageCode.addEventListener('input', e => e.target.value = e.target.value.substring(0, 5));
    }
}

function setupKeyboardShortcuts() {
    ('keydown', function(e) {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            const messageInput = document.getElementById('messageInput');
            if (messageInput && document.activeElement === messageInput) {
                checkAccessAndRun(() => encryptMessage());
            }
        }
    });
}

// ================================================================
// SECURE ENCRYPTION / DECRYPTION (UPDATED)
// ================================================================

// ENCRYPTION - Jetzt ASYNC für Web Crypto API
async function encryptMessage() {
    const code = document.getElementById('messageCode').value;
    const message = document.getElementById('messageInput').value;

    if (!code || code.length !== 5) {
        alert('Bitte geben Sie einen 5-stelligen Sicherheitscode ein.');
        return;
    }

    if (!message) {
        alert('Bitte geben Sie eine Nachricht ein.');
        return;
    }

    // UI Feedback: Loading
    const btn = document.getElementById('encryptBtn');
    const originalText = btn.innerText;
    btn.innerText = '⏳ Verschlüssle...';
    btn.disabled = true;

    try {
        logActivity('encrypt_message', { length: message.length });

        // WICHTIG: await verwenden!
        const encrypted = await encryptFull(message, code);

        document.getElementById('messageOutput').value = encrypted;
        document.getElementById('outputGroup').style.display = 'block';
    } catch (err) {
        console.error(err);
        alert('Fehler bei der Verschlüsselung. Bitte versuchen Sie es erneut.');
    } finally {
        btn.innerText = originalText;
        btn.disabled = false;
    }
}

// DECRYPTION - Jetzt ASYNC für Web Crypto API
async function decryptMessage() {
    const code = document.getElementById('messageCode').value;
    const encrypted = document.getElementById('messageInput').value;

    if (!code || code.length !== 5) {
        alert('Bitte geben Sie den korrekten 5-stelligen Sicherheitscode ein.');
        return;
    }

    if (!encrypted) {
        alert('Bitte geben Sie den verschlüsselten Text ein.');
        return;
    }

    // UI Feedback
    const btn = document.getElementById('decryptBtn');
    const originalText = btn.innerText;
    btn.innerText = '⏳ Entschlüssle...';
    btn.disabled = true;

    try {
        logActivity('decrypt_message', { length: encrypted.length });

        // WICHTIG: await verwenden!
        const decrypted = await decryptFull(encrypted, code);

        // Prüfen auf Fehler-String aus cryptoLayers (oder Fehler werfen lassen)
        if (decrypted.startsWith('[Fehler')) {
            alert('Entschlüsselung fehlgeschlagen.\n\nMögliche Gründe:\n1. Falscher Sicherheitscode (Code muss EXAKT stimmen).\n2. Text wurde beim Kopieren beschädigt.');
        } else {
            document.getElementById('messageOutput').value = decrypted;
            document.getElementById('outputGroup').style.display = 'block';
        }
    } catch (error) {
        console.error(error);
        alert('Fehler: Ungültige Daten oder falscher Code.');
    } finally {
        btn.innerText = originalText;
        btn.disabled = false;
    }
}

function copyToClipboard() {
    const output = document.getElementById('messageOutput');
    if (!output || !output.value) return;

    output.select();
    document.execCommand('copy'); // Fallback für ältere Browser
    
    // Modernere Clipboard API falls verfügbar
    if (navigator.clipboard && navigator.clipboard.writeText) {
         navigator.clipboard.writeText(output.value);
    }

    const copyBtn = document.getElementById('copyBtn');
    const originalText = copyBtn.textContent;
    copyBtn.textContent = '✓ KOPIERT!';
    
    logActivity('copy_to_clipboard');

    setTimeout(() => {
        copyBtn.textContent = originalText;
    }, 2000);
}


// ================================================================
// ACCESS CONTROL & LOGGING
// ================================================================

async function checkAccessAndRun(action) {
    const token = localStorage.getItem('secretMessages_token');
    if (!token) return performAutoLogout();

    try {
        const res = await fetch(`${API_BASE}/checkAccess`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        const result = await res.json();

        if (result.status === 'banned') {
            alert('Dein Account wurde gesperrt.');
            return performAutoLogout();
        }
        if (result.status === 'expired') {
            alert('Dein Lizenz-Zugang ist abgelaufen.');
            return performAutoLogout();
        }

        // Zugriff erlaubt -> Action ausführen
        action();

    } catch (err) {
        console.warn('Zugriffsprüfung fehlgeschlagen:', err);
        // Im Zweifel (Offline/Fehler) lassen wir es bei Client-Side Crypto oft zu, 
        // oder blockieren es. Hier: Warnung und weiter.
        // Für strikte Sicherheit: return;
        action(); 
    }
}

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
                metadata: { ...metadata, timestamp: new Date().toISOString() }
            })
        });
    } catch (e) { /* silent fail */ }
}

// ================================================================
// AUTHENTICATION (LOGIN / ACTIVATE / LOGOUT)
// ================================================================

async function handleLogin(event) {
    event.preventDefault();
    const usernameEl = document.getElementById('username');
    const codeEl = document.getElementById('accessCode');
    
    if (!usernameEl.value || !codeEl.value) {
        showStatus('loginStatus', 'Bitte alle Felder ausfüllen', 'error');
        return;
    }

    const loginBtn = document.getElementById('loginBtn');
    const btnText = document.getElementById('loginBtnText');
    loginBtn.disabled = true;
    btnText.innerHTML = '<span class="spinner"></span>';

    try {
        const res = await fetch(`${API_BASE}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: usernameEl.value.trim(), accessCode: codeEl.value.trim() })
        });

        const data = await res.json();
        
        if (data.success) {
            authToken = data.token;
            currentUser = data.username;
            localStorage.setItem('secretMessages_token', authToken);
            localStorage.setItem('secretMessages_user', currentUser);
            
            showStatus('loginStatus', 'Anmeldung erfolgreich!', 'success');
            
            setTimeout(() => {
                showMainSection();
                if (data.product_code === 'unl' || !data.expires_at) {
                    document.getElementById('licenseCountdown').textContent = 'LIZENZ: UNLIMITED';
                } else {
                    startLicenseCountdown(data.expires_at);
                }
            }, 1000);
        } else {
            showStatus('loginStatus', data.error || 'Fehler', 'error');
        }
    } catch (err) {
        showStatus('loginStatus', 'Verbindungsfehler', 'error');
    } finally {
        loginBtn.disabled = false;
        btnText.textContent = 'ANMELDEN';
    }
}

async function handleActivation(event) {
    event.preventDefault();
    const key = document.getElementById('licenseKey').value;
    const user = document.getElementById('newUsername').value;
    const code = document.getElementById('newAccessCode').value;

    const btn = document.getElementById('activateBtn');
    const btnText = document.getElementById('activateBtnText');
    btn.disabled = true;
    btnText.innerHTML = '<span class="spinner"></span>';

    try {
        const res = await fetch(`${API_BASE}/auth/activate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ licenseKey: key, username: user, accessCode: code })
        });
        const data = await res.json();

        if (data.success) {
            showStatus('activationStatus', 'Erfolg! Weiterleitung...', 'success');
            setTimeout(() => {
                showLoginSection();
                document.getElementById('username').value = user;
                document.getElementById('accessCode').value = code;
            }, 2000);
        } else {
            showStatus('activationStatus', data.error || 'Fehler', 'error');
        }
    } catch (e) {
        showStatus('activationStatus', 'Serverfehler', 'error');
    } finally {
        btn.disabled = false;
        btnText.textContent = 'ZUGANG ERSTELLEN';
    }
}

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
        } catch (e) {}
    }
    performAutoLogout();
}

async function performAutoLogout() {
    localStorage.removeItem('secretMessages_token');
    localStorage.removeItem('secretMessages_user');
    currentUser = null;
    authToken = null;
    
    // UI Reset
    document.getElementById("messageInput").value = "";
    document.getElementById("messageOutput").value = "";
    document.getElementById("outputGroup").style.display = "none";
    
    showLoginSection();
}

async function confirmDeleteAccount() {
    if (!confirm('WARNUNG: Account wirklich löschen? Dies kann nicht rückgängig gemacht werden.')) return;
    
    try {
        const res = await fetch(`${API_BASE}/auth/delete-account`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        const data = await res.json();
        if (data.success) {
            alert('Account gelöscht.');
            performAutoLogout();
        } else {
            alert(data.error);
        }
    } catch (e) {
        alert('Verbindungsfehler');
    }
}

// ================================================================
// SESSION & UI HELPERS
// ================================================================

async function checkExistingSession() {
    const token = localStorage.getItem('secretMessages_token');
    const user = localStorage.getItem('secretMessages_user');
    
    if (!token || !user) {
        showLoginSection();
        return;
    }

    try {
        const res = await fetch(`${API_BASE}/auth/validate`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}` 
            },
            body: JSON.stringify({ token }) // Fallback
        });
        const data = await res.json();

        if (data.valid) {
            authToken = token;
            currentUser = user;
            showMainSection();
            document.getElementById('userInfo').textContent = `User: ${currentUser}`;
            
            // Optional: Lizenzstatus nochmal holen, falls nötig
        } else {
            performAutoLogout();
        }
    } catch (e) {
        performAutoLogout();
    }
}

function startLicenseCountdown(expiresAtString) {
    const el = document.getElementById('licenseCountdown');
    if (!el || !expiresAtString) return;
    
    const end = new Date(expiresAtString).getTime();
    
    const timer = setInterval(() => {
        const diff = end - Date.now();
        if (diff <= 0) {
            clearInterval(timer);
            el.textContent = 'ABGELAUFEN';
            performAutoLogout();
            return;
        }
        
        const d = Math.floor(diff / (1000*60*60*24));
        const h = Math.floor((diff / (1000*60*60)) % 24);
        const m = Math.floor((diff / 1000 / 60) % 60);
        el.textContent = `LIZENZ: ${d}d ${h}h ${m}m`;
    }, 60000); // Update jede Minute reicht meistens, oder 1000 für Sekunden
    
    // Initial call
    const d = Math.floor((end - Date.now()) / (1000*60*60*24));
    el.textContent = `LIZENZ: ${d} Tage`;
}

// Navigation
function showSection(id) {
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    document.getElementById(id)?.classList.add('active');
}
function showLoginSection() { showSection('loginSection'); }
function showActivationSection() { showSection('activationSection'); }
function showMainSection() { 
    showSection('mainSection'); 
    document.getElementById('userInfo').textContent = `User: ${currentUser || 'Gast'}`;
}

function showStatus(id, msg, type) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = msg;
    el.className = `status ${type} show`;
    el.style.display = 'block';
    if (type === 'error') setTimeout(() => el.style.display = 'none', 5000);
}

// ================================================================
// MATRIX RAIN (Optimized)
// ================================================================
function startMatrixCanvas() {
    const cvs = document.getElementById('matrixCanvas');
    if (!cvs) return;
    const ctx = cvs.getContext('2d', { alpha: true });
    
    const isMobile = /Mobi|Android/i.test(navigator.userAgent);
    const FONT = isMobile ? 16 : 20;
    
    let cols = [];
    let w, h;
    
    function resize() {
        w = window.innerWidth;
        h = window.innerHeight; // Nutze innerHeight für fixierten Background
        cvs.width = w;
        cvs.height = h;
        
        const count = Math.floor(w / FONT);
        cols = new Array(count).fill(0).map(() => Math.random() * -h);
    }
    
    function draw() {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.05)';
        ctx.fillRect(0, 0, w, h);
        
        ctx.fillStyle = '#0F0';
        ctx.font = `${FONT}px monospace`;
        
        cols.forEach((y, i) => {
            const char = String.fromCharCode(0x30A0 + Math.random() * 96);
            const x = i * FONT;
            ctx.fillText(char, x, y);
            
            if (y > h + Math.random() * 10000) {
                cols[i] = 0;
            } else {
                cols[i] = y + FONT;
            }
        });
        requestAnimationFrame(draw);
    }
    
    window.addEventListener('resize', resize);
    resize();
    draw();
}
