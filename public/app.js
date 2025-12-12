// app.js - Frontend Logic (Complete: Sidebar, Contacts, Guide, Info, Security)

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
let selectedContactIds = new Set(); // Set für ausgewählte IDs
let sortKey = 'name';       
let sortDir = 'asc';        

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

    menuBtn?.addEventListener('click', () => toggleMainMenu());
    
    // Overlay schließt BEIDE Sidebars
    overlay?.addEventListener('click', () => {
        toggleMainMenu(true);
        closeContactSidebar();
    });

    // 1. LINK: KONTAKTVERZEICHNIS
    document.getElementById('navContacts')?.addEventListener('click', (e) => {
        e.preventDefault();
        toggleMainMenu(true); // Hauptmenü zu
        openContactSidebar('manage'); // Kontakt-Sidebar auf
    });

    // 2. LINK: ANLEITUNG (NEU)
    document.getElementById('navGuide')?.addEventListener('click', (e) => {
        e.preventDefault();
        toggleMainMenu(true);
        showSection('guideSection');
    });

    // 3. LINK: INFO & SICHERHEIT (NEU)
    document.getElementById('navInfo')?.addEventListener('click', (e) => {
        e.preventDefault();
        toggleMainMenu(true);
        showSection('infoSection');
    });

    // 4. LINK: ABMELDEN
    document.getElementById('logoutBtnSide')?.addEventListener('click', handleLogout);

    // 5. LINK: ZUGANG LÖSCHEN (NEU)
    document.getElementById('navDelete')?.addEventListener('click', (e) => {
        e.preventDefault();
        toggleMainMenu(true);
        confirmDeleteAccount();
    });

    // WICHTIG: Helper für "Zurück zur App" Buttons in den HTML Sections
    // Wir erstellen ein unsichtbares Element, auf das die HTML-Buttons klicken
    const backDummy = document.createElement('div');
    backDummy.id = 'navBackToApp';
    document.body.appendChild(backDummy);
    backDummy.addEventListener('click', () => {
        if(currentUser) showSection('mainSection');
        else showSection('loginSection');
    });

    // --- BUTTONS AM EMPFÄNGERFELD ---
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

    // --- QR CODE ---
    document.getElementById('qrGenBtn')?.addEventListener('click', () => {
        const text = document.getElementById('messageOutput').value;
        if(!text) return showAppStatus("Bitte erst Text verschlüsseln!", 'error');
        showQRModal(text);
    });
    document.getElementById('closeQrBtn')?.addEventListener('click', () => document.getElementById('qrModal').classList.remove('active'));
    document.getElementById('saveQrBtn')?.addEventListener('click', downloadQR);

    document.getElementById('qrScanBtn')?.addEventListener('click', startQRScanner);
    document.getElementById('closeScannerBtn')?.addEventListener('click', stopQRScanner);


    // --- KONTAKT-SIDEBAR EVENTS ---
    document.getElementById('closeContactSidebar')?.addEventListener('click', closeContactSidebar);
    document.getElementById('contactSearch')?.addEventListener('input', (e) => renderContactList(e.target.value));
    document.getElementById('sortByName')?.addEventListener('click', () => toggleSort('name'));
    document.getElementById('sortByGroup')?.addEventListener('click', () => toggleSort('group'));
    
    document.getElementById('btnAddContactOpen')?.addEventListener('click', () => openEditModal()); 
    document.getElementById('btnEditToggle')?.addEventListener('click', toggleEditMode);
    
    document.getElementById('btnCancelSelect')?.addEventListener('click', closeContactSidebar);
    document.getElementById('btnConfirmSelect')?.addEventListener('click', confirmSelection);
    
    document.getElementById('contactForm')?.addEventListener('submit', saveContact);
    document.getElementById('btnCancelEdit')?.addEventListener('click', () => document.getElementById('contactEditModal').classList.remove('active'));
    document.getElementById('btnDeleteContact')?.addEventListener('click', deleteContact);
}


// ================================================================
// KONTAKT-VERZEICHNIS LOGIK
// ================================================================

function openContactSidebar(mode) {
    contactMode = mode;
    isEditMode = false; 
    selectedContactIds.clear(); 

    const sidebar = document.getElementById('contactSidebar');
    const overlay = document.getElementById('sidebarOverlay');
    
    const footerManage = document.getElementById('csFooterManage');
    const footerSelect = document.getElementById('csFooterSelect');
    const groupArea = document.getElementById('groupSelectionArea');
    const btnEdit = document.getElementById('btnEditToggle');

    document.getElementById('contactSearch').value = '';
    btnEdit.style.background = 'transparent';
    btnEdit.innerHTML = '✎ Bearbeiten';

    if (mode === 'manage') {
        footerManage.style.display = 'flex';
        footerSelect.style.display = 'none';
        groupArea.style.display = 'none'; 
    } else {
        footerManage.style.display = 'none';
        footerSelect.style.display = 'flex';
        groupArea.style.display = 'flex'; 
        renderGroupTags(); 
    }

    renderContactList(); 
    sidebar.classList.add('active');
    overlay.classList.add('active');
}

