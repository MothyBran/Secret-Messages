// app.js - Frontend Logic (Final Polish: User-Scoped Enterprise Keys)

const APP_VERSION = 'Beta v0.26.2';

// Import encryption functions including backup helpers
import { encryptFull, decryptFull, decryptBackup, setEnterpriseKeys, exportProfilePackage, importProfilePackage, generateTransferProof } from './cryptoLayers.js';

// ================================================================
// KONFIGURATION & STATE
// ================================================================

const API_BASE = '/api';
// deferredPrompt is now managed via window.deferredPrompt
let currentUser = null; // Object { name: string, sm_id: number }
let authToken = null;
let currentAttachmentBase64 = null;
let currentResultData = null; // Store decrypted result for saving
let currentResultType = null; // 'text', 'image', 'pdf'
let currentMode = 'encrypt'; 
let currentScannerMode = 'message'; // 'message' or 'transfer'

// Kontakt State
let contacts = [];
let contactMode = 'manage'; 
let contactTargetInput = 'recipientName'; // Default target
let isEditMode = false;     
let selectedContactIds = new Set(); 
let sortKey = 'name';       
let sortDir = 'asc';
let pendingContactAction = null;

// ================================================================
// INITIALISIERUNG
// ================================================================

document.addEventListener('DOMContentLoaded', function() {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = '/assets/css/user-tickets.css';
    document.head.appendChild(link);

    const verEl = document.getElementById('appVersion');
    if(verEl) verEl.textContent = APP_VERSION;

    // PWA Service Worker
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/service-worker.js')
            .then(reg => {
                console.log('SW Registered', reg);
                // Check if we are already installed-ish
                if (reg.installing) {
                    console.log('Service worker installing');
                } else if (reg.waiting) {
                    console.log('Service worker installed');
                } else if (reg.active) {
                    console.log('Service worker active');
                }
            })
            .catch(err => console.error('SW Error', err));
    }

    // PWA Install Prompt Logic
    // If the event fired before app.js loaded, the inline script caught it and set display:flex.
    // If it fires later, the inline script listener will handle it.
    // We just need to ensure the Install function uses window.deferredPrompt.

    setupUIEvents();
    
    // URL Check & Auto-Fill
    const urlParams = new URLSearchParams(window.location.search);
    const action = urlParams.get('action');
    const keyParam = urlParams.get('key');

    if (keyParam) {
        const actInput = document.getElementById('licenseKey');
        if (actInput) actInput.value = keyParam;

        const renInput = document.getElementById('manualRenewalKey');
        if (renInput) renInput.value = keyParam;
    }

    // Clean URL Params to prevent Loop/Re-trigger on Refresh
    if (action || keyParam) {
        window.history.replaceState({}, document.title, window.location.pathname);
    }

    if (action === 'activate' || action === 'register') {
        showSection('activationSection');
    } else {
        const token = localStorage.getItem('sm_token');
        if (token) {
            checkExistingSession().then(() => {
                if (action === 'renew' && authToken) {
                    const modal = document.getElementById('manualRenewalModal');
                    if(modal) modal.classList.add('active');
                }
            });
        } else {
            updateSidebarInfo(null);
            showSection('loginSection');
        }
    }

    if (window.location.hostname !== 'localhost' && window.location.origin !== 'https://www.secure-msg.app') {
        showToast("Hinweis: Sie befinden sich nicht auf der Haupt-Domain. Kontakte sind ggf. nicht sichtbar.", 'error');
    }

    if (!document.title.includes('Wartung')) {
        fetch(API_BASE + '/ping').catch(err => {});
    }

    // ENTERPRISE CHECK & TOR DETECTION
    fetch(API_BASE + '/config').then(r=>r.json()).then(conf => {
        if(conf.mode === 'ENTERPRISE') {
            document.body.classList.add('mode-enterprise');
            const script = document.createElement('script');
            script.src = '/js/enterprise-client.js';
            script.onload = () => { if(window.initEnterpriseClient) window.initEnterpriseClient(); };
            document.body.appendChild(script);
        }

        // Tor Logic
        if(conf.onionAddress) {
            const el = document.getElementById('onionAddressDisplay');
            if(el) el.textContent = conf.onionAddress;
        }

        if(window.location.hostname.endsWith('.onion')) {
            const statusContainer = document.getElementById('globalStatusContainer');
            const banner = document.createElement('div');
            banner.style.cssText = "position:fixed; top:0; left:0; width:100%; background:#006400; color:#fff; text-align:center; padding:2px; font-size:0.7rem; z-index:9999; font-weight:bold;";
            banner.textContent = "🛡️ TOR-NETZWERK AKTIV";
            document.body.appendChild(banner);
        }
    }).catch(e=>{});

    setupIdleTimer();
});

const originalFetch = window.fetch;
window.fetch = async function(...args) {
    try {
        const response = await originalFetch(...args);
        if (response.status === 503) {
            try {
                const clone = response.clone();
                const data = await clone.json();
                if (data.error === 'MAINTENANCE_MODE') { window.location.href = '/maintenance'; return response; }
            } catch (e) {}
        }
        if (response.url && response.url.includes('/maintenance')) { window.location.href = '/maintenance'; }
        return response;
    } catch (error) { throw error; }
};

// Note: showToast, showLoader, hideLoader, showConfirm are now from ui.js
// Wrappers below ensure compatibility if internal calls use `window.showAppConfirm`

window.showAppConfirm = function(message, onConfirm, labels = null) {
    let options = {};
    if (labels) {
        options.confirm = labels.confirm;
        options.cancel = labels.cancel;
    }
    window.showConfirm(message, onConfirm, options);
};

function setupUIEvents() {
    const menuBtn = document.getElementById('menuToggle');
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebarOverlay');
    
    function toggleMainMenu(forceClose = false) {
        if (forceClose) { sidebar.classList.remove('active'); overlay.classList.remove('active'); }
        else { sidebar.classList.toggle('active'); overlay.classList.toggle('active'); }
    }

    menuBtn?.addEventListener('click', () => toggleMainMenu());
    overlay?.addEventListener('click', () => { toggleMainMenu(true); closeContactSidebar(); closeInboxSidebar(); });

    document.getElementById('navInstallApp')?.addEventListener('click', installApp);
    document.getElementById('navContacts')?.addEventListener('click', (e) => { e.preventDefault(); toggleMainMenu(true); openContactSidebar('manage'); });
    document.getElementById('navPost')?.addEventListener('click', (e) => { e.preventDefault(); toggleMainMenu(true); loadAndShowInbox(); });
    document.getElementById('navGuide')?.addEventListener('click', (e) => { e.preventDefault(); toggleMainMenu(true); showSection('guideSection'); });
    document.getElementById('navInfo')?.addEventListener('click', (e) => { e.preventDefault(); window.location.href = '/forum'; });

    document.getElementById('faqBtn')?.addEventListener('click', (e) => { e.preventDefault(); toggleMainMenu(true); document.getElementById('faqModal').classList.add('active'); });
    document.getElementById('closeFaqBtn')?.addEventListener('click', () => { document.getElementById('faqModal').classList.remove('active'); });
    document.getElementById('faqModal')?.addEventListener('click', (e) => { if (e.target === document.getElementById('faqModal')) document.getElementById('faqModal').classList.remove('active'); });

    document.getElementById('navSupport')?.addEventListener('click', (e) => { e.preventDefault(); toggleMainMenu(true); openSupportModal(); });
    document.getElementById('closeSupportBtn')?.addEventListener('click', (e) => { e.preventDefault(); document.getElementById('supportModal').classList.remove('active'); });
    document.getElementById('supportForm')?.addEventListener('submit', handleSupportSubmit);

    document.getElementById('logoutBtnSide')?.addEventListener('click', handleLogout);
    document.getElementById('logoutBtnRenewal')?.addEventListener('click', handleLogout);

    document.getElementById('navChangeCode')?.addEventListener('click', (e) => {
        e.preventDefault(); toggleMainMenu(true); document.getElementById('changeCodeModal').classList.add('active');
        document.getElementById('sk_fld_5').value = ''; document.getElementById('sk_fld_6').value = ''; document.getElementById('sk_fld_7').value = '';
    });
    document.getElementById('btnCancelChangeCode')?.addEventListener('click', () => { document.getElementById('changeCodeModal').classList.remove('active'); });
    document.getElementById('btnConfirmChangeCode')?.addEventListener('click', handleChangeAccessCode);

    // Manual Renewal
    document.getElementById('navRenewal')?.addEventListener('click', (e) => {
        e.preventDefault();
        toggleMainMenu(true);
        updateRenewalModalStatus();
        document.getElementById('manualRenewalModal').classList.add('active');
        document.getElementById('manualRenewalKey').value = '';
    });
    document.getElementById('btnConfirmManualRenewal')?.addEventListener('click', handleManualRenewal);

    document.querySelector('.app-logo')?.addEventListener('click', () => {
        const isLoggedIn = !!authToken;
        if (!isLoggedIn) {
            const loginActive = document.getElementById('loginSection').classList.contains('active');
            const activationActive = document.getElementById('activationSection').classList.contains('active');
            if (loginActive || activationActive) window.location.href = 'landing.html';
        }
    });

    function goBackToMain() { if(currentUser) showSection('mainSection'); else showSection('loginSection'); }
    document.getElementById('btnBackGuide')?.addEventListener('click', goBackToMain);
    document.getElementById('btnBackInfo')?.addEventListener('click', goBackToMain);
    // Inbox Back Arrow replaced by Sidebar Close
    document.getElementById('closeInboxSidebar')?.addEventListener('click', closeInboxSidebar);

    document.getElementById('navDelete')?.addEventListener('click', (e) => { e.preventDefault(); toggleMainMenu(true); document.getElementById('deleteAccountModal').classList.add('active'); });
    document.getElementById('btnCancelDelete')?.addEventListener('click', () => { document.getElementById('deleteAccountModal').classList.remove('active'); });
    document.getElementById('btnConfirmDelete')?.addEventListener('click', performAccountDeletion);

    // Profile Transfer (Sidebar - Export)
    document.getElementById('navProfileTransfer')?.addEventListener('click', (e) => {
        e.preventDefault(); toggleMainMenu(true);
        document.getElementById('sk_fld_10').value = '';
        document.getElementById('transferSecurityModal').classList.add('active');
    });
    document.getElementById('btnConfirmTransferStart')?.addEventListener('click', handleTransferExportStart);

    // Profile Transfer (Login - Import)
    document.getElementById('navTransferImport')?.addEventListener('click', (e) => {
        e.preventDefault();
        toggleMainMenu(true);
        startTransferScanner();
    });
    document.getElementById('btnConfirmTransferImport')?.addEventListener('click', handleTransferImportDecrypt);

    // Manual Transfer Modals
    document.getElementById('btnOpenManualTransfer')?.addEventListener('click', () => {
        stopQRScanner();
        document.getElementById('manualTransferModal').classList.add('active');
    });
    document.getElementById('btnSubmitManualTransfer')?.addEventListener('click', submitManualTransfer);
    document.getElementById('btnUnlockProfile')?.addEventListener('click', handleUnlockProfile);

    document.getElementById('contactsBtn')?.addEventListener('click', () => openContactSidebar('select', 'recipientName'));
    document.getElementById('btnComposeContacts')?.addEventListener('click', () => openContactSidebar('select', 'composeRecipient'));
    
    document.getElementById('composeFileInput')?.addEventListener('change', handleComposeFileUpload);
    document.getElementById('btnRemoveComposeFile')?.addEventListener('click', clearComposeFile);

    document.getElementById('modeSwitch')?.addEventListener('change', (e) => { updateAppMode(e.target.checked ? 'decrypt' : 'encrypt'); });
    document.getElementById('actionBtn')?.addEventListener('click', handleMainAction);
    document.getElementById('copyBtn')?.addEventListener('click', copyToClipboard);

    // New Logic for Wizard
    document.getElementById('messageInput')?.addEventListener('input', updateWizardState);
    document.getElementById('sk_fld_2')?.addEventListener('input', updateWizardState);
    document.getElementById('wizardResetLink')?.addEventListener('click', clearMessageInput);
    document.getElementById('btnNewMessage')?.addEventListener('click', resetWizard);
    document.getElementById('embeddedQrScanBtn')?.addEventListener('click', startMessageScanner);

    // Legacy support (hidden buttons)
    document.getElementById('clearFieldsBtn')?.addEventListener('click', clearAllFields);

    document.getElementById('saveTxtBtn')?.addEventListener('click', () => {
        const content = document.getElementById('messageOutput').value; if(content) downloadTxtFile(content);
    });

    // Save Media Btn (Wizard Result - Image/PDF)
    document.getElementById('saveMediaBtn')?.addEventListener('click', () => {
        if (!currentResultData) return;

        const a = document.createElement('a');
        a.href = currentResultData;

        if (currentResultType === 'image') {
            a.download = `secure-image-${Date.now()}.png`;
        } else if (currentResultType === 'pdf') {
            a.download = `secure-doc-${Date.now()}.pdf`;
        } else {
            a.download = `secure-file-${Date.now()}.bin`;
        }

        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    });

    document.getElementById('uploadTxtBtn')?.addEventListener('click', () => { document.getElementById('txtFileInput').click(); });
    document.getElementById('txtFileInput')?.addEventListener('change', handleTxtImport);

    document.getElementById('loginForm')?.addEventListener('submit', handleLogin);
    document.getElementById('activationForm')?.addEventListener('submit', handleActivation);
    document.getElementById('showActivationLink')?.addEventListener('click', (e) => { e.preventDefault(); showSection('activationSection'); });
    document.getElementById('showLoginLink')?.addEventListener('click', (e) => {
        e.preventDefault(); showSection('loginSection');
        const u = document.getElementById('u_ident_entry'); const c = document.getElementById('sk_fld_1'); if(u) u.value = ''; if(c) c.value = '';
    });

    document.getElementById('licenseKey')?.addEventListener('blur', async (e) => {
        const key = e.target.value.trim(); if(!key) return;
        try {
            const res = await fetch(`${API_BASE}/auth/check-license`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ licenseKey: key }) });
            const data = await res.json();
            if (data.isValid && data.assignedUserId) {
                const uField = document.getElementById('newUsername'); uField.value = data.assignedUserId; uField.readOnly = true; uField.style.opacity = '0.7';
                let hint = document.getElementById('assignedIdHint');
                if(!hint) { hint = document.createElement('div'); hint.id = 'assignedIdHint'; hint.style.fontSize = '0.8rem'; hint.style.color = 'var(--accent-blue)'; hint.style.marginTop = '5px'; uField.parentNode.appendChild(hint); }
                hint.textContent = `ℹ️ Diese Lizenz ist fest für die ID ${data.assignedUserId} reserviert.`;
            } else if (!data.isValid && data.error === 'Bereits benutzt') { showAppStatus("Dieser Key wurde bereits verwendet.", 'error'); }
        } catch(e) { console.error(e); }
    });

    document.getElementById('sk_fld_3')?.addEventListener('input', validateActivationInputs);
    document.getElementById('sk_fld_4')?.addEventListener('input', validateActivationInputs);
    document.getElementById('agbCheck')?.addEventListener('change', validateActivationInputs);

    const uField = document.getElementById('u_ident_entry'); const cField = document.getElementById('sk_fld_1');
    if (uField) uField.value = ''; if (cField) cField.value = '';

    document.getElementById('qrGenBtn')?.addEventListener('click', () => {
        const text = document.getElementById('messageOutput').value; if(!text) return showAppStatus("Bitte erst Text verschlüsseln!", 'error'); showQRModal(text);
    });
    document.getElementById('closeQrBtn')?.addEventListener('click', () => { document.getElementById('qrModal').classList.remove('active'); stopQRAnimation(); });
    document.getElementById('saveQrBtn')?.addEventListener('click', downloadQR);
    document.getElementById('qrScanBtn')?.addEventListener('click', startMessageScanner);
    document.getElementById('closeScannerBtn')?.addEventListener('click', stopQRScanner);

    // Close QR Scanner on click outside
    document.getElementById('qrScannerModal')?.addEventListener('click', (e) => {
        if (e.target === document.getElementById('qrScannerModal')) {
            stopQRScanner();
        }
    });

    // Close QR Scanner on Escape
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && document.getElementById('qrScannerModal').classList.contains('active')) {
            stopQRScanner();
        }
    });

    document.getElementById('closeContactSidebar')?.addEventListener('click', closeContactSidebar);
    document.getElementById('contactSearch')?.addEventListener('input', (e) => renderContactList(e.target.value));
    document.getElementById('sortByName')?.addEventListener('click', () => toggleSort('name'));
    document.getElementById('sortByGroup')?.addEventListener('click', () => toggleSort('group'));
    
    document.getElementById('btnAddContactOpen')?.addEventListener('click', () => openEditModal()); 
    document.getElementById('btnEditToggle')?.addEventListener('click', toggleEditMode);
    document.getElementById('btnCancelSelect')?.addEventListener('click', closeContactSidebar);
    document.getElementById('btnConfirmSelect')?.addEventListener('click', confirmSelection);
    
    document.getElementById('btnExportContacts')?.addEventListener('click', exportContactsCsv);
    document.getElementById('btnImportContacts')?.addEventListener('click', () => document.getElementById('contactImportInput').click());
    document.getElementById('contactImportInput')?.addEventListener('change', (e) => { if(e.target.files.length > 0) handleCsvImport(e.target.files[0]); });

    document.getElementById('btnCancelBackup')?.addEventListener('click', () => { document.getElementById('backupModal').classList.remove('active'); document.getElementById('sk_fld_9').value = ''; document.getElementById('contactImportInput').value = ''; });

    document.getElementById('contactForm')?.addEventListener('submit', saveContact);
    document.getElementById('btnCancelEdit')?.addEventListener('click', () => document.getElementById('contactEditModal').classList.remove('active'));
    document.getElementById('btnDeleteContact')?.addEventListener('click', deleteContact);

    document.getElementById('btnCancelContactCode')?.addEventListener('click', () => { document.getElementById('contactCodeModal').classList.remove('active'); pendingContactAction = null; });
    document.getElementById('btnConfirmContactCode')?.addEventListener('click', handleContactCodeSubmit);

    document.getElementById('btnGenerateTorCode')?.addEventListener('click', generateTorCode);
    document.getElementById('btnConfirmTorLink')?.addEventListener('click', handleTorLink);

    document.getElementById('tabInboxSystem')?.addEventListener('click', () => switchInboxTab('system'));
    document.getElementById('tabInboxPrivate')?.addEventListener('click', () => switchInboxTab('private'));
    document.getElementById('btnComposeMessage')?.addEventListener('click', () => openComposeModal());
    document.getElementById('composeForm')?.addEventListener('submit', handleSendMessage);
    document.getElementById('btnInboxDecryptConfirm')?.addEventListener('click', handleInboxDecrypt);

    // --- ENTERPRISE KEY ADD LISTENER (Moved to UI setup) ---
    document.getElementById('btnAddEntKey')?.addEventListener('click', () => {
        if (!currentUser || !currentUser.sm_id) return;
        const storageKey = `sm_ent_keys_${currentUser.sm_id}`;

        const input = document.getElementById('newEntKey');
        const val = input.value.trim();
        if(!val) return;

        let stored = localStorage.getItem(storageKey);
        let keys = stored ? JSON.parse(stored) : [];

        if(!keys.includes(val)) {
            keys.push(val);
            localStorage.setItem(storageKey, JSON.stringify(keys));
            setEnterpriseKeys(keys); // Update live crypto
            initEnterpriseKeys(); // Refresh UI
            input.value = '';
            showToast("Schlüssel hinzugefügt", 'success');
        }
    });

    const fileInput = document.getElementById('fileInput');
    if (fileInput) {
        fileInput.addEventListener('change', function(e) {
            const file = e.target.files[0];
            if (!file) return;
            if (file.size > 25 * 1024 * 1024) { showToast("Datei ist zu groß! Maximum sind 25MB.", 'error'); this.value = ''; return; }

            if (file.size > 10 * 1024 * 1024) {
                 showToast("Große Datei wird verarbeitet... Bitte warten.", 'info');
            }

            showLoader("Lade Datei...");
            const infoDiv = document.getElementById('fileInfo'); const nameSpan = document.getElementById('fileName'); const spinner = document.getElementById('fileSpinner'); const check = document.getElementById('fileCheck'); const textArea = document.getElementById('messageInput');

            if (infoDiv) infoDiv.style.display = 'flex'; if (spinner) spinner.style.display = 'inline-block'; if (check) check.style.display = 'none'; if (nameSpan) nameSpan.textContent = "Lade " + file.name + "...";

            if (textArea) { textArea.disabled = true; textArea.value = "Lade Datei..."; }

            const reader = new FileReader();
            reader.onload = function(evt) {
                currentAttachmentBase64 = evt.target.result;
                if (spinner) spinner.style.display = 'none'; if (check) check.style.display = 'inline-block'; if (nameSpan) nameSpan.textContent = "📎 " + file.name;

                if (textArea) {
                    textArea.value = `[Datei ausgewählt: ${file.name}]`;
                    textArea.disabled = true; // Disable typing when file is selected
                }

                hideLoader();
                showToast("Datei erfolgreich geladen.", 'success');

                // Trigger Wizard State Update
                updateWizardState();
            };
            reader.onerror = function() { hideLoader(); showToast("Fehler beim Laden der Datei.", 'error'); };
            reader.readAsDataURL(file);
        });
    }

    // Auto-Scroll to Top on Blur (Mobile Optimization)
    // Ensures the UI jumps back to the top after closing the keyboard
    const scrollFields = ['messageInput', 'recipientName', 'sk_fld_2'];
    scrollFields.forEach(id => {
        const el = document.getElementById(id);
        if(el) {
            el.addEventListener('blur', () => {
                setTimeout(() => window.scrollTo(0,0), 100);
            });
        }
    });
}

