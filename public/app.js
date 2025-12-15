// app.js - Frontend Logic (Final Polish: Custom Delete Modal & Fixed Navigation)

const APP_VERSION = 'v1.01';

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
let contactMode = 'manage'; 
let isEditMode = false;     
let selectedContactIds = new Set(); 
let sortKey = 'name';       
let sortDir = 'asc';        

// ================================================================
// INITIALISIERUNG
// ================================================================

document.addEventListener('DOMContentLoaded', function() {
    const verEl = document.getElementById('appVersion');
    if(verEl) verEl.textContent = APP_VERSION;

    setupUIEvents();
    
    // URL Check (Kauf-Rückkehr)
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('action') === 'activate') {
        showSection('activationSection');
    } else {
        // Standard-Start: Prüfen ob Session existiert, sonst Login zeigen (nicht Activation!)
        const token = localStorage.getItem('sm_token');
        if (token) {
            checkExistingSession();
        } else {
            showSection('loginSection');
        }
    }

    setupIdleTimer();
});

// ================================================================
// UI EVENT HANDLING
// ================================================================

function setupUIEvents() {
    
    // --- SIDEBAR (MENÜ) ---
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
    
    // Overlay Klick schließt alles
    overlay?.addEventListener('click', () => {
        toggleMainMenu(true);
        closeContactSidebar();
    });

    // Sidebar Links
    document.getElementById('navContacts')?.addEventListener('click', (e) => {
        e.preventDefault(); toggleMainMenu(true); openContactSidebar('manage');
    });

    document.getElementById('navGuide')?.addEventListener('click', (e) => {
        e.preventDefault(); toggleMainMenu(true); showSection('guideSection');
    });

    document.getElementById('navInfo')?.addEventListener('click', (e) => {
        e.preventDefault(); toggleMainMenu(true); showSection('infoSection');
    });

    // FAQ Handler
    document.getElementById('faqBtn')?.addEventListener('click', (e) => {
        e.preventDefault(); toggleMainMenu(true);
        document.getElementById('faqModal').classList.add('active');
    });
    document.getElementById('closeFaqBtn')?.addEventListener('click', () => {
        document.getElementById('faqModal').classList.remove('active');
    });

    // Close FAQ when clicking outside (on the backdrop)
    document.getElementById('faqModal')?.addEventListener('click', (e) => {
        if (e.target === document.getElementById('faqModal')) {
            document.getElementById('faqModal').classList.remove('active');
        }
    });

    document.getElementById('logoutBtnSide')?.addEventListener('click', handleLogout);
    document.getElementById('logoutBtnRenewal')?.addEventListener('click', handleLogout);

    // --- LOGO KLICK LOGIK (NEU) ---
    document.querySelector('.app-logo')?.addEventListener('click', () => {
        // Prüfen ob eingeloggt (Token existiert)
        const isLoggedIn = !!authToken;

        if (!isLoggedIn) {
            // FALL A: Nicht eingeloggt
            // Check if on login or activation section
            const loginActive = document.getElementById('loginSection').classList.contains('active');
            const activationActive = document.getElementById('activationSection').classList.contains('active');

            if (loginActive || activationActive) {
                window.location.href = 'landing.html';
            }
        } else {
            // FALL B: Eingeloggt -> Nichts tun (user intent: safe, no exit)
        }
    });

    // --- NAVIGATION & SEITEN (FIXED) ---
    
    // Funktion für "Zurück zur App"
    function goBackToMain() {
        if(currentUser) showSection('mainSection');
        else showSection('loginSection');
    }

    document.getElementById('btnBackGuide')?.addEventListener('click', goBackToMain);
    document.getElementById('btnBackInfo')?.addEventListener('click', goBackToMain);


    // --- ACCOUNT LÖSCHEN (NEUES LAYOUT) ---
    
    // 1. Klick im Menü -> Öffnet Warn-Modal
    document.getElementById('navDelete')?.addEventListener('click', (e) => {
        e.preventDefault();
        toggleMainMenu(true); // Menü zu
        document.getElementById('deleteAccountModal').classList.add('active'); // Modal auf
    });

    // 2. "Abbrechen" im Modal
    document.getElementById('btnCancelDelete')?.addEventListener('click', () => {
        document.getElementById('deleteAccountModal').classList.remove('active');
    });

    // 3. "Endgültig Löschen" im Modal -> Führt API Call aus
    document.getElementById('btnConfirmDelete')?.addEventListener('click', performAccountDeletion);


    // --- HAUPT APP EVENTS ---
    document.getElementById('contactsBtn')?.addEventListener('click', () => openContactSidebar('select'));
    
    document.getElementById('modeSwitch')?.addEventListener('change', (e) => {
        updateAppMode(e.target.checked ? 'decrypt' : 'encrypt');
    });
    document.getElementById('actionBtn')?.addEventListener('click', handleMainAction);
    document.getElementById('copyBtn')?.addEventListener('click', copyToClipboard);
    document.getElementById('clearFieldsBtn')?.addEventListener('click', clearAllFields);

    // Forms
    document.getElementById('loginForm')?.addEventListener('submit', handleLogin);
    document.getElementById('activationForm')?.addEventListener('submit', handleActivation);
    document.getElementById('showActivationLink')?.addEventListener('click', (e) => { e.preventDefault(); showSection('activationSection'); });
    document.getElementById('showLoginLink')?.addEventListener('click', (e) => { e.preventDefault(); showSection('loginSection'); });

    // QR
    document.getElementById('qrGenBtn')?.addEventListener('click', () => {
        const text = document.getElementById('messageOutput').value;
        if(!text) return showAppStatus("Bitte erst Text verschlüsseln!", 'error');
        showQRModal(text);
    });
    document.getElementById('closeQrBtn')?.addEventListener('click', () => document.getElementById('qrModal').classList.remove('active'));
    document.getElementById('saveQrBtn')?.addEventListener('click', downloadQR);

    document.getElementById('qrScanBtn')?.addEventListener('click', startQRScanner);
    document.getElementById('closeScannerBtn')?.addEventListener('click', stopQRScanner);

    // Kontakt Sidebar Events
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
// SEITEN LOGIK
// ================================================================

function showSection(id) {
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    document.getElementById(id).classList.add('active');
    
    const wrapper = document.getElementById('headerSwitchWrapper');
    if(id === 'mainSection') wrapper.style.display = 'inline-block';
    else wrapper.style.display = 'none';
    
    window.scrollTo(0,0);
}

// ================================================================
// ACCOUNT LÖSCHEN LOGIK (API)
// ================================================================

async function performAccountDeletion() {
    const btn = document.getElementById('btnConfirmDelete');
    const originalText = btn.textContent;
    btn.textContent = "Lösche..."; btn.disabled = true;

    try {
        const res = await fetch(`${API_BASE}/auth/delete-account`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        const d = await res.json();
        
        document.getElementById('deleteAccountModal').classList.remove('active'); // Modal zu
        
        if(d.success) {
            alert("Dein Account wurde erfolgreich gelöscht.");
            handleLogout();
        } else {
            showAppStatus(d.error || "Fehler beim Löschen", 'error');
        }
    } catch(e) { 
        showAppStatus("Verbindungsfehler", 'error'); 
        document.getElementById('deleteAccountModal').classList.remove('active');
    } finally {
        btn.textContent = originalText; btn.disabled = false;
    }
}


// ================================================================
// KONTAKT LOGIK (Unverändert gut)
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
    area.innerHTML = '<small style="width: 100%; color: #777; margin-bottom: 5px;">Gruppen ankreuzen:</small>';
    const groups = [...new Set(contacts.map(c => c.group).filter(g => g))].sort();
    if (groups.length === 0) { area.innerHTML += '<span style="color:#555; font-size:0.8rem;">Keine Gruppen.</span>'; return; }

    groups.forEach(g => {
        const tag = document.createElement('div');
        tag.className = 'group-tag';
        tag.innerHTML = `<input type="checkbox" class="grp-chk" value="${g}" style="width:auto; margin-right:5px;"><span>${g}</span>`;
        const chk = tag.querySelector('input');
        tag.addEventListener('click', (e) => { if (e.target !== chk) { chk.checked = !chk.checked; toggleGroupSelection(g, chk.checked); } });
        chk.addEventListener('change', (e) => toggleGroupSelection(g, e.target.checked));
        area.appendChild(tag);
    });
}

function toggleGroupSelection(groupName, isSelected) {
    const members = contacts.filter(c => c.group === groupName);
    members.forEach(m => { if (isSelected) selectedContactIds.add(m.id); else selectedContactIds.delete(m.id); });
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
        (c.name && c.name.toLowerCase().includes(term)) || c.id.toLowerCase().includes(term) || (c.group && c.group.toLowerCase().includes(term))
    );

    list.sort((a, b) => {
        let valA = (a[sortKey] || '').toLowerCase();
        let valB = (b[sortKey] || '').toLowerCase();
        if (valA < valB) return sortDir === 'asc' ? -1 : 1;
        if (valA > valB) return sortDir === 'asc' ? 1 : -1;
        return 0;
    });

    if (list.length === 0) { document.getElementById('emptyContactMsg').style.display = 'block'; return; }
    document.getElementById('emptyContactMsg').style.display = 'none';

    list.forEach(c => {
        const row = document.createElement('div');
        row.className = 'cs-row';
        if (contactMode === 'select' && selectedContactIds.has(c.id)) row.classList.add('selected');
        if (contactMode === 'manage' && isEditMode) row.classList.add('edit-mode-active');
        row.innerHTML = `<div style="display:flex; flex-direction:column; flex:2; overflow:hidden;"><span style="font-weight:bold; color:#fff;">${c.name || c.id}</span>${c.name ? `<span style="font-size:0.75rem; color:#666;">ID: ${c.id}</span>` : ''}</div><div style="flex:1; text-align:right; font-size:0.8rem; color:var(--accent-blue);">${c.group || '-'}</div>`;
        row.addEventListener('click', () => handleRowClick(c));
        container.appendChild(row);
    });
}

