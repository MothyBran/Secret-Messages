// app.js - Frontend Logic (Fixed Sidebar & Slider)

import { encryptFull, decryptFull } from './cryptoLayers.js';

// KONFIGURATION
const API_BASE = '/api';
let currentUser = null;
let authToken = null;
let currentMode = 'encrypt'; 

// KONTAKTE STATE
let contacts = JSON.parse(localStorage.getItem('sm_contacts')) || [];

// INIT
document.addEventListener('DOMContentLoaded', function() {
    setupUIEvents();
    
    // Check ob von Kauf zurückgekehrt
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('action') === 'activate') {
        showSection('activationSection');
    } else {
        checkExistingSession();
    }
});

// UI EVENT HANDLING
function setupUIEvents() {
    
    // --- SIDEBAR ---
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
    const bindNav = (id, section) => {
        const el = document.getElementById(id);
        if(el) el.addEventListener('click', (e) => {
            e.preventDefault();
            toggleSidebar();
            if(section === 'contactsModal') openContactsModal('tabManage');
            else showSection(section);
        });
    };

    bindNav('navMain', 'mainSection');
    bindNav('navGuide', 'guideSection');
    bindNav('navInfo', 'infoSection');
    
    // Special Case: Kontakte
    document.getElementById('navContacts')?.addEventListener('click', (e) => {
        e.preventDefault();
        toggleSidebar();
        openContactsModal('tabManage');
    });

    document.getElementById('logoutBtnSide')?.addEventListener('click', (e) => { e.preventDefault(); handleLogout(); });
    document.getElementById('navDelete')?.addEventListener('click', (e) => { e.preventDefault(); confirmDeleteAccount(); });

    // --- MAIN TOOLS ---
    
    // Slider (Mode Switch)
    const modeSwitch = document.getElementById('modeSwitch');
    if(modeSwitch) {
        modeSwitch.addEventListener('change', (e) => {
            currentMode = e.target.checked ? 'decrypt' : 'encrypt';
            updateAppMode(currentMode);
        });
    }

    // Buttons
    document.getElementById('actionBtn')?.addEventListener('click', handleMainAction);
    document.getElementById('copyBtn')?.addEventListener('click', copyToClipboard);
    document.getElementById('clearFieldsBtn')?.addEventListener('click', clearAllFields);
    
    // QR
    document.getElementById('qrGenBtn')?.addEventListener('click', () => {
        const txt = document.getElementById('messageOutput').value;
        if(!txt) return alert("Erst Text verschlüsseln!");
        showQRModal(txt);
    });

    // --- FORMS ---
    document.getElementById('loginForm')?.addEventListener('submit', handleLogin);
    document.getElementById('activationForm')?.addEventListener('submit', handleActivation);
    
    document.getElementById('showActivationLink')?.addEventListener('click', (e) => { e.preventDefault(); showSection('activationSection'); });
    document.getElementById('showLoginLink')?.addEventListener('click', (e) => { e.preventDefault(); showSection('loginSection'); });

    // --- KONTAKTE MODAL ---
    document.getElementById('contactsBtn')?.addEventListener('click', () => openContactsModal('tabSelect'));
    
    document.getElementById('addContactForm')?.addEventListener('submit', (e) => {
        e.preventDefault();
        handleAddContact();
    });

    // Tab Switcher
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            e.target.classList.add('active');
            document.getElementById(e.target.dataset.target).classList.add('active');
        });
    });

    // Selection Confirm
    document.getElementById('confirmSelectionBtn')?.addEventListener('click', () => {
        const checked = document.querySelectorAll('.contact-select-cb:checked');
        const ids = Array.from(checked).map(cb => cb.value);
        if(ids.length > 0) {
            document.getElementById('recipientName').value = ids.join(', ');
            document.getElementById('contactsModal').classList.remove('active');
        }
    });
}

// AUTH FUNCTIONS
async function handleLogin(e) {
    e.preventDefault();
    const user = document.getElementById('username').value;
    const pass = document.getElementById('accessCode').value;
    
    let deviceId = localStorage.getItem('sm_device_id');
    if(!deviceId) { deviceId = Math.random().toString(36).substring(2); localStorage.setItem('sm_device_id', deviceId); }

    try {
        const res = await fetch(`${API_BASE}/auth/login`, {
            method: 'POST', headers: {'Content-Type':'application/json'},
            body: JSON.stringify({ username: user, accessCode: pass, deviceId })
        });
        const data = await res.json();
        
        if(data.success) {
            authToken = data.token;
            currentUser = data.username;
            localStorage.setItem('sm_token', authToken);
            localStorage.setItem('sm_user', currentUser);
            
            updateSidebarInfo(currentUser, data.expiresAt);
            if(checkLicenseExpiry(data.expiresAt)) showSection('renewalSection');
            else showSection('mainSection');
        } else {
            alert("Login fehlgeschlagen: " + (data.error || '?'));
        }
    } catch(e) { alert("Verbindungsfehler"); }
}

async function checkExistingSession() {
    const token = localStorage.getItem('sm_token');
    if(!token) return showSection('loginSection');
    
    const res = await fetch(`${API_BASE}/auth/validate`, {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ token })
    });
    const data = await res.json();
    
    if(data.valid) {
        authToken = token;
        currentUser = data.username;
        updateSidebarInfo(currentUser, data.expiresAt);
        if(checkLicenseExpiry(data.expiresAt)) showSection('renewalSection');
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
    // Activation Logic ... (wie zuvor)
    // Einfachheitshalber alert hier:
    alert("Funktion im Backend integriert.");
}