function showSection(id) {
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    document.getElementById(id).classList.add('active');
    
    const wrapper = document.getElementById('headerSwitchWrapper');
    if(id === 'mainSection') wrapper.style.display = 'inline-block';
    else wrapper.style.display = 'none';
    
    window.scrollTo(0,0);
}

async function performAccountDeletion() {
    const btn = document.getElementById('btnConfirmDelete'); const originalText = btn.textContent; btn.textContent = "Lösche..."; btn.disabled = true;
    try {
        const res = await fetch(`${API_BASE}/auth/delete-account`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${authToken}` } });
        const d = await res.json();
        document.getElementById('deleteAccountModal').classList.remove('active');
        if(d.success) {
            if(currentUser && currentUser.sm_id) {
                localStorage.removeItem(`sm_contacts_${currentUser.sm_id}`);
                localStorage.removeItem(`sm_ent_keys_${currentUser.sm_id}`); // Clear keys too
            }
            showToast("Dein Account wurde erfolgreich gelöscht.", 'success');
            setTimeout(() => { localStorage.removeItem('sm_token'); localStorage.removeItem('sm_user'); contacts = []; window.location.reload(); }, 2000);
        } else { showToast(d.error || "Fehler beim Löschen", 'error'); }
    } catch(e) { showToast("Verbindungsfehler", 'error'); document.getElementById('deleteAccountModal').classList.remove('active'); } finally { btn.textContent = originalText; btn.disabled = false; }
}

async function handleChangeAccessCode() {
    const currentCode = document.getElementById('sk_fld_5').value; const newCode = document.getElementById('sk_fld_6').value; const newCodeRepeat = document.getElementById('sk_fld_7').value; const btn = document.getElementById('btnConfirmChangeCode');

    if(!currentCode || !newCode || !newCodeRepeat) return showToast("Bitte alle Felder ausfüllen.", 'error');
    if(newCode.length !== 5 || isNaN(newCode)) return showToast("Der neue Code muss 5 Ziffern haben.", 'error');
    if(newCode !== newCodeRepeat) return showToast("Die neuen Codes stimmen nicht überein.", 'error');

    btn.textContent = "Verarbeite..."; btn.disabled = true; showLoader("Ändere Zugangscode...");

    try {
        const res = await fetch(`${API_BASE}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: currentUser.name, accessCode: currentCode, deviceId: await generateDeviceFingerprint() }) });
        const loginData = await res.json();

        if(!loginData.success) { showToast("Der aktuelle Zugangscode ist falsch.", 'error'); btn.textContent = "Ändern"; btn.disabled = false; hideLoader(); return; }

        const updateRes = await fetch(`${API_BASE}/auth/change-code`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` }, body: JSON.stringify({ newAccessCode: newCode }) });
        const updateData = await updateRes.json();

        if(updateData.success) { showToast("Zugangscode erfolgreich geändert.", 'success'); document.getElementById('changeCodeModal').classList.remove('active'); } else { showToast("Fehler: " + (updateData.error || "Unbekannt"), 'error'); }
    } catch(e) { showToast("Verbindungsfehler.", 'error'); } finally { btn.textContent = "Ändern"; btn.disabled = false; hideLoader(); }
}

async function handleManualRenewal() {
    const key = document.getElementById('manualRenewalKey').value.trim();
    if (!key) return showToast("Bitte Key eingeben", 'error');

    const btn = document.getElementById('btnConfirmManualRenewal');
    const oldTxt = btn.textContent;
    btn.textContent = "Prüfe..."; btn.disabled = true;

    try {
        // Step 1: Pre-Check & Prediction
        const checkRes = await fetch(`${API_BASE}/auth/check-license`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
            body: JSON.stringify({ licenseKey: key, username: currentUser.name })
        });
        const checkData = await checkRes.json();

        if (!checkData.isValid) {
            showToast(checkData.error || "Lizenz ungültig", 'error');
            btn.textContent = oldTxt; btn.disabled = false;
            return;
        }

        if (checkData.assignedUserId && checkData.assignedUserId !== currentUser.name) {
            showToast("Dieser Key ist für einen anderen Benutzer reserviert.", 'error');
            btn.textContent = oldTxt; btn.disabled = false;
            return;
        }

        // Prepare Prediction Message
        let predictionStr = "Unbegrenzt";
        if (checkData.predictedExpiry && checkData.predictedExpiry !== 'Unlimited') {
            const d = new Date(checkData.predictedExpiry);
            predictionStr = d.toLocaleDateString('de-DE');
        }

        const confirmMsg = `Deine Lizenz wird bis zum ${predictionStr} verlängert.\n\nIhre Sicherheits-Identität bleibt unverändert.`;

        // Step 2: Show Confirmation
        window.showAppConfirm(confirmMsg, async () => {
            // Step 3: Execute Renewal
            btn.textContent = "Verlängere...";
            try {
                const res = await fetch(`${API_BASE}/renew-license`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
                    body: JSON.stringify({ licenseKey: key })
                });
                const data = await res.json();

                if (data.success) {
                    document.getElementById('manualRenewalModal').classList.remove('active');
                    updateSidebarInfo(currentUser.name, data.newExpiresAt);
                    showToast("Lizenz erfolgreich verlängert!", 'success');
                } else {
                    showToast(data.error || "Fehler", 'error');
                }
            } catch(e) {
                showToast("Verbindungsfehler", 'error');
            } finally {
                btn.textContent = oldTxt; btn.disabled = false;
            }
        }, { confirm: 'Verlängern', cancel: 'Abbrechen' });

        // Reset button state if modal is just shown (callback handles execution)
        btn.textContent = oldTxt; btn.disabled = false;

    } catch (e) {
        showToast("Verbindungsfehler beim Prüfen", 'error');
        btn.textContent = oldTxt; btn.disabled = false;
    }
}

function openContactSidebar(mode, targetId = 'recipientName') {
    contactMode = mode;
    contactTargetInput = targetId;
    isEditMode = false; selectedContactIds.clear();
    const sidebar = document.getElementById('contactSidebar'); const overlay = document.getElementById('sidebarOverlay'); const footerManage = document.getElementById('csFooterManage'); const footerSelect = document.getElementById('csFooterSelect'); const groupArea = document.getElementById('groupSelectionArea'); const btnEdit = document.getElementById('btnEditToggle');

    document.getElementById('contactSearch').value = ''; btnEdit.style.background = 'transparent'; btnEdit.innerHTML = '✎ Bearbeiten';

    if (mode === 'manage') { footerManage.style.display = 'flex'; footerSelect.style.display = 'none'; groupArea.style.display = 'none'; } else { footerManage.style.display = 'none'; footerSelect.style.display = 'flex'; groupArea.style.display = 'flex'; renderGroupTags(); }
    renderContactList(); sidebar.classList.add('active'); overlay.classList.add('active', 'high-z');
}

function closeContactSidebar() { document.getElementById('contactSidebar').classList.remove('active'); document.getElementById('sidebarOverlay').classList.remove('active', 'high-z'); }

function closeInboxSidebar() { document.getElementById('inboxSidebar').classList.remove('active'); document.getElementById('sidebarOverlay').classList.remove('active'); }

function renderGroupTags() {
    const area = document.getElementById('groupSelectionArea'); area.innerHTML = '<small style="width: 100%; color: #777; margin-bottom: 5px;">Gruppen ankreuzen:</small>';
    const groups = [...new Set(contacts.map(c => c.group).filter(g => g))].sort();
    if (groups.length === 0) { area.innerHTML += '<span style="color:#555; font-size:0.8rem;">Keine Gruppen.</span>'; return; }

    groups.forEach(g => {
        const tag = document.createElement('div'); tag.className = 'group-tag';
        tag.innerHTML = `<input type="checkbox" class="grp-chk" value="${g}" style="width:auto; margin-right:5px;"><span>${g}</span>`;
        const chk = tag.querySelector('input');
        tag.addEventListener('click', (e) => { if (e.target !== chk) { chk.checked = !chk.checked; toggleGroupSelection(g, chk.checked); } });
        chk.addEventListener('change', (e) => toggleGroupSelection(g, e.target.checked));
        area.appendChild(tag);
    });
}

function toggleGroupSelection(groupName, isSelected) {
    const members = contacts.filter(c => c.group === groupName); members.forEach(m => { if (isSelected) selectedContactIds.add(m.id); else selectedContactIds.delete(m.id); });
    renderContactList(document.getElementById('contactSearch').value);
}

function toggleSort(key) {
    if (sortKey === key) sortDir = sortDir === 'asc' ? 'desc' : 'asc'; else { sortKey = key; sortDir = 'asc'; }
    document.getElementById('sortByName').textContent = `Empfänger ${sortKey==='name' ? (sortDir==='asc'?'▲':'▼') : '↕'}`;
    document.getElementById('sortByGroup').textContent = `Gruppe ${sortKey==='group' ? (sortDir==='asc'?'▲':'▼') : '↕'}`;
    renderContactList(document.getElementById('contactSearch').value);
}

function renderContactList(search = '') {
    const container = document.getElementById('contactListBody'); container.innerHTML = ''; const term = search.toLowerCase();

    let list = contacts.filter(c => (c.name && c.name.toLowerCase().includes(term)) || c.id.toLowerCase().includes(term) || (c.group && c.group.toLowerCase().includes(term)));
    list.sort((a, b) => {
        let valA = (a[sortKey] || '').toLowerCase(); let valB = (b[sortKey] || '').toLowerCase();
        if (valA < valB) return sortDir === 'asc' ? -1 : 1; if (valA > valB) return sortDir === 'asc' ? 1 : -1; return 0;
    });

    if (list.length === 0) { document.getElementById('emptyContactMsg').style.display = 'block'; return; }
    document.getElementById('emptyContactMsg').style.display = 'none';

    list.forEach(c => {
        const row = document.createElement('div'); row.className = 'cs-row';
        if (contactMode === 'select' && selectedContactIds.has(c.id)) row.classList.add('selected');
        if (contactMode === 'manage' && isEditMode) row.classList.add('edit-mode-active');
        row.innerHTML = `<div style="display:flex; flex-direction:column; flex:2; overflow:hidden;"><span style="font-weight:bold; color:#fff;">${c.name || c.id}</span>${c.name ? `<span style="font-size:0.75rem; color:#666;">ID: ${c.id}</span>` : ''}</div><div style="flex:1; text-align:right; font-size:0.8rem; color:var(--accent-blue);">${c.group || '-'}</div>`;
        row.addEventListener('click', () => handleRowClick(c)); container.appendChild(row);
    });
}

function handleRowClick(contact) {
    if (contactMode === 'manage') { if (isEditMode) openEditModal(contact); }
    else { if (selectedContactIds.has(contact.id)) selectedContactIds.delete(contact.id); else selectedContactIds.add(contact.id); renderContactList(document.getElementById('contactSearch').value); }
}

function toggleEditMode() {
    isEditMode = !isEditMode; const btn = document.getElementById('btnEditToggle'); const footerImpExp = document.getElementById('csImportExport');
    if (isEditMode) { btn.style.background = 'rgba(255, 165, 0, 0.2)'; btn.textContent = 'Modus: Bearbeiten'; if(footerImpExp) footerImpExp.style.display = 'flex'; }
    else { btn.style.background = 'transparent'; btn.textContent = '✎ Bearbeiten'; if(footerImpExp) footerImpExp.style.display = 'none'; }
    renderContactList(document.getElementById('contactSearch').value);
}

function openEditModal(contact = null) {
    const modal = document.getElementById('contactEditModal'); const btnSave = document.getElementById('btnSaveContact'); const btnDel = document.getElementById('btnDeleteContact'); document.getElementById('contactForm').reset(); const dl = document.getElementById('groupSuggestions'); dl.innerHTML = '';
    [...new Set(contacts.map(c => c.group).filter(g => g))].forEach(g => dl.appendChild(new Option(g,g)));

    if (contact) {
        document.getElementById('modalTitle').textContent = 'Kontakt bearbeiten'; document.getElementById('inputName').value = contact.name || ''; document.getElementById('inputID').value = contact.id; document.getElementById('inputID').readOnly = true; document.getElementById('inputID').style.opacity = '0.5'; document.getElementById('inputGroup').value = contact.group || '';
        btnSave.textContent = 'Aktualisieren'; btnDel.style.display = 'block'; btnDel.dataset.id = contact.id;
    } else {
        document.getElementById('modalTitle').textContent = 'Kontakt hinzufügen'; document.getElementById('inputID').readOnly = false; document.getElementById('inputID').style.opacity = '1';
        btnSave.textContent = 'Speichern'; btnDel.style.display = 'none';
    }
    modal.classList.add('active');
}

async function saveContact(e) {
    e.preventDefault(); const btn = document.getElementById('btnSaveContact'); const oldTxt = btn.textContent;
    const nameVal = document.getElementById('inputName').value.trim(); const idVal = document.getElementById('inputID').value.trim(); const groupVal = document.getElementById('inputGroup').value.trim();

    if (!idVal) return showToast("ID fehlt!", 'error'); btn.disabled = true; btn.textContent = "Prüfe...";

    try {
        const res = await fetch(`${API_BASE}/users/exists`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` }, body: JSON.stringify({ targetUsername: idVal }) });
        const data = await res.json();
        if (!data.exists) { showToast(`ID "${idVal}" nicht gefunden.`, 'error'); btn.disabled = false; btn.textContent = oldTxt; return; }

        contacts = contacts.filter(c => c.id !== idVal); contacts.push({ id: idVal, name: nameVal || idVal, group: groupVal }); contacts.sort((a, b) => a.name.localeCompare(b.name));
        saveUserContacts();
        document.getElementById('contactEditModal').classList.remove('active'); renderContactList(document.getElementById('contactSearch').value); if(contactMode === 'select') renderGroupTags(); showToast(`Kontakt gespeichert.`, 'success');
    } catch (err) { showToast("Fehler beim Speichern", 'error'); } finally { btn.disabled = false; btn.textContent = oldTxt; }
}