function handleRowClick(contact) {
    if (contactMode === 'manage') { if (isEditMode) openEditModal(contact); }
    else { if (selectedContactIds.has(contact.id)) selectedContactIds.delete(contact.id); else selectedContactIds.add(contact.id); renderContactList(document.getElementById('contactSearch').value); }
}

function toggleEditMode() {
    isEditMode = !isEditMode;
    const btn = document.getElementById('btnEditToggle');
    if (isEditMode) { btn.style.background = 'rgba(255, 165, 0, 0.2)'; btn.textContent = 'Modus: Bearbeiten'; }
    else { btn.style.background = 'transparent'; btn.textContent = '✎ Bearbeiten'; }
    renderContactList(document.getElementById('contactSearch').value);
}

function openEditModal(contact = null) {
    const modal = document.getElementById('contactEditModal');
    const btnSave = document.getElementById('btnSaveContact');
    const btnDel = document.getElementById('btnDeleteContact');
    document.getElementById('contactForm').reset();
    const dl = document.getElementById('groupSuggestions'); dl.innerHTML = '';
    [...new Set(contacts.map(c => c.group).filter(g => g))].forEach(g => dl.appendChild(new Option(g,g)));

    if (contact) {
        document.getElementById('modalTitle').textContent = 'Kontakt bearbeiten';
        document.getElementById('inputName').value = contact.name || '';
        document.getElementById('inputID').value = contact.id; document.getElementById('inputID').readOnly = true; document.getElementById('inputID').style.opacity = '0.5';
        document.getElementById('inputGroup').value = contact.group || '';
        btnSave.textContent = 'Aktualisieren'; btnDel.style.display = 'block'; btnDel.dataset.id = contact.id;
    } else {
        document.getElementById('modalTitle').textContent = 'Kontakt hinzufügen';
        document.getElementById('inputID').readOnly = false; document.getElementById('inputID').style.opacity = '1';
        btnSave.textContent = 'Speichern'; btnDel.style.display = 'none';
    }
    modal.classList.add('active');
}

