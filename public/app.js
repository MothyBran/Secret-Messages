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
    console.log('[MatrixRain] DOM ready. matrixBg =', document.getElementById('matrixBg'));
    
    // Matrix Rain Effect
    startMatrixCanvas();
    
    // Event Listeners hinzufügen
    setupEventListeners();
    
    // Check for existing session
    requestAnimationFrame(() => {
        checkExistingSession();
    });
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
            if (document.activeElement.id === 'Code') {
                const loginBtn = document.getElementById('loginBtn');
                if (loginBtn && !loginBtn.disabled) {
                    loginBtn.click();
                }
            }
        }
    });
}

// ================================================================
// MATRIX RAIN EFFECT (Canvas) – flüssig & mobil-optimiert
// ================================================================
function startMatrixCanvas() {
  const cvs = document.getElementById('matrixCanvas');
  if (!cvs) return;
  const ctx = cvs.getContext('2d', { alpha: true });

  // Device Pixel Ratio sanft begrenzen (Akkuschonung auf Mobilgeräten)
  const DPR = Math.max(1, Math.min(window.devicePixelRatio || 1, 2));
  const isMobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);

  // Zeichensatz (Griechisch + Kyrillisch + Latein A–Z + Ziffern)
  const GUP='ΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩ', GLO='αβγδεζηθικλμνξοπρστυφχψω';
  const CUP='АБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ', CLO='абвгдежзийклмнопрстуфхцчшщьыъэюя';
  const LUP='ABCDEFGHIJKLMNOPQRSTUVWXYZ', DIG='0123456789';
  const CH = (GUP+CUP+LUP+DIG).split('');
  const pick = () => CH[(Math.random()*CH.length)|0];

  // Parameter (mobil freundlich)
  const FONT  = isMobile ? 18 : 22;         // px
  const GAP   = isMobile ? 18 : 16;         // Spaltenabstand
  const MAXC  = isMobile ? 40 : 90;        // Max. Spaltenanzahl
  const VMIN  = 50;                         // min px/s
  const VMAX  = 130;                        // max px/s
  const MUT_MIN = isMobile ? 0.14 : 0.12;   // s – Mutationsintervall
  const MUT_MAX = isMobile ? 0.32 : 0.26;   // s
  const FLIMMER = isMobile ? 0.07 : 0.14;   // zusätzliche Mutationschance

  let cols = [];
  let running = false;
  let last = 0;

  function resize() {
      const w = window.innerWidth;
      const h = Math.max(
        document.documentElement.scrollHeight,
        document.body.scrollHeight,
        window.innerHeight
      );

      const scaledW = Math.min(Math.floor(w * DPR), 1920);
      const scaledH = Math.min(Math.floor(h * DPR), 3000); // du kannst hier auch höher gehen
    
      cvs.width  = scaledW;
      cvs.height = scaledH;
      cvs.style.width  = w + 'px';
      cvs.style.height = h + 'px';
    
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

    // Spalten neu initialisieren
    const count = Math.min(MAXC, Math.max(1, Math.floor(w / GAP)));
    const rows  = Math.ceil(h / FONT) + 2;
    const totalHeight = rows * FONT;
    
    cols = new Array(count).fill(0).map((_, i) => ({
      x: i * GAP + (Math.random()*2 - 1),              // leichter jitter
      // Start Y: immer oberhalb des sichtbaren Bereichs
      // zufällig zwischen -totalHeight und -FONT:
      y: - (Math.random() * (totalHeight - FONT) + FONT),
      v: VMIN + Math.random()*(VMAX - VMIN),           // px/s
      head: (Math.random()*rows)|0,
      rows,
      chars: new Array(rows).fill(0).map(pick),
      mutT: 0,
      mutInt: MUT_MIN + Math.random()*(MUT_MAX - MUT_MIN)
    }));
  }

  function tick(t) {
    if (!running) return;
    if (!last) last = t;
    const dt = Math.min(0.05, (t - last) / 1000); // clamp 50ms
    last = t;

    const w = cvs.clientWidth;
    const h = cvs.clientHeight;

    // Halbtransparenter Überzug -> weicher Trail ohne teure Schatten auf jedem Glyphen
    ctx.fillStyle = 'rgba(10, 10, 10, 0.14)'; // passt zum Body-Hintergrund
    ctx.fillRect(0, 0, w, h);

    ctx.font = `${FONT}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';

    for (const c of cols) {
      // Position
        c.y += c.v * dt;
        if (c.y > h) {
          const totalHeight = c.rows * FONT;
          c.y = -totalHeight - Math.random() * (0.3 * h); // etwas Streuung
          c.v = VMIN + Math.random()*(VMAX - VMIN);
        }

      // Mutationstakt / Head-Advance
      c.mutT += dt;
      if (c.mutT >= c.mutInt) {
        c.mutT = 0;
        c.mutInt = MUT_MIN + Math.random()*(MUT_MAX - MUT_MIN);

        c.head = (c.head + 1) % c.rows;
        c.chars[c.head] = pick();

        if (Math.random() < FLIMMER) {
          c.chars[(Math.random()*c.rows)|0] = pick();
        }
      }

      // Zeichnen – Head heller, rest in Grundfarbe
      let y = c.y;
      for (let i = 0; i < c.rows; i++) {
        const ch = c.chars[(c.head + i) % c.rows];

        if (i === 0) {
          ctx.fillStyle = '#b6ffe6';                    // Head
          ctx.shadowColor = 'rgba(0, 255, 190, 0.65)';
          ctx.shadowBlur = 8;
        } else {
          ctx.fillStyle = '#00f0a8';                    // Body
          ctx.shadowColor = 'rgba(0, 240, 168, 0.35)';
          ctx.shadowBlur = 3;
        }

        ctx.fillText(ch, c.x, y);
        y += FONT;
      }
    }

    // Shadow-Reste zurücksetzen
    ctx.shadowBlur = 0;
    requestAnimationFrame(tick);
  }

  function start() { running = true; last = 0; requestAnimationFrame(tick); }
  function stop()  { running = false; }

  // Resize/Visibility
  let rto;
  window.addEventListener('resize', () => {
    clearTimeout(rto);
    rto = setTimeout(() => { resize(); }, 150);
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stop(); else { start(); }
  });

  // init
  resize();
  start();
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

    const usernameInput = document.getElementById('username');
    const codeInput = document.getElementById('accessCode');
    const loginStatus = document.getElementById('loginStatus');

    if (usernameInput) usernameInput.value = '';
    if (codeInput) codeInput.value = '';
    if (loginStatus) {
  loginStatus.textContent = '';
  loginStatus.className = 'status';
  loginStatus.style.display = 'none';
}
    usernameInput?.focus();
}

function showActivationSection() {
    showSection('activationSection');
    document.getElementById('licenseKey').focus();
}

function showMainSection() {
    showSection('mainSection');
    if (currentUser) {
        document.getElementById('userInfo').textContent = `User: ${currentUser}`;
    }
}

// ================================================================
// STATUS MESSAGES
// ================================================================

function showStatus(statusId, message, type = 'info') {
    const status = document.getElementById(statusId);
    if (!status) return;

    if (!message) {
        status.textContent = '';
        status.className = 'status';
        status.style.display = 'none';  // Box ausblenden
        return;
    }

    status.textContent = message;
    status.className = `status ${type} show`;
    status.style.display = 'block'; // Box einblenden

    if (type === 'error') {
        setTimeout(() => {
            status.classList.remove('show');
        }, 5000);
    }
}

// ================================================================
// Access CHECK (Lizenz + Benutzerstatus prüfen)
// ================================================================
async function checkAccessAndRun(action) {
    const token = localStorage.getItem('secretMessages_token');
    if (!token) return performAutoLogout();

    try {
        const res = await fetch(`${API_BASE}/checkAccess`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        const result = await res.json();

        if (result.status === 'banned') {
            alert('Dein Account wurde gesperrt. Du wirst jetzt ausgeloggt.');
            return performAutoLogout();
        }

        if (result.status === 'expired') {
            alert('Dein Lizenz-Zugang ist abgelaufen. Du wirst jetzt ausgeloggt.');
            return performAutoLogout();
        }

        // Zugriff erlaubt → Aktion ausführen
        action();

    } catch (err) {
        console.warn('Zugriffsprüfung fehlgeschlagen:', err);
        alert('Ein Fehler ist aufgetreten. Bitte neu laden.');
    }
}

// ================================================================
// LOGIN HANDLER
// ================================================================

async function handleLogin(event) {
  event.preventDefault();
  console.log('🔒 Login-Funktion ausgeführt – Seite bleibt erhalten.');

  const usernameEl = document.getElementById('username');
  const codeEl = document.getElementById('accessCode');

  if (!usernameEl || !codeEl) {
    console.warn('Login-Felder nicht gefunden im DOM');
    showStatus('loginStatus', 'Technischer Fehler – bitte neu laden.', 'error');
    return;
  }

  const usernameInput = usernameEl.value.trim();
  const Code = codeEl.value.trim();
  const loginBtn = document.getElementById('loginBtn');
  const loginBtnText = document.getElementById('loginBtnText');

  if (!usernameInput || !Code) {
    showStatus('loginStatus', 'Bitte alle Felder ausfüllen', 'error');
    return;
  }

  if (!/^[0-9]{5}$/.test(Code)) {
    showStatus('loginStatus', 'Zugangscode muss 5 Ziffern enthalten', 'error');
    return;
  }

  loginBtn.disabled = true;
  loginBtnText.innerHTML = '<span class="spinner"></span>Anmeldung läuft...';

  try {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: usernameInput, accessCode: Code })
    });

    const data = await res.json();
    console.log('📡 Antwort vom Server:', data);
      
    if (data.success) {
      authToken = data.token;
      currentUser = data.username;
      localStorage.setItem('secretMessages_token', authToken);
      localStorage.setItem('secretMessages_user', currentUser);
      showStatus('loginStatus', 'Anmeldung erfolgreich!', 'success');

      setTimeout(() => {
        document.getElementById('loginSection')?.classList.remove('active');
        document.getElementById('mainSection')?.classList.add('active');
        document.getElementById('userInfo').textContent = `User: ${currentUser}`;
        if (data.product_code === 'unl' || !data.expires_at) {
          document.getElementById('licenseCountdown').textContent = 'UNLIMITED';
        } else {
          startLicenseCountdown(data.expires_at);
        }
      }, 1500);
    } else {
      showStatus('loginStatus', data.error || 'Anmeldung fehlgeschlagen', 'error');
    }
  } catch (err) {
    console.error('Login-Fehler:', err);
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
    
    if (!/^[a-zA-Z0-9]+$/.test(newUsername) || newUsername.length < 3) {
        showStatus('activationStatus', 'Gewünschter Benutzername muss mindestens 3 Zeichen lang sein (nur Buchstaben, Zahlen,)', 'error');
        return;
    }
    
    if (!/^[0-9]{5}$/.test(newAccessCode)) {
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
                document.getElementById('Code').value = newAccessCode;
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

// Lizenz Countdown
function startLicenseCountdown(expiresAtString) {
  const countdownEl = document.getElementById('licenseCountdown');
  if (!countdownEl || !expiresAtString) return;

  const endTime = new Date(expiresAtString).getTime();

  function updateCountdown() {
    const now = Date.now();
    const diff = endTime - now;

    if (diff <= 0) {
      countdownEl.textContent = '❌ Lizenz abgelaufen – Sie wurden abgemeldet.';
      countdownEl.style.color = 'red';
      performAutoLogout();
      clearInterval(timer);
      return;
    }

    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
    const minutes = Math.floor((diff / (1000 * 60)) % 60);
    const seconds = Math.floor((diff / 1000) % 60);

    countdownEl.textContent = `Lizenz: ${days}:${hours}:${minutes}:${seconds}`;
  }

  updateCountdown();
  const timer = setInterval(updateCountdown, 1000);
}

async function performAutoLogout() {
  const token = localStorage.getItem('secretMessages_token');

  if (token) {
    try {
      await fetch(`${API_BASE}/auth/logout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        }
      });
    } catch (err) {
      console.warn('Automatischer Logout fehlgeschlagen:', err);
    }
  }

  // Token und Benutzer lokal entfernen
  localStorage.removeItem('secretMessages_token');
  localStorage.removeItem('secretMessages_user');
  currentUser = null;
  authToken = null;

  // Felder zurücksetzen
  document.getElementById("messageInput").value = "";
  document.getElementById("messageOutput").value = "";
  document.getElementById("outputGroup").style.display = "none";

  // Sichtbarkeit
  showLoginSection();

  // ✅ Statusbox zurücksetzen
  const loginStatus = document.getElementById('loginStatus');
  if (loginStatus) {
    loginStatus.textContent = '';
    loginStatus.className = 'status';
    loginStatus.style.display = 'none';
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
