// app.js - Frontend Logic (Final Polish: Custom Delete Modal & Fixed Navigation)

const APP_VERSION = 'v1.01';

import { encryptFull, decryptFull } from './cryptoLayers.js';

// ================================================================
// KONFIGURATION & STATE
// ================================================================

const API_BASE = '/api';
let currentUser = null; // Object { name: string, sm_id: number }
let authToken = null;
let currentAttachmentBase64 = null;
let currentMode = 'encrypt'; 

// Kontakt State
let contacts = []; // Loaded dynamically
let contactMode = 'manage'; 
let isEditMode = false;     
let selectedContactIds = new Set(); 
let sortKey = 'name';       
let sortDir = 'asc';        

// ================================================================
// INITIALISIERUNG
// ================================================================

document.addEventListener('DOMContentLoaded', function() {
    // Inject CSS for tickets if not present
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = '/assets/css/user-tickets.css';
    document.head.appendChild(link);

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

    // URL Consistency Check
    if (window.location.hostname !== 'localhost' && window.location.origin !== 'https://www.secure-msg.app') {
        showToast("Hinweis: Sie befinden sich nicht auf der Haupt-Domain. Kontakte sind ggf. nicht sichtbar.", 'error');
    }

    // Wartungsmodus Check (Initial)
    if (document.title.includes('Wartung')) {
        // Schon auf der Wartungsseite
    } else {
        fetch(API_BASE + '/ping').catch(err => {
             // 503 check?
        });
    }

    setupIdleTimer();
});

// GLOBAL FETCH INTERCEPTOR to handle Maintenance Mode Redirects
const originalFetch = window.fetch;
window.fetch = async function(...args) {
    try {
        const response = await originalFetch(...args);

        // Check for Maintenance Mode (503 Service Unavailable with specific JSON or text)
        if (response.status === 503) {
            // Check if it's maintenance
            try {
                const clone = response.clone();
                const data = await clone.json();
                if (data.error === 'MAINTENANCE_MODE') {
                     window.location.href = '/maintenance';
                     return response;
                }
            } catch (e) {
                // If text response or check failed, maybe just redirect if it was an API call?
            }
        }

        // If we are redirected to /maintenance via HTTP Redirect (302/301) handled by browser,
        // we might not catch it here unless we check response.url
        if (response.url && response.url.includes('/maintenance')) {
            window.location.href = '/maintenance';
        }

        return response;
    } catch (error) {
        throw error;
    }
};

// ================================================================
// TOAST & LOADER SYSTEM & CONFIRM
// ================================================================

window.showToast = function(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    let icon = 'ℹ️';
    if (type === 'success') icon = '✅';
    if (type === 'error') icon = '❌';

    toast.innerHTML = `<span style="font-size:1.2rem;">${icon}</span><span>${message}</span>`;
    container.appendChild(toast);

    // Trigger animation
    requestAnimationFrame(() => {
        toast.classList.add('show');
    });

    // Auto remove
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 400); // wait for fade out
    }, 4000);
};

window.showLoader = function(text = "Verarbeite Daten...") {
    const loader = document.getElementById('global-loader');
    if (!loader) return;
    loader.querySelector('.loader-text').textContent = text;
    loader.classList.add('active');
};

window.hideLoader = function() {
    const loader = document.getElementById('global-loader');
    if (loader) loader.classList.remove('active');
};

// Async Confirm Modal
let appConfirmCallback = null;
window.showAppConfirm = function(message, onConfirm) {
    document.getElementById('appConfirmMessage').textContent = message;
    document.getElementById('appConfirmModal').classList.add('active');
    appConfirmCallback = onConfirm;
};

