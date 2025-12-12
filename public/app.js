// app.js - Frontend Logic (UI Refactored & Mode Switching)

import { encryptFull, decryptFull } from './cryptoLayers.js';

// ================================================================
// KONFIGURATION & STATE
// ================================================================

const API_BASE = '/api';
let currentUser = null;
let authToken = null;
let currentMode = 'encrypt'; // 'encrypt' oder 'decrypt'
let contacts = JSON.parse(localStorage.getItem('sm_contacts')) || [];

const contactGroups = [
    { name: "Alle Kontakte", id: "ALL" },
    { name: "Freunde", id: "FRIENDS" },
    { name: "Arbeit", id: "WORK" }
];

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
    const navContacts = document.getElementById('navContacts');
    if (navContacts) {
        // Menü -> Kontaktverwaltung öffnen
        navContacts.addEventListener('click', (e) => {
            e.preventDefault();
            openContactsModal('manageTab'); // Öffnet direkt den Manage Tab
            toggleSidebar(true); 
        });
    }
    
    document.getElementById('navSupport')?.addEventListener('click', () => {
        toggleSidebar(true);
    });
    
    document.getElementById('logoutBtnSide')?.addEventListener('click', handleLogout);
    document.getElementById('navDelete')?.addEventListener('click', confirmDeleteAccount);
    
    // --- MAIN ACTIONS & MODAL EVENTS ---
    
    // Button am Empfängerfeld (Öffnet Modal zum Auswählen)
    document.getElementById('contactsBtn')?.addEventListener('click', () => openContactsModal('selectTab'));
    
    // Modal Events (Tabs und Aktionen)
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => switchContactTab(e.target.dataset.target));
    });
    
    // Formular zum Hinzufügen
    document.getElementById('addContactForm')?.addEventListener('submit', handleAddContact);
    
    // Abbrechen Button
    document.getElementById('cancelSelectionBtn')?.addEventListener('click', closeContactsModal);

    // Bestätigen Button
    document.getElementById('confirmSelectionBtn')?.addEventListener('click', handleConfirmSelection);

    // Suchfelder (Filtern bei Tipp-Eingabe)
    document.getElementById('manageSearch')?.addEventListener('input', () => renderContactLists(document.getElementById('manageSearch').value));
    document.getElementById('selectSearch')?.addEventListener('input', () => renderContactSelectionList(document.getElementById('selectSearch').value));

    
    // --- STANDARD APP EVENTS ---
    
    // MODE SWITCHER
    document.getElementById('modeSwitch')?.addEventListener('change', (e) => {
        updateAppMode(e.target.checked ? 'decrypt' : 'encrypt');
    });

    // Haupt-Aktion
    document.getElementById('actionBtn')?.addEventListener('click', handleMainAction);

    // Copy / Clear
    document.getElementById('copyBtn')?.addEventListener('click', copyToClipboard);
    document.getElementById('clearFieldsBtn')?.addEventListener('click', () => {
        document.getElementById('messageInput').value = '';
        document.getElementById('messageOutput').value = '';
        document.getElementById('messageCode').value = '';
        document.getElementById('recipientName').value = '';
        document.getElementById('outputGroup').style.display = 'none';
    });

    // Forms
    document.getElementById('loginForm')?.addEventListener('submit', handleLogin);
    document.getElementById('activationForm')?.addEventListener('submit', handleActivation);
    
    document.getElementById('showActivationLink')?.addEventListener('click', (e) => {
        e.preventDefault(); showSection('activationSection');
    });
    document.getElementById('showLoginLink')?.addEventListener('click', (e) => {
        e.preventDefault(); showSection('loginSection');
    });

    // QR Code
    document.getElementById('qrGenBtn')?.addEventListener('click', () => {
        const text = document.getElementById('messageOutput').value;
        if(!text) return showAppStatus("Bitte erst Text verschlüsseln!", 'error');
        showQRModal(text);
    });

    document.getElementById('closeQrBtn')?.addEventListener('click', () => {
        document.getElementById('qrModal').classList.remove('active');
    });

    // Nach dem Laden der Events: Initiale Listen-Generierung
    renderContactLists(); 
    renderContactSelectionList();
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
    if (!code || code.length !== 5) return alert("Der 5-stellige Sicherheitscode (5 Ziffern) ist erforderlich.");
    if (!currentUser) return alert("Fehler: Zum Verschlüsseln/Entschlüsseln müssen Sie angemeldet sein."); // Sicherheitscheck

    const btn = document.getElementById('actionBtn');
    const originalText = btn.textContent;
    btn.textContent = "⏳ VERARBEITUNG...";
    btn.disabled = true;

    try {
        let result = "";

        if (currentMode === 'encrypt') {
            // --- VERSCHLÜSSELN (NEUE SICHERHEITSREGEL: Kein Public Mode) ---
            
            const recipientInput = document.getElementById('recipientName').value;
            let recipientIDs = [];

            // 1. Empfänger aus Input hinzufügen
            if (recipientInput && recipientInput.trim().length > 0) {
                recipientIDs = recipientInput.split(',').map(s => s.trim()).filter(s => s.length > 0);
            }
            
            // 2. ABSENDER HINZUFÜGEN (Absender MUSS immer dabei sein)
            if (!recipientIDs.includes(currentUser)) {
                recipientIDs.push(currentUser);
            }
            
            if (recipientIDs.length === 0) {
                 // Sollte nach der obigen Logik nicht passieren, ist aber ein Fallback-Check
                throw new Error("Sicherheit: Konnte keinen berechtigten Empfänger (Absender) festlegen.");
            }

            console.log("🔒 Verschlüssele für:", recipientIDs);
            
            // Aufruf der Verschlüsselung
            result = await encryptFull(text, code, recipientIDs);

        } else {
            // --- ENTSCHLÜSSELN ---
            
            console.log("🔓 Entschlüssele als User:", currentUser);
            
            // Ruft decryptFull auf. Dieses prüft jetzt NUR User-Slots (kein Public Slot mehr).
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
        
        // GENAUE FEHLERMELDUNG
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
    if (e) e.preventDefault();
    
    const usernameInput = document.getElementById('username');
    const accessCodeInput = document.getElementById('accessCode');
    const btn = document.getElementById('loginBtn');
    
    if (!usernameInput || !accessCodeInput) return;

    const username = usernameInput.value;
    const accessCode = accessCodeInput.value;
    
    if(btn) btn.disabled = true;
    const statusEl = document.getElementById('loginStatus');
    if(statusEl) statusEl.style.display = 'none';
    
    try {
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
            
            // WICHTIG: Fallback, falls Server doch mal null schickt
            // Wir nutzen 'lifetime' als String, wenn nichts da ist
            let expiry = data.expiresAt || 'lifetime';
            
            // Speichern
            localStorage.setItem('sm_token', authToken);
            localStorage.setItem('sm_user', currentUser);
            localStorage.setItem('sm_exp', expiry);
            
            // UI Update (Hier lag oft der Fehler, jetzt sicher)
            updateSidebarInfo(currentUser, expiry);
            
            // Zur Hauptseite
            showSection('mainSection');
        } else {
            showStatus('loginStatus', data.error || "Login fehlgeschlagen", 'error');
        }
    } catch (err) {
        console.error("Login Error Details:", err);
        // Wir zeigen jetzt den echten Fehler an, statt nur "Verbindungsfehler"
        showStatus('loginStatus', 'Fehler: ' + err.message, 'error');
    } finally {
        if(btn) btn.disabled = false;
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
// KONTAKTVERZEICHNIS LOGIK
// ================================================================

function saveContacts() {
    // Kontakte speichern und sortieren (nach Name)
    contacts.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
    localStorage.setItem('sm_contacts', JSON.stringify(contacts));
    renderContactLists(); // Listen nach Speichern neu zeichnen
}

// Rendert die Liste im 'Verwalten' Tab (Manage)
function renderContactLists(searchTerm = '') {
    const manageList = document.getElementById('contactList');
    if (!manageList) return;

    // Filter und Sortierung
    const normalizedTerm = searchTerm.toLowerCase().trim();
    let filteredContacts = contacts.slice(); 

    if (normalizedTerm) {
        filteredContacts = filteredContacts.filter(c => 
            c.name.toLowerCase().includes(normalizedTerm) || 
            c.id.toLowerCase().includes(normalizedTerm) ||
            (c.group && c.group.toLowerCase().includes(normalizedTerm))
        );
    }
    
    manageList.innerHTML = '';

    if (filteredContacts.length === 0) {
        manageList.innerHTML = `<li style="color: #777; text-align: center;">${normalizedTerm ? 'Keine Treffer.' : '(Noch keine Kontakte gespeichert)'}</li>`;
        return;
    }

    filteredContacts.forEach(contact => {
        // Nur Name und Gruppen-Zuordnung anzeigen (Benutzer-ID aus Datenschutzgründen weggelassen)
        const manageItem = document.createElement('li');
        manageItem.innerHTML = `
            <span style="font-weight: bold; flex-grow: 1;">${contact.name}</span>
            <span style="color: #999; font-size: 0.8rem; margin-right: 15px;">${contact.group || 'Keine Gruppe'}</span>
            <button class="delete-btn" data-id="${contact.id}" onclick="window.handleDeleteContact(this)">Löschen</button>
        `;
        manageList.appendChild(manageItem);
    });

    // Globale Funktion für Lösch-Button
    window.handleDeleteContact = (btn) => {
        const idToDelete = btn.dataset.id;
        if (confirm(`Soll der Kontakt "${idToDelete}" wirklich gelöscht werden?`)) {
            contacts = contacts.filter(c => c.id !== idToDelete);
            saveContacts();
            showAppStatus(`Kontakt erfolgreich gelöscht.`, 'success');
        }
    };
}


// Rendert die Liste im 'Auswählen' Tab (Select)
function renderContactSelectionList(searchTerm = '') {
    const selectList = document.getElementById('selectContactList');
    if (!selectList) return;

    const normalizedTerm = searchTerm.toLowerCase().trim();
    selectList.innerHTML = '';
    
    // Gruppierung und Kontakte zusammenführen
    let itemsToDisplay = [];
    
    // Zuerst Gruppen (Wenn nicht gesucht wird)
    if (!normalizedTerm) {
        contactGroups.forEach(group => {
             itemsToDisplay.push({ type: 'group', name: group.name, id: group.id, memberIds: contacts.filter(c => c.group === group.name).map(c => c.id) });
        });
    }

    // Dann Kontakte
    contacts.forEach(contact => {
        if (!normalizedTerm || 
            contact.name.toLowerCase().includes(normalizedTerm) || 
            (contact.group && contact.group.toLowerCase().includes(normalizedTerm))
           ) {
            itemsToDisplay.push({ type: 'contact', name: contact.name, id: contact.id, group: contact.group });
        }
    });


    itemsToDisplay.forEach(item => {
        const selectItem = document.createElement('li');
        
        if (item.type === 'group') {
            // GRUPPE: Zum Anklicken, wählt alle Mitglieder
            selectItem.innerHTML = `
                <label style="display: flex; gap: 10px; cursor: pointer; flex-grow: 1; align-items: center; padding: 5px 0;">
                    <input type="checkbox" class="group-checkbox" data-group="${item.id}" data-member-ids="${item.memberIds.join(',')}" style="width: 18px; height: 18px;">
                    <span style="color: var(--accent-blue); font-weight: bold;">[GRUPPE] ${item.name}</span>
                </label>
            `;
            // Event Listener für Gruppen-Checkbox
            selectItem.querySelector('.group-checkbox').addEventListener('change', (e) => toggleGroupSelection(e.target, item.id));

        } else {
            // KONTAKT: Individuelle Auswahl
            selectItem.innerHTML = `
                <label style="display: flex; gap: 10px; cursor: pointer; flex-grow: 1; align-items: center;">
                    <input type="checkbox" class="contact-checkbox" data-id="${item.id}" value="${item.id}" data-group="${item.group}" style="width: 18px; height: 18px; border: 1px solid var(--accent-blue);">
                    <span style="color: var(--text-main);">${item.name}</span>
                </label>
                <span style="color: #777; font-size: 0.8rem;">(${item.group || 'Einzel'})</span>
            `;
        }
        selectList.appendChild(selectItem);
    });
}

function toggleGroupSelection(checkbox, groupId) {
    // Holt die IDs der Gruppenmitglieder
    const memberIdsString = checkbox.dataset.memberIds;
    if (!memberIdsString) return;
    
    const memberIds = memberIdsString.split(',');
    
    memberIds.forEach(id => {
        const memberCheckbox = document.querySelector(`#selectContactList input[data-id="${id}"].contact-checkbox`);
        if (memberCheckbox) {
            memberCheckbox.checked = checkbox.checked;
        }
    });
}


// --- MODAL UND TAB FUNKTIONEN ---

function openContactsModal(initialTab = 'manageTab') {
    const modal = document.getElementById('contactsModal');
    if (!modal) return;
    
    // Beide Listen rendern
    renderContactLists(); 
    renderContactSelectionList(); 
    
    switchContactTab(initialTab);
    modal.classList.add('active');
}

function closeContactsModal() {
    document.getElementById('contactsModal')?.classList.remove('active');
    // Suchfelder leeren, damit sie beim nächsten Mal nicht gefiltert sind
    document.getElementById('manageSearch').value = '';
    document.getElementById('selectSearch').value = '';
}

function switchContactTab(targetId) {
    document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
    
    document.getElementById(targetId)?.classList.add('active');
    document.querySelector(`.tab-btn[data-target="${targetId}"]`)?.classList.add('active');
}

function handleAddContact(e) {
    e.preventDefault();
    const nameInput = document.getElementById('newContactName');
    const idInput = document.getElementById('newContactID');

    const name = nameInput.value.trim();
    const id = idInput.value.trim(); // Die Benutzer-ID

    if (name.length < 3 || id.length < 3) {
        showAppStatus("Alias und Benutzer-ID müssen mindestens 3 Zeichen lang sein.", 'error');
        return;
    }
    if (contacts.some(c => c.id.toLowerCase() === id.toLowerCase())) {
        showAppStatus(`Kontakt mit der ID "${id}" existiert bereits.`, 'error');
        return;
    }

    // Fügt den Kontakt hinzu (Gruppe für Demo fix auf 'Freunde')
    contacts.push({ name: name, id: id, group: "Freunde" }); 
    saveContacts();

    nameInput.value = '';
    idInput.value = '';
    
    showAppStatus(`Kontakt "${name}" erfolgreich hinzugefügt und der Gruppe 'Freunde' zugeordnet.`, 'success');
}

function handleConfirmSelection() {
    // Sucht nur Checkboxen vom Typ 'contact-checkbox', um Gruppen-Checkboxen zu ignorieren
    const selectedCheckboxes = document.querySelectorAll('#selectContactList input.contact-checkbox:checked');
    const recipientInput = document.getElementById('recipientName');
    
    if (!recipientInput) {
        closeContactsModal();
        return;
    }
    
    let selectedIDs = [];
    selectedCheckboxes.forEach(cb => {
        // Verhindert doppelte IDs (auch wenn das HTML dies schon verhindern sollte)
        if (!selectedIDs.includes(cb.value)) {
            selectedIDs.push(cb.value);
        }
    });
    
    // IDs als Komma-getrennten String in das Empfängerfeld einfügen
    recipientInput.value = selectedIDs.join(', ');
    
    closeContactsModal();
    showAppStatus(`Empfängerliste mit ${selectedIDs.length} Kontakten aktualisiert.`, 'success');
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

function showAppStatus(msg, type = 'success') {
    const container = document.getElementById('globalStatusContainer');
    const msgElement = document.createElement('div');
    
    if (!container) {
        // Fallback, falls der Container fehlt
        if (type === 'error') alert("FEHLER: " + msg); else alert("INFO: " + msg);
        return;
    }
    
    msgElement.textContent = msg;
    msgElement.className = `app-status-msg ${type}`;
    
    container.prepend(msgElement);
    requestAnimationFrame(() => {
        msgElement.classList.add('active');
    });

    // Nach 5 Sekunden ausblenden und entfernen
    setTimeout(() => {
        msgElement.classList.remove('active');
        setTimeout(() => { msgElement.remove(); }, 500); 
    }, 5000);
}

// Bestehende showStatus Funktion für Formular-spezifische Meldungen beibehalten
function showStatus(elementId, msg, type) {
    const el = document.getElementById(elementId);
    if (!el) return;
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

function updateSidebarInfo(user, expiryData) {
    const userLabel = document.getElementById('sidebarUser');
    const licenseLabel = document.getElementById('sidebarLicense');
    const authElements = document.querySelectorAll('.auth-only');

    // 1. User Name setzen
    if (userLabel) userLabel.textContent = user || 'Gast';

    // 2. Lizenz-Anzeige Logik
    if (user && licenseLabel) {
        // Prüfen auf Lifetime
        if (expiryData === 'lifetime' || String(expiryData).toLowerCase().includes('unlimited')) {
            licenseLabel.textContent = "LIZENZ: UNLIMITED";
            licenseLabel.style.color = "#00ff41"; // Grün für Lifetime
        } 
        // Prüfen auf Datum
        else if (expiryData) {
            try {
                const dateObj = new Date(expiryData);
                // Ist das Datum gültig?
                if (!isNaN(dateObj.getTime())) {
                    const dateStr = dateObj.toLocaleDateString('de-DE', {
                        day: '2-digit', month: '2-digit', year: 'numeric'
                    });
                    licenseLabel.textContent = "LIZENZ gültig bis: " + dateStr;
                    licenseLabel.style.color = "var(--accent-blue)";
                } else {
                    // Fallback, falls Datum komisch ist
                    licenseLabel.textContent = "LIZENZ: Aktiv";
                }
            } catch (e) {
                licenseLabel.textContent = "LIZENZ: Aktiv";
            }
        } else {
            licenseLabel.textContent = "LIZENZ: Unbekannt";
        }
    } else if (licenseLabel) {
        // Wenn nicht eingeloggt
        licenseLabel.textContent = "Nicht verbunden";
        licenseLabel.style.color = "#888";
    }

    // 3. Menü-Buttons ein-/ausblenden
    authElements.forEach(el => el.style.display = user ? 'flex' : 'none');
}

async function checkExistingSession() {
    const token = localStorage.getItem('sm_token');
    const user = localStorage.getItem('sm_user');
    const savedExpiry = localStorage.getItem('sm_exp'); // Datum aus Speicher holen
    
    if (token && user) {
        // Token validieren
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
                
                // Wir nehmen das Datum vom Server (falls vorhanden) oder das gespeicherte
                const finalExpiry = data.expiresAt || savedExpiry || 'lifetime';
                
                // Falls Server neues Datum geschickt hat, speichern wir es
                if (data.expiresAt) {
                    localStorage.setItem('sm_exp', data.expiresAt);
                }

                updateSidebarInfo(user, finalExpiry);
                showSection('mainSection');
                return;
            }
        } catch(e) {
            console.log("Session Check fehlgeschlagen", e);
        }
    }
    // Fallback: Login anzeigen
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