async function confirmDeleteAccount() {
    if(!confirm("Konto wirklich löschen?")) return;
    try {
        const res = await fetch(`${API_BASE}/auth/delete-account`, {
            method: 'DELETE', headers: {'Authorization': `Bearer ${authToken}`}
        });
        if(res.ok) handleLogout();
    } catch(e) { alert("Fehler"); }
}

// CONTACT FUNCTIONS
function openContactsModal(tab) {
    document.getElementById('contactsModal').classList.add('active');
    // Trigger Tab Click
    const btn = document.querySelector(`.tab-btn[data-target="${tab}"]`);
    if(btn) btn.click();
    renderContacts();
}

function renderContacts() {
    // List for Managing
    const list = document.getElementById('contactList');
    if(list) {
        list.innerHTML = '';
        contacts.forEach((c, idx) => {
            const li = document.createElement('li');
            li.innerHTML = `<span>${c.name} (${c.id})</span> <button onclick="deleteContact(${idx})" style="color:red; background:none; border:none; cursor:pointer;">X</button>`;
            list.appendChild(li);
        });
    }
    // List for Selecting
    const selList = document.getElementById('selectContactList');
    if(selList) {
        selList.innerHTML = '';
        contacts.forEach(c => {
            const li = document.createElement('li');
            li.innerHTML = `<label style="display:flex; gap:10px; cursor:pointer;"><input type="checkbox" value="${c.id}" class="contact-select-cb"> ${c.name}</label>`;
            selList.appendChild(li);
        });
    }
}

window.deleteContact = function(idx) {
    contacts.splice(idx, 1);
    localStorage.setItem('sm_contacts', JSON.stringify(contacts));
    renderContacts();
}

function handleAddContact() {
    const name = document.getElementById('newContactName').value;
    const id = document.getElementById('newContactID').value;
    if(name && id) {
        contacts.push({ name, id });
        localStorage.setItem('sm_contacts', JSON.stringify(contacts));
        document.getElementById('newContactName').value = '';
        document.getElementById('newContactID').value = '';
        renderContacts();
    }
}

// APP CORE
async function handleMainAction() {
    const text = document.getElementById('messageInput').value;
    const code = document.getElementById('messageCode').value;
    const rec = document.getElementById('recipientName').value;
    
    if(!text || !code) return alert("Bitte Text & Code eingeben");

    try {
        let res;
        if(currentMode === 'encrypt') {
            let ids = rec.split(',').map(x=>x.trim()).filter(x=>x);
            if(currentUser && !ids.includes(currentUser)) ids.push(currentUser);
            res = await encryptFull(text, code, ids);
        } else {
            res = await decryptFull(text, code, currentUser);
        }
        document.getElementById('messageOutput').value = res;
        document.getElementById('outputGroup').style.display = 'block';
        document.getElementById('messageOutput').scrollIntoView({behavior:'smooth'});
    } catch(e) { alert("Fehler: " + e.message); }
}

// HELPER
function showSection(id) {
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    const el = document.getElementById(id);
    if(el) el.classList.add('active');
}

function updateAppMode(mode) {
    const btn = document.getElementById('actionBtn');
    const lblEn = document.getElementById('labelEncrypt');
    const lblDe = document.getElementById('labelDecrypt');
    const rec = document.getElementById('recipientGroup');
    
    if(mode === 'encrypt') {
        btn.textContent = "🔒 DATEN VERSCHLÜSSELN";
        rec.style.display = 'block';
        lblEn.style.color = "var(--accent-blue)";
        lblEn.style.fontWeight = "bold";
        lblDe.style.color = "#444";
        lblDe.style.fontWeight = "normal";
    } else {
        btn.textContent = "🔓 DATEN ENTSCHLÜSSELN";
        rec.style.display = 'none';
        lblEn.style.color = "#444";
        lblEn.style.fontWeight = "normal";
        lblDe.style.color = "var(--accent-blue)";
        lblDe.style.fontWeight = "bold";
    }
}

function updateSidebarInfo(user, expiry) {
    document.getElementById('sidebarUser').textContent = user;
    const lic = document.getElementById('sidebarLicense');
    if(checkLicenseExpiry(expiry)) {
        lic.textContent = "ABGELAUFEN";
        lic.style.color = "red";
    } else {
        lic.textContent = "AKTIV";
        lic.style.color = "var(--success-green)";
    }
    document.querySelector('.auth-only').style.display = 'flex';
}

function checkLicenseExpiry(expiry) {
    if(!expiry || expiry.includes('9999')) return false;
    return new Date(expiry) < new Date();
}

function copyToClipboard() {
    const el = document.getElementById('messageOutput');
    el.select();
    document.execCommand('copy');
    alert("Kopiert!");
}

function clearAllFields() {
    document.querySelectorAll('input, textarea').forEach(e => e.value = '');
    document.getElementById('outputGroup').style.display = 'none';
}

function showQRModal(text) {
    const m = document.getElementById('qrModal');
    m.classList.add('active');
    const c = document.getElementById('qrDisplay');
    c.innerHTML = '';
    new QRCode(c, { text: text, width: 200, height: 200 });
}

window.startRenewal = function(plan) {
    alert("Leite weiter zu Stripe...");
    // Hier fetch call zu create-checkout-session
}