document.getElementById('btnAppConfirmYes')?.addEventListener('click', () => {
    if(appConfirmCallback) appConfirmCallback();
    document.getElementById('appConfirmModal').classList.remove('active');
    appConfirmCallback = null;
});
document.getElementById('btnAppConfirmNo')?.addEventListener('click', () => {
    document.getElementById('appConfirmModal').classList.remove('active');
    appConfirmCallback = null;
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

    document.getElementById('navPost')?.addEventListener('click', (e) => {
        e.preventDefault(); toggleMainMenu(true); loadAndShowInbox();
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

    // --- SUPPORT MODAL LOGIK ---
    document.getElementById('navSupport')?.addEventListener('click', (e) => {
        e.preventDefault();
        toggleMainMenu(true);
        openSupportModal();
    });

    document.getElementById('closeSupportBtn')?.addEventListener('click', (e) => {
        e.preventDefault();
        document.getElementById('supportModal').classList.remove('active');
    });

    document.getElementById('supportForm')?.addEventListener('submit', handleSupportSubmit);

    document.getElementById('logoutBtnSide')?.addEventListener('click', handleLogout);
    document.getElementById('logoutBtnRenewal')?.addEventListener('click', handleLogout);

    // --- CODE ÄNDERN ---
    document.getElementById('navChangeCode')?.addEventListener('click', (e) => {
        e.preventDefault();
        toggleMainMenu(true);
        document.getElementById('changeCodeModal').classList.add('active');
        document.getElementById('currentAccessCode').value = '';
        document.getElementById('changeNewCode').value = '';
        document.getElementById('changeNewCodeRepeat').value = '';
    });

    document.getElementById('btnCancelChangeCode')?.addEventListener('click', () => {
        document.getElementById('changeCodeModal').classList.remove('active');
    });

    document.getElementById('btnConfirmChangeCode')?.addEventListener('click', handleChangeAccessCode);

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
    document.getElementById('btnBackInbox')?.addEventListener('click', goBackToMain);


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

    document.getElementById('saveTxtBtn')?.addEventListener('click', () => {
        const content = document.getElementById('messageOutput').value;
        if(content) downloadTxtFile(content);
    });

    document.getElementById('uploadTxtBtn')?.addEventListener('click', () => {
        document.getElementById('txtFileInput').click();
    });

    document.getElementById('txtFileInput')?.addEventListener('change', handleTxtImport);

    // Forms
    document.getElementById('loginForm')?.addEventListener('submit', handleLogin);
    document.getElementById('activationForm')?.addEventListener('submit', handleActivation);
    document.getElementById('showActivationLink')?.addEventListener('click', (e) => { e.preventDefault(); showSection('activationSection'); });
    document.getElementById('showLoginLink')?.addEventListener('click', (e) => { e.preventDefault(); showSection('loginSection'); });

    // License Key Check (Auto-Fill Assigned ID)
    document.getElementById('licenseKey')?.addEventListener('blur', async (e) => {
        const key = e.target.value.trim();
        if(!key) return;

        try {
            const res = await fetch(`${API_BASE}/auth/check-license`, {
                method: 'POST',
                headers: {'Content-Type':'application/json'},
                body: JSON.stringify({ licenseKey: key })
            });
            const data = await res.json();

            if (data.isValid && data.assignedUserId) {
                const uField = document.getElementById('newUsername');
                uField.value = data.assignedUserId;
                uField.readOnly = true;
                uField.style.opacity = '0.7';

                // Show hint
                let hint = document.getElementById('assignedIdHint');
                if(!hint) {
                    hint = document.createElement('div');
                    hint.id = 'assignedIdHint';
                    hint.style.fontSize = '0.8rem';
                    hint.style.color = 'var(--accent-blue)';
                    hint.style.marginTop = '5px';
                    uField.parentNode.appendChild(hint);
                }
                hint.textContent = `ℹ️ Diese Lizenz ist fest für die ID ${data.assignedUserId} reserviert.`;
            } else if (!data.isValid && data.error === 'Bereits benutzt') {
                showAppStatus("Dieser Key wurde bereits verwendet.", 'error');
            }
        } catch(e) { console.error(e); }
    });

    // Activation Code Validation
    document.getElementById('newAccessCode')?.addEventListener('input', validateActivationInputs);
    document.getElementById('newAccessCodeRepeat')?.addEventListener('input', validateActivationInputs);

    // AGB Checkbox Logic
    document.getElementById('agbCheck')?.addEventListener('change', validateActivationInputs);

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
    
    // Import/Export
    document.getElementById('btnExportContacts')?.addEventListener('click', exportContacts);
    document.getElementById('btnImportContacts')?.addEventListener('click', () => document.getElementById('contactImportInput').click());
    document.getElementById('contactImportInput')?.addEventListener('change', importContacts);

    document.getElementById('contactForm')?.addEventListener('submit', saveContact);
    document.getElementById('btnCancelEdit')?.addEventListener('click', () => document.getElementById('contactEditModal').classList.remove('active'));
    document.getElementById('btnDeleteContact')?.addEventListener('click', deleteContact);

    // --- DATEI UPLOAD LOGIK ---
    const fileInput = document.getElementById('fileInput');
    if (fileInput) {
        fileInput.addEventListener('change', function(e) {
            const file = e.target.files[0];
            if (!file) return;

            // Limit: 5MB
            if (file.size > 5 * 1024 * 1024) {
                showToast("Datei ist zu groß! Maximum sind 5MB.", 'error');
                this.value = '';
                return;
            }

            // UI Update: Show Spinner immediately
            showLoader("Lade Datei...");
            const infoDiv = document.getElementById('fileInfo');
            const nameSpan = document.getElementById('fileName');
            const spinner = document.getElementById('fileSpinner');
            const check = document.getElementById('fileCheck');
            const textArea = document.getElementById('messageInput');

            if (infoDiv) infoDiv.style.display = 'flex';
            if (spinner) spinner.style.display = 'inline-block';
            if (check) check.style.display = 'none';
            if (nameSpan) nameSpan.textContent = "Lade " + file.name + "...";

            if (textArea) {
                textArea.disabled = true;
                textArea.value = "Lade Datei...";
            }

            const reader = new FileReader();
            reader.onload = function(evt) {
                currentAttachmentBase64 = evt.target.result; // Base64 speichern

                // UI Update: Show Checkmark
                if (spinner) spinner.style.display = 'none';
                if (check) check.style.display = 'inline-block';
                if (nameSpan) nameSpan.textContent = "📎 " + file.name;

                if (textArea) {
                    textArea.value = "[Datei bereit zur Verschlüsselung]";
                }
                hideLoader();
                showToast("Datei erfolgreich geladen.", 'success');
            };
            reader.onerror = function() {
                hideLoader();
                showToast("Fehler beim Laden der Datei.", 'error');
            };
            reader.readAsDataURL(file);
        });
    }
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
            // "Confirm" removal of contacts silently or just do it.
            // Since we remove account, removing local contacts is safe/expected for privacy.
            if(currentUser && currentUser.sm_id) {
                localStorage.removeItem(`sm_contacts_${currentUser.sm_id}`);
            }

            showToast("Dein Account wurde erfolgreich gelöscht.", 'success');
            // Remove token and reload to force Login Screen
            setTimeout(() => {
                localStorage.removeItem('sm_token');
                localStorage.removeItem('sm_user');
                contacts = [];
                window.location.reload();
            }, 2000);
        } else {
            showToast(d.error || "Fehler beim Löschen", 'error');
        }
    } catch(e) { 
        showToast("Verbindungsfehler", 'error');
        document.getElementById('deleteAccountModal').classList.remove('active');
    } finally {
        btn.textContent = originalText; btn.disabled = false;
    }
}

async function handleChangeAccessCode() {
    const currentCode = document.getElementById('currentAccessCode').value;
    const newCode = document.getElementById('changeNewCode').value;
    const newCodeRepeat = document.getElementById('changeNewCodeRepeat').value;
    const btn = document.getElementById('btnConfirmChangeCode');

    if(!currentCode || !newCode || !newCodeRepeat) return showToast("Bitte alle Felder ausfüllen.", 'error');
    if(newCode.length !== 5 || isNaN(newCode)) return showToast("Der neue Code muss 5 Ziffern haben.", 'error');
    if(newCode !== newCodeRepeat) return showToast("Die neuen Codes stimmen nicht überein.", 'error');

    btn.textContent = "Verarbeite...";
    btn.disabled = true;
    showLoader("Ändere Zugangscode...");

    try {
        const res = await fetch(`${API_BASE}/auth/login`, {
             method: 'POST',
             headers: { 'Content-Type': 'application/json' },
             body: JSON.stringify({ username: currentUser.name, accessCode: currentCode, deviceId: await generateDeviceFingerprint() })
        });
        const loginData = await res.json();

        if(!loginData.success) {
            showToast("Der aktuelle Zugangscode ist falsch.", 'error');
            btn.textContent = "Ändern";
            btn.disabled = false;
            hideLoader();
            return;
        }

        const updateRes = await fetch(`${API_BASE}/auth/change-code`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({ newAccessCode: newCode })
        });

        const updateData = await updateRes.json();

        if(updateData.success) {
            showToast("Zugangscode erfolgreich geändert.", 'success');
            document.getElementById('changeCodeModal').classList.remove('active');
        } else {
            showToast("Fehler: " + (updateData.error || "Unbekannt"), 'error');
        }

    } catch(e) {
        showToast("Verbindungsfehler.", 'error');
    } finally {
        btn.textContent = "Ändern";
        btn.disabled = false;
        hideLoader();
    }
}


