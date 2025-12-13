// ==================================================================
// APP.JS - FRONTEND LOGIC (SECRET MESSAGES V2)
// Enthält: UI, Auth, Contacts, Encryption, License Renewal
// ==================================================================

import { encryptFull, decryptFull } from './cryptoLayers.js';

// ==================================================================
// 1. KONFIGURATION & STATE
// ==================================================================

const API_BASE = '/api';
let currentUser = null;
let authToken = null;
let currentMode = 'encrypt'; // 'encrypt' oder 'decrypt'

// Kontakt-State (aus LocalStorage laden)
let contacts = JSON.parse(localStorage.getItem('sm_contacts')) || [];
const contactGroups = [
    { name: "Alle Kontakte", id: "ALL" },
    { name: "Freunde", id: "FRIENDS" },
    { name: "Arbeit", id: "WORK" }
];

// ==================================================================
// 2. INITIALISIERUNG
// ==================================================================

document.addEventListener('DOMContentLoaded', function() {
    console.log('🚀 Secure App Initialized');
    
    // UI Events registrieren
    setupUIEvents();
    
    // Check: Kommt User vom Shop (Aktivierung)?
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('action') === 'activate') {
        showSection('activationSection');
    } else {
        // Normaler Start: Session prüfen
        checkExistingSession();
    }
});

// ==================================================================
// 3. UI EVENT HANDLING
// ==================================================================

function setupUIEvents() {
    
    // --- SIDEBAR ---
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

    if(menuBtn) menuBtn.addEventListener('click', () => toggleSidebar());
    if(overlay) overlay.addEventListener('click', () => toggleSidebar(true));
    
    // Sidebar Links
    const navContacts = document.getElementById('navContacts');
    if (navContacts) {
        navContacts.addEventListener('click', (e) => {
            e.preventDefault();
            openContactsModal('manageTab'); 
            toggleSidebar(true); 
        });
    }

    document.getElementById('logoutBtnSide')?.addEventListener('click', (e) => {
        e.preventDefault(); handleLogout();
    });
    
    document.getElementById('navDelete')?.addEventListener('click', (e) => {
        e.preventDefault(); confirmDeleteAccount();
    });

    // --- MAIN ACTION & CRYPTO ---
    document.getElementById('actionBtn')?.addEventListener('click', handleMainAction);
    
    // Mode Switcher
    document.getElementById('modeSwitch')?.addEventListener('change', (e) => {
        updateAppMode(e.target.checked ? 'decrypt' : 'encrypt');
    });

    // Copy / Clear / QR
    document.getElementById('copyBtn')?.addEventListener('click', copyToClipboard);
    document.getElementById('clearFieldsBtn')?.addEventListener('click', clearAllFields);
    
    document.getElementById('qrGenBtn')?.addEventListener('click', () => {
        const text = document.getElementById('messageOutput').value;
        if(!text) return showAppStatus("Bitte erst Text verschlüsseln!", 'error');
        showQRModal(text);
    });
    document.getElementById('closeQrBtn')?.addEventListener('click', () => {
        document.getElementById('qrModal').classList.remove('active');
    });

    // --- FORMS (AUTH) ---
    document.getElementById('loginForm')?.addEventListener('submit', handleLogin);
    document.getElementById('activationForm')?.addEventListener('submit', handleActivation); // Optional, falls genutzt
    
    document.getElementById('showActivationLink')?.addEventListener('click', (e) => {
        e.preventDefault(); showSection('activationSection');
    });
    document.getElementById('showLoginLink')?.addEventListener('click', (e) => {
        e.preventDefault(); showSection('loginSection');
    });

    // --- KONTAKTE MODAL ---
    document.getElementById('contactsBtn')?.addEventListener('click', () => openContactsModal('selectTab'));
    document.getElementById('addContactForm')?.addEventListener('submit', handleAddContact);
    document.getElementById('cancelSelectionBtn')?.addEventListener('click', closeContactsModal);
    document.getElementById('confirmSelectionBtn')?.addEventListener('click', handleConfirmSelection);
    
    // Tabs
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => switchContactTab(e.target.dataset.target));
    });

    // Suche
    document.getElementById('manageSearch')?.addEventListener('input', (e) => renderContactLists(e.target.value));
    document.getElementById('selectSearch')?.addEventListener('input', (e) => renderContactSelectionList(e.target.value));
}

