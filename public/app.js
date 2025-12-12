// app.js - Frontend Logic (UI Refactored & Mode Switching)

import { encryptFull, decryptFull } from './cryptoLayers.js';

// ================================================================
// KONFIGURATION & STATE
// ================================================================

const API_BASE = '/api';
let currentUser = null;
let authToken = null;
let currentMode = 'encrypt'; // 'encrypt' oder 'decrypt'

// ================================================================
// INITIALISIERUNG
// ================================================================

document.addEventListener('DOMContentLoaded', function() {
    console.log('🚀 Secure App Initialized');
    
    // 1. Event Listeners registrieren
    setupUIEvents();
    
    // 2. Check: Kommt User vom Shop?
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('action') === 'activate') {
        showSection('activationSection');
    } else {
        // 3. Bestehende Session prüfen
        checkExistingSession();
    }
});

// ================================================================
// UI EVENT HANDLING
// ================================================================

function setupUIEvents() {
    
    // --- SIDEBAR NAVIGATION ---
    const menuBtn = document.getElementById('menuToggle');
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebarOverlay');
    
    function toggleSidebar(forceClose = false) {
        if (forceClose) {
            sidebar.classList.remove('active');
            overlay.classList.remove('active');
        } else {
            sidebar.classList.toggle('active');
            overlay.classList.toggle('active');
        }
    }

    menuBtn.addEventListener('click', () => toggleSidebar());
    overlay.addEventListener('click', () => toggleSidebar(true));
    
    // Sidebar Links
    // WICHTIG: Prüfen ob das Element existiert, um Fehler zu vermeiden (falls User ausgeloggt ist)
    const navContacts = document.getElementById('navContacts');
    if (navContacts) {
        navContacts.addEventListener('click', (e) => {
            e.preventDefault();
            alert("Kontaktverzeichnis-Modul wird geladen..."); 
            toggleSidebar(true); 
        });
    }
    
    // Support
    document.getElementById('navSupport').addEventListener('click', () => {
        toggleSidebar(true);
    });
    
    const logoutBtn = document.getElementById('logoutBtnSide');
    if (logoutBtn) logoutBtn.addEventListener('click', handleLogout);

    // Delete Account
    const delBtn = document.getElementById('navDelete');
    if(delBtn) delBtn.addEventListener('click', confirmDeleteAccount);
    
    // --- MODE SWITCHER (Verschlüsseln <-> Entschlüsseln) ---
    const modeSwitch = document.getElementById('modeSwitch');
    if (modeSwitch) {
        modeSwitch.addEventListener('change', (e) => {
            updateAppMode(e.target.checked ? 'decrypt' : 'encrypt');
        });
    }

    // --- MAIN ACTIONS ---
    const actionBtn = document.getElementById('actionBtn');
    if (actionBtn) actionBtn.addEventListener('click', handleMainAction);

    const copyBtn = document.getElementById('copyBtn');
    if (copyBtn) copyBtn.addEventListener('click', copyToClipboard);
    
    const clearBtn = document.getElementById('clearFieldsBtn');
    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            document.getElementById('messageInput').value = '';
            document.getElementById('messageOutput').value = '';
            document.getElementById('messageCode').value = '';
            const recInput = document.getElementById('recipientName');
            if(recInput) recInput.value = '';
            document.getElementById('outputGroup').style.display = 'none';
        });
    }

    // --- FORMS (Login / Activation) ---
    const loginForm = document.getElementById('loginForm');
    if(loginForm) loginForm.addEventListener('submit', handleLogin);

    const actForm = document.getElementById('activationForm');
    if(actForm) actForm.addEventListener('submit', handleActivation);
    
    const showActLink = document.getElementById('showActivationLink');
    if(showActLink) showActLink.addEventListener('click', (e) => {
        e.preventDefault(); showSection('activationSection');
    });

    const showLoginLink = document.getElementById('showLoginLink');
    if(showLoginLink) showLoginLink.addEventListener('click', (e) => {
        e.preventDefault(); showSection('loginSection');
    });

    // --- QR CODE ---
    const qrGenBtn = document.getElementById('qrGenBtn');
    if (qrGenBtn) {
        qrGenBtn.addEventListener('click', () => {
            const text = document.getElementById('messageOutput').value;
            if(!text) return alert("Bitte erst Text verschlüsseln!");
            showQRModal(text);
        });
    }

    // HIER WAR DER FEHLER: Dieser Teil gehört noch IN die Funktion
    const closeQrBtn = document.getElementById('closeQrBtn');
    if (closeQrBtn) {
        closeQrBtn.addEventListener('click', () => {
            document.getElementById('qrModal').classList.remove('active');
        });
    }

} 