// ================================================================
// KONTAKT LOGIK
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
    const footerImpExp = document.getElementById('csImportExport');

    if (isEditMode) {
        btn.style.background = 'rgba(255, 165, 0, 0.2)';
        btn.textContent = 'Modus: Bearbeiten';
        if(footerImpExp) footerImpExp.style.display = 'flex';
    } else {
        btn.style.background = 'transparent';
        btn.textContent = '✎ Bearbeiten';
        if(footerImpExp) footerImpExp.style.display = 'none';
    }
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

    if (!idVal) return showToast("ID fehlt!", 'error');
    btn.disabled = true; btn.textContent = "Prüfe...";

    try {
        const res = await fetch(`${API_BASE}/users/exists`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
            body: JSON.stringify({ targetUsername: idVal })
        });
        const data = await res.json();
        if (!data.exists) { showToast(`ID "${idVal}" nicht gefunden.`, 'error'); btn.disabled = false; btn.textContent = oldTxt; return; }

        contacts = contacts.filter(c => c.id !== idVal);
        contacts.push({ id: idVal, name: nameVal || idVal, group: groupVal });
        contacts.sort((a, b) => a.name.localeCompare(b.name));

        saveUserContacts(); // Use specific key

        document.getElementById('contactEditModal').classList.remove('active');
        renderContactList(document.getElementById('contactSearch').value);
        if(contactMode === 'select') renderGroupTags();
        showToast(`Kontakt gespeichert.`, 'success');
    } catch (err) { showToast("Fehler beim Speichern", 'error'); } finally { btn.disabled = false; btn.textContent = oldTxt; }
}

function deleteContact() {
    const id = document.getElementById('btnDeleteContact').dataset.id;
    window.showAppConfirm("Kontakt wirklich löschen?", () => {
        contacts = contacts.filter(c => c.id !== id);
        saveUserContacts();
        document.getElementById('contactEditModal').classList.remove('active');
        renderContactList();
        showToast("Kontakt gelöscht.", 'success');
    });
}

function exportContacts() {
    if (!contacts || contacts.length === 0) return showToast("Keine Kontakte zum Exportieren.", 'error');
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(contacts, null, 2));
    const downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute("href", dataStr);
    downloadAnchorNode.setAttribute("download", "secure-msg-contacts.json");
    document.body.appendChild(downloadAnchorNode);
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
    showToast("Kontakte erfolgreich exportiert.", 'success');
}