// ==================================================================
// 4. AUTHENTIFIZIERUNG & SESSION
// ==================================================================

// LOGIN
async function handleLogin(e) {
    e.preventDefault();
    const userIn = document.getElementById('username').value.trim();
    const passIn = document.getElementById('accessCode').value.trim();
    const btn = document.getElementById('loginBtn');
    
    // Simple Device ID (oder Fingerprint)
    let deviceId = localStorage.getItem('sm_device_id');
    if (!deviceId) {
        deviceId = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2);
        localStorage.setItem('sm_device_id', deviceId);
    }

    setBtnLoading(btn, true);

    try {
        const res = await fetch(`${API_BASE}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: userIn, accessCode: passIn, deviceId })
        });
        
        const data = await res.json();
        
        if (data.success) {
            authToken = data.token;
            currentUser = data.username;
            const expiry = data.expiresAt || "2099-12-31"; // Fallback

            // Daten speichern
            localStorage.setItem('sm_token', authToken);
            localStorage.setItem('sm_user', currentUser);
            localStorage.setItem('sm_exp', expiry);

            updateSidebarInfo(currentUser, expiry);

            // PRÜFUNG: Ist Lizenz abgelaufen?
            if (checkLicenseExpiry(expiry)) {
                showRenewalScreen();
            } else {
                showSection('mainSection');
            }
        } else {
            showStatus('loginStatus', data.error || 'Login fehlgeschlagen', 'error');
        }
    } catch (err) {
        showStatus('loginStatus', 'Serverfehler. Bitte später versuchen.', 'error');
        console.error(err);
    } finally {
        setBtnLoading(btn, false, "VERBINDUNG HERSTELLEN");
    }
}

// SESSION CHECK (Beim Laden)
async function checkExistingSession() {
    const token = localStorage.getItem('sm_token');
    const user = localStorage.getItem('sm_user');
    let savedExpiry = localStorage.getItem('sm_exp');

    if (!token || !user) {
        handleLogout(false); // Silent logout (nur UI reset)
        return;
    }

    try {
        const res = await fetch(`${API_BASE}/auth/validate`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ token })
        });

        if (!res.ok) throw new Error("Server Validation Error");
        const data = await res.json();

        if (data.valid) {
            authToken = token;
            currentUser = user;
            
            // Server Datum hat Vorrang
            let finalExpiry = data.expiresAt || savedExpiry || 'lifetime';
            localStorage.setItem('sm_exp', finalExpiry);

            updateSidebarInfo(currentUser, finalExpiry);

            // ABLAUF PRÜFEN
            if (checkLicenseExpiry(finalExpiry)) {
                showRenewalScreen();
            } else {
                showSection('mainSection');
            }
        } else {
            // Token invalid (z.B. gesperrt)
            handleLogout();
        }
    } catch (e) {
        console.warn("Session Check failed:", e);
        handleLogout(); 
    }
}

// LOGOUT
function handleLogout(redirect = true) {
    authToken = null;
    currentUser = null;
    localStorage.removeItem('sm_token');
    localStorage.removeItem('sm_user');
    localStorage.removeItem('sm_exp');
    
    updateSidebarInfo(null, null);
    
    if (redirect) {
        showSection('loginSection');
        showStatus('loginStatus', 'Sie wurden abgemeldet.', 'success');
    } else {
        showSection('loginSection');
    }
}

// ACCOUNT LÖSCHEN
async function confirmDeleteAccount() {
    if (!confirm('WARNUNG: Account wirklich unwiderruflich löschen?')) return;
    try {
        const res = await fetch(`${API_BASE}/auth/delete-account`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        const data = await res.json();
        if (data.success) {
            alert('Konto gelöscht.');
            handleLogout();
        } else {
            alert('Fehler: ' + data.error);
        }
    } catch(e) { alert("Serverfehler"); }
}

// ==================================================================
// 5. CORE LOGIC (ENCRYPT / DECRYPT)
// ==================================================================

async function handleMainAction() {
    // Tastatur schließen (Mobile)
    if (document.activeElement) document.activeElement.blur();

    const code = document.getElementById('messageCode').value;
    const text = document.getElementById('messageInput').value;
    
    if (!text) return showAppStatus("Bitte Text eingeben.", 'error');
    if (!code || code.length !== 5) return showAppStatus("5-stelliger Code erforderlich.", 'error');
    if (!currentUser) return showAppStatus("Bitte erst einloggen.", 'error');

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

            // 1. Eingabefeld parsen
            if (recipientInput && recipientInput.trim().length > 0) {
                recipientIDs = recipientInput.split(',').map(s => s.trim()).filter(s => s.length > 0);
            }
            
            // 2. ABSENDER HINZUFÜGEN (Zwingend!)
            if (!recipientIDs.includes(currentUser)) {
                recipientIDs.push(currentUser);
            }
            
            console.log("🔒 Verschlüssele für:", recipientIDs);
            result = await encryptFull(text, code, recipientIDs);

        } else {
            // --- ENTSCHLÜSSELN ---
            console.log("🔓 Entschlüssele als User:", currentUser);
            result = await decryptFull(text, code, currentUser);
        }

        const output = document.getElementById('messageOutput');
        output.value = result;
        document.getElementById('outputGroup').style.display = 'block';
        output.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    } catch (err) {
        console.error("Vorgang fehlgeschlagen:", err);
        
        let msg = err.message || "Unbekannter Fehler";
        if (msg.includes("Format")) msg = "Format ungültig (Alte Version?)";
        else if (msg.includes("Berechtigung") || msg.includes("Code") || msg.includes("Key")) {
             msg = "ZUGRIFF VERWEIGERT: Falscher Code oder falscher Benutzer.";
        }
        showAppStatus(msg, 'error');
    } finally {
        btn.textContent = originalText;
        btn.disabled = false;
    }
}

// ==================================================================
// 6. KONTAKTVERZEICHNIS
// ==================================================================

function renderContactLists(searchTerm = '') {
    const manageList = document.getElementById('contactList');
    if (!manageList) return;

    const term = searchTerm.toLowerCase().trim();
    // Filtern
    const filtered = contacts.filter(c => 
        c.name.toLowerCase().includes(term) || 
        c.id.toLowerCase().includes(term) ||
        (c.group && c.group.toLowerCase().includes(term))
    );
    
    // Sortieren (Alphabetisch)
    filtered.sort((a, b) => a.name.localeCompare(b.name));

    manageList.innerHTML = '';
    if (filtered.length === 0) {
        manageList.innerHTML = `<li style="color:#777; text-align:center;">${term ? 'Keine Treffer' : '(Leer)'}</li>`;
        return;
    }

    filtered.forEach(contact => {
        const li = document.createElement('li');
        li.innerHTML = `
            <span style="font-weight:bold; flex-grow:1;">${contact.name}</span>
            <span style="color:#999; font-size:0.8rem; margin-right:15px;">${contact.group || 'Allgemein'}</span>
            <button class="delete-btn" data-id="${contact.id}">Löschen</button>
        `;
        // Delete Event
        li.querySelector('.delete-btn').addEventListener('click', () => handleDeleteContact(contact.id));
        manageList.appendChild(li);
    });
}

function renderContactSelectionList(searchTerm = '') {
    const selectList = document.getElementById('selectContactList');
    if (!selectList) return;

    const term = searchTerm.toLowerCase().trim();
    selectList.innerHTML = '';
    
    // Gruppenlogik (nur wenn keine Suche aktiv)
    if (!term) {
        contactGroups.forEach(grp => {
            const memberIds = contacts.filter(c => c.group === grp.name).map(c => c.id);
            if(memberIds.length > 0) {
                const li = document.createElement('li');
                li.innerHTML = `
                    <label style="display:flex; gap:10px; cursor:pointer; font-weight:bold; color:var(--accent-blue);">
                        <input type="checkbox" class="group-cb" data-ids="${memberIds.join(',')}">
                        [GRUPPE] ${grp.name}
                    </label>
                `;
                li.querySelector('.group-cb').addEventListener('change', (e) => {
                    toggleGroupSelection(e.target.dataset.ids, e.target.checked);
                });
                selectList.appendChild(li);
            }
        });
    }

    // Einzelkontakte
    const filtered = contacts.filter(c => c.name.toLowerCase().includes(term));
    filtered.forEach(c => {
        const li = document.createElement('li');
        li.innerHTML = `
            <label style="display:flex; gap:10px; cursor:pointer; width:100%;">
                <input type="checkbox" class="contact-cb" value="${c.id}">
                <span>${c.name}</span> <span style="color:#666; font-size:0.8rem;">(${c.group||'-'})</span>
            </label>
        `;
        selectList.appendChild(li);
    });
}

function handleDeleteContact(id) {
    if(confirm('Kontakt löschen?')) {
        contacts = contacts.filter(c => c.id !== id);
        saveContacts();
    }
}

function handleAddContact(e) {
    e.preventDefault();
    const name = document.getElementById('newContactName').value.trim();
    const id = document.getElementById('newContactID').value.trim();

    if (name.length < 2 || id.length < 2) return showAppStatus("Daten zu kurz.", 'error');
    if (contacts.some(c => c.id.toLowerCase() === id.toLowerCase())) return showAppStatus("ID existiert schon.", 'error');

    contacts.push({ name, id, group: "Freunde" }); // Default Group
    saveContacts();
    
    document.getElementById('newContactName').value = '';
    document.getElementById('newContactID').value = '';
    showAppStatus("Kontakt gespeichert.", 'success');
}

function saveContacts() {
    localStorage.setItem('sm_contacts', JSON.stringify(contacts));
    renderContactLists();
}

function toggleGroupSelection(idsStr, checked) {
    const ids = idsStr.split(',');
    document.querySelectorAll('.contact-cb').forEach(cb => {
        if (ids.includes(cb.value)) cb.checked = checked;
    });
}

function handleConfirmSelection() {
    const checked = document.querySelectorAll('.contact-cb:checked');
    const ids = Array.from(checked).map(cb => cb.value);
    
    const input = document.getElementById('recipientName');
    if(input) input.value = ids.join(', ');
    
    closeContactsModal();
}

// Modal Helper
function openContactsModal(tab) {
    renderContactLists();
    renderContactSelectionList();
    switchContactTab(tab);
    document.getElementById('contactsModal').classList.add('active');
}
function closeContactsModal() {
    document.getElementById('contactsModal').classList.remove('active');
}
function switchContactTab(target) {
    document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
    document.getElementById(target)?.classList.add('active');
    document.querySelector(`.tab-btn[data-target="${target}"]`)?.classList.add('active');
}

// ==================================================================
// 7. LIZENZ & RENEWAL
// ==================================================================

function checkLicenseExpiry(expiryDateString) {
    if (!expiryDateString) return false;
    if (expiryDateString === 'lifetime' || String(expiryDateString).includes('9999')) return false;

    const cleanDateStr = String(expiryDateString).replace(' ', 'T');
    const expiry = new Date(cleanDateStr);
    const now = new Date();

    if (isNaN(expiry.getTime())) return false;
    return now > expiry;
}

function showRenewalScreen() {
    showAppStatus("Lizenz ist abgelaufen.", 'error');
    document.querySelectorAll('.section').forEach(el => el.style.display = 'none');
    document.getElementById('renewalSection').style.display = 'block';
    
    // Logout Handler für diesen Screen
    const link = document.getElementById('logoutLinkRenewal');
    if(link) link.onclick = (e) => { e.preventDefault(); handleLogout(); };
}

async function startRenewal(plan) {
    // UI Feedback (Button finden der geklickt wurde ist schwer hier, daher globaler Indikator optional)
    showAppStatus("Leite zu Stripe weiter...", 'success');
    
    try {
        const response = await fetch(`${API_BASE}/create-checkout-session`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}` 
            },
            body: JSON.stringify({ product_type: plan, is_renewal: true })
        });
        const data = await response.json();
        
        if (data.success && data.checkout_url) {
            window.location.href = data.checkout_url;
        } else {
            showAppStatus("Fehler: " + (data.error || "Unbekannt"), 'error');
        }
    } catch(e) { showAppStatus("Verbindungsfehler", 'error'); }
}