function deleteContact() {
    const id = document.getElementById('btnDeleteContact').dataset.id;
    window.showAppConfirm("Kontakt wirklich löschen?", () => { contacts = contacts.filter(c => c.id !== id); saveUserContacts(); document.getElementById('contactEditModal').classList.remove('active'); renderContactList(); showToast("Kontakt gelöscht.", 'success'); });
}

function exportContactsCsv() {
    if (!contacts || contacts.length === 0) return showToast("Keine Kontakte vorhanden.", 'error');
    try {
        let csvContent = "ID,Name,Group\n";
        const escapeCsvField = (field) => { let val = String(field || ""); if (/^[=+\-@]/.test(val)) val = "'" + val; val = val.replace(/"/g, '""'); if (val.search(/("|,|\n)/g) >= 0) val = `"${val}"`; return val; };
        contacts.forEach(c => { const id = escapeCsvField(c.id); const name = escapeCsvField(c.name); const grp = escapeCsvField(c.group); csvContent += `${id},${name},${grp}\n`; });
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' }); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.setAttribute("href", url); link.setAttribute("download", `contacts_export_${new Date().toISOString().slice(0,10)}.csv`); link.style.visibility = 'hidden'; document.body.appendChild(link); link.click(); document.body.removeChild(link);
        showToast("Kontakte erfolgreich als .csv exportiert.", 'success');
    } catch(e) { console.error(e); showToast("Fehler beim Export.", 'error'); }
}

function handleCsvImport(file) {
    if (!file) return;
    if (file.type !== "text/csv" && !file.name.endsWith(".csv")) { showToast("Bitte nur .csv Dateien verwenden.", 'error'); document.getElementById('contactImportInput').value = ''; return; }

    const reader = new FileReader();
    reader.onload = function(evt) {
        try {
            const text = evt.target.result;
            const parseCsvLine = (line) => { const result = []; let start = 0; let inQuotes = false; for (let i = 0; i < line.length; i++) { if (line[i] === '"') inQuotes = !inQuotes; else if (line[i] === ',' && !inQuotes) { let field = line.substring(start, i); if (field.startsWith('"') && field.endsWith('"')) field = field.slice(1, -1).replace(/""/g, '"'); result.push(field); start = i + 1; } } let lastField = line.substring(start); if (lastField.startsWith('"') && lastField.endsWith('"')) lastField = lastField.slice(1, -1).replace(/""/g, '"'); result.push(lastField); return result; };
            const lines = text.split(/\r?\n/); const importedData = [];
            let startIndex = 0; if (lines.length > 0 && lines[0].toLowerCase().includes("id")) startIndex = 1;

            for (let i = startIndex; i < lines.length; i++) { const line = lines[i].trim(); if (!line) continue; const parts = parseCsvLine(line); if (parts.length >= 1) { const id = parts[0].trim(); if(id) { const name = parts.length > 1 ? parts[1].trim() : id; const group = parts.length > 2 ? parts[2].trim() : ""; importedData.push({ id, name, group }); } } }
            if (importedData.length > 0) processImportedData(importedData); else showToast("Keine gültigen Kontakte gefunden.", 'error');
        } catch (e) { console.error(e); showToast("Fehler beim Lesen der Datei.", 'error'); } finally { document.getElementById('contactImportInput').value = ''; }
    };
    reader.onerror = () => { showToast("Lesefehler.", 'error'); document.getElementById('contactImportInput').value = ''; };
    reader.readAsText(file);
}

function handleContactCodeSubmit() { /* Unused */ }

function processImportedData(importedData) {
    try {
        if (!Array.isArray(importedData)) throw new Error("Format ungültig");
        const toUpdate = []; const toAdd = [];
        importedData.forEach(c => { if (!c.id) return; const existingIndex = contacts.findIndex(ex => ex.id === c.id); if (existingIndex > -1) toUpdate.push(c); else toAdd.push(c); });
        const proceedImport = () => { toAdd.forEach(c => contacts.push(c)); toUpdate.forEach(c => { const idx = contacts.findIndex(ex => ex.id === c.id); if(idx > -1) contacts[idx] = c; }); contacts = contacts.filter(c => c && c.id); saveUserContacts(); renderContactList(document.getElementById('contactSearch').value); if(contactMode === 'select') renderGroupTags(); showToast(`Import: ${toAdd.length} neu, ${toUpdate.length} aktualisiert.`, 'success'); };
        if (toUpdate.length > 0) window.showAppConfirm(`${toUpdate.length} Kontakte existieren bereits und werden überschrieben. Fortfahren?`, proceedImport); else proceedImport();
    } catch(err) { showToast("Datenformat ungültig.", 'error'); }
}

function confirmSelection() {
    const input = document.getElementById(contactTargetInput);
    const arr = Array.from(selectedContactIds);
    if (arr.length > 0 && input) {
        // If there's already text, append or replace?
        // User requested "der Wert soll ergänzt werden".
        // Let's verify existing value.
        const currentVal = input.value.trim();
        const newIds = arr.join(', ');

        if(currentVal) {
            // Avoid duplicates in simplistic way if possible, or just append
            // Simple append for now as "replace" was main tool behavior?
            // Main tool usually replaces. User said "der Wert soll ergänzt werden".
            // Let's append with comma.

            // Check if we are in main tool or compose. Main tool might expect replacement or single?
            // Main tool (encryptFull) supports multiple.
            // Let's append for both to be safe/feature-rich, but check for dupes.

            const existing = currentVal.split(',').map(s=>s.trim());
            const toAdd = arr.filter(id => !existing.includes(id));
            if(toAdd.length > 0) {
                input.value = currentVal + ', ' + toAdd.join(', ');
            }
        } else {
            input.value = newIds;
        }
    }
    closeContactSidebar();
}

async function handleLogin(e) {
    e.preventDefault(); const uInput = document.getElementById('u_ident_entry'); const cInput = document.getElementById('sk_fld_1'); const u = uInput.value; const c = cInput.value;
    if(document.body.classList.contains('mode-enterprise')) sessionStorage.setItem('sm_auth_code_temp', c);
    uInput.value = ''; cInput.value = '';

    const devId = await generateDeviceFingerprint();
    try {
        const res = await fetch(`${API_BASE}/auth/login`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ username:u, accessCode:c, deviceId:devId }) });
        const data = await res.json();
        if (data.success) {
            authToken = data.token;
            const decoded = parseJwt(authToken);
            currentUser = { name: data.username, sm_id: decoded.id, badge: data.badge };
            localStorage.setItem('sm_token', authToken); localStorage.setItem('sm_user', JSON.stringify(currentUser));

            // ISOLATED LOAD
            loadUserContacts();
            initEnterpriseKeys();

            if (data.hasLicense === false) { updateSidebarInfo(currentUser.name, null); showRenewalModal(); return; }
            if(data.expiresAt && data.expiresAt !== 'lifetime') { const expDate = new Date(String(data.expiresAt).replace(' ', 'T')); if(expDate < new Date()) { updateSidebarInfo(currentUser.name, data.expiresAt); showRenewalModal(); return; } }
            updateSidebarInfo(currentUser.name, data.expiresAt); showSection('mainSection');
        } else {
            if (data.error === "ACCOUNT_BLOCKED") { localStorage.removeItem('sm_token'); showSection('blockedSection'); }
            else if (data.error === "DEVICE_NOT_AUTHORIZED") {
                localStorage.removeItem('sm_token');
                const torContainer = document.getElementById('torLinkContainer');
                if(torContainer) {
                    torContainer.style.display = 'block';
                    document.getElementById('torLinkUsername').value = u;
                }
                window.showToast("Gerät nicht autorisiert. Ist dies Ihr Zweit-Gerät?", 'error');
            }
            else showAppStatus(data.error || "Login fehlgeschlagen", 'error');
        }
    } catch(err) { showAppStatus("Serverfehler", 'error'); } 
}