function importContacts(e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(evt) {
        try {
            const imported = JSON.parse(evt.target.result);
            if (!Array.isArray(imported)) throw new Error("Format ungültig");

            let added = 0;
            let updated = 0;
            // Simplified merge logic without synchronous confirm dialogs

            // We need a strategy for overwrite. Using a simple flag if conflicts exist?
            // Since showAppConfirm is async, we can't easily iterate and confirm per item inside this loop.
            // Better strategy: Count conflicts, if any, ask once "Import X contacts? Y will be overwritten."

            const toUpdate = [];
            const toAdd = [];

            imported.forEach(c => {
                if (!c.id) return;
                const existingIndex = contacts.findIndex(ex => ex.id === c.id);
                if (existingIndex > -1) toUpdate.push(c);
                else toAdd.push(c);
            });

            const proceedImport = () => {
                // Add new
                toAdd.forEach(c => contacts.push(c));
                // Update existing
                toUpdate.forEach(c => {
                    const idx = contacts.findIndex(ex => ex.id === c.id);
                    if(idx > -1) contacts[idx] = c;
                });

                contacts = contacts.filter(c => c && c.id);
                saveUserContacts();
                renderContactList(document.getElementById('contactSearch').value);
                e.target.value = '';
                showToast(`Import: ${toAdd.length} neu, ${toUpdate.length} aktualisiert.`, 'success');
            };

            if (toUpdate.length > 0) {
                window.showAppConfirm(`${toUpdate.length} Kontakte existieren bereits und werden überschrieben. Fortfahren?`, proceedImport);
            } else {
                proceedImport();
            }

        } catch(err) {
            console.error(err);
            showToast("Fehler beim Importieren der Datei.", 'error');
        }
    };
    reader.readAsText(file);
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
            authToken = data.token;

            // Extract ID from token
            const decoded = parseJwt(authToken);
            currentUser = { name: data.username, sm_id: decoded.id };

            localStorage.setItem('sm_token', authToken);
            localStorage.setItem('sm_user', JSON.stringify(currentUser)); // Store as object

            loadUserContacts(); // Load isolated contacts

            // License Missing Check
            if (data.hasLicense === false) {
                updateSidebarInfo(currentUser.name, null);
                alert("Keine aktive Lizenz gefunden. Bitte verknüpfen Sie einen neuen Key.");
                showRenewalScreen();
                return;
            }

            // Expiry Check
            if(data.expiresAt && data.expiresAt !== 'lifetime') {
                const expDate = new Date(String(data.expiresAt).replace(' ', 'T'));
                if(expDate < new Date()) {
                    updateSidebarInfo(currentUser.name, data.expiresAt);
                    showRenewalScreen();
                    return;
                }
            }

            updateSidebarInfo(currentUser.name, data.expiresAt); showSection('mainSection');
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

    if (!document.getElementById('agbCheck').checked) {
        alert("Bitte akzeptieren Sie die AGB und Nutzungsbedingungen.");
        return;
    }

    const code1 = document.getElementById('newAccessCode').value;
    const code2 = document.getElementById('newAccessCodeRepeat').value;

    if (code1 !== code2) {
        alert("Die Zugangscodes stimmen nicht überein!");
        return;
    }

    const devId = await generateDeviceFingerprint();
    const payload = { licenseKey: document.getElementById('licenseKey').value, username: document.getElementById('newUsername').value, accessCode: document.getElementById('newAccessCode').value, deviceId: devId };
    try {
        const res = await fetch(`${API_BASE}/auth/activate`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload) });
        const d = await res.json();
        if(d.success) {
            showAppStatus("Aktivierung erfolgreich! Bitte einloggen.", 'success');
            showSection('loginSection');
            document.getElementById('username').value = payload.username;
        } else {
            showAppStatus(d.error || "Aktivierung fehlgeschlagen", 'error');
        }
    } catch(e) { showAppStatus("Fehler bei der Aktivierung", 'error'); }
}

async function handleLogout() {
    localStorage.removeItem('sm_token');
    localStorage.removeItem('sm_user');
    currentUser=null;
    authToken=null;
    contacts = []; // Clear contacts from memory
    updateSidebarInfo(null);
    document.getElementById('sidebar').classList.remove('active');
    showSection('loginSection');
}

function updateAppMode(mode) {
    // Force blur to prevent keyboard from popping up on mobile
    if (document.activeElement) {
        document.activeElement.blur();
    }

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

    // Output Buttons
    document.getElementById('qrScanBtn').style.display = isDec ? 'block' : 'none';
    document.getElementById('qrGenBtn').style.display = isDec ? 'none' : 'block';
    document.getElementById('saveTxtBtn').style.display = 'none'; // Reset to hidden

    // Import Button
    document.getElementById('uploadTxtBtn').style.display = isDec ? 'block' : 'none';

    // Attachment Button Logic
    const attachBtn = document.getElementById('attachmentBtn');
    if (attachBtn) attachBtn.style.display = isDec ? 'none' : 'block';

    // Clear input/output on mode switch
    clearAllFields();
    document.getElementById('messageInput').value = '';
    document.getElementById('messageOutput').value = '';
    document.getElementById('outputGroup').style.display = 'none';
}