// Exportieren für HTML onclick
window.startRenewal = startRenewal;

// ==================================================================
// 8. HELPER & UTILS
// ==================================================================

function showSection(id) {
    document.querySelectorAll('.section').forEach(el => {
        el.style.display = 'none';
        el.classList.remove('active');
    });
    const target = document.getElementById(id);
    if(target) {
        target.style.display = 'block';
        setTimeout(() => target.classList.add('active'), 10);
    }
}

function updateSidebarInfo(user, expiry) {
    const userLabel = document.getElementById('sidebarUser');
    const licenseLabel = document.getElementById('sidebarLicense');
    const authElements = document.querySelectorAll('.auth-only');

    if (userLabel) userLabel.textContent = user || 'Gast';

    if (user && licenseLabel) {
        if (!expiry || expiry === 'lifetime' || String(expiry).includes('9999')) {
            licenseLabel.textContent = "LIZENZ: UNLIMITED";
            licenseLabel.style.color = "#00ff41";
        } else {
            try {
                const dateObj = new Date(String(expiry).replace(' ', 'T'));
                if (!isNaN(dateObj.getTime())) {
                    // Check ob abgelaufen für rote Farbe
                    if (dateObj < new Date()) {
                        licenseLabel.textContent = "LIZENZ: ABGELAUFEN";
                        licenseLabel.style.color = "var(--error-red)";
                    } else {
                        // Countdown
                        const diffDays = Math.ceil((dateObj - new Date()) / (1000 * 60 * 60 * 24));
                        licenseLabel.textContent = `LIZENZ: ⏳ ${diffDays} Tag(e)`;
                        licenseLabel.style.color = "var(--accent-blue)";
                    }
                } else {
                    licenseLabel.textContent = "LIZENZ: Aktiv";
                }
            } catch (e) { licenseLabel.textContent = "LIZENZ: Aktiv"; }
        }
    } else if (licenseLabel) {
        licenseLabel.textContent = "Nicht verbunden";
        licenseLabel.style.color = "#888";
    }

    authElements.forEach(el => el.style.display = user ? 'flex' : 'none');
}