async function generateTorCode() {
    const btn = document.getElementById('btnGenerateTorCode');
    btn.disabled = true; btn.textContent = "...";
    try {
        const res = await fetch(`${API_BASE}/auth/generate-link-code`, { headers: { 'Authorization': `Bearer ${authToken}` }, method: 'POST' });
        const data = await res.json();
        if(data.success) {
            document.getElementById('torCodeDisplayArea').style.display = 'block';
            document.getElementById('generatedTorCode').textContent = data.code;
            btn.textContent = "Neuen Code generieren";
        } else {
            showToast("Fehler beim Generieren", 'error');
        }
    } catch(e) { showToast("Verbindungsfehler", 'error'); } finally { btn.disabled = false; }
}

async function handleTorLink() {
    const username = document.getElementById('torLinkUsername').value.trim();
    const code = document.getElementById('torLinkCode').value.trim();
    if(!username || !code) return showToast("Daten fehlen", 'error');

    const btn = document.getElementById('btnConfirmTorLink');
    btn.textContent = "..."; btn.disabled = true;

    try {
        const devId = await generateDeviceFingerprint();
        const res = await fetch(`${API_BASE}/auth/link-device`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ username, code, newDeviceId: devId })
        });
        const data = await res.json();
        if(data.success) {
            document.getElementById('torLinkModal').classList.remove('active');
            document.getElementById('torLinkContainer').style.display = 'none';
            window.showAppConfirm("Kopplung erfolgreich! Bitte jetzt einloggen.", () => {}, { confirm: "OK", cancel: null });
        } else {
            showToast(data.error || "Kopplung fehlgeschlagen", 'error');
        }
    } catch(e) { showToast("Verbindungsfehler", 'error'); } finally { btn.textContent = "Koppeln"; btn.disabled = false; }
}

async function handleActivation(e) {
    e.preventDefault();
    if (!document.getElementById('agbCheck').checked) { window.showToast("Bitte akzeptieren Sie die AGB und Nutzungsbedingungen.", 'error'); return; }
    const code1 = document.getElementById('sk_fld_3').value; const code2 = document.getElementById('sk_fld_4').value;
    if (code1 !== code2) { window.showToast("Die Zugangscodes stimmen nicht überein!", 'error'); return; }
    const devId = await generateDeviceFingerprint(); const payload = { licenseKey: document.getElementById('licenseKey').value, username: document.getElementById('newUsername').value, accessCode: document.getElementById('sk_fld_3').value, deviceId: devId };
    try { const res = await fetch(`${API_BASE}/auth/activate`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload) }); const d = await res.json(); if(d.success) { showAppStatus("Aktivierung erfolgreich! Bitte einloggen.", 'success'); showSection('loginSection'); document.getElementById('u_ident_entry').value = payload.username; } else { showAppStatus(d.error || "Aktivierung fehlgeschlagen", 'error'); } } catch(e) { showAppStatus("Fehler bei der Aktivierung", 'error'); }
}

async function handleLogout() {
    localStorage.removeItem('sm_token'); localStorage.removeItem('sm_user'); currentUser=null; authToken=null; contacts = []; setEnterpriseKeys([]); updateSidebarInfo(null); document.getElementById('sidebar').classList.remove('active'); showSection('loginSection');
}

function updateAppMode(mode) {
    if (document.activeElement) document.activeElement.blur();
    currentMode = mode;
    const isDec = (mode === 'decrypt');

    document.getElementById('modeTitle').textContent = isDec ? 'ENTSCHLÜSSELUNG' : 'VERSCHLÜSSELUNG';
    document.getElementById('statusIndicator').textContent = isDec ? '● EMPFANGSBEREIT' : '● GESICHERT';
    const btn = document.getElementById('actionBtn');
    btn.textContent = isDec ? '🔓 NACHRICHT ENTSCHLÜSSELN' : '🔒 DATEN VERSCHLÜSSELN';

    btn.className = isDec ? 'btn' : 'btn btn-primary';
    if(isDec) { btn.style.border='1px solid var(--accent-blue)'; btn.style.color='var(--accent-blue)'; }
    else { btn.style.border=''; btn.style.color=''; }

    document.getElementById('textLabel').textContent = isDec ? 'Verschlüsselter Text' : 'Nachrichteneingabe (Klartext)';
    document.getElementById('messageInput').placeholder = isDec ? 'Secure Text einfügen...' : 'Nachricht schreiben...';

    // Icon Toggle
    const attachBtn = document.getElementById('attachmentBtn');
    const qrBtn = document.getElementById('embeddedQrScanBtn');
    const txtBtn = document.getElementById('txtUploadIcon');

    if(attachBtn) attachBtn.style.display = isDec ? 'none' : 'block';
    if(qrBtn) qrBtn.style.display = isDec ? 'block' : 'none';
    if(txtBtn) txtBtn.style.display = isDec ? 'block' : 'none';

    // Recipient logic handled in updateWizardState now, but let's hide it initially
    const rGroup = document.getElementById('recipientGroup');
    if(rGroup) rGroup.style.display = isDec ? 'none' : 'block';

    resetWizard();
}

function updateWizardState() {
    const textVal = document.getElementById('messageInput').value;
    const hasInput = (textVal.length > 0 || currentAttachmentBase64 !== null);
    const codeVal = document.getElementById('sk_fld_2').value;
    const isReady = (hasInput && codeVal.length === 5);

    // FIX: Hide icons if text is present to prevent overlap (Encryption & Decryption)
    // Using CSS class for smooth transition instead of display:none
    const iconsWrapper = document.querySelector('.input-icons-wrapper');
    if (iconsWrapper) {
        if (textVal.length > 0) {
            iconsWrapper.classList.add('hide-icons');
        } else {
            iconsWrapper.classList.remove('hide-icons');
        }
    }

    // Toggle "X" Reset Button (New Logic)
    const resetBtn = document.getElementById('wizardResetLink');
    if (resetBtn) {
        resetBtn.style.display = (textVal.length > 0) ? 'flex' : 'none';
    }

    const metaWrapper = document.getElementById('wizardMetaWrapper');
    const actionWrapper = document.getElementById('wizardActionWrapper');

    if (hasInput) {
        metaWrapper.classList.remove('hidden');
    } else {
        metaWrapper.classList.add('hidden');
        actionWrapper.classList.add('hidden'); // Hide action if input cleared
    }

    if (isReady) {
        // Trigger scroll if button just appeared (Mobile Optimization)
        if (actionWrapper.classList.contains('hidden')) {
             setTimeout(() => window.scrollTo(0,0), 100);
        }
        actionWrapper.classList.remove('hidden');
    } else {
        actionWrapper.classList.add('hidden');
    }

    // Toggle Compression State (Fix mobile overlap)
    document.getElementById('wizardInputStep').classList.toggle('compressed', isReady);
}

function clearMessageInput(e) {
    if(e) e.preventDefault();
    if(window.clearAttachment) window.clearAttachment();

    const el = document.getElementById('messageInput');
    if(el) {
        el.value = '';
        el.disabled = false;
        el.focus();
    }
    updateWizardState();
}

function resetApplicationState() {
    // 1. Reset Global State Variables (SECURITY WIPE)
    currentAttachmentBase64 = null;

    // 2. Clear All Inputs
    const msgInput = document.getElementById('messageInput');
    const codeInput = document.getElementById('sk_fld_2');
    const recipientInput = document.getElementById('recipientName');

    if (msgInput) {
        msgInput.value = ''; // Force clear source input
        msgInput.disabled = false;
    }
    if (codeInput) codeInput.value = '';
    if (recipientInput) recipientInput.value = '';

    document.getElementById('messageOutput').value = ''; // Force clear result output
    document.getElementById('mediaOutput').innerHTML = '';
    document.getElementById('mediaOutput').style.display = 'none';

    // 3. Clear File Inputs
    document.getElementById('fileInput').value = '';
    document.getElementById('txtFileInput').value = '';
    document.getElementById('fileInfo').style.display = 'none';

    // 4. Reset UI State Classes
    document.getElementById('wizardInputStep').classList.remove('minimized');
    document.getElementById('wizardInputStep').classList.remove('compressed');
    document.getElementById('outputGroup').classList.add('hidden');
    document.getElementById('wizardMetaWrapper').classList.add('hidden');
    document.getElementById('wizardActionWrapper').classList.add('hidden');

    // 5. Mode Specific Adjustments
    if (currentMode === 'encrypt') {
        document.getElementById('recipientGroup').style.display = 'block';
    } else {
        document.getElementById('recipientGroup').style.display = 'none';
    }

    // 6. Reset legacy/helper feedback
    document.getElementById('importFeedback').style.display = 'none';

    // Explicit GC Hint
    try {
       if(window.gc) window.gc();
    } catch(e){}

    console.log("App State Hard Reset Complete (Security Wipe)");
}

function resetWizard() {
    resetApplicationState();
    // Trigger UI update to ensure correct initial state
    updateWizardState();
}

async function handleMainAction() {
    const code = document.getElementById('sk_fld_2').value;
    let payload = document.getElementById('messageInput').value; // 'let' ensures we can nullify it later

    // Strict Input Retrieval
    if (currentMode === 'encrypt') {
        if (currentAttachmentBase64) {
            payload = currentAttachmentBase64;
        } else {
            payload = document.getElementById('messageInput').value;
        }
    } else {
        // DECRYPT MODE
        payload = document.getElementById('messageInput').value.trim();
        // Ensure no leftover attachment is used for decryption
        currentAttachmentBase64 = null;
    }

    if (!payload || !code || code.length!==5 || !currentUser) return showAppStatus("Daten unvollständig.", 'error');
    const isValid = await validateSessionStrict(); if (!isValid) return;

    const btn = document.getElementById('actionBtn'); const old = btn.textContent;
    btn.textContent = "Processing..."; btn.disabled = true;

    try {
        let res = "";
        if (currentMode === 'encrypt') {
            const rIds = document.getElementById('recipientName').value.split(',').map(s=>s.trim()).filter(s=>s); if(!rIds.includes(currentUser.name)) rIds.push(currentUser.name);
            res = await encryptFull(payload, code, rIds, currentUser.name);

            // WIZARD: Show Result
            enterResultState(res, 'text');

            // SECURITY WIPE (Encryption): Clear Source Material
            // document.getElementById('messageInput').value = ''; // Persist input as requested
            // currentAttachmentBase64 = null;
            payload = null; // Hint for GC

        } else {
            // Decryption Logic
            res = await decryptFull(payload, code, currentUser.name);

            // Safety check: if res is same as payload, something is wrong with logic or assumption
            if (res === payload && !res.startsWith('data:')) {
                console.warn("Decryption returned identical string. Possible logic error.");
            }

            // WIZARD: Show Result (Decrypted)
            enterResultState(res, 'auto'); // Auto-detect image/pdf inside

            // SECURITY WIPE (Decryption): Clear Encrypted Input
            document.getElementById('messageInput').value = '';
            currentAttachmentBase64 = null;
            payload = null;
        }

        // Visual Feedback: Security Pulse
        const indicator = document.getElementById('statusIndicator');
        if (indicator) {
            indicator.classList.add('security-pulse');
            setTimeout(() => indicator.classList.remove('security-pulse'), 1000);
        }

    } catch (e) {
        console.error("Action Failed", e);
        showAppStatus(e.message || "Fehler", 'error');
    } finally {
        btn.textContent=old; btn.disabled=false;
    }
}

function enterResultState(resultData, type) {
    // 1. Store Global State
    currentResultData = resultData;

    // 2. Shrink Input
    document.getElementById('wizardInputStep').classList.add('minimized');

    // 3. Hide Meta & Action
    document.getElementById('wizardMetaWrapper').classList.add('hidden');
    document.getElementById('wizardActionWrapper').classList.add('hidden');

    // 4. Show Result Container
    const outGroup = document.getElementById('outputGroup');
    outGroup.classList.remove('hidden');

    const textOut = document.getElementById('messageOutput');
    const mediaOut = document.getElementById('mediaOutput');
    const copyBtn = document.getElementById('copyBtn');
    const qrBtn = document.getElementById('qrGenBtn');
    const saveTxtBtn = document.getElementById('saveTxtBtn');
    const saveMediaBtn = document.getElementById('saveMediaBtn');

    // Reset Buttons
    copyBtn.style.display = 'none';
    qrBtn.style.display = 'none';
    saveTxtBtn.style.display = 'none';
    saveMediaBtn.style.display = 'none';

    // Clear Outputs
    textOut.style.display = 'none';
    mediaOut.style.display = 'none';
    mediaOut.innerHTML = '';

    // Logic for content type
    if (type === 'auto') {
        if (resultData.startsWith('data:image')) type = 'image';
        else if (resultData.startsWith('data:application/pdf')) type = 'pdf';
        else type = 'text';
    }

    currentResultType = type;

    if (type === 'text') {
        textOut.value = resultData;
        textOut.style.display = 'block';
        copyBtn.style.display = 'block'; // Copy always available for text

        if (currentMode === 'encrypt') {
            // ENCRYPT: Show QR & Save (Large)

            // Check chunk count for QR feasibility (Limit 60 chunks of 250 chars)
            const chunkCount = Math.ceil(resultData.length / 250);
            if (chunkCount <= 60) {
                qrBtn.style.display = 'block';
            } else {
                qrBtn.style.display = 'none'; // Too many chunks for animation
            }

            // Always show save if large enough (e.g. > 9999) OR if QR is hidden due to chunk limit
            if (resultData.length > 9999 || chunkCount > 60) {
                saveTxtBtn.style.display = 'block';
                saveTxtBtn.textContent = "💾 ALS .TXT SPEICHERN";
            }
        } else {
            // DECRYPT: Show Save (.txt) instead of QR
            saveTxtBtn.style.display = 'block';
            saveTxtBtn.textContent = "💾 ALS .TXT SPEICHERN";
        }

    } else if (type === 'image') {
        mediaOut.style.display = 'flex';
        const img = document.createElement('img');
        img.src = resultData;
        img.style.maxWidth = '100%';
        img.style.borderRadius = '4px';
        img.style.maxHeight = '300px';
        img.style.objectFit = 'contain';
        mediaOut.appendChild(img);

        saveMediaBtn.style.display = 'block';
        saveMediaBtn.textContent = "💾 BILD SPEICHERN";

    } else if (type === 'pdf') {
        mediaOut.style.display = 'flex';
        const icon = document.createElement('div');
        icon.innerHTML = '📄 PDF DOKUMENT';
        icon.style.fontSize = '1.5rem';
        icon.style.color = 'var(--accent-blue)';
        icon.style.marginBottom = '10px';
        mediaOut.appendChild(icon);

        saveMediaBtn.style.display = 'block';
        saveMediaBtn.textContent = "💾 PDF SPEICHERN";
    }
}

