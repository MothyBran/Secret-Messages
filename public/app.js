// app.js - Frontend Logic (Final Sidebar Version)

import { encryptFull, decryptFull } from './cryptoLayers.js';

// ================================================================
// KONFIGURATION & STATE
// ================================================================

const API_BASE = '/api';
let currentUser = null;
let authToken = null;
let currentMode = 'encrypt'; 

// Kontakt State
let contacts = JSON.parse(localStorage.getItem('sm_contacts')) || [];
let contactMode = 'manage'; // 'manage' (Verwalten) oder 'select' (Auswählen)
let isEditMode = false;     // Toggle für Bearbeitungs-Modus
let selectedContactIds = new Set(); // Set für ausgewählte IDs (verhindert Duplikate)
let sortKey = 'name';       // Aktuelle Sortierung: 'name' oder 'group'
let sortDir = 'asc';        // Richtung: 'asc' oder 'desc'

// ================================================================
// INITIALISIERUNG
// ================================================================

document.addEventListener('DOMContentLoaded', function() {
    console.log('🚀 Secure App Initialized');
    
    setupUIEvents();
    
    // Check URL Actions (z.B. nach Kauf)
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('action') === 'activate') {
        showSection('activationSection');
    } else {
        checkExistingSession();
    }
});

// ================================================================
// UI EVENT HANDLING
// ================================================================

function setupUIEvents() {
    
    // --- SIDEBAR (HAUPTMENÜ) ---
    const menuBtn = document.getElementById('menuToggle');
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebarOverlay');
    
    function toggleMainMenu(forceClose = false) {
        if (forceClose) {
            sidebar.classList.remove('active');
            overlay.classList.remove('active');
        } else {
            sidebar.classList.toggle('active');
            overlay.classList.toggle('active');
        }
    }

    menuBtn.addEventListener('click', () => toggleMainMenu());
    
    // Overlay schließt BEIDE Sidebars (Menü & Kontakte)
    overlay.addEventListener('click', () => {
        toggleMainMenu(true);
        closeContactSidebar();
    });

    // Menü-Link: Kontaktverzeichnis (Manage Mode)
    const navContacts = document.getElementById('navContacts');
    if (navContacts) {
        navContacts.addEventListener('click', (e) => {
            e.preventDefault();
            toggleMainMenu(true); // Hauptmenü zu
            openContactSidebar('manage'); // Kontakt-Sidebar auf
        });
    }
    
    document.getElementById('logoutBtnSide')?.addEventListener('click', handleLogout);

    // --- BUTTONS AM EMPFÄNGERFELD ---
    // Öffnet Kontakt-Sidebar im 'select' Modus
    document.getElementById('contactsBtn')?.addEventListener('click', () => {
        openContactSidebar('select');
    });

    // --- HAUPTAKTIONEN ---
    document.getElementById('modeSwitch')?.addEventListener('change', (e) => {
        updateAppMode(e.target.checked ? 'decrypt' : 'encrypt');
    });
    document.getElementById('actionBtn')?.addEventListener('click', handleMainAction);
    document.getElementById('copyBtn')?.addEventListener('click', copyToClipboard);
    document.getElementById('clearFieldsBtn')?.addEventListener('click', clearAllFields);

    // --- FORMS ---
    document.getElementById('loginForm')?.addEventListener('submit', handleLogin);
    document.getElementById('activationForm')?.addEventListener('submit', handleActivation);
    document.getElementById('showActivationLink')?.addEventListener('click', (e) => { e.preventDefault(); showSection('activationSection'); });
    document.getElementById('showLoginLink')?.addEventListener('click', (e) => { e.preventDefault(); showSection('loginSection'); });

    // --- QR CODE EVENTS ---
    
    // 1. Generieren (Verschlüsseln-Seite)
    document.getElementById('qrGenBtn')?.addEventListener('click', () => {
        const text = document.getElementById('messageOutput').value;
        if(!text) return showAppStatus("Bitte erst Text verschlüsseln!", 'error');
        showQRModal(text);
    });
    
    // Schließen & Speichern beim Generator
    document.getElementById('closeQrBtn')?.addEventListener('click', () => {
        document.getElementById('qrModal').classList.remove('active');
        document.getElementById('qrDisplay').innerHTML = ''; // Aufräumen
    });
    document.getElementById('saveQrBtn')?.addEventListener('click', downloadQR);

    // 2. Scannen (Entschlüsseln-Seite)
    document.getElementById('qrScanBtn')?.addEventListener('click', startQRScanner);
    
    // Scanner Schließen (Stoppt auch die Kamera)
    document.getElementById('closeScannerBtn')?.addEventListener('click', stopQRScanner);

    // ============================================================
    // KONTAKT-SIDEBAR EVENTS (WICHTIG!)
    // ============================================================

    // 1. Schließen Button (Oben links in Sidebar)
    document.getElementById('closeContactSidebar')?.addEventListener('click', closeContactSidebar);

    // 2. Suche & Sortierung
    document.getElementById('contactSearch')?.addEventListener('input', (e) => renderContactList(e.target.value));
    
    // Header-Klicks zum Sortieren
    document.getElementById('sortByName')?.addEventListener('click', () => toggleSort('name'));
    document.getElementById('sortByGroup')?.addEventListener('click', () => toggleSort('group'));

    // 3. Footer Buttons (Manage Mode)
    document.getElementById('btnAddContactOpen')?.addEventListener('click', () => openEditModal()); 
    document.getElementById('btnEditToggle')?.addEventListener('click', toggleEditMode);

    // 4. Footer Buttons (Select Mode)
    document.getElementById('btnCancelSelect')?.addEventListener('click', closeContactSidebar);
    document.getElementById('btnConfirmSelect')?.addEventListener('click', confirmSelection);

    // 5. Modal Events (Hinzufügen/Bearbeiten)
    document.getElementById('contactForm')?.addEventListener('submit', saveContact);
    document.getElementById('btnCancelEdit')?.addEventListener('click', () => document.getElementById('contactEditModal').classList.remove('active'));
    document.getElementById('btnDeleteContact')?.addEventListener('click', deleteContact);
}


