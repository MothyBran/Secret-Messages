// admin.js - Admin Panel Logic (Complete)

const API_BASE = '/api/admin';
let adminPassword = '';

// Lokale Datenspeicher für Suche & Edit
let allUsers = [];
let allKeys = [];
let allPurchases = [];

// ==========================================
// 1. INIT & EVENT LISTENERS
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    // Session Check
    const storedPw = sessionStorage.getItem('sm_admin_pw');
    if(storedPw) {
        adminPassword = storedPw;
        initDashboard();
    }

    // Login Form
    document.getElementById('adminLoginForm')?.addEventListener('submit', (e) => {
        e.preventDefault();
        adminPassword = document.getElementById('adminPasswordInput').value;
        initDashboard();
    });

    // Logout
    document.getElementById('logoutBtn')?.addEventListener('click', () => {
        sessionStorage.removeItem('sm_admin_pw');
        location.reload();
    });

    // Buttons Actions
    document.getElementById('generateBtn')?.addEventListener('click', generateKeys);
    document.getElementById('saveLicenseBtn')?.addEventListener('click', saveLicenseChanges);

    // FILTER LOGIK (Live Suche)
    document.getElementById('searchUser')?.addEventListener('input', (e) => {
        const term = e.target.value.toLowerCase();
        // Filter User
        const filtered = allUsers.filter(u => 
            (u.username && u.username.toLowerCase().includes(term)) || 
            String(u.id).includes(term)
        );
        renderUsersTable(filtered);
    });
});

// ==========================================
// 2. DASHBOARD START & AUTH
// ==========================================

function getHeaders() {
    return { 
        'Content-Type': 'application/json', 
        'x-admin-password': adminPassword 
    };
}

async function initDashboard() {
    try {
        // Wir prüfen Login über den Stats Endpoint
        const res = await fetch(`${API_BASE}/stats`, { headers: getHeaders() });
        const data = await res.json();
        
        if(data.success) {
            sessionStorage.setItem('sm_admin_pw', adminPassword);
            document.getElementById('login-view').style.display = 'none';
            document.getElementById('dashboard-view').style.display = 'block';
            
            renderStats(data.stats);
            
            // Alles laden
            loadUsers();
            loadKeys();
            loadPurchases(); // <--- DAS HAT GEFEHLT
        } else {
            alert("Passwort falsch.");
        }
    } catch(e) {
        console.error(e);
        alert("Server nicht erreichbar.");
    }
}

// ==========================================
// 3. LOAD DATA (Global Functions)
// ==========================================

window.loadUsers = async function() {
    try {
        const res = await fetch(`${API_BASE}/users`, { headers: getHeaders() });
        allUsers = await res.json();
        renderUsersTable(allUsers);
    } catch(e) { console.error("Users Error", e); }
};

window.loadKeys = async function() {
    try {
        const res = await fetch(`${API_BASE}/keys`, { headers: getHeaders() });
        allKeys = await res.json();
        renderKeysTable(allKeys);
    } catch(e) { console.error("Keys Error", e); }
};

window.loadPurchases = async function() {
    try {
        const res = await fetch(`${API_BASE}/purchases`, { headers: getHeaders() });
        allPurchases = await res.json();
        renderPurchasesTable(allPurchases);
    } catch(e) { console.error("Purchases Error", e); }
};

// ==========================================
// 4. RENDER TABELLEN
// ==========================================

function renderStats(stats) {
    if(!stats) return;
    // Elemente füllen falls vorhanden
    const setVal = (id, val) => { const el = document.getElementById(id); if(el) el.textContent = val; };
    
    setVal('stUsersActive', stats.users_active);
    setVal('stUsersBlocked', stats.users_blocked);
    setVal('stKeysActive', stats.keys_active);
    setVal('stKeysExpired', stats.keys_expired);
    setVal('stPurchases', stats.purchases_count);
    setVal('stRevenue', (stats.revenue_total / 100).toFixed(2) + ' €');
}