async function saveContact(e) {
    e.preventDefault();
    const btn = document.getElementById('btnSaveContact'); const oldTxt = btn.textContent;
    const nameVal = document.getElementById('inputName').value.trim();
    const idVal = document.getElementById('inputID').value.trim();
    const groupVal = document.getElementById('inputGroup').value.trim();

    if (!idVal) return showAppStatus("ID fehlt!", 'error');
    btn.disabled = true; btn.textContent = "Prüfe...";

    try {
        const res = await fetch(`${API_BASE}/users/exists`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
            body: JSON.stringify({ targetUsername: idVal })
        });
        const data = await res.json();
        if (!data.exists) { showAppStatus(`ID "${idVal}" nicht gefunden.`, 'error'); btn.disabled = false; btn.textContent = oldTxt; return; }

        contacts = contacts.filter(c => c.id !== idVal);
        contacts.push({ id: idVal, name: nameVal || idVal, group: groupVal });
        contacts.sort((a, b) => a.name.localeCompare(b.name));
        localStorage.setItem('sm_contacts', JSON.stringify(contacts));
        document.getElementById('contactEditModal').classList.remove('active');
        renderContactList(document.getElementById('contactSearch').value);
        if(contactMode === 'select') renderGroupTags();
        showAppStatus(`Gespeichert.`, 'success');
    } catch (err) { showAppStatus("Fehler", 'error'); } finally { btn.disabled = false; btn.textContent = oldTxt; }
}