function closeContactSidebar() {
    document.getElementById('contactSidebar').classList.remove('active');
    document.getElementById('sidebarOverlay').classList.remove('active');
}

function renderGroupTags() {
    const area = document.getElementById('groupSelectionArea');
    area.innerHTML = '<small style="width: 100%; color: #777; margin-bottom: 5px;">Gruppen ankreuzen (wählt alle aus):</small>';
    
    const groups = [...new Set(contacts.map(c => c.group).filter(g => g))].sort();
    if (groups.length === 0) {
        area.innerHTML += '<span style="color:#555; font-size:0.8rem;">Keine Gruppen vorhanden.</span>';
        return;
    }

    groups.forEach(g => {
        const tag = document.createElement('div');
        tag.className = 'group-tag';
        tag.innerHTML = `
            <input type="checkbox" class="grp-chk" value="${g}" style="width:auto; margin-right:5px;">
            <span>${g}</span>
        `;
        const chk = tag.querySelector('input');
        tag.addEventListener('click', (e) => {
            if (e.target !== chk) { chk.checked = !chk.checked; toggleGroupSelection(g, chk.checked); }
        });
        chk.addEventListener('change', (e) => toggleGroupSelection(g, e.target.checked));
        area.appendChild(tag);
    });
}

function toggleGroupSelection(groupName, isSelected) {
    const members = contacts.filter(c => c.group === groupName);
    members.forEach(m => {
        if (isSelected) selectedContactIds.add(m.id);
        else selectedContactIds.delete(m.id);
    });
    renderContactList(document.getElementById('contactSearch').value);
}

function toggleSort(key) {
    if (sortKey === key) sortDir = sortDir === 'asc' ? 'desc' : 'asc';
    else { sortKey = key; sortDir = 'asc'; }
    
    document.getElementById('sortByName').textContent = `Empfänger ${sortKey==='name' ? (sortDir==='asc'?'▲':'▼') : '↕'}`;
    document.getElementById('sortByGroup').textContent = `Gruppe ${sortKey==='group' ? (sortDir==='asc'?'▲':'▼') : '↕'}`;
    renderContactList(document.getElementById('contactSearch').value);
}

function renderContactList(search = '') {
    const container = document.getElementById('contactListBody');
    container.innerHTML = '';
    const term = search.toLowerCase();

    let list = contacts.filter(c => 
        (c.name && c.name.toLowerCase().includes(term)) || 
        c.id.toLowerCase().includes(term) ||
        (c.group && c.group.toLowerCase().includes(term))
    );

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

    list.forEach(c => {
        const row = document.createElement('div');
        row.className = 'cs-row';
        if (contactMode === 'select' && selectedContactIds.has(c.id)) row.classList.add('selected');
        if (contactMode === 'manage' && isEditMode) row.classList.add('edit-mode-active');

        row.innerHTML = `
            <div style="display:flex; flex-direction:column; flex:2; overflow:hidden;">
                <span style="font-weight:bold; color:#fff;">${c.name || c.id}</span>
                ${c.name ? `<span style="font-size:0.75rem; color:#666;">ID: ${c.id}</span>` : ''}
            </div>
            <div style="flex:1; text-align:right; font-size:0.8rem; color:var(--accent-blue);">${c.group || '-'}</div>
        `;
        row.addEventListener('click', () => handleRowClick(c));
        container.appendChild(row);
    });
}

function handleRowClick(contact) {
    if (contactMode === 'manage') {
        if (isEditMode) openEditModal(contact);
    } else {
        if (selectedContactIds.has(contact.id)) selectedContactIds.delete(contact.id);
        else selectedContactIds.add(contact.id);
        renderContactList(document.getElementById('contactSearch').value);
    }
}

function toggleEditMode() {
    isEditMode = !isEditMode;
    const btn = document.getElementById('btnEditToggle');
    if (isEditMode) {
        btn.style.background = 'rgba(255, 165, 0, 0.2)';
        btn.textContent = 'Modus: Bearbeiten';
    } else {
        btn.style.background = 'transparent';
        btn.textContent = '✎ Bearbeiten';
    }
    renderContactList(document.getElementById('contactSearch').value);
}