function renderUsersTable(users) {
    const tbody = document.getElementById('usersTableBody');
    if(!tbody) return;
    tbody.innerHTML = '';

    users.forEach(u => {
        const tr = document.createElement('tr');
        
        const status = u.is_blocked ? 
            '<span style="color:var(--error-red); font-weight:bold;">GESPERRT</span>' : 
            '<span style="color:var(--success-green);">AKTIV</span>';
            
        const deviceIcon = u.allowed_device_id ? '📱' : '⚪';

        tr.innerHTML = `
            <td>#${u.id}</td>
            <td style="font-weight:bold; color:#fff;">${u.username}</td>
            <td>${status}</td>
            <td>${u.last_login ? new Date(u.last_login).toLocaleString('de-DE') : '-'}</td>
            <td style="text-align:center;">${deviceIcon}</td>
            <td>
                <div style="display:flex; gap:10px;">
                    <button class="btn-icon" onclick="resetDevice('${u.id}')" title="Gerät entkoppeln" style="cursor:pointer; border:none; background:none; font-size:1.2rem;">📱</button>
                    <button class="btn-icon" onclick="toggleUserBlock('${u.id}', ${u.is_blocked})" title="Blockieren" style="cursor:pointer; border:none; background:none; font-size:1.2rem;">
                        ${u.is_blocked ? '🔓' : '🛑'}
                    </button>
                </div>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function renderKeysTable(keys) {
    const tbody = document.getElementById('keysTableBody');
    if(!tbody) return;
    tbody.innerHTML = '';

    keys.forEach(k => {
        const tr = document.createElement('tr');
        
        let status = '<span style="color:#888;">Frei</span>';
        const now = new Date();
        const exp = k.expires_at ? new Date(k.expires_at) : null;

        if (exp && exp < now) status = '<span style="color:var(--error-red);">Abgelaufen</span>';
        else if (k.user_id || k.is_active) status = '<span style="color:var(--success-green);">Aktiv</span>';

        const expiry = k.expires_at ? new Date(k.expires_at).toLocaleDateString('de-DE') : 'Lifetime';

        tr.innerHTML = `
            <td style="font-family:'Roboto Mono'">${k.key_code}</td>
            <td>${k.product_code || 'std'}</td>
            <td>${status}</td>
            <td>${new Date(k.created_at).toLocaleDateString('de-DE')}</td>
            <td>${expiry}</td>
            <td>
                 <button class="btn-icon" onclick="openEditLicenseModal(${k.id})" style="cursor:pointer; border:none; background:none; font-size:1.2rem;">⚙️</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function renderPurchasesTable(purchases) {
    const tbody = document.getElementById('purchasesTableBody');
    if(!tbody) return;
    tbody.innerHTML = '';

    purchases.forEach(p => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${new Date(p.date).toLocaleString('de-DE')}</td>
            <td>${p.email}</td>
            <td>${p.product}</td>
            <td>${(p.amount / 100).toFixed(2)} ${p.currency.toUpperCase()}</td>
            <td>${p.status}</td>
        `;
        tbody.appendChild(tr);
    });
}

// ==========================================
// 5. ACTIONS (Buttons)
// ==========================================

// Geräte Reset
window.resetDevice = async function(id) {
    if(!confirm(`Gerätebindung für User #${id} löschen?`)) return;
    await fetch(`${API_BASE}/reset-device/${id}`, { method: 'POST', headers: getHeaders() });
    loadUsers();
};

// User Sperren
window.toggleUserBlock = async function(id, isBlocked) {
    if(!confirm(`Benutzer ${isBlocked ? 'entsperren' : 'sperren'}?`)) return;
    const endpoint = isBlocked ? 'unblock-user' : 'block-user';
    await fetch(`${API_BASE}/${endpoint}/${id}`, { method: 'POST', headers: getHeaders() });
    loadUsers();
};

// Generator
async function generateKeys() {
    const duration = document.getElementById('genDuration').value;
    const count = document.getElementById('genCount').value || 1;
    
    try {
        const res = await fetch(`${API_BASE}/generate-keys`, {
            method: 'POST',
            headers: getHeaders(),
            body: JSON.stringify({ product: duration, count: count })
        });
        const data = await res.json();
        
        if(data.success) {
            const area = document.getElementById('newKeysArea');
            if(area) {
                area.style.display = 'block';
                area.textContent = data.keys.join('\n');
            }
            loadKeys(); 
            // Stats aktualisieren (optional)
            initDashboard(); 
        } else {
            alert("Fehler: " + data.error);
        }
    } catch(e) { alert("Fehler beim Generieren."); }
}

// --- EDIT LICENSE ---
let currentEditingKeyId = null;

window.openEditLicenseModal = function(id) {
    const key = allKeys.find(k => k.id === id);
    if(!key) return;

    currentEditingKeyId = key.id;
    document.getElementById('editKeyId').value = key.id;
    document.getElementById('editKeyCode').value = key.key_code;
    document.getElementById('editUserId').value = key.user_id || '';
    
    if(key.expires_at) {
        const d = new Date(key.expires_at);
        document.getElementById('editExpiryDate').value = d.toISOString().split('T')[0];
        const hh = String(d.getHours()).padStart(2, '0');
        const mm = String(d.getMinutes()).padStart(2, '0');
        document.getElementById('editExpiryTime').value = `${hh}:${mm}`;
    } else {
        document.getElementById('editExpiryDate').value = '';
        document.getElementById('editExpiryTime').value = '';
    }
    
    document.getElementById('editLicenseModal').style.display = 'flex';
};

async function saveLicenseChanges() {
    if(!currentEditingKeyId) return;
    
    const dateStr = document.getElementById('editExpiryDate').value;
    const timeStr = document.getElementById('editExpiryTime').value || '23:59';
    const userId = document.getElementById('editUserId').value.trim();

    let finalIsoString = null;
    if(dateStr) {
        finalIsoString = new Date(`${dateStr}T${timeStr}:00`).toISOString();
    }

    const payload = {
        expires_at: finalIsoString,
        user_id: userId || null
    };

    try {
        const res = await fetch(`${API_BASE}/keys/${currentEditingKeyId}`, {
            method: 'PUT', headers: getHeaders(),
            body: JSON.stringify(payload)
        });
        
        if(res.ok) {
            document.getElementById('editLicenseModal').style.display = 'none';
            loadKeys();
            loadUsers();
            alert("Gespeichert.");
        } else {
            alert("Fehler beim Speichern.");
        }
    } catch(e) { alert("Serverfehler."); }
}