// ================================================================
// KONTAKT-VERZEICHNIS LOGIK
// ================================================================

function openContactSidebar(mode) {
    contactMode = mode;
    isEditMode = false; // Immer Reset beim Öffnen
    selectedContactIds.clear(); // Auswahl zurücksetzen

    const sidebar = document.getElementById('contactSidebar');
    const overlay = document.getElementById('sidebarOverlay');
    
    // UI Elemente je nach Modus zeigen/verstecken
    const footerManage = document.getElementById('csFooterManage');
    const footerSelect = document.getElementById('csFooterSelect');
    const groupArea = document.getElementById('groupSelectionArea');
    const btnEdit = document.getElementById('btnEditToggle');

    // Reset Search & Style
    document.getElementById('contactSearch').value = '';
    btnEdit.style.background = 'transparent';
    btnEdit.innerHTML = '✎ Bearbeiten';

    if (mode === 'manage') {
        // VERWALTEN MODUS
        footerManage.style.display = 'flex';
        footerSelect.style.display = 'none';
        groupArea.style.display = 'none'; // Keine Gruppen-Checkboxen oben
    } else {
        // AUSWAHL MODUS
        footerManage.style.display = 'none';
        footerSelect.style.display = 'flex';
        groupArea.style.display = 'flex'; // Gruppen-Checkboxen anzeigen
        renderGroupTags(); // Gruppen rendern
    }

    renderContactList(); // Liste zeichnen

    // Animation: Slide In
    sidebar.classList.add('active');
    overlay.classList.add('active');
}

function closeContactSidebar() {
    document.getElementById('contactSidebar').classList.remove('active');
    document.getElementById('sidebarOverlay').classList.remove('active');
}

// --- RENDERING & FILTER ---