async function installApp(e) {
    if (e) e.preventDefault();
    const btn = document.getElementById('navInstallApp');

    // Check for "Open" mode
    if (btn && btn.getAttribute('data-action') === 'open') {
        window.open('/app?mode=app', '_blank');
        return;
    }

    if (!window.deferredPrompt) {
        showToast("Installation momentan nicht möglich. App ist eventuell bereits installiert.", "info");
        // Optional: Offer open anyway
        window.showAppConfirm("Installation nicht verfügbar. App stattdessen öffnen?", () => {
             window.open('/app?mode=app', '_blank');
        }, { confirm: "Öffnen", cancel: "Abbrechen" });
        return;
    }

    window.deferredPrompt.prompt();
    const { outcome } = await window.deferredPrompt.userChoice;
    console.log(`User response to the install prompt: ${outcome}`);
    window.deferredPrompt = null;
    btn.style.display = 'none';
}

async function generateDeviceFingerprint() {
    // Priority: Stable LocalStorage ID (Works for Tor Session & Standard Browsers)
    let id = localStorage.getItem('sm_device_id');
    if (id) return id;

    // Generate robust random ID
    try {
        if (crypto.randomUUID) {
            id = 'dev-' + crypto.randomUUID();
        } else {
            const rnd = new Uint8Array(16);
            crypto.getRandomValues(rnd);
            id = 'dev-' + Array.from(rnd).map(b => b.toString(16).padStart(2, '0')).join('');
        }
    } catch (e) {
        // Fallback
        id = 'dev-fb-' + Date.now() + '-' + Math.random().toString(36).substring(2);
    }

    localStorage.setItem('sm_device_id', id);
    return id;
}

let idleTimer; const IDLE_TIMEOUT = 15 * 60 * 1000;
function setupIdleTimer() { window.onload = resetIdleTimer; window.onmousemove = resetIdleTimer; window.onmousedown = resetIdleTimer; window.ontouchstart = resetIdleTimer; window.onclick = resetIdleTimer; window.onkeypress = resetIdleTimer; window.addEventListener('scroll', resetIdleTimer, true); }
function resetIdleTimer() {
    if (!currentUser) return;
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
        if(currentUser) {
            // "Inaktivitäts-Logout": messageModal with login button
            window.showMessage("Sitzung abgelaufen", "Sie wurden automatisch abgemeldet.", () => {
                // Callback does nothing specific here, user is already logged out below
                // or user clicks Login which is just closing modal usually, but we want to ensure they go to login
                // handleLogout switches to loginSection.
                // The prompt asked for "Login-Button". showMessage has OK button.
                // We'll customize it.
            }, "Anmelden");
            handleLogout();
        }
    }, IDLE_TIMEOUT);
}

async function validateSessionStrict() {
    if (!authToken) { handleLogout(); return false; }
    try {
        // 1. Basic Token Validation
        const res = await fetch(`${API_BASE}/auth/validate`, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ token: authToken }) });
        const data = await res.json();
        if (!data.valid) {
            if (data.reason === 'blocked') { window.showMessage("Konto gesperrt", "Ihr Zugang wurde administrativ gesperrt.", () => handleLogout()); return false; }
            else if (data.reason === 'expired') { showRenewalModal(); return false; }
            else if (data.reason === 'no_license') {
                showRenewalModal();
                return false;
            }
            else { window.showMessage("Sitzung abgelaufen", "Bitte melden Sie sich erneut an.", () => handleLogout(), "Anmelden"); return false; }
        }

        // 2. Strict Device Check
        const devId = await generateDeviceFingerprint();
        const checkRes = await fetch(`${API_BASE}/checkAccess?deviceId=${devId}`, { headers: {'Authorization': `Bearer ${authToken}`} });
        const checkData = await checkRes.json();

        if (checkData.status === 'device_mismatch') {
            localStorage.removeItem('sm_token');
            window.showMessage("Sitzung beendet", "Ihr Account wurde auf ein neues Gerät übertragen. Dieses Gerät ist nicht mehr autorisiert.", () => {
                window.location.href = '/';
            }, "OK");
            return false;
        }

        // Valid Session: Update Expiration in Sidebar (Real-time sync)
        if (data.expiresAt !== undefined) {
            updateSidebarInfo(currentUser.name, data.expiresAt);
        }
        return true;
    } catch (e) {
        console.warn("Session check warning", e);
        // Do not logout on simple network error, allow retry
        return true;
    }
}

function validateActivationInputs() {
    const code1 = document.getElementById('sk_fld_3').value; const code2 = document.getElementById('sk_fld_4').value; const agbChecked = document.getElementById('agbCheck').checked; const btn = document.getElementById('activateBtn'); const warning = document.getElementById('codeMismatchWarning');
    if (code2.length > 0 && code1 !== code2) warning.style.display = 'block'; else warning.style.display = 'none';
    if (agbChecked && (code1 === code2) && (code1.length === 5)) btn.disabled = false; else btn.disabled = true;
}

function updateRenewalModalStatus() {
    const statusDiv = document.getElementById('licenseStatusDisplay');
    if (!statusDiv) return;

    let expiry = localStorage.getItem('sm_exp');
    // Fallback to currentUser if available
    if (!expiry && currentUser && currentUser.expiresAt) {
        expiry = currentUser.expiresAt;
    }

    if (!expiry) {
        statusDiv.style.display = 'none';
        return;
    }

    statusDiv.style.display = 'block';

    // Check for Lifetime (Case Insensitive)
    if (String(expiry).toLowerCase() === 'lifetime' || String(expiry).toLowerCase().includes('unlimited')) {
        statusDiv.textContent = "Status: Lifetime-Zugang (Unbegrenzt gültig)";
        statusDiv.style.color = 'var(--success-green)';
        statusDiv.style.borderLeftColor = 'var(--success-green)';
        statusDiv.style.background = 'rgba(0, 255, 65, 0.1)';
        return;
    }

    // Calculate Days
    const expDate = new Date(String(expiry).replace(' ', 'T'));
    if (isNaN(expDate.getTime())) {
        statusDiv.textContent = "";
        statusDiv.style.display = 'none';
        return;
    }

    const now = new Date();
    const diffTime = expDate - now;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays < 0) {
         statusDiv.textContent = "Ihre Lizenz ist abgelaufen.";
         statusDiv.style.color = 'var(--error-red)';
         statusDiv.style.borderLeftColor = 'var(--error-red)';
         statusDiv.style.background = 'rgba(255, 50, 50, 0.1)';
    } else {
         statusDiv.textContent = `Ihre Lizenz ist noch ${diffDays} Tage gültig.`;
         // Default Info Style (Blue)
         statusDiv.style.color = '#ccc';
         statusDiv.style.borderLeftColor = 'var(--accent-blue)';
         statusDiv.style.background = 'rgba(0, 191, 255, 0.1)';
    }
}

function updateSidebarInfo(user, expiryData) {
    const userLabel = document.getElementById('sidebarUser');
    const licenseLabel = document.getElementById('sidebarLicense');
    const authElements = document.querySelectorAll('.auth-only');
    const guestElements = document.querySelectorAll('.guest-only');

    if (userLabel) userLabel.textContent = user || 'Gast';
    if(user) { checkUnreadMessages(); if(window.msgPollInterval) clearInterval(window.msgPollInterval); window.msgPollInterval = setInterval(checkUnreadMessages, 5 * 60 * 1000); } else { if(window.msgPollInterval) clearInterval(window.msgPollInterval); }

    if (user && licenseLabel) {
        if (expiryData === 'undefined' || expiryData === 'null') expiryData = null;
        if (expiryData === 'lifetime' || String(expiryData).toLowerCase().includes('unlimited')) { licenseLabel.textContent = "LIZENZ: UNLIMITED"; licenseLabel.style.color = "#00ff41"; }
        else if (expiryData) { try { let cleanDateStr = String(expiryData).replace(' ', 'T'); const dateObj = new Date(cleanDateStr); if (!isNaN(dateObj.getTime())) { const day = String(dateObj.getDate()).padStart(2, '0'); const month = String(dateObj.getMonth() + 1).padStart(2, '0'); const year = dateObj.getFullYear(); const dateStr = `${day}.${month}.${year}`; licenseLabel.textContent = "LIZENZ: gültig bis " + dateStr; licenseLabel.style.color = "var(--accent-blue)"; } else { licenseLabel.textContent = "LIZENZ: Aktiv"; licenseLabel.style.color = "var(--text-main)"; } } catch (e) { licenseLabel.textContent = "LIZENZ: Aktiv"; } }
        else { licenseLabel.textContent = "LIZENZ: Unbekannt"; licenseLabel.style.color = "#888"; }
    } else if (licenseLabel) { licenseLabel.textContent = "Nicht verbunden"; licenseLabel.style.color = "#888"; }

    // BADGE RENDERING
    if (user && currentUser && currentUser.badge) {
        // Map badge name to class
        const badgeName = currentUser.badge.split(' ')[0].toLowerCase(); // e.g. "Dev 👾" -> "dev"
        const badgeClass = `user-badge badge-${badgeName}`;
        userLabel.innerHTML = `👤 ${user} <span class="user-badge ${badgeClass}">${currentUser.badge}</span>`;
    } else {
        userLabel.innerHTML = user ? `👤 ${user}` : 'Gast';
    }

    authElements.forEach(el => el.style.display = user ? 'flex' : 'none');
    guestElements.forEach(el => el.style.display = user ? 'none' : 'flex');

    const footerOnion = document.getElementById('footerOnionIcon');
    if(footerOnion) footerOnion.style.display = user ? 'block' : 'none';
}

async function checkExistingSession() {
    const token = localStorage.getItem('sm_token'); const userStored = localStorage.getItem('sm_user'); let savedExpiry = localStorage.getItem('sm_exp');
    let userName = ''; try { const parsed = JSON.parse(userStored); userName = parsed.name || parsed; } catch(e) { userName = userStored; }

    if (token) {
        try {
            const res = await fetch(`${API_BASE}/auth/validate`, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ token }) });
            const data = await res.json();
            if (data.valid) {
                authToken = token; const decoded = parseJwt(token); currentUser = { name: data.username || userName, sm_id: decoded.id, badge: data.badge };
                localStorage.setItem('sm_user', JSON.stringify(currentUser));

                // ISOLATED LOAD
                loadUserContacts();
                initEnterpriseKeys();

                let finalExpiry = data.expiresAt; if (!finalExpiry) finalExpiry = savedExpiry || 'lifetime'; else localStorage.setItem('sm_exp', finalExpiry);
                if(finalExpiry && finalExpiry !== 'lifetime') { const expDate = new Date(String(finalExpiry).replace(' ', 'T')); if(expDate < new Date()) { updateSidebarInfo(currentUser.name, finalExpiry); showRenewalScreen(); return; } }
                updateSidebarInfo(currentUser.name, finalExpiry); showSection('mainSection'); return;
            } else {
                if (data.reason === 'no_license') {
                    authToken = token; const decoded = parseJwt(token); currentUser = { name: userName, sm_id: decoded.id };
                    showRenewalScreen();
                    window.showMessage("Lizenz fehlt", "Keine aktive Lizenz gefunden. Bitte verknüpfen Sie einen neuen Key.");
                }
                else handleLogout();
            }
        } catch(e) { showSection('loginSection'); }
    } else { showSection('loginSection'); }
}

function showRenewalScreen() { showSection('renewalSection'); const wrapper = document.getElementById('headerSwitchWrapper'); if(wrapper) wrapper.style.display = 'none'; }

function showRenewalModal() {
    // Custom Modal for Renewal
    // "Modal, das direkt einen Button 'Jetzt im Shop verlängern' enthält."
    const msg = "Ihre Lizenz ist abgelaufen oder nicht vorhanden. Bitte verlängern Sie Ihren Zugang.";
    window.showMessage("Lizenz Erforderlich", msg, () => {
        window.location.href = "/shop";
    }, "Jetzt im Shop verlängern");

    // Also redirect to renewal section behind modal?
    showRenewalScreen();
}

function openSupportModal() {
    const modal = document.getElementById('supportModal'); const userField = document.getElementById('supportUsername'); document.getElementById('supportForm').reset();
    if (currentUser) { userField.value = currentUser.name; userField.readOnly = true; userField.style.opacity = '0.7'; }
    else { userField.value = ''; userField.readOnly = false; userField.style.opacity = '1'; userField.placeholder = "Benutzername oder ID (falls bekannt)"; }
    modal.classList.add('active');
}

async function handleSupportSubmit(e) {
    e.preventDefault(); const form = e.target; const btn = form.querySelector('button[type="submit"]'); const allFields = form.querySelectorAll('input, textarea, button'); const oldText = btn.textContent;
    const usernameVal = document.getElementById('supportUsername').value.trim(); const emailVal = document.getElementById('supportEmail').value.trim(); const messageVal = document.getElementById('supportMessage').value.trim(); const subjectVal = document.getElementById('supportSubject').value.trim();

    if (!messageVal || !subjectVal) { showToast("Bitte Betreff und Nachricht eingeben.", 'error'); return; }
    if (!usernameVal && !emailVal) { showToast("Bitte geben Sie eine E-Mail-Adresse oder Ihre Benutzer-ID für eine Rückantwort an.", 'error'); return; }

    btn.textContent = "Wird gesendet..."; allFields.forEach(f => f.disabled = true);
    const payload = { username: usernameVal, subject: subjectVal, email: emailVal, message: messageVal };

    try {
        const controller = new AbortController(); const timeoutId = setTimeout(() => controller.abort(), 25000);
        const res = await fetch('/api/support', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: controller.signal }); clearTimeout(timeoutId);
        const data = await res.json();
        if (data.success) {
            showAppStatus(`Danke! Ihre Nachricht wurde gesendet. Ticket: ${data.ticketId}`, 'success');
            setTimeout(() => { document.getElementById('supportModal').classList.remove('active'); e.target.reset(); allFields.forEach(f => f.disabled = false); btn.textContent = "Nachricht Senden"; }, 3000);
        } else { window.showMessage("Fehler", "Der Mail-Server ist aktuell nicht erreichbar. Bitte senden Sie Ihre Anfrage direkt an support@secure-msg.app."); allFields.forEach(f => f.disabled = false); btn.textContent = oldText; }
    } catch (err) {
        window.showMessage("Fehler", "Der Mail-Server ist aktuell nicht erreichbar. Bitte senden Sie Ihre Anfrage direkt an support@secure-msg.app.");
        allFields.forEach(f => f.disabled = false); btn.textContent = oldText;
    }
}