function openEditModal(contact = null) {
    const modal = document.getElementById('contactEditModal');
    const title = document.getElementById('modalTitle');
    const btnSave = document.getElementById('btnSaveContact');
    const btnDel = document.getElementById('btnDeleteContact');
    
    document.getElementById('contactForm').reset();
    
    const dl = document.getElementById('groupSuggestions');
    dl.innerHTML = '';
    const groups = [...new Set(contacts.map(c => c.group).filter(g => g))];
    groups.forEach(g => dl.appendChild(new Option(g,g)));

    if (contact) {
        title.textContent = 'Kontakt bearbeiten';
        document.getElementById('inputName').value = contact.name || '';
        document.getElementById('inputID').value = contact.id;
        document.getElementById('inputGroup').value = contact.group || '';
        document.getElementById('inputID').readOnly = true;
        document.getElementById('inputID').style.opacity = '0.5';
        btnSave.textContent = 'Aktualisieren';
        btnDel.style.display = 'block';
        btnDel.dataset.id = contact.id;
    } else {
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

    if (!idVal) return showAppStatus("ID fehlt!", 'error');

    btnSave.disabled = true; btnSave.textContent = "Prüfe...";

    try {
        const res = await fetch(`${API_BASE}/users/exists`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
            body: JSON.stringify({ targetUsername: idVal })
        });
        const data = await res.json();

        if (!data.exists) {
            showAppStatus(`ID "${idVal}" nicht gefunden.`, 'error');
            btnSave.disabled = false; btnSave.textContent = originalText;
            return; 
        }

        contacts = contacts.filter(c => c.id !== idVal);
        contacts.push({ id: idVal, name: nameVal || idVal, group: groupVal });
        contacts.sort((a, b) => a.name.localeCompare(b.name));
        localStorage.setItem('sm_contacts', JSON.stringify(contacts));
        
        document.getElementById('contactEditModal').classList.remove('active');
        renderContactList(document.getElementById('contactSearch').value);
        if(contactMode === 'select') renderGroupTags();

        showAppStatus(`Kontakt gespeichert.`, 'success');

    } catch (err) {
        showAppStatus("Verbindungsfehler", 'error');
    } finally {
        btnSave.disabled = false; btnSave.textContent = originalText;
    }
}

function deleteContact() {
    const id = document.getElementById('btnDeleteContact').dataset.id;
    if (confirm("Kontakt wirklich löschen?")) {
        contacts = contacts.filter(c => c.id !== id);
        localStorage.setItem('sm_contacts', JSON.stringify(contacts));
        document.getElementById('contactEditModal').classList.remove('active');
        renderContactList();
        showAppStatus("Gelöscht.", 'success');
    }
}

function confirmSelection() {
    const input = document.getElementById('recipientName');
    const arr = Array.from(selectedContactIds);
    if (arr.length > 0) input.value = arr.join(', ');
    closeContactSidebar();
}


// ================================================================
// LOGIK: AUTH & ACCOUNT
// ================================================================

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
            updateSidebarInfo(currentUser);
            showSection('mainSection');
        } else {
            showAppStatus(data.error || "Login fehlgeschlagen", 'error');
        }
    } catch(err) { showAppStatus("Serverfehler", 'error'); } 
    finally { btn.disabled = false; }
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