function renderGroupTags() {
    const area = document.getElementById('groupSelectionArea');
    area.innerHTML = '<small style="width: 100%; color: #777; margin-bottom: 5px;">Gruppen ankreuzen (wählt alle aus):</small>';
    
    // Alle existierenden Gruppen sammeln (Unique)
    const groups = [...new Set(contacts.map(c => c.group).filter(g => g))].sort();

    if (groups.length === 0) {
        area.innerHTML += '<span style="color:#555; font-size:0.8rem;">Keine Gruppen vorhanden.</span>';
        return;
    }

    groups.forEach(g => {
        const tag = document.createElement('div');
        tag.className = 'group-tag';
        // Checkbox + Name
        tag.innerHTML = `
            <input type="checkbox" class="grp-chk" value="${g}" style="width:auto; margin-right:5px;">
            <span>${g}</span>
        `;
        
        // Logik: Wenn Gruppe angeklickt wird -> Alle Mitglieder selektieren
        const chk = tag.querySelector('input');
        
        // Klick auf den ganzen Tag toggelt Checkbox
        tag.addEventListener('click', (e) => {
            if (e.target !== chk) {
                chk.checked = !chk.checked;
                toggleGroupSelection(g, chk.checked);
            }
        });
        
        // Change Event
        chk.addEventListener('change', (e) => {
            toggleGroupSelection(g, e.target.checked);
        });

        area.appendChild(tag);
    });
}

function toggleGroupSelection(groupName, isSelected) {
    // Finde alle Kontakte in dieser Gruppe
    const members = contacts.filter(c => c.group === groupName);
    
    members.forEach(m => {
        if (isSelected) selectedContactIds.add(m.id);
        else selectedContactIds.delete(m.id);
    });
    
    // Liste neu zeichnen (damit Checkboxen/Markierungen aktualisiert werden)
    renderContactList(document.getElementById('contactSearch').value);
}

function toggleSort(key) {
    // Wenn gleiche Spalte geklickt -> Richtung umkehren
    if (sortKey === key) {
        sortDir = sortDir === 'asc' ? 'desc' : 'asc';
    } else {
        sortKey = key;
        sortDir = 'asc';
    }
    
    // Visuelles Feedback in den Headern (Pfeile)
    document.getElementById('sortByName').textContent = `Empfänger ${sortKey==='name' ? (sortDir==='asc'?'▲':'▼') : '↕'}`;
    document.getElementById('sortByGroup').textContent = `Gruppe ${sortKey==='group' ? (sortDir==='asc'?'▲':'▼') : '↕'}`;

    renderContactList(document.getElementById('contactSearch').value);
}

function renderContactList(search = '') {
    const container = document.getElementById('contactListBody');
    container.innerHTML = '';
    const term = search.toLowerCase();

    // 1. Filtern
    let list = contacts.filter(c => 
        (c.name && c.name.toLowerCase().includes(term)) || 
        c.id.toLowerCase().includes(term) ||
        (c.group && c.group.toLowerCase().includes(term))
    );

    // 2. Sortieren
    list.sort((a, b) => {
        let valA = (a[sortKey] || '').toLowerCase();
        let valB = (b[sortKey] || '').toLowerCase();
        
        if (valA < valB) return sortDir === 'asc' ? -1 : 1;
        if (valA > valB) return sortDir === 'asc' ? 1 : -1;
        return 0;
    });

    if (list.length === 0) {
        document.getElementById('emptyContactMsg').style.display = 'block';
        return;
    }
    document.getElementById('emptyContactMsg').style.display = 'none';

    // 3. Zeilen erstellen
    list.forEach(c => {
        const row = document.createElement('div');
        row.className = 'cs-row';
        
        // Markierung je nach Modus
        if (contactMode === 'select' && selectedContactIds.has(c.id)) {
            row.classList.add('selected');
        }
        // Markierung im Edit Mode (Orange Border)
        if (contactMode === 'manage' && isEditMode) {
            row.classList.add('edit-mode-active');
        }

        row.innerHTML = `
            <div style="display:flex; flex-direction:column; flex:2; overflow:hidden;">
                <span style="font-weight:bold; color:#fff;">${c.name || c.id}</span>
                ${c.name ? `<span style="font-size:0.75rem; color:#666;">ID: ${c.id}</span>` : ''}
            </div>
            <div style="flex:1; text-align:right; font-size:0.8rem; color:var(--accent-blue);">
                ${c.group || '-'}
            </div>
        `;

        // Klick-Handler
        row.addEventListener('click', () => handleRowClick(c));

        container.appendChild(row);
    });
}