async function handleMainAction() {
    const code = document.getElementById('messageCode').value;
    let payload = document.getElementById('messageInput').value;

    // Logic Fix: Prioritize Attachment
    if (currentMode === 'encrypt' && currentAttachmentBase64) {
        payload = currentAttachmentBase64;
    }

    if (!payload || !code || code.length!==5 || !currentUser) return showAppStatus("Daten unvollständig.", 'error');

    // Pre-Action Check: Server Validierung
    const isValid = await validateSessionStrict();
    if (!isValid) return; // validateSessionStrict handles logout or redirect

    const btn = document.getElementById('actionBtn'); const old = btn.textContent; btn.textContent="..."; btn.disabled=true;
    try {
        let res = "";
        if (currentMode === 'encrypt') {
            const rIds = document.getElementById('recipientName').value.split(',').map(s=>s.trim()).filter(s=>s);
            if(!rIds.includes(currentUser.name)) rIds.push(currentUser.name);
            res = await encryptFull(payload, code, rIds, currentUser.name);

             // Show encrypted text result
             const textOut = document.getElementById('messageOutput');
             const mediaOut = document.getElementById('mediaOutput');
             if(textOut) {
                 textOut.value = res;
                 textOut.style.display = 'block';
             }
             if(mediaOut) mediaOut.style.display = 'none';

             // Check length for TXT vs QR
             if (res.length > 9999) {
                 document.getElementById('qrGenBtn').style.display = 'none';
                 document.getElementById('saveTxtBtn').style.display = 'block';
             } else {
                 document.getElementById('qrGenBtn').style.display = 'block';
                 document.getElementById('saveTxtBtn').style.display = 'none';
             }

        } else {
            res = await decryptFull(payload, code, currentUser.name);
            renderDecryptedOutput(res);
        }
        document.getElementById('outputGroup').style.display = 'block';
        setTimeout(() => document.getElementById('outputGroup').scrollIntoView({ behavior:'smooth', block:'nearest' }), 100);
    } catch (e) { showAppStatus(e.message, 'error'); } finally { btn.textContent=old; btn.disabled=false; }
}