function deleteContact() {
    const id = document.getElementById('btnDeleteContact').dataset.id;
    if (confirm("Kontakt löschen?")) {
        contacts = contacts.filter(c => c.id !== id);
        localStorage.setItem('sm_contacts', JSON.stringify(contacts));
        document.getElementById('contactEditModal').classList.remove('active'); renderContactList(); showAppStatus("Gelöscht.", 'success');
    }
}

function confirmSelection() {
    const input = document.getElementById('recipientName'); const arr = Array.from(selectedContactIds);
    if (arr.length > 0) input.value = arr.join(', ');
    closeContactSidebar();
}

// ================================================================
// AUTH & HELPERS
// ================================================================

async function handleLogin(e) {
    e.preventDefault();
    const u = document.getElementById('username').value; const c = document.getElementById('accessCode').value;
    const devId = await generateDeviceFingerprint();
    try {
        const res = await fetch(`${API_BASE}/auth/login`, {
            method: 'POST', headers: {'Content-Type':'application/json'},
            body: JSON.stringify({ username:u, accessCode:c, deviceId:devId })
        });
        const data = await res.json();
        if (data.success) {
            authToken = data.token; currentUser = data.username;
            localStorage.setItem('sm_token', authToken); localStorage.setItem('sm_user', currentUser);

            // Expiry Check
            if(data.expiresAt && data.expiresAt !== 'lifetime') {
                const expDate = new Date(String(data.expiresAt).replace(' ', 'T'));
                if(expDate < new Date()) {
                    updateSidebarInfo(currentUser, data.expiresAt);
                    showRenewalScreen();
                    return;
                }
            }

            updateSidebarInfo(currentUser, data.expiresAt); showSection('mainSection');
        } else {
            // Handle specific blocked error
            if (data.error === "ACCOUNT_BLOCKED") {
                document.getElementById('accessCode').value = ''; // Clear sensitive data
                localStorage.removeItem('sm_token'); // Ensure no token is kept
                showSection('blockedSection');
            } else {
                showAppStatus(data.error || "Login fehlgeschlagen", 'error');
            }
        }
    } catch(err) { showAppStatus("Serverfehler", 'error'); } 
}

async function handleActivation(e) {
    e.preventDefault();
    const devId = await generateDeviceFingerprint();
    const payload = { licenseKey: document.getElementById('licenseKey').value, username: document.getElementById('newUsername').value, accessCode: document.getElementById('newAccessCode').value, deviceId: devId };
    try {
        const res = await fetch(`${API_BASE}/auth/activate`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload) });
        const d = await res.json();
        if(d.success) { alert("Erfolg! Einloggen."); showSection('loginSection'); document.getElementById('username').value = payload.username; } 
        else showAppStatus(d.error, 'error');
    } catch(e) { showAppStatus("Fehler", 'error'); }
}

async function handleLogout() {
    localStorage.removeItem('sm_token'); localStorage.removeItem('sm_user');
    currentUser=null; authToken=null; updateSidebarInfo(null);
    document.getElementById('sidebar').classList.remove('active'); showSection('loginSection');
}