function handleRowClick(contact) {
    if (contactMode === 'manage') {
        // Im Manage-Modus: Nur klickbar, wenn Edit-Mode aktiv ist
        if (isEditMode) {
            openEditModal(contact);
        }
    } else {
        // Im Select-Modus: Ankreuzen/Abwählen
        if (selectedContactIds.has(contact.id)) {
            selectedContactIds.delete(contact.id);
        } else {
            selectedContactIds.add(contact.id);
        }
        // Neu rendern, um Status anzuzeigen
        renderContactList(document.getElementById('contactSearch').value);
    }
}

function toggleEditMode() {
    isEditMode = !isEditMode;
    const btn = document.getElementById('btnEditToggle');
    if (isEditMode) {
        btn.style.background = 'rgba(255, 165, 0, 0.2)';
        btn.textContent = 'Modus: Bearbeiten (Wähle Kontakt)';
    } else {
        btn.style.background = 'transparent';
        btn.textContent = '✎ Bearbeiten';
    }
    renderContactList(document.getElementById('contactSearch').value);
}

// --- SPEICHERN / LÖSCHEN (CRUD) ---

function openEditModal(contact = null) {
    const modal = document.getElementById('contactEditModal');
    const title = document.getElementById('modalTitle');
    const btnSave = document.getElementById('btnSaveContact');
    const btnDel = document.getElementById('btnDeleteContact');
    
    // Formular Reset
    document.getElementById('contactForm').reset();
    
    // Datalist für Gruppen füllen (Vorschläge)
    const dl = document.getElementById('groupSuggestions');
    dl.innerHTML = '';
    const groups = [...new Set(contacts.map(c => c.group).filter(g => g))];
    groups.forEach(g => {
        const opt = document.createElement('option');
        opt.value = g;
        dl.appendChild(opt);
    });

    if (contact) {
        // BEARBEITEN
        title.textContent = 'Kontakt bearbeiten';
        document.getElementById('inputName').value = contact.name || '';
        document.getElementById('inputID').value = contact.id;
        document.getElementById('inputGroup').value = contact.group || '';
        
        // ID darf beim Bearbeiten nicht geändert werden (Key)
        document.getElementById('inputID').readOnly = true;
        document.getElementById('inputID').style.opacity = '0.5';

        btnSave.textContent = 'Aktualisieren';
        btnDel.style.display = 'block';
        btnDel.dataset.id = contact.id;
    } else {
        // HINZUFÜGEN
        title.textContent = 'Kontakt hinzufügen';
        document.getElementById('inputID').readOnly = false;
        document.getElementById('inputID').style.opacity = '1';
        btnSave.textContent = 'Speichern';
        btnDel.style.display = 'none';
    }

    modal.classList.add('active');
}

// WICHTIG: Server-Check beim Speichern
async function saveContact(e) {
    e.preventDefault();
    
    const btnSave = document.getElementById('btnSaveContact');
    const originalText = btnSave.textContent;
    const nameVal = document.getElementById('inputName').value.trim();
    const idVal = document.getElementById('inputID').value.trim();
    const groupVal = document.getElementById('inputGroup').value.trim();

    if (!idVal) return showAppStatus("Benutzer-ID ist Pflicht!", 'error');

    // UI Feedback
    btnSave.disabled = true;
    btnSave.textContent = "Prüfe ID...";

    try {
        // 1. Check gegen Server
        const res = await fetch(`${API_BASE}/users/exists`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({ targetUsername: idVal })
        });
        const data = await res.json();

        if (!data.exists) {
            showAppStatus(`Fehler: ID "${idVal}" existiert nicht!`, 'error');
            btnSave.disabled = false;
            btnSave.textContent = originalText;
            return; 
        }

        // 2. Lokal speichern
        // Alten entfernen falls vorhanden
        contacts = contacts.filter(c => c.id !== idVal);
        contacts.push({ id: idVal, name: nameVal || idVal, group: groupVal });

        // Sortieren & Speichern
        contacts.sort((a, b) => a.name.localeCompare(b.name));
        localStorage.setItem('sm_contacts', JSON.stringify(contacts));
        
        // Modal schließen & Liste updaten
        document.getElementById('contactEditModal').classList.remove('active');
        renderContactList(document.getElementById('contactSearch').value);
        if(contactMode === 'select') renderGroupTags();

        showAppStatus(`Kontakt "${idVal}" gespeichert.`, 'success');

    } catch (err) {
        console.error(err);
        showAppStatus("Verbindungsfehler", 'error');
    } finally {
        btnSave.disabled = false;
        btnSave.textContent = originalText;
    }
}

