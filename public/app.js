// app.js - Frontend Logic (Fixed Contacts & Full Features)

import { encryptFull, decryptFull } from './cryptoLayers.js';

// KONFIGURATION
const API_BASE = '/api';
let currentUser = null;
let authToken = null;
let currentMode = 'encrypt'; 

// KONTAKTE STATE (Laden aus LocalStorage)
let contacts = [];
try {
    contacts = JSON.parse(localStorage.getItem('sm_contacts')) || [];
} catch(e) { contacts = []; }

// INIT
document.addEventListener('DOMContentLoaded', function() {
    console.log("🚀 App Init");
    setupUIEvents();
    
    // Check Action URL (z.B. nach Kauf)
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('action') === 'activate') {
        showSection('activationSection');
    } else {
        checkExistingSession();
    }
});

// EVENT HANDLING
function setupUIEvents() {
    // Menü
    const menuBtn = document.getElementById('menuToggle');
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebarOverlay');
    
    function toggleSidebar() {
        sidebar.classList.toggle('active');
        overlay.classList.toggle('active');
    }
    
    if(menuBtn) menuBtn.addEventListener('click', toggleSidebar);
    if(overlay) overlay.addEventListener('click', toggleSidebar);

    // Sidebar Links
    document.getElementById('navContacts')?.addEventListener('click', (e) => {
        e.preventDefault();
        toggleSidebar();
        openContactsModal('manageTab');
    });

    document.getElementById('logoutBtnSide')?.addEventListener('click', (e) => { e.preventDefault(); handleLogout(); });

    // Mode Switcher
    document.getElementById('modeSwitch')?.addEventListener('change', (e) => {
        currentMode = e.target.checked ? 'decrypt' : 'encrypt';
        updateAppMode(currentMode);
    });

    // Main Actions
    document.getElementById('actionBtn')?.addEventListener('click', handleMainAction);
    document.getElementById('copyBtn')?.addEventListener('click', copyToClipboard);
    document.getElementById('clearFieldsBtn')?.addEventListener('click', clearAllFields);

    // Auth Forms
    document.getElementById('loginForm')?.addEventListener('submit', handleLogin);
    document.getElementById('activationForm')?.addEventListener('submit', handleActivation);
    
    document.getElementById('showActivationLink')?.addEventListener('click', () => showSection('activationSection'));
    document.getElementById('showLoginLink')?.addEventListener('click', () => showSection('loginSection'));

    // --- KONTAKTVERZEICHNIS LOGIK (HIER WAR DAS PROBLEM) ---
    document.getElementById('contactsBtn')?.addEventListener('click', () => openContactsModal('selectTab'));
    
    // Kontakt hinzufügen
    document.getElementById('addContactForm')?.addEventListener('submit', (e) => {
        e.preventDefault();
        handleAddContact();
    });

    // Tabs im Modal
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            
            e.target.classList.add('active');
            const targetId = e.target.getAttribute('data-target');
            document.getElementById(targetId).classList.add('active');
        });
    });
    
    // Modal schließen bei Klick außerhalb
    window.onclick = function(event) {
        const modal = document.getElementById('contactsModal');
        if (event.target == modal) {
            modal.classList.remove('active');
        }
    }
}

// AUTH LOGIK
async function handleLogin(e) {
    e.preventDefault();
    const user = document.getElementById('username').value;
    const pass = document.getElementById('accessCode').value;
    
    // Device ID (Simuliert)
    let deviceId = localStorage.getItem('sm_device_id');
    if(!deviceId) {
        deviceId = Math.random().toString(36).substring(2);
        localStorage.setItem('sm_device_id', deviceId);
    }

    try {
        const res = await fetch(`${API_BASE}/auth/login`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ username: user, accessCode: pass, deviceId })
        });
        const data = await res.json();
        
        if(data.success) {
            authToken = data.token;
            currentUser = data.username;
            localStorage.setItem('sm_token', authToken);
            localStorage.setItem('sm_user', currentUser);
            
            updateSidebarInfo(currentUser, data.expiresAt);
            
            if(checkLicenseExpiry(data.expiresAt)) {
                showRenewalScreen();
            } else {
                showSection('mainSection');
            }
        } else {
            alert("Login fehlgeschlagen: " + data.error);
        }
    } catch(e) { alert("Serverfehler"); }
}

async function checkExistingSession() {
    const token = localStorage.getItem('sm_token');
    if(!token) return showSection('loginSection');
    
    const res = await fetch(`${API_BASE}/auth/validate`, {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ token })
    });
    const data = await res.json();
    
    if(data.valid) {
        authToken = token;
        currentUser = data.username;
        updateSidebarInfo(currentUser, data.expiresAt);
        if(checkLicenseExpiry(data.expiresAt)) showRenewalScreen();
        else showSection('mainSection');
    } else {
        handleLogout();
    }
}

function handleLogout() {
    localStorage.removeItem('sm_token');
    location.reload();
}

async function handleActivation(e) {
    e.preventDefault();
    const key = document.getElementById('licenseKey').value;
    const user = document.getElementById('newUsername').value;
    const code = document.getElementById('newAccessCode').value;
    
    let deviceId = localStorage.getItem('sm_device_id');
    if(!deviceId) { deviceId = Math.random().toString(36).substring(2); localStorage.setItem('sm_device_id', deviceId); }

    const res = await fetch(`${API_BASE}/auth/activate`, {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ licenseKey: key, username: user, accessCode: code, deviceId })
    });
    const data = await res.json();
    if(data.success) {
        alert("Aktivierung erfolgreich! Bitte einloggen.");
        showSection('loginSection');
    } else {
        alert("Fehler: " + data.error);
    }
}

