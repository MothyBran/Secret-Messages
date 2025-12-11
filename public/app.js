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

    // Elemente holen
    const title = document.getElementById('modeTitle');
    const indicator = document.getElementById('statusIndicator');
    const actionBtn = document.getElementById('actionBtn');
    const recipientGroup = document.getElementById('recipientGroup');
    const qrScanBtn = document.getElementById('qrScanBtn');
    const qrGenBtn = document.getElementById('qrGenBtn');
    const textLabel = document.getElementById('textLabel');

    if (isDecrypt) {
        // ENTSCHLÜSSELN MODUS (Grün/Orange Akzente oder einfach Textänderung)
        title.textContent = 'ENTSCHLÜSSELUNG';
        title.style.color = '#00ff41'; // Matrix Grün
        
        indicator.textContent = '● EMPFANGSBEREIT';
        indicator.style.color = '#00ff41';

        // Button Style ändern
        actionBtn.textContent = '🔓 NACHRICHT ENTSCHLÜSSELN';
        actionBtn.classList.remove('btn-primary');
        actionBtn.style.borderColor = '#00ff41';
        actionBtn.style.color = '#00ff41';

        textLabel.textContent = 'Verschlüsselter Text (Cipher)';
        
        // Input Felder steuern
        recipientGroup.style.display = 'none'; // Beim Entschlüsseln brauchen wir keinen Empfänger eingeben (wir sind es selbst)
        
        // QR Buttons
        qrScanBtn.style.display = 'block'; // Scanner an
        qrGenBtn.style.display = 'none';   // Generator aus (man generiert QR meist vom Ergebnis oder beim Senden)

    } else {
        // VERSCHLÜSSELN MODUS (Standard Blau)
        title.textContent = 'VERSCHLÜSSELUNG';
        title.style.color = 'var(--accent-blue)';
        
        indicator.textContent = '● GESICHERT';
        indicator.style.color = 'var(--accent-blue)';

        actionBtn.textContent = '🔒 DATEN VERSCHLÜSSELN';
        actionBtn.classList.add('btn-primary');
        actionBtn.style.borderColor = '';
        actionBtn.style.color = '';

        textLabel.textContent = 'Nachrichteneingabe (Klartext)';

        // Input Felder
        recipientGroup.style.display = 'block';

        // QR Buttons
        qrScanBtn.style.display = 'none';
        qrGenBtn.style.display = 'block';
    }

    // Reset Output beim Wechsel
    document.getElementById('outputGroup').style.display = 'none';
}

// ================================================================
// HAUPTFUNKTION (ENCRYPT / DECRYPT HANDLER)
// ================================================================

async function handleMainAction() {
    // 1. Tastatur auf Handy schließen
    if (document.activeElement) document.activeElement.blur();

    // 2. Daten sammeln
    const code = document.getElementById('messageCode').value;
    const text = document.getElementById('messageInput').value;
    
    // Validation
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

            // Eingabe am Komma trennen und bereinigen
            const rawList = recipientInput.split(',').map(s => s.trim()).filter(s => s.length > 0);

            if (rawList.length > 0) {
                // FALL A: RESTRICTED ACCESS (Mindestens 1 Empfänger)
                // Nur Absender + gelistete Empfänger dürfen entschlüsseln.
                recipientIDs = rawList;

                // WICHTIG: Absender (Du selbst) muss auch auf die Liste, 
                // sonst kannst du deine eigene Nachricht nicht mehr lesen!
                if (currentUser && !recipientIDs.includes(currentUser)) {
                    recipientIDs.push(currentUser);
                }
            } else {
                // FALL B: PUBLIC ACCESS (Kein Empfänger)
                // Liste bleibt leer []. cryptoLayers.js erkennt das und
                // erstellt einen "Public Slot", der nur den 5-stelligen Code braucht.
            }

            // Wir übergeben das Array an die neue Logik
            result = await encryptFull(text, code, recipientIDs);

        } else {
            // --- ENTSCHLÜSSELN ---
            
            // Hier passiert die Magie der "Key Slots":
            // Wir übergeben unsere eigene ID (currentUser).
            // Die Funktion decryptFull prüft automatisch:
            // "Gibt es einen Tresor für MICH + diesen Code?"
            // ODER "Gibt es einen öffentlichen Tresor für diesen Code?"
            
            result = await decryptFull(text, code, currentUser);
        }

        // Ergebnis anzeigen
        const output = document.getElementById('messageOutput');
        output.value = result;
        document.getElementById('outputGroup').style.display = 'block';
        
        // Scroll zum Ergebnis
        output.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    } catch (err) {
        console.error(err);
        // Benutzerfreundliche Fehlermeldung
        if (err.message.includes("Verschlüsselung")) {
             alert("Fehler beim Verschlüsseln. Bitte prüfen Sie die Eingaben.");
        } else {
             alert("Entschlüsselung fehlgeschlagen!\n\nMögliche Gründe:\n1. Falscher 5-stelliger Code.\n2. Sie sind nicht berechtigt (falscher Benutzer).\n3. Daten wurden manipuliert.");
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
            
            updateSidebarInfo(currentUser, "Verbunden");
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

function updateSidebarInfo(user, status) {
    // Texte aktualisieren
    document.getElementById('sidebarUser').textContent = user || 'Gast';
    document.getElementById('sidebarLicense').textContent = status || 'Nicht verbunden';

    // Elemente holen, die nur für eingeloggte User sind
    const authElements = document.querySelectorAll('.auth-only');

    if (user) {
        // USER IST EINGELOGGT -> Buttons anzeigen
        authElements.forEach(el => el.style.display = 'flex'); // oder 'block'
    } else {
        // GAST / LOGOUT -> Buttons verstecken
        authElements.forEach(el => el.style.display = 'none');
    }
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