function updateAppMode(mode) {
    currentMode = mode;
    const isDec = (mode === 'decrypt');
    document.getElementById('modeTitle').textContent = isDec ? 'ENTSCHLÜSSELUNG' : 'VERSCHLÜSSELUNG';
    document.getElementById('statusIndicator').textContent = isDec ? '● EMPFANGSBEREIT' : '● GESICHERT';
    const btn = document.getElementById('actionBtn');
    btn.textContent = isDec ? '🔓 NACHRICHT ENTSCHLÜSSELN' : '🔒 DATEN VERSCHLÜSSELN';
    btn.className = isDec ? 'btn' : 'btn btn-primary';
    if(isDec) { btn.style.border='1px solid var(--accent-blue)'; btn.style.color='var(--accent-blue)'; } else { btn.style.border=''; btn.style.color=''; }
    document.getElementById('textLabel').textContent = isDec ? 'Verschlüsselter Text' : 'Nachrichteneingabe (Klartext)';
    document.getElementById('recipientGroup').style.display = isDec ? 'none' : 'block';
    document.getElementById('qrScanBtn').style.display = isDec ? 'block' : 'none';
    document.getElementById('qrGenBtn').style.display = isDec ? 'none' : 'block';
    document.getElementById('messageInput').value = ''; document.getElementById('messageOutput').value = ''; document.getElementById('outputGroup').style.display = 'none';
}

async function handleMainAction() {
    const code = document.getElementById('messageCode').value; const text = document.getElementById('messageInput').value;
    if (!text || !code || code.length!==5 || !currentUser) return showAppStatus("Daten unvollständig.", 'error');

    // Pre-Action Check: Server Validierung
    const isValid = await validateSessionStrict();
    if (!isValid) return; // validateSessionStrict handles logout or redirect

    const btn = document.getElementById('actionBtn'); const old = btn.textContent; btn.textContent="..."; btn.disabled=true;
    try {
        let res = "";
        if (currentMode === 'encrypt') {
            const rIds = document.getElementById('recipientName').value.split(',').map(s=>s.trim()).filter(s=>s);
            if(!rIds.includes(currentUser)) rIds.push(currentUser);
            res = await encryptFull(text, code, rIds, currentUser);
        } else {
            res = await decryptFull(text, code, currentUser);
        }
        document.getElementById('messageOutput').value = res;
        document.getElementById('outputGroup').style.display = 'block';
        setTimeout(() => document.getElementById('outputGroup').scrollIntoView({ behavior:'smooth', block:'nearest' }), 100);
    } catch (e) { showAppStatus(e.message, 'error'); } finally { btn.textContent=old; btn.disabled=false; }
}

async function generateDeviceFingerprint() {
    try {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        canvas.width = 200; canvas.height = 50;
        ctx.textBaseline = "top"; ctx.font = "14px 'Arial'"; ctx.textBaseline = "alphabetic";
        ctx.fillStyle = "#f60"; ctx.fillRect(125,1,62,20);
        ctx.fillStyle = "#069"; ctx.fillText("SecureMsg_v1", 2, 15);
        ctx.fillStyle = "rgba(102, 204, 0, 0.7)"; ctx.fillText("Fingerprint", 4, 17);
        const canvasData = canvas.toDataURL();
        const baseString = canvasData + navigator.userAgent + screen.width + "x" + screen.height + new Date().getTimezoneOffset();
        const msgBuffer = new TextEncoder().encode(baseString);
        const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return "dev-" + hashArray.map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 32);
    } catch(e) {
        let id = localStorage.getItem('sm_id_fb');
        if(!id){id='dev-fb-'+Date.now();localStorage.setItem('sm_id_fb',id);} return id;
    }
}

let idleTimer;
const IDLE_TIMEOUT = 15 * 60 * 1000; // 15 Minuten

function setupIdleTimer() {
    window.onload = resetIdleTimer;
    window.onmousemove = resetIdleTimer;
    window.onmousedown = resetIdleTimer;
    window.ontouchstart = resetIdleTimer;
    window.onclick = resetIdleTimer;
    window.onkeypress = resetIdleTimer;
    window.addEventListener('scroll', resetIdleTimer, true);
}