function deleteContact() {
    const id = document.getElementById('btnDeleteContact').dataset.id;
    if (confirm("Kontakt wirklich löschen?")) {
        contacts = contacts.filter(c => c.id !== id);
        localStorage.setItem('sm_contacts', JSON.stringify(contacts));
        
        document.getElementById('contactEditModal').classList.remove('active');
        renderContactList();
        showAppStatus("Kontakt gelöscht.", 'success');
    }
}

function confirmSelection() {
    const input = document.getElementById('recipientName');
    const arr = Array.from(selectedContactIds);
    
    if (arr.length > 0) {
        input.value = arr.join(', ');
        showAppStatus(`${arr.length} Empfänger übernommen.`, 'success');
    }
    closeContactSidebar();
}


// ================================================================
// CORE UI HELPERS (Status, Mode, Copy, Clear)
// ================================================================

function showAppStatus(msg, type = 'success') {
    const div = document.createElement('div');
    div.className = `app-status-msg ${type}`;
    div.textContent = msg;
    document.getElementById('globalStatusContainer').appendChild(div);
    
    // Animation
    requestAnimationFrame(() => div.classList.add('active'));
    setTimeout(() => {
        div.classList.remove('active');
        setTimeout(() => div.remove(), 500);
    }, 4000);
}

function clearAllFields() {
    document.getElementById('messageInput').value = '';
    document.getElementById('messageOutput').value = '';
    document.getElementById('messageCode').value = '';
    document.getElementById('recipientName').value = '';
    document.getElementById('outputGroup').style.display = 'none';
}

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

    // Reset Fields
    document.getElementById('messageInput').value = '';
    document.getElementById('messageOutput').value = '';
    document.getElementById('outputGroup').style.display = 'none';

    if (isDecrypt) {
        title.textContent = 'ENTSCHLÜSSELUNG';
        title.style.color = 'var(--accent-blue)'; 
        indicator.textContent = '● EMPFANGSBEREIT';
        actionBtn.textContent = '🔓 NACHRICHT ENTSCHLÜSSELN';
        actionBtn.classList.remove('btn-primary');
        actionBtn.style.border = '1px solid var(--accent-blue)';
        actionBtn.style.background = 'transparent';
        textLabel.textContent = 'Verschlüsselter Text';
        
        if(recipientGroup) recipientGroup.style.display = 'none'; 
        if(qrScanBtn) qrScanBtn.style.display = 'block'; 
        if(qrGenBtn) qrGenBtn.style.display = 'none';   
    } else {
        title.textContent = 'VERSCHLÜSSELUNG';
        title.style.color = 'var(--accent-blue)';
        indicator.textContent = '● GESICHERT';
        actionBtn.textContent = '🔒 DATEN VERSCHLÜSSELN';
        actionBtn.classList.add('btn-primary');
        actionBtn.style.border = '';
        actionBtn.style.background = '';
        textLabel.textContent = 'Nachrichteneingabe (Klartext)';

        if(recipientGroup) recipientGroup.style.display = 'block';
        if(qrScanBtn) qrScanBtn.style.display = 'none';
        if(qrGenBtn) qrGenBtn.style.display = 'block';
    }
}

// ================================================================
// MAIN ACTION & AUTH
// ================================================================