function showAppStatus(msg, type = 'success') {
    const container = document.getElementById('globalStatusContainer');
    if (!container) return alert(msg);
    
    const div = document.createElement('div');
    div.className = `app-status-msg ${type}`;
    div.textContent = msg;
    container.prepend(div);
    
    requestAnimationFrame(() => div.classList.add('active'));
    setTimeout(() => {
        div.classList.remove('active');
        setTimeout(() => div.remove(), 500);
    }, 4000);
}

function showStatus(id, msg, type) {
    const el = document.getElementById(id);
    if (el) {
        el.textContent = msg;
        el.style.color = type === 'error' ? 'var(--error-red)' : 'var(--success-green)';
        el.style.display = 'block';
        setTimeout(() => el.style.display = 'none', 5000);
    }
}

function updateAppMode(mode) {
    currentMode = mode;
    const title = document.getElementById('modeTitle');
    const btn = document.getElementById('actionBtn');
    const recipientGroup = document.getElementById('recipientGroup');
    
    if (mode === 'encrypt') {
        title.textContent = "VERSCHLÜSSELUNG";
        btn.textContent = "🔒 DATEN VERSCHLÜSSELN";
        recipientGroup.style.display = 'block';
    } else {
        title.textContent = "ENTSCHLÜSSELUNG";
        btn.textContent = "🔓 DATEN ENTSCHLÜSSELN";
        recipientGroup.style.display = 'none';
    }
}