function resetIdleTimer() {
    if (!currentUser) return;
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
        if(currentUser) {
            alert("Automatische Abmeldung wegen Inaktivität.");
            handleLogout();
        }
    }, IDLE_TIMEOUT);
}

async function validateSessionStrict() {
    if (!authToken) {
        handleLogout();
        return false;
    }
    try {
        const res = await fetch(`${API_BASE}/auth/validate`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ token: authToken })
        });
        const data = await res.json();

        if (!data.valid) {
            if (data.reason === 'blocked') {
                alert("Sitzung beendet: Konto wurde gesperrt.");
                handleLogout();
                return false;
            } else if (data.reason === 'expired') {
                showRenewalScreen();
                // Optional: Update sidebar text if needed, but renewal screen is enough
                return false;
            } else {
                // Invalid token / user not found
                alert("Sitzung abgelaufen.");
                handleLogout();
                return false;
            }
        }
        return true;
    } catch (e) {
        console.error("Validation Check Failed", e);
        // On network error, we might choose to fail safe or allow.
        // Security requirement says "If Server responds with false...".
        // If network error, maybe let user know.
        showAppStatus("Verbindung prüfen...", 'error');
        return false;
    }
}

function updateSidebarInfo(user, expiryData) {
    const userLabel = document.getElementById('sidebarUser');
    const licenseLabel = document.getElementById('sidebarLicense');
    const authElements = document.querySelectorAll('.auth-only');

    // 1. User Name setzen
    if (userLabel) userLabel.textContent = user || 'Gast';

    // 2. Lizenz-Anzeige Logik
    if (user && licenseLabel) {
        // Aufräumen: Falls "undefined" oder "null" als String gespeichert wurde
        if (expiryData === 'undefined' || expiryData === 'null') expiryData = null;

        // Fall A: Lifetime / Unlimited
        if (expiryData === 'lifetime' || String(expiryData).toLowerCase().includes('unlimited')) {
            licenseLabel.textContent = "LIZENZ: UNLIMITED";
            licenseLabel.style.color = "#00ff41"; 
        } 
        // Fall B: Datum vorhanden
        else if (expiryData) {
            try {
                // Versuch das Datum zu reparieren (SQL Timestamp zu ISO)
                let cleanDateStr = String(expiryData).replace(' ', 'T'); 
                
                const dateObj = new Date(cleanDateStr);
                
                // Ist das Datum gültig?
                if (!isNaN(dateObj.getTime())) {
                    const dateStr = dateObj.toLocaleDateString('de-DE', {
                        day: '2-digit', month: '2-digit', year: 'numeric'
                    });
                    licenseLabel.textContent = "LIZENZ: gültig bis " + dateStr;
                    licenseLabel.style.color = "var(--accent-blue)";
                } else {
                    // Fallback nur wenn Datum wirklich kaputt ist
                    console.warn("Ungültiges Datum erkannt:", expiryData);
                    licenseLabel.textContent = "LIZENZ: Aktiv";
                    licenseLabel.style.color = "var(--text-main)";
                }
            } catch (e) {
                licenseLabel.textContent = "LIZENZ: Aktiv";
            }
        } else {
            // Fall C: Keine Daten (z.B. alter Account ohne Key)
            licenseLabel.textContent = "LIZENZ: Unbekannt";
            licenseLabel.style.color = "#888";
        }
    } else if (licenseLabel) {
        // Nicht eingeloggt
        licenseLabel.textContent = "Nicht verbunden";
        licenseLabel.style.color = "#888";
    }

    // 3. Menü-Buttons ein-/ausblenden
    authElements.forEach(el => el.style.display = user ? 'flex' : 'none');
}

