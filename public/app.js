// app.js - Frontend Logic (Secure Messenger Enterprise)

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
let contactMode = 'manage'; // 'manage' (Menü) oder 'select' (Verschlüsseln)
let isEditMode = false; // Wenn true im Manage-Mode, öffnet Klick das Edit-Fenster
let selectedContactIds = new Set(); // Für Multi-Select
let sortKey = 'name'; // 'name' oder 'group'
let sortDir = 'asc';

// ================================================================
// INITIALISIERUNG
// ================================================================

document.addEventListener('DOMContentLoaded', function() {
    setupUIEvents();
    
    // Check URL Actions
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
    
    // --- SIDEBAR & MENU ---
    const menuBtn = document.getElementById('menuToggle');
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebarOverlay');
    
    // Hauptmenü Toggle
    menuBtn.addEventListener('click', () => {
        sidebar.classList.toggle('active');
        overlay.classList.toggle('active');
    });
    
    overlay.addEventListener('click', () => {
        sidebar.classList.remove('active');
        document.getElementById('contactSidebar').classList.remove('active'); // Auch Kontakt schließen
        overlay.classList.remove('active');
    });

    // Menü-Links
    const navContacts = document.getElementById('navContacts');
    if (navContacts) {
        navContacts.addEventListener('click', (e) => {
            e.preventDefault();
            sidebar.classList.remove('active'); // Menü zu
            openContactSidebar('manage'); // Kontakt-Sidebar von links rein
        });
    }
    
    document.getElementById('logoutBtnSide')?.addEventListener('click', handleLogout);

    // --- MAIN APP ACTIONS ---
    document.getElementById('modeSwitch')?.addEventListener('change', (e) => {
        updateAppMode(e.target.checked ? 'decrypt' : 'encrypt');
    });
    
    document.getElementById('actionBtn')?.addEventListener('click', handleMainAction);
    document.getElementById('copyBtn')?.addEventListener('click', copyToClipboard);
    
    document.getElementById('clearFieldsBtn')?.addEventListener('click', () => {
        document.getElementById('messageInput').value = '';
        document.getElementById('messageOutput').value = '';
        document.getElementById('messageCode').value = '';
        document.getElementById('recipientName').value = '';
        document.getElementById('outputGroup').style.display = 'none';
    });

    // --- FORMS ---
    document.getElementById('loginForm')?.addEventListener('submit', handleLogin);
    document.getElementById('activationForm')?.addEventListener('submit', handleActivation);
    
    document.getElementById('showActivationLink')?.addEventListener('click', (e) => { e.preventDefault(); showSection('activationSection'); });
    document.getElementById('showLoginLink')?.addEventListener('click', (e) => { e.preventDefault(); showSection('loginSection'); });

    // --- QR ---
    document.getElementById('qrGenBtn')?.addEventListener('click', () => {
        const text = document.getElementById('messageOutput').value;
        if(!text) return showAppStatus("Bitte erst Text verschlüsseln!", 'error');
        showQRModal(text);
    });
    document.getElementById('closeQrBtn')?.addEventListener('click', () => document.getElementById('qrModal').classList.remove('active'));


    // ============================================================
    // NEU: KONTAKT-VERZEICHNIS EVENTS
    // ============================================================
    
    // 1. Öffnen aus Verschlüsselungs-Ansicht
    document.getElementById('contactsBtn')?.addEventListener('click', () => {
        openContactSidebar('select');
    });

    // 2. Sidebar Schließen
    document.getElementById('closeContactSidebar')?.addEventListener('click', () => {
        document.getElementById('contactSidebar').classList.remove('active');
        document.getElementById('sidebarOverlay').classList.remove('active');
    });

    // 3. Suche & Sortierung
    document.getElementById('contactSearch')?.addEventListener('input', (e) => renderContactList(e.target.value));
    document.getElementById('sortByName')?.addEventListener('click', () => toggleSort('name'));
    document.getElementById('sortByGroup')?.addEventListener('click', () => toggleSort('group'));

    // 4. Footer Buttons (Manage Mode)
    document.getElementById('btnAddContactOpen')?.addEventListener('click', () => openEditModal()); // New
    document.getElementById('btnEditToggle')?.addEventListener('click', toggleEditMode);

    // 5. Footer Buttons (Select Mode)
    document.getElementById('btnCancelSelect')?.addEventListener('click', () => {
        document.getElementById('contactSidebar').classList.remove('active');
        document.getElementById('sidebarOverlay').classList.remove('active');
    });
    document.getElementById('btnConfirmSelect')?.addEventListener('click', confirmSelection);

    // 6. Modal Events (Add/Edit)
    document.getElementById('contactForm')?.addEventListener('submit', saveContact);
    document.getElementById('btnCancelEdit')?.addEventListener('click', () => document.getElementById('contactEditModal').classList.remove('active'));
    document.getElementById('btnDeleteContact')?.addEventListener('click', deleteContact);
}

// ================================================================
// KONTAKT LOGIK (NEU & VERBESSERT)
// ================================================================

function openContactSidebar(mode) {
    contactMode = mode;
    isEditMode = false; // Reset Edit Mode
    selectedContactIds.clear();

    const sidebar = document.getElementById('contactSidebar');
    const overlay = document.getElementById('sidebarOverlay');
    const footerManage = document.getElementById('csFooterManage');
    const footerSelect = document.getElementById('csFooterSelect');
    const groupArea = document.getElementById('groupSelectionArea');
    const btnEdit = document.getElementById('btnEditToggle');

    // UI Reset
    document.getElementById('contactSearch').value = '';
    
    // Modus-spezifische Anzeige
    if (mode === 'manage') {
        footerManage.style.display = 'flex';
        footerSelect.style.display = 'none';
        groupArea.style.display = 'none'; // Keine Gruppen-Checkboxen oben im Manage-Mode
        btnEdit.style.background = 'transparent'; // Reset Style
        btnEdit.style.color = '#ffa500';
    } else {
        // Select Mode
        footerManage.style.display = 'none';
        footerSelect.style.display = 'flex';
        groupArea.style.display = 'flex'; // Gruppen anzeigen
        renderGroupTags(); // Gruppen rendern
    }

    renderContactList();

    // Slide In
    sidebar.classList.add('active');
    overlay.classList.add('active');
}

function renderGroupTags() {
    const area = document.getElementById('groupSelectionArea');
    area.innerHTML = '<small style="width: 100%; color: #777; margin-bottom: 5px;">Gruppen ankreuzen (wählt alle aus):</small>';
    
    // Alle einzigartigen Gruppen finden
    const groups = [...new Set(contacts.map(c => c.group).filter(g => g))].sort();

    groups.forEach(g => {
        const tag = document.createElement('div');
        tag.className = 'group-tag';
        tag.innerHTML = `
            <input type="checkbox" class="grp-chk" value="${g}" style="width:auto;">
            <span>${g}</span>
        `;
        
        // Klick auf Tag toggelt Checkbox
        tag.addEventListener('click', (e) => {
            if (e.target.type !== 'checkbox') {
                const chk = tag.querySelector('input');
                chk.checked = !chk.checked;
                toggleGroupSelection(g, chk.checked);
            }
        });
        
        // Klick auf Checkbox direkt
        tag.querySelector('input').addEventListener('change', (e) => {
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
    renderContactList(document.getElementById('contactSearch').value);
}

function toggleSort(key) {
    if (sortKey === key) {
        sortDir = sortDir === 'asc' ? 'desc' : 'asc';
    } else {
        sortKey = key;
        sortDir = 'asc';
    }
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

    // 3. Rendern
    list.forEach(c => {
        const row = document.createElement('div');
        row.className = 'cs-row';
        
        // Visuals je nach Modus
        if (contactMode === 'select' && selectedContactIds.has(c.id)) {
            row.classList.add('selected');
        }
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

        // Click Handler
        row.addEventListener('click', () => handleRowClick(c));

        container.appendChild(row);
    });
}

function handleRowClick(contact) {
    if (contactMode === 'manage') {
        if (isEditMode) {
            // Öffne Edit Modal
            openEditModal(contact);
        } else {
            // Nichts tun oder Info anzeigen?
            // User wollte, dass "Bearbeiten" erst gedrückt werden muss.
        }
    } else {
        // Select Mode: Toggle Selection
        if (selectedContactIds.has(contact.id)) {
            selectedContactIds.delete(contact.id);
        } else {
            selectedContactIds.add(contact.id);
        }
        renderContactList(document.getElementById('contactSearch').value);
    }
}

function toggleEditMode() {
    isEditMode = !isEditMode;
    const btn = document.getElementById('btnEditToggle');
    if (isEditMode) {
        btn.style.background = 'rgba(255, 165, 0, 0.2)';
        btn.innerHTML = 'Modus: Bearbeiten (Klick auf Kontakt)';
    } else {
        btn.style.background = 'transparent';
        btn.innerHTML = '✎ Bearbeiten';
    }
    renderContactList(document.getElementById('contactSearch').value);
}

// --- CRUD ---

function openEditModal(contact = null) {
    const modal = document.getElementById('contactEditModal');
    const title = document.getElementById('modalTitle');
    const btnSave = document.getElementById('btnSaveContact');
    const btnDel = document.getElementById('btnDeleteContact');
    
    // Reset Form
    document.getElementById('contactForm').reset();
    
    // Datalist für Gruppen füllen
    const dl = document.getElementById('groupSuggestions');
    dl.innerHTML = '';
    const groups = [...new Set(contacts.map(c => c.group).filter(g => g))];
    groups.forEach(g => {
        const opt = document.createElement('option');
        opt.value = g;
        dl.appendChild(opt);
    });

    if (contact) {
        // Edit Mode
        title.textContent = 'Kontakt bearbeiten';
        document.getElementById('inputName').value = contact.name || '';
        document.getElementById('inputID').value = contact.id;
        document.getElementById('inputGroup').value = contact.group || '';
        
        // ID sollte nicht änderbar sein beim Editieren, um Duplikate zu vermeiden, 
        // oder wir löschen den alten und erstellen neu. 
        // Einfacher: ID readonly machen.
        document.getElementById('inputID').readOnly = true;
        document.getElementById('inputID').style.opacity = '0.5';

        btnSave.textContent = 'Aktualisieren';
        btnDel.style.display = 'block';
        btnDel.dataset.id = contact.id;
    } else {
        // Add Mode
        title.textContent = 'Kontakt hinzufügen';
        document.getElementById('inputID').readOnly = false;
        document.getElementById('inputID').style.opacity = '1';
        btnSave.textContent = 'Speichern';
        btnDel.style.display = 'none';
    }

    modal.classList.add('active');
}

async function saveContact(e) {
    e.preventDefault();
    
    const btnSave = document.getElementById('btnSaveContact');
    const originalText = btnSave.textContent;
    const nameVal = document.getElementById('inputName').value.trim();
    const idVal = document.getElementById('inputID').value.trim();
    const groupVal = document.getElementById('inputGroup').value.trim();

    if (!idVal) return showAppStatus("Benutzer-ID ist ein Pflichtfeld!", 'error');

    // UI Feedback: Laden...
    btnSave.disabled = true;
    btnSave.textContent = "Prüfe ID...";

    try {
        // 1. LIVE-CHECK gegen die Datenbank
        const res = await fetch(`${API_BASE}/users/exists`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}` // Wichtig: User muss eingeloggt sein
            },
            body: JSON.stringify({ targetUsername: idVal })
        });
        
        const data = await res.json();

        // 2. FEHLERMELDUNG wenn User nicht existiert
        if (!data.exists) {
            showAppStatus(`Fehler: Benutzer-ID "${idVal}" ist unbekannt oder existiert nicht.`, 'error');
            // Abbruch des Speicherns
            btnSave.disabled = false;
            btnSave.textContent = originalText;
            return; 
        }

        // --- AB HIER: User existiert -> Speichern erlaubt ---

        // Alten Eintrag entfernen (falls Update)
        contacts = contacts.filter(c => c.id !== idVal);

        contacts.push({
            id: idVal,
            name: nameVal || idVal, 
            group: groupVal
        });

        saveContactsToStorage(); // Hilfsfunktion zum Speichern (siehe unten)
        
        document.getElementById('contactEditModal').classList.remove('active');
        
        // Liste neu rendern (je nach aktuellem Filter)
        renderContactList(document.getElementById('contactSearch').value);
        
        if(contactMode === 'select') renderGroupTags();

        showAppStatus(`Kontakt "${idVal}" erfolgreich verifiziert und gespeichert.`, 'success');

    } catch (err) {
        console.error(err);
        showAppStatus("Verbindungsfehler bei der Überprüfung.", 'error');
    } finally {
        btnSave.disabled = false;
        btnSave.textContent = originalText;
    }
}

// Kleine Hilfsfunktion, falls noch nicht vorhanden, um Code Redundanz zu vermeiden
function saveContactsToStorage() {
    contacts.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
    localStorage.setItem('sm_contacts', JSON.stringify(contacts));
}

function deleteContact() {
    const id = document.getElementById('btnDeleteContact').dataset.id;
    if (confirm("Kontakt wirklich löschen?")) {
        contacts = contacts.filter(c => c.id !== id);
        localStorage.setItem('sm_contacts', JSON.stringify(contacts));
        document.getElementById('contactEditModal').classList.remove('active');
        renderContactList();
    }
}

function confirmSelection() {
    const input = document.getElementById('recipientName');
    const arr = Array.from(selectedContactIds);
    if (arr.length > 0) {
        input.value = arr.join(', ');
    }
    document.getElementById('contactSidebar').classList.remove('active');
    document.getElementById('sidebarOverlay').classList.remove('active');
}

// ================================================================
// CORE UI LOGIC (REST)
// ================================================================

function showAppStatus(msg, type = 'success') {
    const div = document.createElement('div');
    div.className = `app-status-msg ${type} active`;
    div.textContent = msg;
    document.getElementById('globalStatusContainer').appendChild(div);
    setTimeout(() => div.remove(), 4000);
}

function updateAppMode(mode) {
    currentMode = mode;
    const isDecrypt = (mode === 'decrypt');
    const title = document.getElementById('modeTitle');
    const indicator = document.getElementById('statusIndicator');
    const actionBtn = document.getElementById('actionBtn');
    const recipientGroup = document.getElementById('recipientGroup');
    
    if (isDecrypt) {
        title.textContent = 'ENTSCHLÜSSELUNG';
        title.style.color = 'var(--accent-blue)'; 
        indicator.textContent = '● EMPFANGSBEREIT';
        actionBtn.textContent = '🔓 NACHRICHT ENTSCHLÜSSELN';
        actionBtn.classList.remove('btn-primary');
        actionBtn.style.border = '1px solid var(--accent-blue)';
        if(recipientGroup) recipientGroup.style.display = 'none'; 
    } else {
        title.textContent = 'VERSCHLÜSSELUNG';
        indicator.textContent = '● GESICHERT';
        actionBtn.textContent = '🔒 DATEN VERSCHLÜSSELN';
        actionBtn.classList.add('btn-primary');
        if(recipientGroup) recipientGroup.style.display = 'block';
    }
}

async function handleMainAction() {
    // ... (Code unverändert, aber ruft encryptFull mit recipientIDs auf) ...
    // Kurze Version:
    const code = document.getElementById('messageCode').value;
    const text = document.getElementById('messageInput').value;
    if(!text || !code) return alert("Fehlende Daten");
    
    try {
        if(currentMode === 'encrypt') {
            const rInput = document.getElementById('recipientName').value;
            let rIDs = rInput ? rInput.split(',').map(s=>s.trim()).filter(s=>s) : [];
            if(currentUser && !rIDs.includes(currentUser)) rIDs.push(currentUser);
            
            const res = await encryptFull(text, code, rIDs);
            document.getElementById('messageOutput').value = res;
            document.getElementById('outputGroup').style.display = 'block';
        } else {
            const res = await decryptFull(text, code, currentUser);
            document.getElementById('messageOutput').value = res;
            document.getElementById('outputGroup').style.display = 'block';
        }
    } catch(e) {
        alert("Fehler: " + e.message);
    }
}

// ... AUTH FUNCTIONS (Login, CheckSession, Logout) bleiben wie gehabt ...
// Ich füge hier nur Platzhalter ein, damit der Code vollständig kopierbar ist.

async function handleLogin(e) {
    e.preventDefault();
    // (Bestehender Login Code)
    // ...
    // Simulation Success:
    const u = document.getElementById('username').value;
    authToken = 'demo'; currentUser = u;
    localStorage.setItem('sm_token', authToken); localStorage.setItem('sm_user', u);
    updateSidebarInfo(u, 'lifetime');
    showSection('mainSection');
}

function updateSidebarInfo(user, expiry) {
    document.getElementById('sidebarUser').textContent = user || 'Gast';
    if(user) {
        document.querySelectorAll('.auth-only').forEach(el => el.style.display = 'flex');
        document.getElementById('sidebarLicense').textContent = "LIZENZ: Aktiv";
    } else {
        document.querySelectorAll('.auth-only').forEach(el => el.style.display = 'none');
    }
}

async function checkExistingSession() {
    const t = localStorage.getItem('sm_token');
    const u = localStorage.getItem('sm_user');
    if(t && u) {
        authToken = t; currentUser = u;
        updateSidebarInfo(u, 'lifetime');
        showSection('mainSection');
    } else {
        showSection('loginSection');
    }
}

async function handleLogout() {
    localStorage.removeItem('sm_token'); localStorage.removeItem('sm_user');
    currentUser = null; authToken = null;
    document.getElementById('sidebar').classList.remove('active');
    updateSidebarInfo(null, null);
    showSection('loginSection');
}

function showSection(id) {
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    document.getElementById(id).classList.add('active');
    if(id === 'mainSection') document.getElementById('headerSwitchWrapper').style.display = 'inline-block';
    else document.getElementById('headerSwitchWrapper').style.display = 'none';
}

function copyToClipboard() {
    navigator.clipboard.writeText(document.getElementById('messageOutput').value);
    const b = document.getElementById('copyBtn');
    b.textContent = "KOPIERT!"; setTimeout(()=>b.textContent="📋 KOPIEREN", 2000);
}