function copyToClipboard() {
    const text = document.getElementById('messageOutput').value;
    if(text) {
        navigator.clipboard.writeText(text).then(() => showAppStatus("Kopiert!", 'success'));
    }
}

function clearAllFields() {
    document.getElementById('messageInput').value = '';
    document.getElementById('messageOutput').value = '';
    document.getElementById('messageCode').value = '';
    document.getElementById('recipientName').value = '';
    document.getElementById('outputGroup').style.display = 'none';
}

function setBtnLoading(btn, isLoading, originalText) {
    if(!btn) return;
    if(isLoading) {
        btn.disabled = true;
        btn.dataset.orig = btn.textContent;
        btn.textContent = "⏳ ...";
    } else {
        btn.disabled = false;
        btn.textContent = originalText || btn.dataset.orig;
    }
}

function showQRModal(text) {
    const modal = document.getElementById('qrModal');
    const container = document.getElementById('qrDisplay');
    modal.classList.add('active');
    
    // QR Code Simulation (Da keine externe Lib hier im Text möglich)
    // Du kannst hier qrcode.js nutzen: new QRCode(container, text);
    container.innerHTML = `<div style="padding:20px; text-align:center; color:#000;">
        <h3 style="margin-bottom:10px;">QR CODE</h3>
        <p style="font-size:0.8rem; word-break:break-all;">${text.substring(0,50)}...</p>
        <div style="width:150px; height:150px; background:#000; margin:20px auto; display:flex; align-items:center; justify-content:center; color:#fff;">
           [QR LIB REQUIRED]
        </div>
    </div>`;
}

// Optional: Activation Handler (falls genutzt)
async function handleActivation(e) {
    e.preventDefault();
    // ... Implementierung analog zu Register ...
}