function renderDecryptedOutput(res) {
    const textArea = document.getElementById('messageOutput');
    const mediaDiv = document.getElementById('mediaOutput');

    mediaDiv.innerHTML = ''; // Clear previous media

    if (res.startsWith('data:image')) {
        // IMAGE MODE
        textArea.style.display = 'none';
        mediaDiv.style.display = 'flex';

        const img = document.createElement('img');
        img.src = res;
        img.style.maxWidth = '100%';
        img.style.border = '1px solid #333';
        img.style.borderRadius = '4px';

        const dlBtn = document.createElement('button');
        dlBtn.className = 'btn';
        dlBtn.textContent = '💾 Bild speichern';
        dlBtn.onclick = () => {
            const a = document.createElement('a');
            a.href = res;
            a.download = `secure-image-${Date.now()}.png`; // or jpg detection?
            a.click();
        };

        mediaDiv.appendChild(img);
        mediaDiv.appendChild(dlBtn);

    } else if (res.startsWith('data:application/pdf')) {
        // PDF MODE
        textArea.style.display = 'none';
        mediaDiv.style.display = 'flex';

        const icon = document.createElement('div');
        icon.innerHTML = '📄 PDF DOKUMENT';
        icon.style.fontSize = '1.2rem';
        icon.style.color = 'var(--accent-blue)';

        const dlBtn = document.createElement('button');
        dlBtn.className = 'btn';
        dlBtn.textContent = '⬇ PDF Herunterladen';
        dlBtn.onclick = () => {
            const a = document.createElement('a');
            a.href = res;
            a.download = `secure-document-${Date.now()}.pdf`;
            a.click();
        };

        mediaDiv.appendChild(icon);
        mediaDiv.appendChild(dlBtn);

    } else {
        // TEXT MODE
        textArea.style.display = 'block';
        mediaDiv.style.display = 'none';
        textArea.value = res;
    }
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
                return false;
            } else if (data.reason === 'no_license') {
                alert("Keine aktive Lizenz gefunden. Bitte verknüpfen Sie einen neuen Key.");
                showRenewalScreen();
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

function validateActivationInputs() {
    const code1 = document.getElementById('newAccessCode').value;
    const code2 = document.getElementById('newAccessCodeRepeat').value;
    const agbChecked = document.getElementById('agbCheck').checked;
    const btn = document.getElementById('activateBtn');
    const warning = document.getElementById('codeMismatchWarning');

    // Show warning if codes mismatch (only if repeat field is not empty)
    if (code2.length > 0 && code1 !== code2) {
        warning.style.display = 'block';
    } else {
        warning.style.display = 'none';
    }

    // Enable button conditions
    const codesMatch = (code1 === code2);
    const codeValid = (code1.length === 5);

    if (agbChecked && codesMatch && codeValid) {
        btn.disabled = false;
    } else {
        btn.disabled = true;
    }
}

function updateSidebarInfo(user, expiryData) {
    const userLabel = document.getElementById('sidebarUser');
    const licenseLabel = document.getElementById('sidebarLicense');
    const authElements = document.querySelectorAll('.auth-only');

    // 1. User Name setzen
    if (userLabel) userLabel.textContent = user || 'Gast';

    // Start Polling Messages if user is logged in
    if(user) {
        checkUnreadMessages();
        // Clear existing interval if any
        if(window.msgPollInterval) clearInterval(window.msgPollInterval);
        window.msgPollInterval = setInterval(checkUnreadMessages, 5 * 60 * 1000);
    } else {
        if(window.msgPollInterval) clearInterval(window.msgPollInterval);
    }

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
                    // FIX: Exaktes Format TT.MM.JJJJ erzwingen
                    const day = String(dateObj.getDate()).padStart(2, '0');
                    const month = String(dateObj.getMonth() + 1).padStart(2, '0');
                    const year = dateObj.getFullYear();
                    const dateStr = `${day}.${month}.${year}`;

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
    const userStored = localStorage.getItem('sm_user');
    let savedExpiry = localStorage.getItem('sm_exp'); 
    
    // Attempt to parse old user string or new user object
    let userName = '';
    try {
        const parsed = JSON.parse(userStored);
        userName = parsed.name || parsed;
    } catch(e) {
        userName = userStored;
    }

    if (token) {
        try {
            const res = await fetch(`${API_BASE}/auth/validate`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ token })
            });
            const data = await res.json();
            
            if (data.valid) {
                authToken = token;
                
                // Construct new currentUser object with ID from token
                const decoded = parseJwt(token);
                currentUser = { name: data.username || userName, sm_id: decoded.id };

                // Update storage to new format
                localStorage.setItem('sm_user', JSON.stringify(currentUser));

                loadUserContacts(); // Load isolated contacts

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
                        updateSidebarInfo(currentUser.name, finalExpiry);
                        showRenewalScreen();
                        return;
                    }
                }

                updateSidebarInfo(currentUser.name, finalExpiry);
                showSection('mainSection');
                return;
            } else {
                if (data.reason === 'no_license') {
                    alert("Keine aktive Lizenz gefunden. Bitte verknüpfen Sie einen neuen Key.");
                    authToken = token; // Needed for renewal call

                    const decoded = parseJwt(token);
                    currentUser = { name: userName, sm_id: decoded.id }; // Partial info

                    showRenewalScreen();
                } else {
                    // Token invalid or blocked -> Logout
                    handleLogout();
                }
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

function openSupportModal() {
    const modal = document.getElementById('supportModal');
    const userField = document.getElementById('supportUsername');

    // Reset fields
    document.getElementById('supportForm').reset();

    if (currentUser) {
        // Fall: Eingeloggt
        userField.value = currentUser.name;
        userField.readOnly = true;
        userField.style.opacity = '0.7';
    } else {
        // Fall: Nicht eingeloggt
        userField.value = '';
        userField.readOnly = false;
        userField.style.opacity = '1';
        userField.placeholder = "Benutzername oder ID (falls bekannt)";
    }

    modal.classList.add('active');
}

async function handleSupportSubmit(e) {
    e.preventDefault();
    const form = e.target;
    const btn = form.querySelector('button[type="submit"]');
    const allFields = form.querySelectorAll('input, textarea, button');
    const oldText = btn.textContent;

    const usernameVal = document.getElementById('supportUsername').value.trim();
    const emailVal = document.getElementById('supportEmail').value.trim();
    const messageVal = document.getElementById('supportMessage').value.trim();
    const subjectVal = document.getElementById('supportSubject').value.trim();

    // Validation Logic
    if (!messageVal || !subjectVal) {
        showToast("Bitte Betreff und Nachricht eingeben.", 'error');
        return;
    }

    if (!usernameVal && !emailVal) {
        showToast("Bitte geben Sie eine E-Mail-Adresse oder Ihre Benutzer-ID für eine Rückantwort an.", 'error');
        return;
    }

    // 1. Lock UI
    btn.textContent = "Wird gesendet...";
    allFields.forEach(f => f.disabled = true);

    const payload = {
        username: usernameVal,
        subject: subjectVal,
        email: emailVal,
        message: messageVal
    };

    try {
        // Timeout Logic (10s)
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 25000);

        const res = await fetch('/api/support', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: controller.signal
        });
        clearTimeout(timeoutId);

        const data = await res.json();
        console.log('Server-Antwort:', data);

        if (data.success) {
            showAppStatus(`Danke! Ihre Nachricht wurde gesendet. Ticket: ${data.ticketId}`, 'success');
            // Form stays locked until close
            setTimeout(() => {
                document.getElementById('supportModal').classList.remove('active');
                e.target.reset();
                allFields.forEach(f => f.disabled = false);
                btn.textContent = "Nachricht Senden";
            }, 3000);
        } else {
            alert("Der Mail-Server ist aktuell nicht erreichbar. Bitte senden Sie Ihre Anfrage direkt an support@secure-msg.app.");
            allFields.forEach(f => f.disabled = false);
            btn.textContent = oldText;
        }
    } catch (err) {
        if (err.name === 'AbortError') {
            alert("Server antwortet nicht. Bitte schreiben Sie direkt an support@secure-msg.app");
        } else {
            alert("Der Mail-Server ist aktuell nicht erreichbar. Bitte senden Sie Ihre Anfrage direkt an support@secure-msg.app.");
        }
        allFields.forEach(f => f.disabled = false);
        btn.textContent = oldText;
    }
}