async function handleMainAction() {
    // Tastatur weg
    if (document.activeElement) document.activeElement.blur();

    const code = document.getElementById('messageCode').value;
    const text = document.getElementById('messageInput').value;
    
    if (!text) return showAppStatus("Bitte Text eingeben.", 'error');
    if (!code || code.length !== 5) return showAppStatus("5-stelliger Code fehlt.", 'error');
    if (!currentUser) return showAppStatus("Nicht eingeloggt.", 'error');

    const btn = document.getElementById('actionBtn');
    const oldTxt = btn.textContent;
    btn.textContent = "⏳ ..."; btn.disabled = true;

    try {
        let result = "";
        if (currentMode === 'encrypt') {
            const rInput = document.getElementById('recipientName').value;
            let rIDs = rInput ? rInput.split(',').map(s=>s.trim()).filter(s=>s) : [];
            
            // Absender immer hinzufügen
            if(!rIDs.includes(currentUser)) rIDs.push(currentUser);

            result = await encryptFull(text, code, rIDs);
        } else {
            result = await decryptFull(text, code, currentUser);
        }

        document.getElementById('messageOutput').value = result;
        document.getElementById('outputGroup').style.display = 'block';
        document.getElementById('messageOutput').scrollIntoView({ behavior:'smooth' });

    } catch (err) {
        console.error(err);
        let msg = err.message || "Fehler";
        if (msg.includes("Berechtigung") || msg.includes("Code")) {
             showAppStatus("ZUGRIFF VERWEIGERT! Falscher Code?", 'error');
        } else {
             showAppStatus("Fehler: " + msg, 'error');
        }
    } finally {
        btn.textContent = oldTxt; btn.disabled = false;
    }
}

// AUTHENTIFIZIERUNG (Kurzform)
async function handleLogin(e) {
    e.preventDefault();
    const u = document.getElementById('username').value;
    const c = document.getElementById('accessCode').value;
    const btn = document.getElementById('loginBtn');
    btn.disabled = true;

    try {
        const devId = getDeviceId();
        const res = await fetch(`${API_BASE}/auth/login`, {
            method: 'POST', headers: {'Content-Type':'application/json'},
            body: JSON.stringify({ username:u, accessCode:c, deviceId:devId })
        });
        const data = await res.json();
        
        if (data.success) {
            authToken = data.token; currentUser = data.username;
            localStorage.setItem('sm_token', authToken); localStorage.setItem('sm_user', currentUser);
            
            updateSidebarInfo(currentUser, data.expiresAt || 'lifetime');
            showSection('mainSection');
        } else {
            showAppStatus(data.error || "Login fehlgeschlagen", 'error');
        }
    } catch(err) { showAppStatus("Serverfehler", 'error'); } 
    finally { btn.disabled = false; }
}

async function handleActivation(e) {
    e.preventDefault();
    // Payload bauen
    const payload = {
        licenseKey: document.getElementById('licenseKey').value,
        username: document.getElementById('newUsername').value,
        accessCode: document.getElementById('newAccessCode').value,
        deviceId: getDeviceId()
    };
    try {
        const res = await fetch(`${API_BASE}/auth/activate`, {
            method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload)
        });
        const d = await res.json();
        if(d.success) {
            alert("Erfolg! Bitte einloggen."); showSection('loginSection');
            document.getElementById('username').value = payload.username;
        } else {
            showAppStatus(d.error, 'error');
        }
    } catch(e) { showAppStatus("Serverfehler", 'error'); }
}

async function handleLogout() {
    localStorage.removeItem('sm_token'); localStorage.removeItem('sm_user');
    currentUser=null; authToken=null;
    updateSidebarInfo(null);
    document.getElementById('sidebar').classList.remove('active');
    showSection('loginSection');
}

// HELPER
function getDeviceId() {
    let id = localStorage.getItem('sm_device_id');
    if(!id) { id = 'dev-'+Date.now(); localStorage.setItem('sm_device_id', id); }
    return id;
}

function updateSidebarInfo(user, expiry) {
    const lblUser = document.getElementById('sidebarUser');
    const lblLic = document.getElementById('sidebarLicense');
    
    if(user) {
        lblUser.textContent = user;
        lblLic.textContent = "LIZENZ: Aktiv";
        document.querySelectorAll('.auth-only').forEach(e=>e.style.display='flex');
    } else {
        lblUser.textContent = "Gast";
        lblLic.textContent = "Nicht verbunden";
        document.querySelectorAll('.auth-only').forEach(e=>e.style.display='none');
    }
}