// ================================================================
// CORE UI LOGIC (MODE SWITCHING)
// ================================================================

function updateAppMode(mode) {
    currentMode = mode;
    const isDecrypt = (mode === 'decrypt');

    const title = document.getElementById('modeTitle');
    const indicator = document.getElementById('statusIndicator');
    const actionBtn = document.getElementById('actionBtn');
    const recipientGroup = document.getElementById('recipientGroup');
    const qrScanBtn = document.getElementById('qrScanBtn');
    const qrGenBtn = document.getElementById('qrGenBtn');
    const textLabel = document.getElementById('textLabel');
    
    // WICHTIG: Felder leeren beim Wechsel
    const msgInput = document.getElementById('messageInput');
    const msgOutput = document.getElementById('messageOutput');
    const outputGroup = document.getElementById('outputGroup');
    
    if(msgInput) msgInput.value = '';
    if(msgOutput) msgOutput.value = '';
    if(outputGroup) outputGroup.style.display = 'none';

    if (isDecrypt) {
        // ENTSCHLÜSSELN (Alles in Blau/Accent-Color)
        title.textContent = 'ENTSCHLÜSSELUNG';
        title.style.color = 'var(--accent-blue)'; 
        
        indicator.textContent = '● EMPFANGSBEREIT';
        indicator.style.color = 'var(--accent-blue)';

        actionBtn.textContent = '🔓 NACHRICHT ENTSCHLÜSSELN';
        actionBtn.classList.remove('btn-primary');
        actionBtn.style.border = '1px solid var(--accent-blue)';
        actionBtn.style.color = 'var(--accent-blue)';
        actionBtn.style.background = 'transparent';

        textLabel.textContent = 'Verschlüsselter Text hier einfügen';
        
        if(recipientGroup) recipientGroup.style.display = 'none'; 
        if(qrScanBtn) qrScanBtn.style.display = 'block'; 
        if(qrGenBtn) qrGenBtn.style.display = 'none';   

    } else {
        // VERSCHLÜSSELN
        title.textContent = 'VERSCHLÜSSELUNG';
        title.style.color = 'var(--accent-blue)';
        
        indicator.textContent = '● GESICHERT';
        indicator.style.color = 'var(--accent-blue)';

        actionBtn.textContent = '🔒 DATEN VERSCHLÜSSELN';
        actionBtn.classList.add('btn-primary');
        actionBtn.style.border = '';
        actionBtn.style.color = '';
        actionBtn.style.background = '';

        textLabel.textContent = 'Nachrichteneingabe (Klartext)';

        if(recipientGroup) recipientGroup.style.display = 'block';
        if(qrScanBtn) qrScanBtn.style.display = 'none';
        if(qrGenBtn) qrGenBtn.style.display = 'block';
    }
}

// ================================================================
// HAUPTFUNKTION (ENCRYPT / DECRYPT HANDLER)
// ================================================================

async function handleMainAction() {
    // 1. Tastatur auf Handy schließen
    if (document.activeElement) document.activeElement.blur();

    const code = document.getElementById('messageCode').value;
    const text = document.getElementById('messageInput').value;
    
    if (!text) return alert("Bitte geben Sie einen Text ein.");
    if (!code || code.length !== 5) return alert("Der 5-stellige Sicherheitscode ist erforderlich.");

    const btn = document.getElementById('actionBtn');
    const originalText = btn.textContent;
    btn.textContent = "⏳ VERARBEITUNG...";
    btn.disabled = true;

    try {
        let result = "";

        if (currentMode === 'encrypt') {
            // --- VERSCHLÜSSELN ---
            
            const recipientInput = document.getElementById('recipientName').value;
            let recipientIDs = [];

            // Nur wenn das Feld NICHT leer ist, bauen wir eine Empfängerliste
            if (recipientInput && recipientInput.trim().length > 0) {
                recipientIDs = recipientInput.split(',').map(s => s.trim()).filter(s => s.length > 0);

                // Absender (Dich selbst) hinzufügen, damit du deine eigene Nachricht lesen kannst
                if (currentUser && !recipientIDs.includes(currentUser)) {
                    recipientIDs.push(currentUser);
                }
            } 
            // WICHTIG: Ist das Feld leer, bleibt recipientIDs = []. 
            // Die cryptoLayers.js erkennt das automatisch als "Public Message".

            console.log("Verschlüssele für:", recipientIDs.length === 0 ? "ALLE (Public)" : recipientIDs);
            
            // Aufruf der Verschlüsselung
            result = await encryptFull(text, code, recipientIDs);

        } else {
            // --- ENTSCHLÜSSELN ---
            
            console.log("Entschlüssele als User:", currentUser || "Gast");
            
            // Wir übergeben den User. Die cryptoLayers prüfen automatisch:
            // 1. Gibt es einen "Public Slot"? (Wenn ja -> Öffnen)
            // 2. Gibt es einen "User Slot" für mich? (Wenn ja -> Öffnen)
            result = await decryptFull(text, code, currentUser);
        }

        // Ergebnis anzeigen
        const output = document.getElementById('messageOutput');
        output.value = result;
        document.getElementById('outputGroup').style.display = 'block';
        
        // Scroll zum Ergebnis
        output.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    } catch (err) {
        console.error("Fehler im Prozess:", err);
        
        // GENAUE FEHLERMELDUNG (Damit wir wissen, was los ist)
        let msg = err.message || "Unbekannter Fehler";

        if (msg.includes("Format")) {
             alert("Fehler: Das Nachrichtenformat ist veraltet oder ungültig.");
        } else if (msg.includes("Berechtigung") || msg.includes("Code") || msg.includes("Key")) {
             alert("ZUGRIFF VERWEIGERT!\n\nMögliche Gründe:\n1. Falscher 5-stelliger Code.\n2. Die Nachricht ist privat und nicht für Sie bestimmt.\n3. Daten wurden manipuliert.");
        } else {
             alert("Technischer Fehler: " + msg);
        }
    } finally {
        btn.textContent = originalText;
        btn.disabled = false;
    }
}