// Make globally available for onclick in HTML
window.clearAttachment = function() {
    document.getElementById('fileInput').value = '';
    currentAttachmentBase64 = null;
    document.getElementById('fileInfo').style.display = 'none';

    // Reset Status Icons
    document.getElementById('fileSpinner').style.display = 'none';
    document.getElementById('fileCheck').style.display = 'none';

    const textArea = document.getElementById('messageInput');
    textArea.disabled = false;
    textArea.value = '';
};

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
function clearAllFields() {
    document.getElementById('messageInput').value='';
    document.getElementById('messageOutput').value='';
    document.getElementById('messageCode').value='';
    document.getElementById('recipientName').value='';
    document.getElementById('outputGroup').style.display='none';
    document.getElementById('importFeedback').style.display = 'none';
    document.getElementById('importFeedback').textContent = '';
    document.getElementById('txtFileInput').value = '';

    if (window.clearAttachment) window.clearAttachment();

    // Reset output buttons if in encrypt mode
    if (currentMode === 'encrypt') {
        document.getElementById('qrGenBtn').style.display = 'block';
        document.getElementById('saveTxtBtn').style.display = 'none';
    }
}
function copyToClipboard() { const el=document.getElementById('messageOutput'); el.select(); navigator.clipboard.writeText(el.value); showAppStatus("Kopiert!", 'success'); }

function downloadTxtFile(content) {
    // Filename: SECURE_MSG_[FIRST_5_CHARS].txt
    const hashPart = content.substring(0, 5);
    const filename = `SECURE_MSG_${hashPart}.txt`;

    const element = document.createElement('a');
    element.setAttribute('href', 'data:text/plain;charset=utf-8,' + encodeURIComponent(content));
    element.setAttribute('download', filename);
    element.style.display = 'none';
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
}

function handleTxtImport(e) {
    const file = e.target.files[0];
    if (!file) return;

    if (file.type !== "text/plain" && !file.name.endsWith('.txt')) {
        alert("Bitte nur .txt Dateien verwenden.");
        return;
    }

    const reader = new FileReader();
    reader.onload = function(evt) {
        const content = evt.target.result;
        document.getElementById('messageInput').value = content;

        const fb = document.getElementById('importFeedback');
        fb.textContent = `Importiert: ${file.name}`;
        fb.style.display = 'block';
    };
    reader.readAsText(file);
}

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

// ========================================================
// HELPERS
// ========================================================

function parseJwt (token) {
    try {
        var base64Url = token.split('.')[1];
        var base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
        var jsonPayload = decodeURIComponent(window.atob(base64).split('').map(function(c) {
            return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
        }).join(''));
        return JSON.parse(jsonPayload);
    } catch (e) {
        return {};
    }
}

function loadUserContacts() {
    if (!currentUser || !currentUser.sm_id) {
        contacts = [];
        return;
    }
    const key = `sm_contacts_${currentUser.sm_id}`;
    const globalKey = 'sm_contacts';

    let stored = localStorage.getItem(key);

    // Migration Logic
    if (!stored && localStorage.getItem(globalKey)) {
        // Alte Daten vorhanden, neue noch nicht -> Migration
        stored = localStorage.getItem(globalKey);
        localStorage.setItem(key, stored);
        localStorage.removeItem(globalKey);
        console.log("Contacts migrated to user-specific storage.");
    }

    contacts = stored ? JSON.parse(stored) : [];
}

function saveUserContacts() {
    if (!currentUser || !currentUser.sm_id) return;
    localStorage.setItem(`sm_contacts_${currentUser.sm_id}`, JSON.stringify(contacts));
}

// --- NEW POSTBOX UI LOGIC ---

function updatePostboxUI(unreadCount) {
    const navLink = document.getElementById('navPost');
    if (!navLink) return;

    if (unreadCount > 0) {
        // Active state
        navLink.innerHTML = `📬 Postfach <span style="color:var(--accent-blue); font-weight:bold;">(${unreadCount})</span>`;
        navLink.style.color = "var(--accent-blue)";
        navLink.style.borderLeft = "3px solid var(--accent-blue)";
        navLink.style.paddingLeft = "22px"; // slightly indented to indicate active/highlight
    } else {
        // Idle state
        navLink.innerHTML = `📪 Postfach`;
        navLink.style.color = "var(--text-main)";
        navLink.style.borderLeft = "none";
        navLink.style.paddingLeft = "15px"; // Reset to default style (assuming .sidebar-item padding)
    }
}