async function confirmDeleteAccount() {
    if (!confirm("WARNUNG:\nDein Account wird unwiderruflich gelöscht!\nDeine ID und Lizenz sind danach weg.\n\nFortfahren?")) return;
    
    try {
        const res = await fetch(`${API_BASE}/auth/delete-account`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        const d = await res.json();
        if(d.success) {
            alert("Account gelöscht. Auf Wiedersehen.");
            handleLogout();
        } else {
            showAppStatus(d.error || "Fehler beim Löschen", 'error');
        }
    } catch(e) { showAppStatus("Fehler", 'error'); }
}


// ================================================================
// LOGIK: HAUPTAKTION & SEITEN
// ================================================================

function showSection(id) {
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    document.getElementById(id).classList.add('active');
    
    // Header-Switch nur auf der Hauptseite anzeigen
    const wrapper = document.getElementById('headerSwitchWrapper');
    if(id === 'mainSection') wrapper.style.display = 'inline-block';
    else wrapper.style.display = 'none';
    
    // Scroll nach oben
    window.scrollTo(0,0);
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
    const outGroup = document.getElementById('outputGroup');

    // Reset Fields
    document.getElementById('messageInput').value = '';
    document.getElementById('messageOutput').value = '';
    outGroup.style.display = 'none';

    if (isDecrypt) {
        title.textContent = 'ENTSCHLÜSSELUNG';
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

async function handleMainAction() {
    if (document.activeElement) document.activeElement.blur();

    const code = document.getElementById('messageCode').value;
    const text = document.getElementById('messageInput').value;
    
    if (!text) return showAppStatus("Kein Text eingegeben.", 'error');
    if (!code || code.length !== 5) return showAppStatus("5-stelliger Code fehlt.", 'error');
    if (!currentUser) return showAppStatus("Bitte einloggen.", 'error');

    const btn = document.getElementById('actionBtn');
    const oldTxt = btn.textContent;
    btn.textContent = "⏳ Verarbeite..."; btn.disabled = true;

    try {
        let result = "";
        if (currentMode === 'encrypt') {
            const rInput = document.getElementById('recipientName').value;
            let rIDs = rInput ? rInput.split(',').map(s=>s.trim()).filter(s=>s) : [];
            if(!rIDs.includes(currentUser)) rIDs.push(currentUser);

            result = await encryptFull(text, code, rIDs);
        } else {
            result = await decryptFull(text, code, currentUser);
        }

        document.getElementById('messageOutput').value = result;
        document.getElementById('outputGroup').style.display = 'block';
        
        // Scroll zum Ergebnis
        setTimeout(() => {
            document.getElementById('outputGroup').scrollIntoView({ behavior:'smooth', block:'nearest' });
        }, 100);

    } catch (err) {
        console.error(err);
        let msg = err.message || "Fehler";
        if (msg.includes("Berechtigung") || msg.includes("Code")) {
             showAppStatus("ZUGRIFF VERWEIGERT! Falscher Code oder falscher User.", 'error');
        } else {
             showAppStatus("Fehler: " + msg, 'error');
        }
    } finally {
        btn.textContent = oldTxt; btn.disabled = false;
    }
}


// ================================================================
// HELPER (QR, Status, etc.)
// ================================================================

function getDeviceId() {
    let id = localStorage.getItem('sm_device_id');
    if(!id) { id = 'dev-'+Date.now(); localStorage.setItem('sm_device_id', id); }
    return id;
}

function updateSidebarInfo(user) {
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
        authToken = t; currentUser = u;
        updateSidebarInfo(u);
        showSection('mainSection');
    } else {
        showSection('loginSection');
    }
}

function showAppStatus(msg, type = 'success') {
    const div = document.createElement('div');
    div.className = `app-status-msg ${type}`;
    div.textContent = msg;
    document.getElementById('globalStatusContainer').appendChild(div);
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

function copyToClipboard() {
    const out = document.getElementById('messageOutput');
    out.select();
    navigator.clipboard.writeText(out.value);
    const btn = document.getElementById('copyBtn');
    btn.textContent = "OK"; setTimeout(()=>btn.textContent="📋 KOPIEREN", 1500);
}


// --- QR CODE (Fixed Logic) ---

function showQRModal(text) {
    const modal = document.getElementById('qrModal');
    const container = document.getElementById('qrDisplay');
    modal.classList.add('active');
    container.innerHTML = "";
    
    if (typeof QRCode === 'undefined') {
        container.textContent = "QR Lib nicht geladen."; return;
    }

    try {
        new QRCode(container, {
            text: text,
            width: 190, height: 190,
            colorDark : "#000000", colorLight : "#ffffff",
            correctLevel : QRCode.CorrectLevel.L 
        });
    } catch (e) { container.textContent = "Fehler beim Erstellen."; }
}

function downloadQR() {
    const container = document.getElementById('qrDisplay');
    const img = container.querySelector('img'); 
    const canvas = container.querySelector('canvas');
    let url = "";
    if (img && img.src) url = img.src;
    else if (canvas) url = canvas.toDataURL("image/png");
    else return;

    const link = document.createElement('a');
    link.href = url; link.download = `secure-qr-${Date.now()}.png`;
    document.body.appendChild(link); link.click(); document.body.removeChild(link);
}

// Global für Scanner
let html5QrCode = null;

function startQRScanner() {
    // Basic HTTPS Check
    if (location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
        alert("Kamera benötigt HTTPS."); 
    }
    const modal = document.getElementById('qrScannerModal');
    modal.classList.add('active');

    if (!html5QrCode) html5QrCode = new Html5Qrcode("qr-reader");

    html5QrCode.start({ facingMode: "environment" }, { fps: 10, qrbox: 250 }, 
        (decodedText) => {
            stopQRScanner();
            document.getElementById('messageInput').value = decodedText;
            showAppStatus("QR erkannt!", 'success');
            document.getElementById('messageCode').focus();
        },
        () => {} // Ignore Errors
    ).catch(err => {
        document.getElementById('qr-reader').innerHTML = `<p style="color:red; padding:20px;">Kamera Fehler: ${err}</p>`;
    });
}

function stopQRScanner() {
    document.getElementById('qrScannerModal').classList.remove('active');
    if (html5QrCode) html5QrCode.stop().then(() => html5QrCode.clear()).catch(()=>{});
}