window.clearAttachment = function() {
    document.getElementById('fileInput').value = '';
    currentAttachmentBase64 = null;
    document.getElementById('fileInfo').style.display = 'none';
    document.getElementById('fileSpinner').style.display = 'none';
    document.getElementById('fileCheck').style.display = 'none';
    const textArea = document.getElementById('messageInput');
    textArea.disabled = false;

    // Retrigger state check
    updateWizardState();
};

window.startRenewal = async function(planType) {
    if(!authToken) return showAppStatus("Bitte erst einloggen", 'error');
    const btn = event.currentTarget; btn.style.opacity = '0.5'; btn.style.pointerEvents = 'none';
    try {
        const res = await fetch('/api/create-checkout-session', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` }, body: JSON.stringify({ product_type: planType, is_renewal: true }) });
        const data = await res.json();
        if (data.success && data.checkout_url) window.location.href = data.checkout_url; else { showAppStatus(data.error || "Fehler beim Checkout", 'error'); btn.style.opacity = '1'; btn.style.pointerEvents = 'auto'; }
    } catch(e) { showAppStatus("Verbindungsfehler", 'error'); btn.style.opacity = '1'; btn.style.pointerEvents = 'auto'; }
};

function showAppStatus(msg, type='success') {
    const d=document.createElement('div'); d.className=`app-status-msg ${type}`; d.textContent=msg;
    document.getElementById('globalStatusContainer').appendChild(d);
    requestAnimationFrame(()=>d.classList.add('active')); setTimeout(()=>{d.classList.remove('active');setTimeout(()=>d.remove(),500)},4000);
}
function clearAllFields() {
    document.getElementById('messageInput').value=''; document.getElementById('messageOutput').value=''; document.getElementById('sk_fld_2').value=''; document.getElementById('recipientName').value=''; document.getElementById('outputGroup').style.display='none'; document.getElementById('importFeedback').style.display = 'none'; document.getElementById('importFeedback').textContent = ''; document.getElementById('txtFileInput').value = '';
    if (window.clearAttachment) window.clearAttachment();
    if (currentMode === 'encrypt') { document.getElementById('qrGenBtn').style.display = 'block'; document.getElementById('saveTxtBtn').style.display = 'none'; }
}
function copyToClipboard() { const el=document.getElementById('messageOutput'); el.select(); navigator.clipboard.writeText(el.value); showAppStatus("Kopiert!", 'success'); }

function downloadTxtFile(content) {
    const hashPart = content.substring(0, 5); const filename = `SECURE_MSG_${hashPart}.txt`;
    const element = document.createElement('a'); element.setAttribute('href', 'data:text/plain;charset=utf-8,' + encodeURIComponent(content)); element.setAttribute('download', filename); element.style.display = 'none'; document.body.appendChild(element); element.click(); document.body.removeChild(element);
}

function handleTxtImport(e) {
    const file = e.target.files[0]; if (!file) return;
    if (file.type !== "text/plain" && !file.name.endsWith('.txt')) { showToast("Bitte nur .txt Dateien verwenden.", 'error'); return; }
    const reader = new FileReader();
    reader.onload = function(evt) {
        const content = evt.target.result;
        const input = document.getElementById('messageInput');
        input.value = content;

        const fb = document.getElementById('importFeedback');
        fb.textContent = `Importiert: ${file.name}`;
        fb.style.display = 'block';

        // Trigger Wizard State Update
        updateWizardState();
    };
    reader.readAsText(file);
}

let qrAnimInterval = null;

function showQRModal(text) {
    document.getElementById('qrModal').classList.add('active');
    startQRAnimation(text);
}

function startQRAnimation(data) {
    stopQRAnimation();
    const container = document.getElementById('qrDisplay');
    const statusDiv = document.getElementById('qrAnimStatus');
    container.innerHTML = "";
    if(statusDiv) statusDiv.style.display = 'none';

    // Threshold increased to 250 as per user request (Balanced complexity)
    const THRESHOLD = 250;
    const saveBtn = document.getElementById('saveQrBtn');

    if (data.length <= THRESHOLD) {
        if(saveBtn) saveBtn.style.display = 'block'; // Ensure visible for single QR
        try { new QRCode(container, { text: data, width: 190, height: 190, colorDark: "#000", colorLight: "#fff", correctLevel: QRCode.CorrectLevel.L }); } catch (e) { container.textContent = "QR Lib Error"; }
    } else {
        if(saveBtn) saveBtn.style.display = 'none'; // Hide Save Button for Animation
        if(statusDiv) statusDiv.style.display = 'block';

        const chunkSize = THRESHOLD;
        const chunks = [];
        for (let i = 0; i < data.length; i += chunkSize) {
            chunks.push(data.substring(i, i + chunkSize));
        }

        const total = chunks.length;
        let currentIdx = 0;

        const renderFrame = () => {
            container.innerHTML = "";
            const index = currentIdx + 1;
            const chunkData = chunks[currentIdx];
            const payload = `${index}/${total}|${chunkData}`;

            try {
                new QRCode(container, { text: payload, width: 190, height: 190, colorDark: "#000", colorLight: "#fff", correctLevel: QRCode.CorrectLevel.L });
                if(statusDiv) statusDiv.textContent = `Teil ${index} von ${total} wird gesendet...`;
            } catch (e) {
                console.error(e);
            }

            currentIdx = (currentIdx + 1) % total;
        };

        renderFrame();
        qrAnimInterval = setInterval(renderFrame, 600); // 600ms Interval
    }
}

function stopQRAnimation() {
    if (qrAnimInterval) {
        clearInterval(qrAnimInterval);
        qrAnimInterval = null;
    }
    const statusDiv = document.getElementById('qrAnimStatus');
    if(statusDiv) statusDiv.style.display = 'none';
}

function downloadQR() { const img=document.querySelector('#qrDisplay img'); if(img){ const a=document.createElement('a'); a.href=img.src; a.download=`qr-${Date.now()}.png`; a.click(); } }
let qrScan=null;

function startMessageScanner() {
    currentScannerMode = 'message';
    startScannerInternal();
}

function startTransferScanner() {
    currentScannerMode = 'transfer';
    startScannerInternal();
}

function startScannerInternal() {
    if(location.protocol!=='https:' && location.hostname!=='localhost') return window.showMessage("Fehler", "Kamera benötigt HTTPS.");

    // Reset Receiver State
    let receivedChunks = {};
    let expectedTotal = 0;
    const progressDiv = document.getElementById('scannerProgress');
    if(progressDiv) {
        progressDiv.textContent = "";
        progressDiv.style.display = 'none';
    }

    // UI Setup for Transfer vs Normal
    const manualBtn = document.getElementById('btnOpenManualTransfer');
    if (manualBtn) manualBtn.style.display = (currentScannerMode === 'transfer') ? 'block' : 'none';

    document.getElementById('qrScannerModal').classList.add('active');

    if(!qrScan) qrScan = new Html5Qrcode("qr-reader");

    qrScan.start({facingMode:"environment"}, {fps:10, qrbox:250}, (decodedText) => {
        console.log("Scanner Rohdaten:", decodedText); // Debugging

        if (currentScannerMode === 'transfer') {
            // Logik für Profil-Transfer
            // Simple validation before closing scanner
            if (!decodedText || !decodedText.includes(':')) {
                showToast("Ungültiger Transfer-Code", "error");
                return; // Scanner offen lassen
            }
            stopQRScanner(); // Beendet Kamera & schließt Modal
            handleTransferScanSuccess(decodedText);
        } else {
            // Logik für Nachrichten
            const inputField = document.getElementById('messageInput');
            if (inputField) {
                let cleanedText = decodedText.trim();

                // Animated QR Detection (index/total|data)
                const animMatch = cleanedText.match(/^(\d+)\/(\d+)\|(.*)$/);

                if (animMatch) {
                    const idx = parseInt(animMatch[1]);
                    const tot = parseInt(animMatch[2]);
                    const chunk = animMatch[3];

                    if (expectedTotal !== 0 && expectedTotal !== tot) {
                        receivedChunks = {}; // Reset on mismatch
                        expectedTotal = tot;
                    }
                    expectedTotal = tot;

                    if (!receivedChunks[idx]) {
                        receivedChunks[idx] = chunk;
                        if(navigator.vibrate) navigator.vibrate(50);

                        const count = Object.keys(receivedChunks).length;
                        if(progressDiv) {
                            progressDiv.style.display = 'block';
                            progressDiv.textContent = `Empfangen: ${count} / ${tot}`;
                        }

                        if (count === tot) {
                            const fullData = [];
                            for(let i=1; i<=tot; i++) fullData.push(receivedChunks[i]);

                            inputField.value = fullData.join('');
                            inputField.dispatchEvent(new Event('input', { bubbles: true }));
                            showToast("Nachricht vollständig empfangen!", "success");
                            if(navigator.vibrate) navigator.vibrate([100, 50, 100]);
                            stopQRScanner();
                        }
                    }
                    return; // Keep scanning
                }

                // Normal QR Logic
                if (cleanedText.startsWith('SECURE-MSG:')) {
                    cleanedText = cleanedText.replace('SECURE-MSG:', '').trim();
                }

                const isSystemMessage = /^[A-Za-z0-9+/=]+$/.test(cleanedText) || cleanedText.startsWith('{') || cleanedText.startsWith('[');

                const processInsert = () => {
                    inputField.value = cleanedText;
                    inputField.dispatchEvent(new Event('input', { bubbles: true }));
                    showToast("Nachricht eingelesen", "success");
                    stopQRScanner();
                };

                if (isSystemMessage || cleanedText.length > 5) {
                    processInsert();
                } else {
                    stopQRScanner(); // Prevent spam
                    window.showAppConfirm("Unbekanntes Format erkannt. Text trotzdem einfügen?", () => {
                         processInsert();
                    }, { confirm: "Einfügen", cancel: "Abbrechen" });
                }
            }
        }
    }, undefined).catch(err => {
        console.error(err);
        document.getElementById('qr-reader').innerHTML = `<div style="color:red;padding:20px;">Kamera-Fehler: ${err}</div>`;
    });
}

async function stopQRScanner() {
    document.getElementById('qrScannerModal').classList.remove('active');
    if (qrScan) {
        try {
            if(qrScan.isScanning) {
                await qrScan.stop();
            }
            qrScan.clear();
        } catch (err) {
            console.warn("Kamera Stop Fehler:", err);
        }
        qrScan = null;
    }
}

// ========================================================
// PROFILE TRANSFER LOGIC
// ========================================================

let transferPayloadCache = null;
let transferUidCache = null;

async function handleTransferExportStart() {
    const code = document.getElementById('sk_fld_10').value;
    if (code.length !== 5) return showToast("Code muss 5-stellig sein", 'error');

    const btn = document.getElementById('btnConfirmTransferStart');
    const oldTxt = btn.textContent; btn.textContent = "..."; btn.disabled = true;

    try {
        // 1. Verify Session & Get Encrypted PIK
        const res = await fetch(`${API_BASE}/auth/export-profile`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        const data = await res.json();

        if (!data.success) {
            throw new Error(data.error || "Export fehlgeschlagen");
        }

        const { pik_encrypted, uid } = data;

        // 2. Decrypt PIK locally using User's Code
        // Note: encryptServerSide uses PBKDF2+AES-GCM. We need decryptFull-like logic.
        // But pik_encrypted is from server side crypto util.
        // Client decryptFull expects Layer 1 JSON wrapper. Server PIK is raw encrypted string (Salt+IV+Cipher+Tag).
        // We need a raw decrypt function.
        // ACTUALLY: We don't have a raw decrypt exposed in cryptoLayers.js easily without modifying it further?
        // Wait, `decryptBackup` handles raw AES-GCM decryption! It expects Base64 (Salt+IV+Cipher).
        // `encryptServerSide` returns Base64 (Salt+IV+Cipher+Tag). This matches `decryptBackup` format.

        let pikDecrypted;
        try {
            // We reuse decryptBackup because the crypto structure is identical (PBKDF2 -> AES-GCM)
            // It imports 'decryptBackup' from module.
            // Wait, I need to import it at the top! Added it to import list? No, I missed it.
            // I will dynamically import or assume it's available if I update the import line.
            // Let's assume I updated the import line in step 1 of the patch.
            // Wait, I did NOT update the import line to include `decryptBackup`.
            // I should have. But `decryptFull` does logic.
            // Let's use `decryptBackup` which I see in `cryptoLayers.js` is exported.
            const { decryptBackup } = await import('./cryptoLayers.js');
            pikDecrypted = await decryptBackup(pik_encrypted, code);
        } catch (e) {
            throw new Error("Falscher Zugangscode.");
        }

        // 3. Re-Encrypt for Transfer (Layer 4 System)
        // Wraps {uid, pik} into secure container
        const transferPackage = await exportProfilePackage(uid, pikDecrypted, code);

        // 4. Generate QR (UID:PACKAGE)
        const qrContent = `${uid}:${transferPackage}`;

        // 5. Signal Server to Start & Get Manual Code
        // (Previously we called this in scan success, but now we call it here to get the manual code)
        // Wait, the logic for QR scan was: Scan -> Call 'transfer-start' with UID.
        // Now we need the code *before* the other device scans, or at least concurrently.
        // Actually, the previous logic was: Scan QR -> New Device Calls 'transfer-start'.
        // But the Prompt says: "/api/auth/transfer-start: Generate... code... Return this code to the old device."
        // So we must call it HERE on the Old Device.

        const startRes = await fetch(`${API_BASE}/auth/transfer-start`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
            body: JSON.stringify({ uid })
        });
        const startData = await startRes.json();

        if (!startData.success) throw new Error("Transfer-Start fehlgeschlagen");
        const manualCode = startData.transferCode; // e.g. "ABC123"

        document.getElementById('transferSecurityModal').classList.remove('active');
        document.getElementById('transferExportModal').classList.add('active');

        // Display QR
        const qrContainer = document.getElementById('transferQrDisplay');
        qrContainer.innerHTML = '';
        new QRCode(qrContainer, { text: qrContent, width: 220, height: 220, correctLevel: QRCode.CorrectLevel.L });

        // Display Manual Code
        const codeDisplay = document.getElementById('transferManualCodeDisplay');
        if (codeDisplay) codeDisplay.textContent = manualCode;

        // Update Cancel Button to Reload
        const cancelBtn = document.getElementById('btnCancelTransferExport');
        if (cancelBtn) {
            cancelBtn.textContent = "Schließen (Logout)";
            cancelBtn.onclick = () => window.location.reload();
        }

        // 6. Start Countdown (2 Min)
        let timeLeft = 120;
        const timerEl = document.getElementById('transferTimer');
        const interval = setInterval(() => {
            timeLeft--;
            const m = Math.floor(timeLeft / 60);
            const s = timeLeft % 60;
            timerEl.textContent = `${m}:${s.toString().padStart(2, '0')}`;
            if (timeLeft <= 0 || !document.getElementById('transferExportModal').classList.contains('active')) {
                clearInterval(interval);
                document.getElementById('transferExportModal').classList.remove('active');
                if(timeLeft <= 0) showToast("Zeit abgelaufen.", 'error');
                window.location.reload(); // Auto reload on timeout too? Safer.
            }
        }, 1000);

    } catch (e) {
        showToast(e.message, 'error');
    } finally {
        btn.textContent = oldTxt; btn.disabled = false;
    }
}

async function handleTransferScanSuccess(decodedText) {
    // Expected: UID:PACKAGE
    const parts = decodedText.split(':');
    if (parts.length < 2) return showToast("Ungültiger QR-Code", 'error');

    const uid = parts[0];
    const packageData = parts.slice(1).join(':'); // Rejoin rest in case base64 has colons? Base64 shouldn't.

    transferPayloadCache = packageData;
    transferUidCache = uid;

    showLoader("Verbinde mit Server...");

    try {
        // Legacy Support: We just assume the Old Device already called 'transfer-start'
        // when it generated the QR code. We don't need to call it again here.
        // We just verify we can proceed.
        // Actually, 'transfer-start' resets the timer. If we call it again, we might reset the code?
        // The Old Device called it to get the Manual Code.
        // If we scan the QR, we have the payload.
        // We just need to decrypt it.

        // 2. Open Decrypt Modal
        hideLoader();
        document.getElementById('transferImportModal').classList.add('active');
        document.getElementById('sk_fld_11').value = '';
        document.getElementById('sk_fld_11').focus();

    } catch (e) {
        hideLoader();
        showToast(e.message, 'error');
    }
}

async function handleTransferImportDecrypt() {
    const code = document.getElementById('sk_fld_11').value;
    if (code.length !== 5) return showToast("5-stelliger Code benötigt", 'error');

    const btn = document.getElementById('btnConfirmTransferImport');
    btn.textContent = "Analysiere..."; btn.disabled = true;

    try {
        if (!transferPayloadCache || !transferUidCache) throw new Error("Keine Daten. Bitte neu scannen.");

        // 1. Decrypt Package
        const decryptedData = await importProfilePackage(transferPayloadCache, code);
        // Returns { uid, pik }

        if (decryptedData.uid !== transferUidCache) {
            throw new Error("UID Mismatch! Sicherheitssperre.");
        }

        const pik = decryptedData.pik;

        // 2. Generate Proof
        const timestamp = new Date().toISOString();
        const proof = await generateTransferProof(pik, timestamp);

        // 3. Generate Device ID
        const deviceId = await generateDeviceFingerprint();

        // 4. Send Completion to Server
        const res = await fetch(`${API_BASE}/auth/transfer-complete`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                uid: transferUidCache,
                proof: proof,
                timestamp: timestamp,
                deviceId: deviceId
            })
        });

        const data = await res.json();

        if (data.success) {
            // SUCCESS!
            document.getElementById('transferImportModal').classList.remove('active');

            // Auto Login
            authToken = data.token;
            currentUser = { name: data.username, sm_id: parseJwt(authToken).id, badge: data.badge };
            localStorage.setItem('sm_token', authToken);
            localStorage.setItem('sm_user', JSON.stringify(currentUser));

            // Clean local caches
            contacts = [];
            setEnterpriseKeys([]);
            loadUserContacts(); // Will be empty initially unless we sync?
            // Note: Contacts are local-only. Transfer does not migrate LocalStorage contacts (yet).

            updateSidebarInfo(currentUser.name, data.expiresAt);
            showSection('mainSection');

            showAppStatus(`Willkommen auf dem neuen Gerät, ${currentUser.name}!`, 'success');
            setTimeout(() => window.showMessage("Info", "Ihre Identität wurde erfolgreich übertragen. Da Kontakte nur lokal gespeichert werden, müssen Sie diese ggf. neu importieren."), 1000);

        } else {
            throw new Error(data.error || "Transfer fehlgeschlagen");
        }

    } catch (e) {
        showToast(e.message, 'error');
        if (e.message.includes("Falscher Code")) {
            // Don't close modal, let user retry
        } else {
            document.getElementById('transferImportModal').classList.remove('active');
        }
    } finally {
        btn.textContent = "Installieren"; btn.disabled = false;
    }
}

// --- MANUAL TRANSFER LOGIC ---
let pendingPikEncrypted = null;
let pendingTransferUser = null;

async function submitManualTransfer() {
    const uid = document.getElementById('manualTransferUser').value.trim();
    const code = document.getElementById('manualTransferCode').value.trim();

    if(!uid || !code) return showToast("Bitte beide Felder ausfüllen.", 'error');

    const btn = document.getElementById('btnSubmitManualTransfer');
    const oldTxt = btn.textContent; btn.textContent = "Verbinde..."; btn.disabled = true;

    try {
        const deviceId = await generateDeviceFingerprint();
        const res = await fetch(`${API_BASE}/auth/transfer-complete`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                uid: uid,
                transferCode: code,
                deviceId: deviceId
            })
        });

        const data = await res.json();
        if(!data.success) throw new Error(data.error || "Verbindung fehlgeschlagen");

        // Success: Store Token temporarily, ask for PIK Decryption
        authToken = data.token; // Temp store
        pendingPikEncrypted = data.pik_encrypted;
        pendingTransferUser = { name: data.username, sm_id: parseJwt(authToken).id, expiresAt: data.expiresAt };

        document.getElementById('manualTransferModal').classList.remove('active');
        document.getElementById('unlockProfileModal').classList.add('active');

    } catch(e) {
        showToast(e.message, 'error');
    } finally {
        btn.textContent = oldTxt; btn.disabled = false;
    }
}

async function handleUnlockProfile() {
    const code = document.getElementById('sk_fld_12').value;
    if(code.length !== 5) return showToast("Code muss 5-stellig sein", 'error');

    const btn = document.getElementById('btnUnlockProfile');
    btn.textContent = "Entschlüssle..."; btn.disabled = true;

    try {
        if(!pendingPikEncrypted) throw new Error("Keine Daten vorhanden.");

        // Decrypt the PIK using the user's 5-digit code
        // If this succeeds, the code is correct and we "own" the profile.
        await decryptBackup(pendingPikEncrypted, code);

        // If we are here, it worked.
        // Finalize Login
        currentUser = pendingTransferUser;
        localStorage.setItem('sm_token', authToken);
        localStorage.setItem('sm_user', JSON.stringify(currentUser));

        contacts = [];
        setEnterpriseKeys([]);
        loadUserContacts();
        updateSidebarInfo(currentUser.name, currentUser.expiresAt);

        document.getElementById('unlockProfileModal').classList.remove('active');
        showSection('mainSection');

        showAppStatus(`Willkommen zurück, ${currentUser.name}!`, 'success');

    } catch(e) {
        showToast("Falscher Code. Entschlüsselung fehlgeschlagen.", 'error');
    } finally {
        btn.textContent = "Profil entsperren"; btn.disabled = false;
    }
}

function parseJwt (token) {
    try { var base64Url = token.split('.')[1]; var base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/'); var jsonPayload = decodeURIComponent(window.atob(base64).split('').map(function(c) { return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2); }).join('')); return JSON.parse(jsonPayload); } catch (e) { return {}; }
}

function loadUserContacts() {
    if (!currentUser || !currentUser.sm_id) { contacts = []; return; }
    const key = `sm_contacts_${currentUser.sm_id}`; const globalKey = 'sm_contacts';
    let stored = localStorage.getItem(key);
    if (!stored && localStorage.getItem(globalKey)) { stored = localStorage.getItem(globalKey); localStorage.setItem(key, stored); localStorage.removeItem(globalKey); }
    contacts = stored ? JSON.parse(stored) : [];
}
function saveUserContacts() { if (!currentUser || !currentUser.sm_id) return; localStorage.setItem(`sm_contacts_${currentUser.sm_id}`, JSON.stringify(contacts)); }

function getReadBroadcasts() { if (!currentUser || !currentUser.sm_id) return []; const key = `sm_read_broadcasts_${currentUser.sm_id}`; const stored = localStorage.getItem(key); return stored ? JSON.parse(stored) : []; }
function markBroadcastRead(id) { if (!currentUser || !currentUser.sm_id) return; const key = `sm_read_broadcasts_${currentUser.sm_id}`; const list = getReadBroadcasts(); if (!list.includes(id)) { list.push(id); localStorage.setItem(key, JSON.stringify(list)); } }

function updatePostboxUI(unreadCount) {
    const navLink = document.getElementById('navPost'); if (!navLink) return;
    if (unreadCount > 0) { navLink.innerHTML = `📬 Postfach <span style="color:var(--accent-blue); font-weight:bold;">(${unreadCount})</span>`; navLink.style.color = "var(--accent-blue)"; navLink.style.borderLeft = "3px solid var(--accent-blue)"; navLink.style.paddingLeft = "22px"; }
    else { navLink.innerHTML = `📪 Postfach`; navLink.style.color = "var(--text-main)"; navLink.style.borderLeft = "none"; navLink.style.paddingLeft = "15px"; }
}

async function checkUnreadMessages() {
    if(!currentUser || !authToken) return;
    try {
        const res = await fetch(`${API_BASE}/messages`, { headers: { 'Authorization': `Bearer ${authToken}` } });
        const msgs = await res.json();
        const unreadPersonal = msgs.filter(m => m.recipient_id == currentUser.sm_id && !m.is_read).length;
        const readBroadcasts = getReadBroadcasts();
        const unreadBroadcasts = msgs.filter(m => m.recipient_id === null && !readBroadcasts.includes(m.id)).length;
        updatePostboxUI(unreadPersonal + unreadBroadcasts);
    } catch(e) { console.error("Msg Check Failed", e); }
}

// --- ENTERPRISE KEY MANAGEMENT (USER SCOPED) ---
function initEnterpriseKeys() {
    if (!currentUser || !currentUser.sm_id) return;
    const storageKey = `sm_ent_keys_${currentUser.sm_id}`;
    const stored = localStorage.getItem(storageKey);
    const keys = stored ? JSON.parse(stored) : [];

    setEnterpriseKeys(keys);

    const list = document.getElementById('entKeyList');
    if(list) {
        list.innerHTML = '';
        keys.forEach(k => {
            const d = document.createElement('div');
            d.style.cssText = "background:#111; padding:10px; border:1px solid #333; margin-bottom:5px; display:flex; justify-content:space-between; align-items:center; font-family:'Roboto Mono'; font-size:0.8rem;";
            d.innerHTML = `<span>${k}</span><button onclick="removeEntKey('${k}')" style="background:none;border:none;color:red;cursor:pointer;">✖</button>`;
            list.appendChild(d);
        });
    }
}

window.removeEntKey = function(key) {
    if (!currentUser || !currentUser.sm_id) return;
    const storageKey = `sm_ent_keys_${currentUser.sm_id}`;
    const stored = localStorage.getItem(storageKey);
    let keys = stored ? JSON.parse(stored) : [];
    keys = keys.filter(k => k !== key);
    localStorage.setItem(storageKey, JSON.stringify(keys));
    setEnterpriseKeys(keys);
    initEnterpriseKeys();
};

let currentInboxTab = 'system';
let pendingDecryptMsg = null; // { id, body, element, isUnread }
let composeAttachment = null; // { name, type, data }

function switchInboxTab(tab) {
    currentInboxTab = tab;
    const btnSystem = document.getElementById('tabInboxSystem');
    const btnPrivate = document.getElementById('tabInboxPrivate');
    const contentSystem = document.getElementById('inboxContentSystem');
    const contentPrivate = document.getElementById('inboxContentPrivate');

    if(tab === 'system') {
        btnSystem.style.borderBottomColor = 'var(--accent-blue)';
        btnSystem.style.background = 'rgba(0,191,255,0.1)';
        btnSystem.style.color = 'white';

        btnPrivate.style.borderBottomColor = 'transparent';
        btnPrivate.style.background = 'transparent';
        btnPrivate.style.color = '#888';

        contentSystem.style.display = 'block';
        contentPrivate.style.display = 'none';
    } else {
        btnPrivate.style.borderBottomColor = 'var(--accent-blue)';
        btnPrivate.style.background = 'rgba(0,191,255,0.1)';
        btnPrivate.style.color = 'white';

        btnSystem.style.borderBottomColor = 'transparent';
        btnSystem.style.background = 'transparent';
        btnSystem.style.color = '#888';

        contentPrivate.style.display = 'block';
        contentSystem.style.display = 'none';
    }
}

async function loadAndShowInbox() {
    document.getElementById('inboxSidebar').classList.add('active');
    document.getElementById('sidebarOverlay').classList.add('active');
    switchInboxTab(currentInboxTab); // Restore active tab

    const listSystem = document.getElementById('inboxListSystem');
    const listPrivate = document.getElementById('inboxListPrivate');
    const emptySystem = document.getElementById('inboxEmptySystem');
    const emptyPrivate = document.getElementById('inboxEmptyPrivate');

    listSystem.innerHTML = '<div style="text-align:center; padding:10px;">Lade...</div>';
    listPrivate.innerHTML = '<div style="text-align:center; padding:10px;">Lade...</div>';

    try {
        const res = await fetch(`${API_BASE}/messages`, { headers: { 'Authorization': `Bearer ${authToken}` } });
        const msgs = await res.json();

        const readBroadcasts = getReadBroadcasts();
        const unreadPersonal = msgs.filter(m => m.recipient_id == currentUser.sm_id && !m.is_read).length;
        const unreadBroadcasts = msgs.filter(m => m.recipient_id === null && !readBroadcasts.includes(m.id)).length;
        updatePostboxUI(unreadPersonal + unreadBroadcasts);

        listSystem.innerHTML = '';
        listPrivate.innerHTML = '';

        const systemMsgs = msgs.filter(m => m.type !== 'user_msg');
        const privateMsgs = msgs.filter(m => m.type === 'user_msg');

        if(systemMsgs.length === 0) emptySystem.style.display = 'block'; else emptySystem.style.display = 'none';
        if(privateMsgs.length === 0) emptyPrivate.style.display = 'block'; else emptyPrivate.style.display = 'none';

        // Render System Messages
        systemMsgs.forEach(m => {
            const el = createMessageCard(m, readBroadcasts, false);
            listSystem.appendChild(el);
        });

        // Render Private Messages
        privateMsgs.forEach(m => {
            const el = createMessageCard(m, readBroadcasts, true);
            listPrivate.appendChild(el);
        });

    } catch(e) {
        console.error(e);
        listSystem.innerHTML = '<div style="color:red; text-align:center;">Laden fehlgeschlagen.</div>';
        listPrivate.innerHTML = '<div style="color:red; text-align:center;">Laden fehlgeschlagen.</div>';
    }
}

function createMessageCard(m, readBroadcasts, isPrivateTab) {
    const el = document.createElement('div');
    const isPersonal = !!m.recipient_id;
    const isBroadcast = !isPersonal;
    const isUnread = (isPersonal && !m.is_read) || (isBroadcast && !readBroadcasts.includes(m.id));
    const isTicket = (m.type === 'ticket' || m.type === 'ticket_reply');

    let classes = 'msg-card';
    if(isUnread) classes += ' unread'; else classes += ' read-message';
    if(m.type === 'automated') classes += ' type-automated';
    if(m.type === 'support') classes += ' type-support';
    if(isTicket) classes += ' type-ticket';
    if(isPrivateTab) classes += ' type-private';

    let icon = '📩';
    if(m.type === 'automated') icon = '⚠️';
    else if(m.type === 'support') icon = '💬';
    else if(isTicket) icon = '🎫';
    else if(!isPersonal) icon = '📢';
    else if(isPrivateTab) icon = '🔒';

    let badgeHtml = '';
    if (m.type === 'ticket' && m.status) {
        let statusClass = 'msg-status-open';
        let statusText = 'OFFEN';
        if (m.status === 'in_progress') { statusClass = 'msg-status-progress'; statusText = 'IN BEARBEITUNG'; }
        if (m.status === 'closed') { statusClass = 'msg-status-closed'; statusText = 'ABGESCHLOSSEN'; }
        badgeHtml = `<span class="msg-status-badge ${statusClass}">${statusText}</span>`;
    }

    let senderInfo = isPrivateTab ? `Von: ${escapeHtml(m.sender_username) || 'Unbekannt'}` : (isPersonal ? 'Persönlich' : 'Allgemein');

    el.className = classes;
    el.innerHTML = `<div class="msg-header"><span>${new Date(m.created_at).toLocaleString('de-DE')}</span><span>${senderInfo}</span></div>`;
    const divSubject = document.createElement('div');
    divSubject.className = 'msg-subject';
    divSubject.innerHTML = `${icon} ${escapeHtml(m.subject)} ${badgeHtml}`;

    const divBody = document.createElement('div');
    divBody.className = 'msg-body';
    divBody.textContent = m.body;

    el.appendChild(divSubject);
    el.appendChild(divBody);

    // Actions Container
    const actionsDiv = document.createElement('div');
    actionsDiv.style.display = 'flex';
    actionsDiv.style.gap = '10px';
    actionsDiv.style.marginTop = '10px';

    if (isPrivateTab && m.sender_username) {
        const btnReply = document.createElement('button');
        btnReply.textContent = '↩ Antworten';
        btnReply.className = 'btn btn-primary';
        btnReply.style.fontSize = '0.7rem';
        btnReply.style.padding = '4px 8px';
        btnReply.onclick = (e) => { e.stopPropagation(); openComposeModal(m.sender_username, "RE: " + m.subject); };
        actionsDiv.appendChild(btnReply);
    }

    if (isPersonal) {
        const btnDel = document.createElement('button');
        btnDel.textContent = '🗑 Löschen';
        btnDel.className = 'btn-outline';
        btnDel.style.fontSize = '0.7rem';
        btnDel.style.padding = '4px 8px';

        if (m.type === 'ticket' && m.status !== 'closed') {
            btnDel.classList.add('delete-btn-locked');
            btnDel.title = "Ticket ist noch offen.";
            btnDel.style.display = 'none';
            btnDel.disabled = true;
            btnDel.onclick = (e) => { e.stopPropagation(); };
        } else {
            btnDel.onclick = (e) => { e.stopPropagation(); deleteMessage(m.id, el); };
        }
        actionsDiv.appendChild(btnDel);
    }

    if(actionsDiv.childNodes.length > 0) el.appendChild(actionsDiv);

    el.addEventListener('click', () => {
        const wasExpanded = el.classList.contains('expanded');
        document.querySelectorAll('.msg-card.expanded').forEach(c => c.classList.remove('expanded'));

        if(!wasExpanded) {
            // Private Message Decryption Check
            if (m.type === 'user_msg' && !el.dataset.decrypted) {
                pendingDecryptMsg = { id: m.id, body: m.body, element: el, isUnread: isUnread, msgData: m };
                document.getElementById('inboxDecryptModal').classList.add('active');
                document.getElementById('inboxDecryptCode').value = '';
                document.getElementById('inboxDecryptCode').focus();
                return; // Stop expansion until decrypted
            }

            el.classList.add('expanded');
            if(isUnread) {
                if(el.classList.contains('unread')) {
                    el.classList.remove('unread');
                    if(isPersonal) markMessageRead(m.id); else if(isBroadcast) markBroadcastRead(m.id);
                    const navLink = document.getElementById('navPost');
                    const match = navLink.innerText.match(/\((\d+)\)/);
                    if(match) { let cur = parseInt(match[1]); if(cur > 0) updatePostboxUI(cur - 1); }
                }
            }
        }
    });
    return el;
}

function openComposeModal(recipient = '', subject = '') {
    const modal = document.getElementById('composeModal');
    document.getElementById('composeRecipient').value = recipient;
    document.getElementById('composeSubject').value = subject;
    document.getElementById('composeBody').value = '';
    document.getElementById('composeCode').value = ''; // Reset code
    clearComposeFile();
    modal.classList.add('active');
}

function handleComposeFileUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 25 * 1024 * 1024) { showToast("Datei ist zu groß! Maximum sind 25MB.", 'error'); this.value = ''; return; }

    const reader = new FileReader();
    reader.onload = function(evt) {
        composeAttachment = {
            name: file.name,
            type: file.type,
            data: evt.target.result
        };
        document.getElementById('composeFileName').textContent = "📎 " + file.name;
        document.getElementById('composeFileInfo').style.display = 'flex';

        // Auto-fill body if empty (User Convenience)
        const bodyInput = document.getElementById('composeBody');
        if (bodyInput && !bodyInput.value.trim()) {
            bodyInput.value = `[Anhang: ${file.name}]`;
        }
    };
    reader.onerror = function() { showToast("Fehler beim Laden.", 'error'); };
    reader.readAsDataURL(file);
}

function clearComposeFile() {
    composeAttachment = null;
    const input = document.getElementById('composeFileInput');
    if(input) input.value = '';
    document.getElementById('composeFileInfo').style.display = 'none';
}

async function handleSendMessage(e) {
    e.preventDefault();
    const btn = e.target.querySelector('button[type="submit"]');
    const oldTxt = btn.textContent;

    const recipientRaw = document.getElementById('composeRecipient').value.trim();
    const subject = document.getElementById('composeSubject').value.trim();
    const body = document.getElementById('composeBody').value.trim();
    const code = document.getElementById('composeCode').value.trim();

    if(!recipientRaw || !subject || (!body && !composeAttachment) || !code) {
        showToast("Bitte alle Felder ausfüllen.", 'error');
        return;
    }
    if(code.length !== 5) {
        showToast("Code muss 5-stellig sein.", 'error');
        return;
    }

    btn.textContent = "Verschlüssle..."; btn.disabled = true;

    try {
        // Parse Recipients
        const recipients = recipientRaw.split(',').map(s => s.trim()).filter(s => s);

        // Prepare Payload
        let contentToEncrypt = body;
        if (composeAttachment) {
            contentToEncrypt = JSON.stringify({
                text: body,
                attachment: composeAttachment
            });
        }

        // Encrypt Body
        // Note: encryptFull expects array of IDs/Usernames. It adds current user automatically.
        // It returns a Base64 string.
        const encryptedBody = await encryptFull(contentToEncrypt, code, recipients, currentUser.name);

        btn.textContent = "Sende...";

        const payload = {
            recipientUsername: recipients, // Server now accepts array
            subject: subject, // Plain text
            body: encryptedBody // Encrypted
        };

        const res = await fetch(`${API_BASE}/messages/send`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
            body: JSON.stringify(payload)
        });
        const data = await res.json();

        if(data.success) {
            showToast(`Nachricht an ${data.count} Empfänger gesendet.`, 'success');
            document.getElementById('composeModal').classList.remove('active');
            switchInboxTab('private');
            loadAndShowInbox();
        } else {
            showToast(data.error || "Versand fehlgeschlagen", 'error');
        }
    } catch(e) {
        console.error(e);
        showToast("Fehler: " + e.message, 'error');
    } finally {
        btn.textContent = oldTxt; btn.disabled = false;
    }
}

async function markMessageRead(id) { try { await fetch(`${API_BASE}/messages/${id}/read`, { method: 'PATCH', headers: { 'Authorization': `Bearer ${authToken}` } }); } catch(e) { console.error("Mark Read Failed", e); } }
function deleteMessage(id, element) {
    window.showAppConfirm("Nachricht wirklich löschen?", async () => {
        try {
            const res = await fetch(`${API_BASE}/messages/${id}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${authToken}` } });
            if (res.ok) {
                element.remove();
                showToast("Nachricht gelöscht.", "success");
                checkUnreadMessages();
            } else {
                showToast("Fehler beim Löschen.", "error");
            }
        } catch(e) { showToast("Verbindungsfehler", "error"); }
    }, { confirm: "Löschen", cancel: "Abbrechen" });
}
function escapeHtml(text) { if(!text) return ''; return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;"); }

async function handleInboxDecrypt() {
    const code = document.getElementById('inboxDecryptCode').value.trim();
    if (!code || code.length !== 5) {
        showToast("Bitte 5-stelligen Code eingeben.", 'error');
        return;
    }

    if (!pendingDecryptMsg) return;

    const btn = document.getElementById('btnInboxDecryptConfirm');
    const oldTxt = btn.textContent;
    btn.textContent = "..."; btn.disabled = true;

    try {
        // Attempt Decrypt
        // We reuse decryptFull from cryptoLayers
        // Note: m.body is the encrypted string
        const decrypted = await decryptFull(pendingDecryptMsg.body, code, currentUser.name);

        // Success
        document.getElementById('inboxDecryptModal').classList.remove('active');

        // Update Message Body
        const el = pendingDecryptMsg.element;
        const bodyEl = el.querySelector('.msg-body');

        if (bodyEl) {
            let displayText = decrypted;
            let attachmentHtml = '';

            try {
                // Try parsing as JSON (New format with attachment)
                const parsed = JSON.parse(decrypted);
                if (parsed && typeof parsed === 'object') {
                    if (parsed.text) displayText = parsed.text;
                    if (parsed.attachment) {
                        const { name, data, type } = parsed.attachment;
                        // Create download logic
                        // We use a unique ID for the download button to attach listener or inline onclick
                        const btnId = `dl-${Date.now()}-${Math.floor(Math.random()*1000)}`;
                        // Storing data in memory is safer than inline big base64 string
                        // We'll attach a click listener to the button right after
                        window[`file_data_${btnId}`] = { data, name, type };

                        let previewHtml = '';
                        if (type && type.startsWith('image/')) {
                            previewHtml = `<img src="${data}" style="max-width: 100%; border-radius: 4px; margin-bottom: 10px; display: block;">`;
                        }

                        attachmentHtml = `
                            <div style="margin-top: 15px; padding-top: 10px; border-top: 1px solid #333;">
                                ${previewHtml}
                                <button onclick="downloadPrivateFile('${btnId}')" class="btn" style="font-size: 0.8rem; padding: 5px 10px; border-color: var(--accent-blue); color: var(--accent-blue);">
                                    💾 Datei herunterladen: ${escapeHtml(name)}
                                </button>
                            </div>
                        `;
                    }
                }
            } catch (e) {
                // Not JSON, assume plain text (Legacy)
            }

            bodyEl.innerHTML = escapeHtml(displayText).replace(/\n/g, '<br>') + attachmentHtml;
        }

        el.dataset.decrypted = "true";
        el.classList.add('expanded');

        // Handle Unread Logic (Mark as read ONLY after successful decrypt)
        if (pendingDecryptMsg.isUnread && el.classList.contains('unread')) {
            el.classList.remove('unread');
            // m.id is available in pendingDecryptMsg.id
            markMessageRead(pendingDecryptMsg.id);

            const navLink = document.getElementById('navPost');
            const match = navLink.innerText.match(/\((\d+)\)/);
            if(match) { let cur = parseInt(match[1]); if(cur > 0) updatePostboxUI(cur - 1); }
        }

        showToast("Nachricht entschlüsselt.", 'success');

    } catch (e) {
        console.error(e);
        showToast("Entschlüsselung fehlgeschlagen. Falscher Code?", 'error');
    } finally {
        btn.textContent = oldTxt; btn.disabled = false;
    }
}

window.downloadPrivateFile = function(btnId) {
    const fileInfo = window[`file_data_${btnId}`];
    if (fileInfo) {
        const a = document.createElement('a');
        a.href = fileInfo.data;
        a.download = fileInfo.name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    } else {
        showToast("Fehler: Datei nicht gefunden.", 'error');
    }
};
