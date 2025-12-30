// app.js - Frontend Logic (Fixed LAN Persistence & Sandbox Mode)

const APP_VERSION = 'Beta v0.61';

// Import encryption functions including backup helpers
import { encryptFull, decryptFull } from './cryptoLayers.js';

// ================================================================
// KONFIGURATION & STATE
// ================================================================

const API_BASE = '/api';
let currentUser = null; // Object { name: string, sm_id: number }
let authToken = null;
let currentAttachmentBase64 = null;
let currentMode = 'encrypt'; 

// --- SANDBOX MODE DETECTION ---
const IS_SANDBOX_USER = window.location.pathname.includes('/test/enterprise-user');

// --- NEW: Storage Adapter & Mode Logic ---
const StorageAdapter = {
    mode: 'cloud', // 'cloud', 'local', 'hub'
    socket: null,
    lanIp: null,

    init: function() {
        // 1. Strict Environment Detection
        const isDesktop = (window.location.protocol === 'file:' || window.electronAPI);

        if (isDesktop) {
            const storedMode = localStorage.getItem('sm_app_mode');
            this.mode = storedMode || 'local'; // Default to local (online exe)
        } else if (IS_SANDBOX_USER) {
            this.mode = 'hub'; // Force Hub Mode for Sandbox
            console.log("⚠️ SANDBOX USER MODE ACTIVE");
        } else {
            this.mode = 'cloud';
            localStorage.setItem('sm_app_mode', 'cloud'); // Enforce
        }

        // Restore LAN IP
        const storedIp = localStorage.getItem('sm_lan_ip');
        if(storedIp) this.lanIp = storedIp;

        if(this.mode === 'hub') this.connectHub();

        this.renderStatusBar();
    },

    setMode: function(newMode) {
        this.mode = newMode;
        localStorage.setItem('sm_app_mode', newMode);

        if(newMode === 'hub') this.connectHub();
        else if(this.socket) { this.socket.disconnect(); this.socket = null; }

        this.renderStatusBar();
    },

    setLanIp: function(ip) {
        this.lanIp = ip;
        localStorage.setItem('sm_lan_ip', ip);
        if(this.mode === 'hub') this.connectHub();
    },

    connectHub: function() {
        if(!this.lanIp && !IS_SANDBOX_USER) return;
        if(this.socket) this.socket.disconnect();

        // In Sandbox, we might not have a real hub, or we connect to localhost
        const hubUrl = IS_SANDBOX_USER ? 'http://localhost:3000' : `http://${this.lanIp}:3000`;

        // Connect to port 3000
        this.socket = io(hubUrl);

        this.socket.on('connect', () => {
             if(currentUser) {
                 this.socket.emit('register', { userId: currentUser.sm_id, username: currentUser.name, role: 'user' });
                 showToast("LAN Verbindung hergestellt", "success");

                 // Process Outbox
                 const outbox = JSON.parse(localStorage.getItem('sm_lan_outbox') || '[]');
                 if (outbox.length > 0) {
                     outbox.forEach(msg => {
                         this.socket.emit('send_message', msg);
                     });
                     localStorage.removeItem('sm_lan_outbox');
                     showToast(`${outbox.length} geparkte Nachrichten gesendet.`, 'success');
                 }
             }
        });

        this.socket.on('connect_error', () => {
            // Quiet fail or toast
        });

        // --- FIXED: LAN Message Persistence ---
        this.socket.on('receive_message', (data) => {
            // Data Structure: { senderId, encryptedPayload, type, timestamp? }
            // We need to store this in sessionStorage (ephemeral for LAN session)
            // or localStorage (persistent). Requirement says "fully encrypted communication".

            const msgId = `lan_${Date.now()}_${Math.random().toString(36).substr(2,9)}`;

            const newMsg = {
                id: msgId,
                recipient_id: currentUser.sm_id, // It's for me
                sender_id: data.senderId || 'Unknown',
                subject: "Neue Nachricht (LAN)",
                body: data.encryptedPayload, // Encrypted Content
                created_at: new Date().toISOString(),
                is_read: false,
                is_lan: true, // Flag for UI
                type: data.type || 'message'
            };

            // Retrieve existing
            let msgs = JSON.parse(sessionStorage.getItem('sm_lan_msgs') || '[]');
            msgs.push(newMsg);
            sessionStorage.setItem('sm_lan_msgs', JSON.stringify(msgs));

            showToast("Neue Nachricht empfangen!", "info");

            // If Inbox is open, refresh it
            const inboxSection = document.getElementById('inboxSection');
            if (inboxSection && inboxSection.classList.contains('active')) {
                loadAndShowInbox();
            } else {
                checkUnreadMessages(); // Update badge
            }
        });
    },

    applyEnterpriseMode: function() {
        document.body.classList.add('enterprise-mode');

        // Inject CSS if not present
        if (!document.getElementById('enterprise-css')) {
            const link = document.createElement('link');
            link.id = 'enterprise-css';
            link.rel = 'stylesheet';
            link.href = '/assets/css/enterprise.css';
            document.head.appendChild(link);
        }

        // Hide Cloud Elements
        document.querySelectorAll('a[href="shop"], #navGuide, #navInfo, #faqBtn').forEach(el => el.style.display = 'none');

        // Hide renewal options
        const renewalOptions = document.querySelectorAll('#renewalSection .btn');
        renewalOptions.forEach(btn => {
            if(btn.textContent.includes('EUR') || btn.textContent.includes('MONAT')) btn.style.display = 'none';
        });
    },

    renderStatusBar: function() {
        let bar = document.getElementById('app-mode-bar');
        if(!bar) {
            bar = document.createElement('div');
            bar.id = 'app-mode-bar';
            bar.style.position = 'fixed';
            bar.style.top = '0';
            bar.style.left = '0';
            bar.style.width = '100%';
            bar.style.height = '4px'; // Thin line by default
            bar.style.zIndex = '9999';
            document.body.appendChild(bar);

            // Label
            const label = document.createElement('div');
            label.id = 'app-mode-label';
            label.style.position = 'fixed';
            label.style.top = '5px';
            label.style.right = '10px';
            label.style.background = 'rgba(0,0,0,0.7)';
            label.style.padding = '2px 6px';
            label.style.borderRadius = '4px';
            label.style.fontSize = '0.7rem';
            label.style.color = '#fff';
            label.style.zIndex = '9999';
            label.style.pointerEvents = 'none';
            document.body.appendChild(label);
        }

        const label = document.getElementById('app-mode-label');
        const lanInput = document.getElementById('lan_config');
        const lanIpField = document.getElementById('lan_hub_ip');

        // Hide Cloud elements if in HUB/Enterprise mode
        const isEnterprise = (this.mode === 'hub' || this.mode === 'local'); // local is air-gapped

        if (isEnterprise) {
            this.applyEnterpriseMode();
        } else {
            document.body.classList.remove('enterprise-mode');
            const shopLink = document.querySelector('a[href="shop"]');
            if(shopLink) shopLink.style.display = 'flex';
            document.getElementById('navGuide').style.display = 'flex';
            document.getElementById('navInfo').style.display = 'flex';
            document.getElementById('faqBtn').style.display = 'flex';
        }

        if(this.mode === 'cloud') {
            bar.style.background = 'var(--accent-blue)';
            label.textContent = 'MODE: CLOUD';
            label.style.color = 'var(--accent-blue)';
            if(lanInput) lanInput.style.display = 'none';
        } else if (this.mode === 'hub') {
            bar.style.background = '#00ff88'; // Green
            label.innerHTML = 'MODE: ENTERPRISE LAN <span style="animation:pulse 1.5s infinite">●</span>';
            label.style.color = '#00ff88';
            if(lanInput) {
                lanInput.style.display = 'block';
                if(this.lanIp) lanIpField.value = this.lanIp;
                lanIpField.onchange = (e) => this.setLanIp(e.target.value);
            }
        } else {
            bar.style.background = '#ff3333'; // Red
            label.textContent = 'MODE: AIR-GAPPED';
            label.style.color = '#ff3333';
            if(lanInput) lanInput.style.display = 'none';
        }
    }
};