async function checkUnreadMessages() {
    if(!currentUser || !authToken) return;
    try {
        const res = await fetch(`${API_BASE}/messages`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        const msgs = await res.json();

        // Count unread that are NOT closed tickets (if we want to notify about updates?)
        // Standard behavior: Count all unread where recipient_id is set.
        const unreadPersonal = msgs.filter(m => m.recipient_id && !m.is_read).length;

        updatePostboxUI(unreadPersonal);

    } catch(e) { console.error("Msg Check Failed", e); }
}

async function loadAndShowInbox() {
    showSection('inboxSection');
    const container = document.getElementById('inboxList');
    const emptyMsg = document.getElementById('inboxEmpty');
    container.innerHTML = '<div style="text-align:center; padding:20px;">Lade...</div>';
    emptyMsg.style.display = 'none';

    try {
        const res = await fetch(`${API_BASE}/messages`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        const msgs = await res.json();

        // Update UI immediately with fresh count
        const unreadPersonal = msgs.filter(m => m.recipient_id && !m.is_read).length;
        updatePostboxUI(unreadPersonal);

        container.innerHTML = '';

        if(msgs.length === 0) {
            emptyMsg.style.display = 'block';
            return;
        }

        msgs.forEach(m => {
            const el = document.createElement('div');

            const isPersonal = !!m.recipient_id;
            const isUnread = isPersonal && !m.is_read;
            const isTicket = (m.type === 'ticket' || m.type === 'ticket_reply');

            let classes = 'msg-card';
            if(isUnread) classes += ' unread';
            if(m.type === 'automated') classes += ' type-automated';
            if(m.type === 'support') classes += ' type-support';
            if(isTicket) classes += ' type-ticket';

            let icon = '📩';
            if(m.type === 'automated') icon = '⚠️';
            else if(m.type === 'support') icon = '💬';
            else if(isTicket) icon = '🎫';
            else if(!isPersonal) icon = '📢';

            // --- TICKET BADGE LOGIC ---
            let badgeHtml = '';
            if (m.type === 'ticket' && m.status) {
                let statusClass = 'msg-status-open';
                let statusText = 'OFFEN';
                if (m.status === 'in_progress') { statusClass = 'msg-status-progress'; statusText = 'IN BEARBEITUNG'; }
                if (m.status === 'closed') { statusClass = 'msg-status-closed'; statusText = 'ABGESCHLOSSEN'; }
                badgeHtml = `<span class="msg-status-badge ${statusClass}">${statusText}</span>`;
            }
            // ---------------------------

            el.className = classes;
            el.innerHTML = `
                <div class="msg-header">
                    <span>${new Date(m.created_at).toLocaleString('de-DE')}</span>
                    <span>${isPersonal ? 'Persönlich' : 'Allgemein'}</span>
                </div>
            `;

            // SECURITY: Render Subject & Body safely as text
            const divSubject = document.createElement('div');
            divSubject.className = 'msg-subject';
            divSubject.innerHTML = `${icon} ${escapeHtml(m.subject)} ${badgeHtml}`; // Use innerHTML for badge, but escape subject

            const divBody = document.createElement('div');
            divBody.className = 'msg-body';
            divBody.textContent = m.body;

            el.appendChild(divSubject);
            el.appendChild(divBody);

            // DELETE BUTTON (Custom Logic for Tickets)
            if (isPersonal) {
                const btnDel = document.createElement('button');
                btnDel.textContent = 'Löschen';
                btnDel.className = 'btn-outline';
                btnDel.style.fontSize = '0.7rem';
                btnDel.style.marginTop = '10px';
                btnDel.style.padding = '4px 8px';

                // Lock if Ticket and NOT closed
                if (m.type === 'ticket' && m.status !== 'closed') {
                    btnDel.classList.add('delete-btn-locked');
                    btnDel.title = "Ticket ist noch offen.";
                    btnDel.style.display = 'none'; // HIDE completely as per strict requirement "sichtbar"
                    btnDel.disabled = true;
                    btnDel.onclick = (e) => { e.stopPropagation(); };
                } else {
                    btnDel.onclick = (e) => {
                        e.stopPropagation();
                        deleteMessage(m.id, el);
                    };
                }
                el.appendChild(btnDel);
            }

            el.addEventListener('click', () => {
                const wasExpanded = el.classList.contains('expanded');
                document.querySelectorAll('.msg-card.expanded').forEach(c => c.classList.remove('expanded'));

                if(!wasExpanded) {
                    el.classList.add('expanded');
                    if(isUnread && isPersonal) {
                        markMessageRead(m.id);
                        el.classList.remove('unread');

                        // Decrement local count logic
                        const navLink = document.getElementById('navPost');
                        const match = navLink.innerText.match(/\((\d+)\)/);
                        if(match) {
                            let cur = parseInt(match[1]);
                            if(cur > 0) updatePostboxUI(cur - 1);
                        }
                    }
                }
            });

            container.appendChild(el);
        });

    } catch(e) {
        container.innerHTML = '<div style="color:red; text-align:center;">Laden fehlgeschlagen.</div>';
    }
}

async function markMessageRead(id) {
    try {
        await fetch(`${API_BASE}/messages/${id}/read`, {
            method: 'PATCH',
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
    } catch(e) { console.error("Mark Read Failed", e); }
}

async function deleteMessage(id, element) {
    if(!confirm("Nachricht wirklich löschen?")) return; // Using native confirm for speed inside list
    try {
        // We don't have a specific delete endpoint exposed in server.js for messages?
        // Checking server.js... There is NO DELETE endpoint for messages in server.js provided!
        // Wait, standard user inbox deletion was not in the original requirements provided in memory,
        // but implied by "Interaction Lock: Implement logic that disables the 'Delete' button".
        // Use existing if avail or creating one?
        // The provided server.js DOES NOT have app.delete('/api/messages/:id').
        // I must add it or use a workaround.
        // I will add the DELETE endpoint to server.js in a separate step if missing.
        // Checking server.js content again... NO delete endpoint for messages found.

        // I will implement client logic assuming endpoint exists, and fix server.js in next step.
        const res = await fetch(`${API_BASE}/messages/${id}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${authToken}` }
        });

        if (res.ok) {
            element.remove();
            showToast("Nachricht gelöscht.", "success");
            checkUnreadMessages(); // Update count
        } else {
            showToast("Fehler beim Löschen.", "error");
        }
    } catch(e) { showToast("Verbindungsfehler", "error"); }
}

function escapeHtml(text) {
    if(!text) return '';
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}