// ================================================================
// AUTH & SESSION MANAGEMENT (Refactored)
// ================================================================

async function handleLogin(e) {
    e.preventDefault();
    const username = document.getElementById('username').value;
    const accessCode = document.getElementById('accessCode').value;
    const btn = document.getElementById('loginBtn');
    
    btn.disabled = true;
    
    try {
        // Device ID generieren/holen
        const deviceId = getDeviceId();
        
        const res = await fetch(`${API_BASE}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, accessCode, deviceId })
        });
        const data = await res.json();

        if (data.success) {
            authToken = data.token;
            currentUser = data.username;
            localStorage.setItem('sm_token', authToken);
            localStorage.setItem('sm_user', currentUser);
            localStorage.setItem('sm_exp', expiry);
            
            updateSidebarInfo(currentUser, expiry);
            showSection('mainSection');
        } else {
            showStatus('loginStatus', data.error, 'error');
        }
    } catch (err) {
        showStatus('loginStatus', 'Verbindungsfehler', 'error');
    } finally {
        btn.disabled = false;
    }
}

async function handleActivation(e) {
    e.preventDefault();
    const payload = {
        licenseKey: document.getElementById('licenseKey').value,
        username: document.getElementById('newUsername').value,
        accessCode: document.getElementById('newAccessCode').value,
        deviceId: getDeviceId()
    };

    try {
        const res = await fetch(`${API_BASE}/auth/activate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        
        if (data.success) {
            alert("Aktivierung erfolgreich! Bitte einloggen.");
            showSection('loginSection');
            // Felder vorfüllen
            document.getElementById('username').value = payload.username;
        } else {
            showStatus('activationStatus', data.error, 'error');
        }
    } catch (e) {
        showStatus('activationStatus', 'Serverfehler', 'error');
    }
}

async function handleLogout() {
    // ... (API Call Code) ...

    // Lokal aufräumen
    localStorage.removeItem('sm_token');
    localStorage.removeItem('sm_user');
    currentUser = null;
    authToken = null;
    
    // Sidebar schließen
    document.getElementById('sidebar').classList.remove('active');
    document.getElementById('sidebarOverlay').classList.remove('active');
    
    // UI auf "Gast" setzen (versteckt die Buttons)
    updateSidebarInfo(null, "Nicht verbunden"); 
    
    showSection('loginSection');
}

// ================================================================
// HELPER FUNCTIONS
// ================================================================

function showSection(id) {
    // Alle Sections ausblenden
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    // Gewünschte Section anzeigen
    const target = document.getElementById(id);
    if (target) target.classList.add('active');

    // --- HEADER LOGIK ---
    const switchWrapper = document.getElementById('headerSwitchWrapper');
    if (id === 'mainSection') {
        switchWrapper.style.display = 'inline-block'; // Oder 'block'/'flex'
    } else {
        switchWrapper.style.display = 'none';
        // Optional: Switch zurücksetzen beim Verlassen?
        // document.getElementById('modeSwitch').checked = false;
        // updateAppMode('encrypt'); 
    }
}

function showStatus(elementId, msg, type) {
    const el = document.getElementById(elementId);
    el.textContent = msg;
    el.style.display = 'block';
    el.style.color = type === 'error' ? '#ff3333' : '#00ff41';
    setTimeout(() => el.style.display = 'none', 5000);
}

// Berechnet die verbleibende Zeit bis zum Ablaufdatum
function formatLicenseDuration(expiryDateString) {
    if (!expiryDateString) return "Unbekannt";
    
    // Prüfen auf "Unlimited" Keywords
    if (expiryDateString === 'lifetime' || String(expiryDateString).includes('9999')) {
        return "♾️ UNLIMITED";
    }

    const now = new Date();
    const expiry = new Date(expiryDateString);
    
    // Check ob Datum gültig ist
    if (isNaN(expiry.getTime())) return "Gültig";

    const diffMs = expiry - now;

    if (diffMs <= 0) return "❌ ABGELAUFEN";

    // Umrechnung
    const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    
    if (days > 365) return "♾️ > 1 Jahr";
    if (days > 0) return `⏳ ${days} Tag(e)`;
    if (hours > 0) return `⏳ ${hours} Std.`;
    return "⏳ < 1 Std.";
}

function copyToClipboard() {
    const output = document.getElementById('messageOutput');
    output.select();
    navigator.clipboard.writeText(output.value).then(() => {
        const btn = document.getElementById('copyBtn');
        const oldText = btn.textContent;
        btn.textContent = "✓ KOPIERT";
        setTimeout(() => btn.textContent = oldText, 2000);
    });
}

function getDeviceId() {
    let id = localStorage.getItem('sm_device_id');
    if (!id) {
        id = 'dev-' + Math.random().toString(36).substr(2, 9) + Date.now();
        localStorage.setItem('sm_device_id', id);
    }
    return id;
}

function updateSidebarInfo(user, statusOrDate) {
    const userLabel = document.getElementById('sidebarUser');
    const licenseLabel = document.getElementById('sidebarLicense');
    
    if(userLabel) userLabel.textContent = user || 'Gast';
    
    if (user && statusOrDate && licenseLabel) {
        // Prüfen, ob formatLicenseDuration existiert, um Absturz zu verhindern
        if (typeof formatLicenseDuration === 'function' && (String(statusOrDate).includes('-') || String(statusOrDate).includes(':'))) {
             licenseLabel.textContent = "LIZENZ: " + formatLicenseDuration(statusOrDate);
             licenseLabel.style.color = "var(--accent-blue)";
        } else {
             // Fallback, falls Funktion fehlt oder Format anders ist
             licenseLabel.textContent = "Status: Online";
        }
    } else if (licenseLabel) {
        licenseLabel.textContent = "Nicht verbunden";
        licenseLabel.style.color = "#888"; // var(--text-muted)
    }

    const authElements = document.querySelectorAll('.auth-only');
    authElements.forEach(el => el.style.display = user ? 'flex' : 'none');
}

async function checkExistingSession() {
    const token = localStorage.getItem('sm_token');
    const user = localStorage.getItem('sm_user');
    
    if (token && user) {
        // Token validieren (Quick Check)
        try {
            const res = await fetch(`${API_BASE}/auth/validate`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ token })
            });
            const data = await res.json();
            if (data.valid) {
                authToken = token;
                currentUser = user;
                const expiry = localStorage.getItem('sm_exp');
                updateSidebarInfo(user, "Online");
                showSection('mainSection');
                return;
            }
        } catch(e) {}
    }
    // Fallback
    showSection('loginSection');
}

function showQRModal(text) {
    const modal = document.getElementById('qrModal');
    const container = document.getElementById('qrDisplay');
    
    modal.classList.add('active');
    container.innerHTML = ""; // Clear old
    
    // HINWEIS: Hier bräuchte man eine QR Lib wie qrcode.js
    // Da wir keine externe Lib laden können im Text, simulieren wir es:
    
    container.innerHTML = `<div style="padding:20px; text-align:center; color:black;">
        [QR CODE GENERATOR]<br><br>
        Hier würde der QR Code für:<br>
        "${text.substring(0, 20)}..."<br>
        erscheinen.
    </div>`;
    
    // Wenn du qrcode.js einbindest:
    // new QRCode(container, text);
}

async function confirmDeleteAccount() {
    if (!confirm('WARNUNG: Account wirklich unwiderruflich löschen?')) return;
    
    try {
        const res = await fetch(`${API_BASE}/auth/delete-account`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        const data = await res.json();
        
        if (data.success) {
            alert('Konto wurde gelöscht.');
            handleLogout(); // Loggt aus und setzt UI zurück
        } else {
            alert('Fehler: ' + data.error);
        }
    } catch (e) {
        alert('Verbindungsfehler');
    }
}