// Kontakt State
let contacts = []; // Loaded dynamically
let contactMode = 'manage'; 
let isEditMode = false;     
let selectedContactIds = new Set(); 
let sortKey = 'name';       
let sortDir = 'asc';
let pendingContactAction = null;

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

    // Init Adapter
    StorageAdapter.init();

    setupUIEvents();
    
    // Enterprise License Check logic moved to checkExistingSession/handleLogin to handle redirections

    // --- SANDBOX OVERRIDE ---
    if (IS_SANDBOX_USER) {
        authToken = 'DUMMY_TOKEN';
        currentUser = { name: 'Sandbox_User', sm_id: 999 };
        contacts = [
            { id: '101', name: 'M. Schmidt', group: 'IT' },
            { id: '102', name: 'A. Weber', group: 'Marketing' },
            { id: '103', name: 'Vertrieb_04', group: 'Sales' },
            { id: '104', name: 'L. Müller', group: 'IT' },
            { id: '105', name: 'K. Jansen', group: 'HR' },
            { id: '106', name: 'T. Hoffmann', group: 'Geschäftsführung' },
            { id: '107', name: 'S. Wagner', group: 'Sales' },
            { id: '108', name: 'J. Becker', group: 'IT' },
            { id: '109', name: 'B. Schulz', group: 'Marketing' },
            { id: '110', name: 'Admin_01', group: 'IT' }
        ];

        // Dummy Messages in Session Storage
        let dummyMsgs = JSON.parse(sessionStorage.getItem('sm_lan_msgs') || '[]');
        if(dummyMsgs.length === 0) {
            dummyMsgs = [
                { id: 'dm1', subject: 'Willkommen', body: 'Willkommen im Enterprise LAN Modus.', is_read: false, created_at: new Date().toISOString(), type: 'automated', is_lan: true },
                { id: 'dm2', subject: 'Support Ticket #123', body: 'Ihr Ticket wurde bearbeitet.', is_read: true, created_at: new Date(Date.now()-3600000).toISOString(), type: 'support', is_lan: true },
                { id: 'dm3', subject: 'Verschlüsseltes Bild', body: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUAAAAFCAYAAACNbyblAAAAHElEQVQI12P4//8/w38GIAXDIBKE0DHxgljNBAAO9TXL0Y4OHwAAAABJRU5ErkJggg==', is_read: false, created_at: new Date().toISOString(), type: 'message', is_lan: true }
            ];
            sessionStorage.setItem('sm_lan_msgs', JSON.stringify(dummyMsgs));
        }

        showSection('mainSection');
        updateSidebarInfo(currentUser.name, 'unlimited');
        return; // Skip normal init
    }
    // ------------------------

    // URL Check (Kauf-Rückkehr)
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('action') === 'activate') {
        showSection('activationSection');
    } else {
        const token = localStorage.getItem('sm_token');
        if (token) {
            checkExistingSession();
        } else {
            showSection('loginSection');
        }
    }

    // URL Consistency Check
    if (window.location.hostname !== 'localhost' && window.location.origin !== 'https://www.secure-msg.app') {
        if (!window.electronAPI) {
            showToast("Hinweis: Sie befinden sich nicht auf der Haupt-Domain. Kontakte sind ggf. nicht sichtbar.", 'error');
        }
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

// GLOBAL FETCH INTERCEPTOR (Optimized & Robust)
const originalFetch = window.fetch;
window.fetch = async function(...args) {
    try {
        // Fix: Use apply to preserve correct context (window)
        const response = await originalFetch.apply(window, args);

        if (response.status === 503) {
            try {
                const clone = response.clone();
                const text = await clone.text();
                // Robust Check: Parse JSON only if it looks like JSON, or check generic error text
                if (text.includes('MAINTENANCE_MODE')) {
                     window.location.href = '/maintenance';
                     // Return a dummy response to prevent downstream errors during redirect
                     return new Response(JSON.stringify({ error: 'MAINTENANCE_MODE' }), { status: 503, headers: { 'Content-Type': 'application/json' } });
                }
            } catch (e) {
                console.warn("Maintenance Check Failed:", e);
            }
        }

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

    requestAnimationFrame(() => {
        toast.classList.add('show');
    });

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
        const isLoggedIn = !!authToken;
        if (!isLoggedIn) {
            const loginActive = document.getElementById('loginSection').classList.contains('active');
            const activationActive = document.getElementById('activationSection').classList.contains('active');

            if (loginActive || activationActive) {
                window.location.href = 'landing.html';
            }
        }
    });

    // --- NAVIGATION & SEITEN (FIXED) ---
    function goBackToMain() {
        if(currentUser) showSection('mainSection');
        else showSection('loginSection');
    }

    document.getElementById('btnBackGuide')?.addEventListener('click', goBackToMain);
    document.getElementById('btnBackInfo')?.addEventListener('click', goBackToMain);
    document.getElementById('btnBackInbox')?.addEventListener('click', goBackToMain);


    // --- ACCOUNT LÖSCHEN (NEUES LAYOUT) ---
    document.getElementById('navDelete')?.addEventListener('click', (e) => {
        e.preventDefault();
        toggleMainMenu(true);
        document.getElementById('deleteAccountModal').classList.add('active');
    });

    document.getElementById('btnCancelDelete')?.addEventListener('click', () => {
        document.getElementById('deleteAccountModal').classList.remove('active');
    });

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
    document.getElementById('showLoginLink')?.addEventListener('click', (e) => {
        e.preventDefault();
        showSection('loginSection');
        const u = document.getElementById('u_ident_entry');
        const c = document.getElementById('u_key_secure');
        if(u) u.value = '';
        if(c) c.value = '';
    });

    // License Key Check
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

    // Encryption Key Validation (Strict Input Masking)
    const keyInput = document.getElementById('messageCode');
    if (keyInput) {
        keyInput.addEventListener('input', (e) => {
            // Remove any non-digit characters immediately
            e.target.value = e.target.value.replace(/\D/g, '');
            // Limit to 5 digits
            if (e.target.value.length > 5) e.target.value = e.target.value.slice(0, 5);
        });
        keyInput.addEventListener('keypress', (e) => {
            // Prevent entering non-digits (except control keys)
            if (!/\d/.test(e.key) && e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
                e.preventDefault();
            }
        });
    }

    // Activation Code Validation
    document.getElementById('newAccessCode')?.addEventListener('input', validateActivationInputs);
    document.getElementById('newAccessCodeRepeat')?.addEventListener('input', validateActivationInputs);
    document.getElementById('agbCheck')?.addEventListener('change', validateActivationInputs);

    const uField = document.getElementById('u_ident_entry');
    const cField = document.getElementById('u_key_secure');
    if (uField) uField.value = '';
    if (cField) cField.value = '';

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
    document.getElementById('btnExportContacts')?.addEventListener('click', exportContactsCsv);
    document.getElementById('btnImportContacts')?.addEventListener('click', () => document.getElementById('contactImportInput').click());
    document.getElementById('contactImportInput')?.addEventListener('change', (e) => {
        if(e.target.files.length > 0) handleCsvImport(e.target.files[0]);
    });

    document.getElementById('btnCancelBackup')?.addEventListener('click', () => {
        document.getElementById('backupModal').classList.remove('active');
        document.getElementById('backupCode').value = '';
        document.getElementById('contactImportInput').value = '';
    });

    document.getElementById('contactForm')?.addEventListener('submit', saveContact);
    document.getElementById('btnCancelEdit')?.addEventListener('click', () => document.getElementById('contactEditModal').classList.remove('active'));
    document.getElementById('btnDeleteContact')?.addEventListener('click', deleteContact);

    document.getElementById('btnCancelContactCode')?.addEventListener('click', () => {
        document.getElementById('contactCodeModal').classList.remove('active');
        pendingContactAction = null;
    });
    document.getElementById('btnConfirmContactCode')?.addEventListener('click', handleContactCodeSubmit);


    // --- DATEI UPLOAD LOGIK ---
    const fileInput = document.getElementById('fileInput');
    if (fileInput) {
        fileInput.addEventListener('change', function(e) {
            const file = e.target.files[0];
            if (!file) return;

            if (file.size > 5 * 1024 * 1024) {
                showToast("Datei ist zu groß! Maximum sind 5MB.", 'error');
                this.value = '';
                return;
            }

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
                currentAttachmentBase64 = evt.target.result;

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
        
        document.getElementById('deleteAccountModal').classList.remove('active');
        
        if(d.success) {
            if(currentUser && currentUser.sm_id) {
                localStorage.removeItem(`sm_contacts_${currentUser.sm_id}`);
            }

            showToast("Dein Account wurde erfolgreich gelöscht.", 'success');
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

// --- CSV IMPORT/EXPORT LOGIC ---

function exportContactsCsv() {
    if (!contacts || contacts.length === 0) return showToast("Keine Kontakte vorhanden.", 'error');

    try {
        let csvContent = "ID,Name,Group,PublicKey\n";

        const escapeCsvField = (field) => {
            let val = String(field || "");
            if (/^[=+\-@]/.test(val)) val = "'" + val;
            val = val.replace(/"/g, '""');
            if (val.search(/("|,|\n)/g) >= 0) val = `"${val}"`;
            return val;
        };

        contacts.forEach(c => {
            const id = escapeCsvField(c.id);
            const name = escapeCsvField(c.name);
            const grp = escapeCsvField(c.group);
            const pk = escapeCsvField(c.publicKey || '');
            csvContent += `${id},${name},${grp},${pk}\n`;
        });

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `contacts_export_${new Date().toISOString().slice(0,10)}.csv`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        showToast("Kontakte erfolgreich als .csv exportiert.", 'success');
    } catch(e) { console.error(e); showToast("Fehler beim Export.", 'error'); }
}

function handleCsvImport(file) {
    if (!file) return;
    if (file.type !== "text/csv" && !file.name.endsWith(".csv")) {
        showToast("Bitte nur .csv Dateien verwenden.", 'error');
        document.getElementById('contactImportInput').value = '';
        return;
    }

    const reader = new FileReader();
    reader.onload = function(evt) {
        try {
            const text = evt.target.result;
            const parseCsvLine = (line) => {
                const result = [];
                let start = 0;
                let inQuotes = false;
                for (let i = 0; i < line.length; i++) {
                    if (line[i] === '"') inQuotes = !inQuotes;
                    else if (line[i] === ',' && !inQuotes) {
                        let field = line.substring(start, i);
                        if (field.startsWith('"') && field.endsWith('"')) field = field.slice(1, -1).replace(/""/g, '"');
                        result.push(field);
                        start = i + 1;
                    }
                }
                let lastField = line.substring(start);
                if (lastField.startsWith('"') && lastField.endsWith('"')) lastField = lastField.slice(1, -1).replace(/""/g, '"');
                result.push(lastField);
                return result;
            };

            const lines = text.split(/\r?\n/);
            const importedData = [];

            let startIndex = 0;
            if (lines.length > 0 && lines[0].toLowerCase().includes("id")) startIndex = 1;

            for (let i = startIndex; i < lines.length; i++) {
                const line = lines[i].trim();
                if (!line) continue;
                const parts = parseCsvLine(line);
                if (parts.length >= 1) {
                    const id = parts[0].trim();
                    if(id) {
                        const name = parts.length > 1 ? parts[1].trim() : id;
                        const group = parts.length > 2 ? parts[2].trim() : "";
                        const publicKey = parts.length > 3 ? parts[3].trim() : "";
                        importedData.push({ id, name, group, publicKey });
                    }
                }
            }

            if (importedData.length > 0) processImportedData(importedData);
            else showToast("Keine gültigen Kontakte gefunden.", 'error');
        } catch (e) { console.error(e); showToast("Fehler beim Lesen der Datei.", 'error'); }
        finally { document.getElementById('contactImportInput').value = ''; }
    };
    reader.readAsText(file);
}

function handleContactCodeSubmit() { /* Unused now */ }

function processImportedData(importedData) {
    try {
        if (!Array.isArray(importedData)) throw new Error("Format ungültig");

        const toUpdate = [];
        const toAdd = [];

        importedData.forEach(c => {
            if (!c.id) return;
            const existingIndex = contacts.findIndex(ex => ex.id === c.id);
            if (existingIndex > -1) toUpdate.push(c);
            else toAdd.push(c);
        });

        const proceedImport = () => {
            toAdd.forEach(c => contacts.push(c));
            toUpdate.forEach(c => {
                const idx = contacts.findIndex(ex => ex.id === c.id);
                if(idx > -1) contacts[idx] = c;
            });
            contacts = contacts.filter(c => c && c.id);
            saveUserContacts();
            renderContactList(document.getElementById('contactSearch').value);
            if(contactMode === 'select') renderGroupTags();
            showToast(`Import: ${toAdd.length} neu, ${toUpdate.length} aktualisiert.`, 'success');
        };

        if (toUpdate.length > 0) window.showAppConfirm(`${toUpdate.length} Kontakte existieren bereits und werden überschrieben. Fortfahren?`, proceedImport);
        else proceedImport();
    } catch(err) { showToast("Datenformat ungültig.", 'error'); }
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
    const uInput = document.getElementById('u_ident_entry');
    const cInput = document.getElementById('u_key_secure');
    const u = uInput.value;
    const c = cInput.value;

    uInput.value = '';
    cInput.value = '';

    const devId = await generateDeviceFingerprint();
    try {
        const res = await fetch(`${API_BASE}/auth/login`, {
            method: 'POST', headers: {'Content-Type':'application/json'},
            body: JSON.stringify({ username:u, accessCode:c, deviceId:devId })
        });
        const data = await res.json();
        if (data.success) {
            authToken = data.token;
            const decoded = parseJwt(authToken);
            currentUser = { name: data.username, sm_id: decoded.id };

            localStorage.setItem('sm_token', authToken);
            localStorage.setItem('sm_user', JSON.stringify(currentUser));

            loadUserContacts();

            if (data.hasLicense === false) {
                updateSidebarInfo(currentUser.name, null);
                alert("Keine aktive Lizenz gefunden. Bitte verknüpfen Sie einen neuen Key.");
                showRenewalScreen();
                return;
            }

            if(data.expiresAt && data.expiresAt !== 'lifetime') {
                const expDate = new Date(String(data.expiresAt).replace(' ', 'T'));
                if(expDate < new Date()) {
                    updateSidebarInfo(currentUser.name, data.expiresAt);
                    showRenewalScreen();
                    return;
                }
            }

            // Enterprise Redirect Check
            const isEnterprise = (StorageAdapter.mode === 'hub' || StorageAdapter.mode === 'local');
            // Detect Admin via token payload usually, but for now rely on API response or token
            if (isEnterprise && (data.username.includes('Admin') || decoded.isAdmin)) {
                 window.location.href = 'it-admin.html';
                 return;
            }

            updateSidebarInfo(currentUser.name, data.expiresAt); showSection('mainSection');
        } else {
            if (data.error === "ACCOUNT_BLOCKED") {
                localStorage.removeItem('sm_token');
                showSection('blockedSection');
            } else if (data.error === "DEVICE_NOT_AUTHORIZED") {
                localStorage.removeItem('sm_token');
                window.showToast("Dieses Gerät ist für diesen Account nicht autorisiert.", 'error');
            } else {
                showAppStatus(data.error || "Login fehlgeschlagen", 'error');
            }
        }
    } catch(err) { showAppStatus("Serverfehler", 'error'); } 
}

async function handleActivation(e) {
    e.preventDefault();
    if (!document.getElementById('agbCheck').checked) return alert("Bitte akzeptieren Sie die AGB.");
    const code1 = document.getElementById('newAccessCode').value;
    const code2 = document.getElementById('newAccessCodeRepeat').value;
    if (code1 !== code2) return alert("Die Zugangscodes stimmen nicht überein!");

    const devId = await generateDeviceFingerprint();
    const payload = { licenseKey: document.getElementById('licenseKey').value, username: document.getElementById('newUsername').value, accessCode: document.getElementById('newAccessCode').value, deviceId: devId };
    try {
        const res = await fetch(`${API_BASE}/auth/activate`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload) });
        const d = await res.json();
        if(d.success) {
            showAppStatus("Aktivierung erfolgreich! Bitte einloggen.", 'success');
            showSection('loginSection');
            document.getElementById('u_ident_entry').value = payload.username;
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
    contacts = [];
    updateSidebarInfo(null);
    document.getElementById('sidebar').classList.remove('active');
    showSection('loginSection');
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
    if(isDec) { btn.style.border='1px solid var(--accent-blue)'; btn.style.color='var(--accent-blue)'; } else { btn.style.border=''; btn.style.color=''; }
    document.getElementById('textLabel').textContent = isDec ? 'Verschlüsselter Text' : 'Nachrichteneingabe (Klartext)';
    document.getElementById('recipientGroup').style.display = isDec ? 'none' : 'block';
    document.getElementById('qrScanBtn').style.display = isDec ? 'block' : 'none';
    document.getElementById('qrGenBtn').style.display = isDec ? 'none' : 'block';
    document.getElementById('saveTxtBtn').style.display = 'none';
    document.getElementById('uploadTxtBtn').style.display = isDec ? 'block' : 'none';
    const attachBtn = document.getElementById('attachmentBtn');
    if (attachBtn) attachBtn.style.display = isDec ? 'none' : 'block';
    clearAllFields();
    document.getElementById('messageInput').value = '';
    document.getElementById('messageOutput').value = '';
    document.getElementById('outputGroup').style.display = 'none';
}

async function handleMainAction() {
    const code = document.getElementById('messageCode').value;
    let payload = document.getElementById('messageInput').value;
    if (currentMode === 'encrypt' && currentAttachmentBase64) payload = currentAttachmentBase64;

    // Strict Validation: Must be exactly 5 digits
    if (!/^\d{5}$/.test(code)) return showAppStatus("Der Key muss aus exakt 5 Zahlen bestehen.", 'error');
    if (!payload || !currentUser) return showAppStatus("Daten unvollständig.", 'error');

    if (StorageAdapter.mode !== 'hub') {
        const isValid = await validateSessionStrict();
        if (!isValid) return;
    }

    const btn = document.getElementById('actionBtn'); const old = btn.textContent; btn.textContent="..."; btn.disabled=true;
    try {
        let res = "";
        if (currentMode === 'encrypt') {
            const rIds = document.getElementById('recipientName').value.split(',').map(s=>s.trim()).filter(s=>s);
            if(!rIds.includes(currentUser.name)) rIds.push(currentUser.name);

            res = await encryptFull(payload, code, rIds, currentUser.name);

            if (StorageAdapter.mode === 'hub' && StorageAdapter.socket) {
                let sentCount = 0;
                for (const recipient of rIds) {
                    if (recipient === currentUser.name) continue;
                    const msgData = {
                        recipientId: recipient,
                        encryptedPayload: res,
                        type: 'message'
                    };

                    if (StorageAdapter.socket && StorageAdapter.socket.connected) {
                        StorageAdapter.socket.emit('send_message', msgData);
                        sentCount++;
                    } else {
                        // Park Message
                        const outbox = JSON.parse(localStorage.getItem('sm_lan_outbox') || '[]');
                        outbox.push(msgData);
                        localStorage.setItem('sm_lan_outbox', JSON.stringify(outbox));
                        showToast("Keine LAN-Verbindung. Nachricht geparkt.", 'info');
                    }
                }
                if(sentCount > 0) showAppStatus(`Verschlüsselt & an ${sentCount} Empfänger im LAN gesendet.`, 'success');
            }

             const textOut = document.getElementById('messageOutput');
             const mediaOut = document.getElementById('mediaOutput');
             if(textOut) { textOut.value = res; textOut.style.display = 'block'; }
             if(mediaOut) mediaOut.style.display = 'none';

             if (res.length > 9999) {
                 document.getElementById('qrGenBtn').style.display = 'none';
                 document.getElementById('saveTxtBtn').style.display = 'block';
             } else {
                 document.getElementById('qrGenBtn').style.display = 'block';
                 document.getElementById('saveTxtBtn').style.display = 'none';
             }

             // Offline Export Option (Enterprise)
             const exportBtn = document.getElementById('exportEncBtn');
             if (exportBtn) exportBtn.style.display = 'block';
             else {
                 // Inject if missing
                 const grp = document.getElementById('outputGroup');
                 const btn = document.createElement('button');
                 btn.id = 'exportEncBtn';
                 btn.className = 'btn-outline';
                 btn.textContent = '💾 Export als .msg-enc (Offline)';
                 btn.style.marginTop = '10px';
                 btn.style.width = '100%';
                 btn.onclick = () => downloadOfflineMessage(res);
                 // Insert after text area or before media output
                 const ta = document.getElementById('messageOutput');
                 ta.parentNode.insertBefore(btn, ta.nextSibling);
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
    mediaDiv.innerHTML = '';

    if (res.startsWith('data:image')) {
        textArea.style.display = 'none'; mediaDiv.style.display = 'flex';
        const img = document.createElement('img'); img.src = res; img.style.maxWidth = '100%'; img.style.border = '1px solid #333'; img.style.borderRadius = '4px';
        const dlBtn = document.createElement('button'); dlBtn.className = 'btn'; dlBtn.textContent = '💾 Bild speichern';
        dlBtn.onclick = () => { const a = document.createElement('a'); a.href = res; a.download = `secure-image-${Date.now()}.png`; a.click(); };
        mediaDiv.appendChild(img); mediaDiv.appendChild(dlBtn);

    } else if (res.startsWith('data:application/pdf')) {
        textArea.style.display = 'none'; mediaDiv.style.display = 'flex';
        const icon = document.createElement('div'); icon.innerHTML = '📄 PDF DOKUMENT'; icon.style.fontSize = '1.2rem'; icon.style.color = 'var(--accent-blue)';
        const dlBtn = document.createElement('button'); dlBtn.className = 'btn'; dlBtn.textContent = '⬇ PDF Herunterladen';
        dlBtn.onclick = () => { const a = document.createElement('a'); a.href = res; a.download = `secure-document-${Date.now()}.pdf`; a.click(); };
        mediaDiv.appendChild(icon); mediaDiv.appendChild(dlBtn);
    } else {
        textArea.style.display = 'block'; mediaDiv.style.display = 'none'; textArea.value = res;
    }
}

async function generateDeviceFingerprint() {
    try {
        const canvas = document.createElement('canvas'); const ctx = canvas.getContext('2d');
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
const IDLE_TIMEOUT = 15 * 60 * 1000;

function setupIdleTimer() {
    window.onload = resetIdleTimer; window.onmousemove = resetIdleTimer; window.onmousedown = resetIdleTimer;
    window.ontouchstart = resetIdleTimer; window.onclick = resetIdleTimer; window.onkeypress = resetIdleTimer; window.addEventListener('scroll', resetIdleTimer, true);
}
function resetIdleTimer() {
    if (!currentUser) return;
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => { if(currentUser) { alert("Automatische Abmeldung wegen Inaktivität."); handleLogout(); } }, IDLE_TIMEOUT);
}

async function validateSessionStrict() {
    if (!authToken) { handleLogout(); return false; }
    try {
        const res = await fetch(`${API_BASE}/auth/validate`, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ token: authToken }) });
        const data = await res.json();
        if (!data.valid) {
            if (data.reason === 'blocked') { alert("Sitzung beendet: Konto wurde gesperrt."); handleLogout(); return false; }
            else if (data.reason === 'expired') { showRenewalScreen(); return false; }
            else if (data.reason === 'no_license') { alert("Keine aktive Lizenz gefunden."); showRenewalScreen(); return false; }
            else { alert("Sitzung abgelaufen."); handleLogout(); return false; }
        }
        return true;
    } catch (e) { showAppStatus("Verbindung prüfen...", 'error'); return false; }
}

function validateActivationInputs() {
    const code1 = document.getElementById('newAccessCode').value;
    const code2 = document.getElementById('newAccessCodeRepeat').value;
    const agbChecked = document.getElementById('agbCheck').checked;
    const btn = document.getElementById('activateBtn');
    const warning = document.getElementById('codeMismatchWarning');
    if (code2.length > 0 && code1 !== code2) warning.style.display = 'block'; else warning.style.display = 'none';
    if (agbChecked && (code1 === code2) && (code1.length === 5)) btn.disabled = false; else btn.disabled = true;
}

function updateSidebarInfo(user, expiryData) {
    const userLabel = document.getElementById('sidebarUser');
    const licenseLabel = document.getElementById('sidebarLicense');
    const authElements = document.querySelectorAll('.auth-only');

    if (userLabel) userLabel.textContent = user || 'Gast';

    if(user) {
        checkUnreadMessages();
        if(window.msgPollInterval) clearInterval(window.msgPollInterval);
        window.msgPollInterval = setInterval(checkUnreadMessages, 5 * 60 * 1000);
    } else {
        if(window.msgPollInterval) clearInterval(window.msgPollInterval);
    }

    if (user && licenseLabel) {
        if (expiryData === 'undefined' || expiryData === 'null') expiryData = null;
        if (expiryData === 'lifetime' || String(expiryData).toLowerCase().includes('unlimited')) {
            licenseLabel.textContent = "LIZENZ: UNLIMITED";
            licenseLabel.style.color = "#00ff41"; 
        } else if (expiryData) {
            try {
                let cleanDateStr = String(expiryData).replace(' ', 'T'); 
                const dateObj = new Date(cleanDateStr);
                if (!isNaN(dateObj.getTime())) {
                    const day = String(dateObj.getDate()).padStart(2, '0');
                    const month = String(dateObj.getMonth() + 1).padStart(2, '0');
                    const year = dateObj.getFullYear();
                    licenseLabel.textContent = "LIZENZ: gültig bis " + `${day}.${month}.${year}`;
                    licenseLabel.style.color = "var(--accent-blue)";
                } else {
                    licenseLabel.textContent = "LIZENZ: Aktiv";
                    licenseLabel.style.color = "var(--text-main)";
                }
            } catch (e) { licenseLabel.textContent = "LIZENZ: Aktiv"; }
        } else {
            licenseLabel.textContent = "LIZENZ: Unbekannt";
            licenseLabel.style.color = "#888";
        }
    } else if (licenseLabel) {
        licenseLabel.textContent = "Nicht verbunden";
        licenseLabel.style.color = "#888";
    }
    authElements.forEach(el => el.style.display = user ? 'flex' : 'none');
}

async function checkExistingSession() {
    const token = localStorage.getItem('sm_token');
    const userStored = localStorage.getItem('sm_user');
    let savedExpiry = localStorage.getItem('sm_exp'); 
    let userName = '';
    try { const parsed = JSON.parse(userStored); userName = parsed.name || parsed; } catch(e) { userName = userStored; }

    if (token) {
        try {
            const res = await fetch(`${API_BASE}/auth/validate`, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ token }) });
            const data = await res.json();
            
            if (data.valid) {
                authToken = token;
                const decoded = parseJwt(token);
                currentUser = { name: data.username || userName, sm_id: decoded.id };
                localStorage.setItem('sm_user', JSON.stringify(currentUser));
                loadUserContacts();

                let finalExpiry = data.expiresAt;
                if (!finalExpiry) finalExpiry = savedExpiry || 'lifetime';
                else localStorage.setItem('sm_exp', finalExpiry);

                if(finalExpiry && finalExpiry !== 'lifetime') {
                    const expDate = new Date(String(finalExpiry).replace(' ', 'T'));
                    if(expDate < new Date()) { updateSidebarInfo(currentUser.name, finalExpiry); showRenewalScreen(); return; }
                }

                // Enterprise Redirect Check
                const isEnterprise = (StorageAdapter.mode === 'hub' || StorageAdapter.mode === 'local');
                if (isEnterprise && (currentUser.name.includes('Admin') || decoded.isAdmin)) {
                     window.location.href = 'it-admin.html';
                     return;
                }

                updateSidebarInfo(currentUser.name, finalExpiry); showSection('mainSection');
                return;
            } else {
                if (data.reason === 'no_license') {
                    alert("Keine aktive Lizenz gefunden.");
                    authToken = token;
                    const decoded = parseJwt(token);
                    currentUser = { name: userName, sm_id: decoded.id };
                    showRenewalScreen();
                } else { handleLogout(); }
            }
        } catch(e) { showSection('loginSection'); }
    } else { showSection('loginSection'); }
}

function showRenewalScreen() {
    showSection('renewalSection');
    const wrapper = document.getElementById('headerSwitchWrapper');
    if(wrapper) wrapper.style.display = 'none';
}

function openSupportModal() {
    const modal = document.getElementById('supportModal');
    const userField = document.getElementById('supportUsername');
    document.getElementById('supportForm').reset();
    if (currentUser) {
        userField.value = currentUser.name; userField.readOnly = true; userField.style.opacity = '0.7';
    } else {
        userField.value = ''; userField.readOnly = false; userField.style.opacity = '1'; userField.placeholder = "Benutzername oder ID (falls bekannt)";
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

    if (!messageVal || !subjectVal) return showToast("Bitte Betreff und Nachricht eingeben.", 'error');

    btn.textContent = "Wird gesendet...";
    allFields.forEach(f => f.disabled = true);

    // --- LAN MODE SUPPORT LOGIC ---
    if(StorageAdapter.mode === 'hub' && StorageAdapter.socket) {
        try {
            const code = prompt("Bitte 5-stelligen Sicherheits-Code für diese Nachricht eingeben:");
            if(!code || code.length !== 5) {
                btn.textContent = oldText; allFields.forEach(f => f.disabled = false);
                return showToast("Code erforderlich.", 'error');
            }
            const encrypted = await encryptFull(messageVal, code, ['MASTER'], currentUser.name);
            StorageAdapter.socket.emit('send_message', { recipientId: 'MASTER', encryptedPayload: encrypted, type: 'support' });

            showAppStatus(`Verschlüsseltes Support-Ticket an LAN-Hub gesendet.`, 'success');
            setTimeout(() => {
                document.getElementById('supportModal').classList.remove('active');
                e.target.reset();
                allFields.forEach(f => f.disabled = false);
                btn.textContent = "Nachricht Senden";
            }, 1500);
        } catch(e) {
            showAppStatus("Verschlüsselungsfehler: " + e.message, 'error');
            btn.textContent = oldText; allFields.forEach(f => f.disabled = false);
        }
        return;
    }

    if (!usernameVal && !emailVal) {
        showToast("Bitte geben Sie eine E-Mail oder Benutzer-ID an.", 'error');
        allFields.forEach(f => f.disabled = false); btn.textContent = oldText; return;
    }

    const payload = { username: usernameVal, subject: subjectVal, email: emailVal, message: messageVal };

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 25000);
        const res = await fetch('/api/support', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: controller.signal });
        clearTimeout(timeoutId);
        const data = await res.json();
        if (data.success) {
            showAppStatus(`Danke! Ihre Nachricht wurde gesendet. Ticket: ${data.ticketId}`, 'success');
            setTimeout(() => {
                document.getElementById('supportModal').classList.remove('active');
                e.target.reset();
                allFields.forEach(f => f.disabled = false);
                btn.textContent = "Nachricht Senden";
            }, 3000);
        } else {
            alert("Mail-Server Fehler."); allFields.forEach(f => f.disabled = false); btn.textContent = oldText;
        }
    } catch (err) {
        alert("Mail-Server Fehler."); allFields.forEach(f => f.disabled = false); btn.textContent = oldText;
    }
}

window.clearAttachment = function() {
    document.getElementById('fileInput').value = ''; currentAttachmentBase64 = null;
    document.getElementById('fileInfo').style.display = 'none';
    document.getElementById('fileSpinner').style.display = 'none'; document.getElementById('fileCheck').style.display = 'none';
    const textArea = document.getElementById('messageInput'); textArea.disabled = false; textArea.value = '';
};

window.startRenewal = async function(planType) {
    if(!authToken) return showAppStatus("Bitte erst einloggen", 'error');
    const btn = event.currentTarget; btn.style.opacity = '0.5'; btn.style.pointerEvents = 'none';
    try {
        const res = await fetch('/api/create-checkout-session', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` }, body: JSON.stringify({ product_type: planType, is_renewal: true }) });
        const data = await res.json();
        if (data.success && data.checkout_url) window.location.href = data.checkout_url;
        else { showAppStatus(data.error || "Fehler beim Checkout", 'error'); btn.style.opacity = '1'; btn.style.pointerEvents = 'auto'; }
    } catch(e) { showAppStatus("Verbindungsfehler", 'error'); btn.style.opacity = '1'; btn.style.pointerEvents = 'auto'; }
};

function showAppStatus(msg, type='success') {
    const d=document.createElement('div'); d.className=`app-status-msg ${type}`; d.textContent=msg;
    document.getElementById('globalStatusContainer').appendChild(d);
    requestAnimationFrame(()=>d.classList.add('active')); setTimeout(()=>{d.classList.remove('active');setTimeout(()=>d.remove(),500)},4000);
}
function clearAllFields() {
    document.getElementById('messageInput').value=''; document.getElementById('messageOutput').value=''; document.getElementById('messageCode').value='';
    document.getElementById('recipientName').value=''; document.getElementById('outputGroup').style.display='none';
    document.getElementById('importFeedback').style.display = 'none'; document.getElementById('importFeedback').textContent = '';
    document.getElementById('txtFileInput').value = '';
    if (window.clearAttachment) window.clearAttachment();
    if (currentMode === 'encrypt') { document.getElementById('qrGenBtn').style.display = 'block'; document.getElementById('saveTxtBtn').style.display = 'none'; }
}
function copyToClipboard() { const el=document.getElementById('messageOutput'); el.select(); navigator.clipboard.writeText(el.value); showAppStatus("Kopiert!", 'success'); }

function downloadTxtFile(content) {
    const hashPart = content.substring(0, 5); const filename = `SECURE_MSG_${hashPart}.txt`;
    const element = document.createElement('a'); element.setAttribute('href', 'data:text/plain;charset=utf-8,' + encodeURIComponent(content));
    element.setAttribute('download', filename); element.style.display = 'none';
    document.body.appendChild(element); element.click(); document.body.removeChild(element);
}

function handleTxtImport(e) {
    const file = e.target.files[0]; if (!file) return;
    if (file.type !== "text/plain" && !file.name.endsWith('.txt')) { alert("Bitte nur .txt Dateien verwenden."); return; }
    const reader = new FileReader();
    reader.onload = function(evt) {
        document.getElementById('messageInput').value = evt.target.result;
        const fb = document.getElementById('importFeedback'); fb.textContent = `Importiert: ${file.name}`; fb.style.display = 'block';
    };
    reader.readAsText(file);
}

function showQRModal(text) {
    document.getElementById('qrModal').classList.add('active'); const c=document.getElementById('qrDisplay'); c.innerHTML="";
    try { new QRCode(c, { text:text, width:190, height:190, colorDark:"#000", colorLight:"#fff", correctLevel:QRCode.CorrectLevel.L }); } catch(e){c.textContent="QR Lib Error";}
}
function downloadQR() { const img=document.querySelector('#qrDisplay img'); if(img){ const a=document.createElement('a'); a.href=img.src; a.download=`qr-${Date.now()}.png`; a.click(); } }
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
    } catch (e) { return {}; }
}

function loadUserContacts() {
    if (!currentUser || !currentUser.sm_id) { contacts = []; return; }

    // Enterprise Global Directory
    // Enterprise Global Directory
    const isEnterprise = (StorageAdapter.mode === 'hub' || StorageAdapter.mode === 'local');
    if (isEnterprise) {
        // Fetch from Hub/Server
        fetch(`${API_BASE}/users`)
            .then(res => res.json())
            .then(users => {
                contacts = users.map(u => ({
                    id: u.username,
                    name: u.username, // Or specific display name if available
                    group: 'Enterprise Directory'
                }));
                // Filter out self
                contacts = contacts.filter(c => c.id !== currentUser.name);

                // If the sidebar is open, refresh list
                const sidebar = document.getElementById('contactSidebar');
                if(sidebar && sidebar.classList.contains('active')) {
                    renderContactList(document.getElementById('contactSearch').value);
                }
            })
            .catch(err => console.error("Error fetching Enterprise Directory:", err));
        return;
    }

    const key = `sm_contacts_${currentUser.sm_id}`;
    let stored = localStorage.getItem(key);
    if (!stored && localStorage.getItem('sm_contacts')) {
        stored = localStorage.getItem('sm_contacts'); localStorage.setItem(key, stored); localStorage.removeItem('sm_contacts');
    }
    contacts = stored ? JSON.parse(stored) : [];
}

function saveUserContacts() { if (!currentUser || !currentUser.sm_id) return; localStorage.setItem(`sm_contacts_${currentUser.sm_id}`, JSON.stringify(contacts)); }

function getReadBroadcasts() {
    if (!currentUser || !currentUser.sm_id) return [];
    const key = `sm_read_broadcasts_${currentUser.sm_id}`;
    const stored = localStorage.getItem(key);
    return stored ? JSON.parse(stored) : [];
}

function markBroadcastRead(id) {
    if (!currentUser || !currentUser.sm_id) return;
    const key = `sm_read_broadcasts_${currentUser.sm_id}`;
    const list = getReadBroadcasts();
    if (!list.includes(id)) { list.push(id); localStorage.setItem(key, JSON.stringify(list)); }
}

// --- NEW POSTBOX UI LOGIC ---

function updatePostboxUI(unreadCount) {
    const navLink = document.getElementById('navPost'); if (!navLink) return;
    if (unreadCount > 0) {
        navLink.innerHTML = `📬 Postfach <span style="color:var(--accent-blue); font-weight:bold;">(${unreadCount})</span>`;
        navLink.style.color = "var(--accent-blue)"; navLink.style.borderLeft = "3px solid var(--accent-blue)"; navLink.style.paddingLeft = "22px";
    } else {
        navLink.innerHTML = `📪 Postfach`; navLink.style.color = "var(--text-main)"; navLink.style.borderLeft = "none"; navLink.style.paddingLeft = "15px";
    }
}

async function checkUnreadMessages() {
    if(!currentUser) return;
    let totalUnread = 0;
    if(authToken && StorageAdapter.mode !== 'airgap') {
        try {
            const res = await fetch(`${API_BASE}/messages`, { headers: { 'Authorization': `Bearer ${authToken}` } });
            const msgs = await res.json();
            const readBroadcasts = getReadBroadcasts();
            const unreadPersonal = msgs.filter(m => m.recipient_id == currentUser.sm_id && !m.is_read).length;
            const unreadBroadcasts = msgs.filter(m => m.recipient_id === null && !readBroadcasts.includes(m.id)).length;
            totalUnread += (unreadPersonal + unreadBroadcasts);
        } catch(e) {}
    }
    const lanMsgs = JSON.parse(sessionStorage.getItem('sm_lan_msgs') || '[]');
    const lanUnread = lanMsgs.filter(m => !m.is_read).length;
    totalUnread += lanUnread;
    updatePostboxUI(totalUnread);
}

function downloadOfflineMessage(encryptedContent) {
    const filename = `OFFLINE_MSG_${Date.now()}.msg-enc`;
    const element = document.createElement('a');
    element.setAttribute('href', 'data:text/plain;charset=utf-8,' + encodeURIComponent(encryptedContent));
    element.setAttribute('download', filename);
    element.style.display = 'none';
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
    showToast("Nachricht für Offline-Transfer exportiert.", 'success');
}

async function loadAndShowInbox() {
    showSection('inboxSection');
    const container = document.getElementById('inboxList');
    const emptyMsg = document.getElementById('inboxEmpty');
    container.innerHTML = '<div style="text-align:center; padding:20px;">Lade...</div>'; emptyMsg.style.display = 'none';

    let allMsgs = [];
    if(authToken && StorageAdapter.mode !== 'airgap') {
        try {
            const res = await fetch(`${API_BASE}/messages`, { headers: { 'Authorization': `Bearer ${authToken}` } });
            const cloudMsgs = await res.json();
            allMsgs = allMsgs.concat(cloudMsgs);
        } catch(e) {}
    }
    const lanMsgs = JSON.parse(sessionStorage.getItem('sm_lan_msgs') || '[]');
    allMsgs = allMsgs.concat(lanMsgs);
    allMsgs.sort((a,b) => new Date(b.created_at) - new Date(a.created_at));

    checkUnreadMessages();
    container.innerHTML = '';

    if(allMsgs.length === 0) { emptyMsg.style.display = 'block'; return; }
    const readBroadcasts = getReadBroadcasts();

    allMsgs.forEach(m => {
        const el = document.createElement('div');
        const isLan = !!m.is_lan;
        const isPersonal = !!m.recipient_id;
        const isBroadcast = !isPersonal;
        const isUnread = isLan ? !m.is_read : ((isPersonal && !m.is_read) || (isBroadcast && !readBroadcasts.includes(m.id)));
        const isTicket = (m.type === 'ticket' || m.type === 'ticket_reply' || m.type === 'admin_reply');

        let classes = 'msg-card';
        if(isUnread) classes += ' unread';
        if(m.type === 'automated') classes += ' type-automated';
        if(m.type === 'support') classes += ' type-support';
        if(isTicket) classes += ' type-ticket';
        if(isLan) classes += ' type-lan';

        let icon = '📩';
        if(m.type === 'automated') icon = '⚠️';
        else if(m.type === 'support') icon = '💬';
        else if(isTicket) icon = '🎫';
        else if(!isPersonal) icon = '📢';
        if(isLan) icon = '🖥️';

        let badgeHtml = '';
        if (m.type === 'ticket' && m.status) {
            let statusClass = 'msg-status-open'; let statusText = 'OFFEN';
            if (m.status === 'in_progress') { statusClass = 'msg-status-progress'; statusText = 'IN BEARBEITUNG'; }
            if (m.status === 'closed') { statusClass = 'msg-status-closed'; statusText = 'ABGESCHLOSSEN'; }
            badgeHtml = `<span class="msg-status-badge ${statusClass}">${statusText}</span>`;
        }

        el.className = classes;
        el.innerHTML = `
            <div class="msg-header"><span>${new Date(m.created_at).toLocaleString('de-DE')}</span><span>${isLan ? 'LAN Intern' : (isPersonal ? 'Persönlich' : 'Allgemein')}</span></div>
        `;

        const divSubject = document.createElement('div'); divSubject.className = 'msg-subject'; divSubject.innerHTML = `${icon} ${escapeHtml(m.subject)} ${badgeHtml}`;
        const divBody = document.createElement('div'); divBody.className = 'msg-body';

        if (isLan) {
             divBody.innerHTML = `
                <div style="font-size:0.8rem; color:#888; margin-bottom:10px;">Verschlüsselte Nachricht</div>
                <button class="btn" style="padding:5px 10px; font-size:0.8rem;" onclick="window.decryptLanMessage('${m.id}')">🔓 Entschlüsseln</button>
                <div id="dec-${m.id}" style="margin-top:10px; white-space:pre-wrap; display:none;"></div>
             `;
             divBody.dataset.payload = m.body;
        } else { divBody.textContent = m.body; }

        el.appendChild(divSubject); el.appendChild(divBody);

        if (isPersonal || isLan) {
            const btnDel = document.createElement('button'); btnDel.textContent = 'Löschen'; btnDel.className = 'btn-outline'; btnDel.style.fontSize = '0.7rem'; btnDel.style.marginTop = '10px'; btnDel.style.padding = '4px 8px';
            if (!isLan && m.type === 'ticket' && m.status !== 'closed') {
                btnDel.classList.add('delete-btn-locked'); btnDel.style.display = 'none'; btnDel.disabled = true; btnDel.onclick = (e) => { e.stopPropagation(); };
            } else {
                btnDel.onclick = (e) => { e.stopPropagation(); if(isLan) deleteLanMessage(m.id, el); else deleteMessage(m.id, el); };
            }
            el.appendChild(btnDel);
        }

        el.addEventListener('click', (e) => {
            if(e.target.tagName === 'BUTTON') return;
            const wasExpanded = el.classList.contains('expanded');
            document.querySelectorAll('.msg-card.expanded').forEach(c => c.classList.remove('expanded'));

            if(!wasExpanded) {
                el.classList.add('expanded');
                if(isUnread) {
                    if(el.classList.contains('unread')) {
                        el.classList.remove('unread');
                        if(isLan) markLanMessageRead(m.id);
                        else if(isPersonal) markMessageRead(m.id);
                        else if(isBroadcast) markBroadcastRead(m.id);
                        const navLink = document.getElementById('navPost');
                        const match = navLink.innerText.match(/\((\d+)\)/);
                        if(match) { let cur = parseInt(match[1]); if(cur > 0) updatePostboxUI(cur - 1); }
                    }
                }
            }
        });
        container.appendChild(el);
    });
}

async function markMessageRead(id) { try { await fetch(`${API_BASE}/messages/${id}/read`, { method: 'PATCH', headers: { 'Authorization': `Bearer ${authToken}` } }); } catch(e) {} }

async function deleteMessage(id, element) {
    if(!confirm("Nachricht wirklich löschen?")) return;
    try {
        const res = await fetch(`${API_BASE}/messages/${id}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${authToken}` } });
        if (res.ok) { element.remove(); showToast("Nachricht gelöscht.", "success"); checkUnreadMessages(); } else { showToast("Fehler beim Löschen.", "error"); }
    } catch(e) { showToast("Verbindungsfehler", "error"); }
}

function markLanMessageRead(id) {
    let msgs = JSON.parse(sessionStorage.getItem('sm_lan_msgs') || '[]');
    const idx = msgs.findIndex(m => m.id === id);
    if(idx > -1) { msgs[idx].is_read = true; sessionStorage.setItem('sm_lan_msgs', JSON.stringify(msgs)); }
}

function deleteLanMessage(id, element) {
    if(!confirm("LAN Nachricht löschen?")) return;
    let msgs = JSON.parse(sessionStorage.getItem('sm_lan_msgs') || '[]');
    msgs = msgs.filter(m => m.id !== id);
    sessionStorage.setItem('sm_lan_msgs', JSON.stringify(msgs));
    element.remove(); showToast("Gelöscht.", "success"); checkUnreadMessages();
}

window.decryptLanMessage = async function(msgId) {
    const el = document.getElementById('dec-'+msgId);
    const parent = el.parentNode;
    const payload = parent.dataset.payload;
    const code = prompt("5-stelligen Code eingeben:"); if(!code) return;
    try {
        const res = await decryptFull(payload, code, currentUser.name);
        el.innerText = res; el.style.display = 'block'; el.style.color = '#fff';
    } catch(e) { alert("Entschlüsselung fehlgeschlagen: " + e.message); }
};

function escapeHtml(text) {
    if(!text) return '';
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}