// CONTACT FUNCTIONS
function openContactsModal(tabId) {
    const modal = document.getElementById('contactsModal');
    if(!modal) return;
    modal.classList.add('active');
    
    // Tab Logik
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    
    const btn = document.querySelector(`.tab-btn[data-target="${tabId}"]`);
    if(btn) btn.classList.add('active');
    document.getElementById(tabId).classList.add('active');

    renderContactLists();
}

function renderContactLists() {
    const list = document.getElementById('contactList');
    const selectList = document.getElementById('selectContactList');
    
    if(list) {
        list.innerHTML = '';
        contacts.forEach((c, idx) => {
            const li = document.createElement('li');
            li.innerHTML = `
                <span><b>${c.name}</b> (${c.id})</span>
                <button class="delete-btn" data-idx="${idx}">Löschen</button>
            `;
            li.querySelector('.delete-btn').addEventListener('click', () => deleteContact(idx));
            list.appendChild(li);
        });
    }

    if(selectList) {
        selectList.innerHTML = '';
        contacts.forEach(c => {
            const li = document.createElement('li');
            li.innerHTML = `
                <div style="display:flex; align-items:center; gap:10px; width:100%;">
                    <input type="checkbox" value="${c.id}" class="contact-select-cb">
                    <span>${c.name}</span>
                </div>
            `;
            selectList.appendChild(li);
        });
        
        // Confirm Button Logic (im Select Tab)
        // Muss dynamisch gebunden werden oder statisch im HTML
        const confirmBtn = document.getElementById('confirmSelectionBtn');
        if(confirmBtn) {
            confirmBtn.onclick = () => {
                const selected = [];
                document.querySelectorAll('.contact-select-cb:checked').forEach(cb => selected.push(cb.value));
                if(selected.length > 0) {
                    const input = document.getElementById('recipientName');
                    // Füge hinzu statt zu überschreiben (optional)
                    input.value = selected.join(', '); 
                    document.getElementById('contactsModal').classList.remove('active');
                }
            };
        }
    }
}

function handleAddContact() {
    const name = document.getElementById('newContactName').value;
    const id = document.getElementById('newContactID').value;
    if(!name || !id) return;

    contacts.push({ name, id });
    localStorage.setItem('sm_contacts', JSON.stringify(contacts));
    
    document.getElementById('newContactName').value = '';
    document.getElementById('newContactID').value = '';
    
    renderContactLists();
}

function deleteContact(index) {
    if(confirm('Kontakt löschen?')) {
        contacts.splice(index, 1);
        localStorage.setItem('sm_contacts', JSON.stringify(contacts));
        renderContactLists();
    }
}

// CORE FUNCTIONS
async function handleMainAction() {
    const text = document.getElementById('messageInput').value;
    const code = document.getElementById('messageCode').value;
    const recipient = document.getElementById('recipientName').value; // String "UserA, UserB"

    if(!text || !code) return alert("Text und Code eingeben.");

    try {
        let result;
        if(currentMode === 'encrypt') {
            // Empfänger parsen
            let userIds = recipient.split(',').map(s => s.trim()).filter(s => s);
            // Sich selbst hinzufügen (damit man es lesen kann)
            if(currentUser && !userIds.includes(currentUser)) userIds.push(currentUser);
            
            result = await encryptFull(text, code, userIds);
        } else {
            result = await decryptFull(text, code, currentUser);
        }
        document.getElementById('messageOutput').value = result;
        document.getElementById('outputGroup').style.display = 'block';
    } catch(e) {
        alert("Fehler: " + e.message);
    }
}

// HELPER
function showSection(id) {
    document.querySelectorAll('.section').forEach(el => el.style.display = 'none');
    document.getElementById(id).style.display = 'block';
}

function updateAppMode(mode) {
    const title = document.getElementById('modeTitle');
    const btn = document.getElementById('actionBtn');
    const recGroup = document.getElementById('recipientGroup');
    
    if(mode === 'encrypt') {
        title.textContent = "VERSCHLÜSSELUNG";
        btn.textContent = "🔒 DATEN VERSCHLÜSSELN";
        recGroup.style.display = 'block';
    } else {
        title.textContent = "ENTSCHLÜSSELUNG";
        btn.textContent = "🔓 DATEN ENTSCHLÜSSELN";
        recGroup.style.display = 'none';
    }
}

function updateSidebarInfo(user, expiry) {
    const elUser = document.getElementById('sidebarUser');
    const elLic = document.getElementById('sidebarLicense');
    if(elUser) elUser.textContent = user || 'Gast';
    if(elLic) elLic.textContent = expiry ? `Ablauf: ${new Date(expiry).toLocaleDateString()}` : 'Lizenz: Inaktiv';
    
    document.querySelectorAll('.auth-only').forEach(el => el.style.display = user ? 'flex' : 'none');
}

function checkLicenseExpiry(expiry) {
    if(!expiry || expiry.includes('9999')) return false;
    return new Date(expiry) < new Date();
}

function showRenewalScreen() {
    showSection('renewalSection');
}

function copyToClipboard() {
    const txt = document.getElementById('messageOutput');
    txt.select();
    document.execCommand('copy');
    alert("Kopiert!");
}

function clearAllFields() {
    document.querySelectorAll('input, textarea').forEach(el => el.value = '');
    document.getElementById('outputGroup').style.display = 'none';
}

// Export für HTML Onclick (Renewal)
window.startRenewal = async function(plan) {
    try {
        const res = await fetch(`${API_BASE}/create-checkout-session`, {
            method: 'POST', headers: {'Content-Type':'application/json', 'Authorization': `Bearer ${authToken}`},
            body: JSON.stringify({ product_type: plan, is_renewal: true })
        });
        const data = await res.json();
        if(data.checkout_url) window.location.href = data.checkout_url;
    } catch(e) { alert("Fehler"); }
};