async function checkExistingSession() {
    const token = localStorage.getItem('sm_token');
    const user = localStorage.getItem('sm_user');
    let savedExpiry = localStorage.getItem('sm_exp'); 
    
    if (token && user) {
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
                
                // WICHTIG: Server-Datum hat Vorrang vor LocalStorage!
                let finalExpiry = data.expiresAt;
                
                // Wenn Server nichts liefert (null), schauen wir ob wir lokal was haben oder setzen Fallback
                if (!finalExpiry) {
                    finalExpiry = savedExpiry || 'lifetime'; 
                } else {
                    // Neues Datum vom Server speichern
                    localStorage.setItem('sm_exp', finalExpiry);
                }

                // Expiry Check
                if(finalExpiry && finalExpiry !== 'lifetime') {
                    const expDate = new Date(String(finalExpiry).replace(' ', 'T'));
                    if(expDate < new Date()) {
                        updateSidebarInfo(user, finalExpiry);
                        showRenewalScreen();
                        return;
                    }
                }

                updateSidebarInfo(user, finalExpiry);
                showSection('mainSection');
                return;
            } else {
                // Token invalid or blocked -> Logout
                handleLogout();
            }
        } catch(e) {
            console.log("Session Check fehlgeschlagen", e);
            showSection('loginSection');
        }
    } else {
        showSection('loginSection');
    }
}

function showRenewalScreen() {
    showSection('renewalSection');
    // Hide contacts and encryption mode if they were visible
    const wrapper = document.getElementById('headerSwitchWrapper');
    if(wrapper) wrapper.style.display = 'none';
}

// Make globally available for onclick in HTML
window.startRenewal = async function(planType) {
    if(!authToken) return showAppStatus("Bitte erst einloggen", 'error');

    const btn = event.currentTarget;
    btn.style.opacity = '0.5';
    btn.style.pointerEvents = 'none';

    try {
        const res = await fetch('/api/create-checkout-session', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}` // Token mitsenden
            },
            body: JSON.stringify({
                product_type: planType,
                is_renewal: true
            })
        });

        const data = await res.json();

        if (data.success && data.checkout_url) {
            window.location.href = data.checkout_url;
        } else {
            showAppStatus(data.error || "Fehler beim Checkout", 'error');
            btn.style.opacity = '1';
            btn.style.pointerEvents = 'auto';
        }
    } catch(e) {
        showAppStatus("Verbindungsfehler", 'error');
        btn.style.opacity = '1';
        btn.style.pointerEvents = 'auto';
    }
};

function showAppStatus(msg, type='success') {
    const d=document.createElement('div'); d.className=`app-status-msg ${type}`; d.textContent=msg;
    document.getElementById('globalStatusContainer').appendChild(d);
    requestAnimationFrame(()=>d.classList.add('active')); setTimeout(()=>{d.classList.remove('active');setTimeout(()=>d.remove(),500)},4000);
}
function clearAllFields() { document.getElementById('messageInput').value=''; document.getElementById('messageOutput').value=''; document.getElementById('messageCode').value=''; document.getElementById('recipientName').value=''; document.getElementById('outputGroup').style.display='none'; }
function copyToClipboard() { const el=document.getElementById('messageOutput'); el.select(); navigator.clipboard.writeText(el.value); showAppStatus("Kopiert!", 'success'); }

// QR
function showQRModal(text) {
    document.getElementById('qrModal').classList.add('active'); const c=document.getElementById('qrDisplay'); c.innerHTML="";
    try { new QRCode(c, { text:text, width:190, height:190, colorDark:"#000", colorLight:"#fff", correctLevel:QRCode.CorrectLevel.L }); } catch(e){c.textContent="QR Lib Error";}
}
function downloadQR() {
    const img=document.querySelector('#qrDisplay img'); if(img){ const a=document.createElement('a'); a.href=img.src; a.download=`qr-${Date.now()}.png`; a.click(); }
}
let qrScan=null;
function startQRScanner() {
    if(location.protocol!=='https:' && location.hostname!=='localhost') alert("HTTPS nötig.");
    document.getElementById('qrScannerModal').classList.add('active');
    if(!qrScan) qrScan=new Html5Qrcode("qr-reader");
    qrScan.start({facingMode:"environment"}, {fps:10, qrbox:250}, (txt)=>{stopQRScanner(); document.getElementById('messageInput').value=txt; showAppStatus("QR erkannt!");}, ()=>{}).catch(e=>{document.getElementById('qr-reader').innerHTML="Kamera Fehler";});
}
function stopQRScanner() { document.getElementById('qrScannerModal').classList.remove('active'); if(qrScan) qrScan.stop().catch(()=>{}); }