async function checkExistingSession() {
    const t = localStorage.getItem('sm_token');
    const u = localStorage.getItem('sm_user');
    if(t && u) {
        // Token Check (optional hier Fetch)
        authToken = t; currentUser = u;
        updateSidebarInfo(u, 'lifetime');
        showSection('mainSection');
    } else {
        showSection('loginSection');
    }
}

function showSection(id) {
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    document.getElementById(id).classList.add('active');
    const wrapper = document.getElementById('headerSwitchWrapper');
    if(id === 'mainSection') wrapper.style.display = 'inline-block';
    else wrapper.style.display = 'none';
}

function copyToClipboard() {
    const out = document.getElementById('messageOutput');
    out.select();
    navigator.clipboard.writeText(out.value);
    const btn = document.getElementById('copyBtn');
    btn.textContent = "OK"; setTimeout(()=>btn.textContent="📋 KOPIEREN", 1500);
}

function showQRModal(text) {
    const modal = document.getElementById('qrModal');
    const container = document.getElementById('qrDisplay');
    
    container.innerHTML = ""; // Alten Code löschen
    modal.classList.add('active');

    // QRCode Bibliothek nutzen (global verfügbar durch script tag)
    // Wir warten kurz, damit das Modal sichtbar ist (für korrekte Dimensionen)
    setTimeout(() => {
        new QRCode(container, {
            text: text,
            width: 200,
            height: 200,
            colorDark : "#000000",
            colorLight : "#ffffff",
            correctLevel : QRCode.CorrectLevel.M
        });
    }, 50);
}

function downloadQR() {
    const container = document.getElementById('qrDisplay');
    const img = container.querySelector('img'); // Die Library erzeugt ein <img> tag

    if (img && img.src) {
        const link = document.createElement('a');
        link.href = img.src;
        link.download = `secure-msg-${Date.now()}.png`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        showAppStatus("QR-Code gespeichert!", 'success');
    } else {
        // Fallback, falls Library Canvas nutzt statt Img (Browser-abhängig)
        const canvas = container.querySelector('canvas');
        if (canvas) {
            const link = document.createElement('a');
            link.href = canvas.toDataURL("image/png");
            link.download = `secure-msg-${Date.now()}.png`;
            link.click();
            showAppStatus("QR-Code gespeichert!", 'success');
        } else {
            showAppStatus("Fehler beim Speichern.", 'error');
        }
    }
}


// --- 2. SCANNEN (KAMERA) ---

let html5QrCodeScanner = null;

function startQRScanner() {
    const modal = document.getElementById('qrScannerModal');
    modal.classList.add('active');

    // Scanner Instanz erstellen (falls nicht vorhanden)
    if (!html5QrCodeScanner) {
        html5QrCodeScanner = new Html5Qrcode("qr-reader");
    }

    const config = { fps: 10, qrbox: { width: 250, height: 250 } };
    
    // Kamera starten (facingMode: "environment" = Rückkamera auf Handys)
    html5QrCodeScanner.start(
        { facingMode: "environment" }, 
        config, 
        onScanSuccess, 
        onScanFailure
    ).catch(err => {
        console.error("Kamera Fehler:", err);
        showAppStatus("Kein Kamerazugriff. Bitte HTTPS nutzen oder Berechtigung erteilen.", 'error');
        modal.classList.remove('active');
    });
}

function onScanSuccess(decodedText, decodedResult) {
    // 1. Scanner stoppen
    stopQRScanner();
    
    // 2. Text einfügen
    const inputField = document.getElementById('messageInput');
    inputField.value = decodedText;
    
    // 3. Feedback
    showAppStatus("QR-Code erfolgreich gescannt!", 'success');
    
    // Optional: Automatisch Fokus auf das Code-Feld setzen
    document.getElementById('messageCode').focus();
}

function onScanFailure(error) {
    // Wird oft aufgerufen, wenn im Frame kein QR Code ist -> Ignorieren
    // console.warn(`Scan error: ${error}`);
}

function stopQRScanner() {
    const modal = document.getElementById('qrScannerModal');
    modal.classList.remove('active');

    if (html5QrCodeScanner) {
        html5QrCodeScanner.stop().then(() => {
            html5QrCodeScanner.clear();
        }).catch(err => {
            console.error("Stop failed", err);
        });
    }
}
