// admin.js - Admin Panel Logic V2 (FIXED: Device Reset Restored)

const API_BASE = '/api/admin';
let adminPassword = '';

document.addEventListener('DOMContentLoaded', () => {
    // Session Check
    const storedPw = sessionStorage.getItem('sm_admin_pw');
    if(storedPw) {
        adminPassword = storedPw;
        initDashboard();
    }

    // Auth
    document.getElementById('adminLoginForm').addEventListener('submit', (e) => {
        e.preventDefault();
        adminPassword = document.getElementById('adminPasswordInput').value;
        initDashboard();
    });

    document.getElementById('logoutBtn').addEventListener('click', () => {
        sessionStorage.removeItem('sm_admin_pw');
        location.reload();
    });

    // Actions
    document.getElementById('generateBtn').addEventListener('click', generateKeys);
    document.getElementById('saveLicenseBtn').addEventListener('click', saveLicenseChanges);
});

async function initDashboard() {
    // 1. Authentifizierung testen durch Laden der Stats
    const headers = { 'Content-Type': 'application/json', 'x-admin-password': adminPassword };
    try {
        const res = await fetch(`${API_BASE}/stats`, { headers });
        const data = await res.json();
        
        if(data.success) {
            sessionStorage.setItem('sm_admin_pw', adminPassword);
            document.getElementById('login-view').style.display = 'none';
            document.getElementById('dashboard-view').style.display = 'block';
            
            renderStats(data.stats);
            loadUsers();
            loadKeys();
            loadPurchases();
        } else {
            alert("Login fehlgeschlagen. Falsches Passwort.");
        }
    } catch(e) {
        console.error(e);
        alert("Verbindungsfehler zum Server.");
    }
}

function getHeaders() {
    return { 'Content-Type': 'application/json', 'x-admin-password': adminPassword };
}

// ==========================================
// RENDERERS
// ==========================================

function renderStats(stats) {
    document.getElementById('stUsersActive').textContent = stats.users_active;
    document.getElementById('stUsersBlocked').textContent = stats.users_blocked;
    
    document.getElementById('stKeysActive').textContent = stats.keys_active;
    document.getElementById('stKeysExpired').textContent = stats.keys_expired;
    
    document.getElementById('stPurchases').textContent = stats.purchases_count;
    document.getElementById('stRevenue').textContent = (stats.revenue_total / 100).toFixed(2) + ' €';
}

// --- KEYS ---
async function loadKeys() {
    try {
        const res = await fetch(`${API_BASE}/keys`, { headers: getHeaders() });
        const keys = await res.json();
        const tbody = document.getElementById('keysTableBody');
        tbody.innerHTML = '';

        keys.forEach(k => {
            const tr = document.createElement('tr');
            
            // Status Logik
            let status = '<span class="status-free">Frei</span>';
            const now = new Date();
            const exp = k.expires_at ? new Date(k.expires_at) : null;

            if (exp && exp < now) {
                status = '<span class="status-expired">Abgelaufen</span>';
            } else if (k.user_id || k.username || k.is_active) {
                status = '<span class="status-active">Aktiv</span>';
            }

            // User ID Column
            const userIdDisplay = k.user_id ? `<span style="color:#fff;">${k.user_id}</span>` : '<span style="color:#444;">-</span>';
            
            // Expiry
            let expiryDisplay = k.expires_at ? new Date(k.expires_at).toLocaleDateString() : 'Lifetime';

            tr.innerHTML = `
                <td style="font-family:'Roboto Mono'; letter-spacing:1px;">${k.key_code}</td>
                <td>${k.product_code || 'std'}</td>
                <td>${status}</td>
                <td>${userIdDisplay}</td>
                <td>${new Date(k.created_at).toLocaleDateString()}</td>
                <td>${expiryDisplay}</td>
                <td>
                    <button class="btn-icon" onclick='openEditLicenseModal(${JSON.stringify(k)})' title="Bearbeiten">⚙️</button>
                </td>
            `;
            tbody.appendChild(tr);
        });
    } catch(e) { console.error("Load Keys Error", e); }
}

// --- USERS (MIT RESTORED FUNCTIONS) ---
async function loadUsers() {
    try {
        const res = await fetch(`${API_BASE}/users`, { headers: getHeaders() });
        const users = await res.json();
        const tbody = document.getElementById('usersTableBody');
        tbody.innerHTML = '';

        users.forEach(u => {
            const tr = document.createElement('tr');
            const status = u.is_blocked ? '<span class="status-expired">GESPERRT</span>' : '<span class="status-active">AKTIV</span>';
            
            // Device Status Icon
            const deviceIcon = u.allowed_device_id ? '📱' : '⚪';
            const deviceTitle = u.allowed_device_id ? 'Gerät gebunden (Klicken zum Lösen)' : 'Kein Gerät gebunden';

            tr.innerHTML = `
                <td>#${u.id}</td>
                <td style="font-weight:bold;">${u.username}</td>
                <td>${status}</td>
                <td>${formatDate(u.last_login)}</td>
                <td style="text-align:center;" title="${deviceTitle}">${deviceIcon}</td>
                <td>
                    <div style="display:flex; gap:5px;">
                        <button class="btn-icon" onclick="resetDevice('${u.id}')" title="Gerätebindung aufheben" style="color:var(--warning-orange);">
                            📱
                        </button>

                        <button class="btn-icon" onclick="toggleUserBlock(${u.id}, ${u.is_blocked})" title="${u.is_blocked ? 'Entsperren' : 'Sperren'}">
                            ${u.is_blocked ? '🔓' : '🛑'}
                        </button>
                    </div>
                </td>
            `;
            tbody.appendChild(tr);
        });
    } catch(e) { console.error("Load Users Error", e); }
}

// --- PURCHASES ---
async function loadPurchases() {
    try {
        const res = await fetch(`${API_BASE}/purchases`, { headers: getHeaders() });
        const purchases = await res.json();
        const tbody = document.getElementById('purchasesTableBody');
        tbody.innerHTML = '';

        purchases.forEach(p => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${formatDate(p.date)}</td>
                <td>${p.email}</td>
                <td>${p.product}</td>
                <td>${(p.amount / 100).toFixed(2)} ${p.currency.toUpperCase()}</td>
                <td>${p.status}</td>
            `;
            tbody.appendChild(tr);
        });
    } catch(e) { console.error("Load Purchases Error", e); }
}

// ==========================================
// ACTIONS
// ==========================================

// --- LICENSE EDITING ---
let currentEditingKeyId = null;

function openEditLicenseModal(key) {
    currentEditingKeyId = key.id;
    document.getElementById('editKeyId').value = key.id;
    document.getElementById('editKeyCode').value = key.key_code;
    document.getElementById('editUserId').value = key.user_id || '';
    
    // Datum setzen
    if(key.expires_at) {
        const d = new Date(key.expires_at);
        document.getElementById('editExpiryDate').value = d.toISOString().split('T')[0];
        document.getElementById('editExpiryTime').value = d.toTimeString().slice(0,5);
    } else {
        document.getElementById('editExpiryDate').value = '';
        document.getElementById('editExpiryTime').value = '';
    }
    
    document.getElementById('editLicenseModal').style.display = 'flex';
}

async function saveLicenseChanges() {
    const keyId = currentEditingKeyId;
    const datePart = document.getElementById('editExpiryDate').value;
    const timePart = document.getElementById('editExpiryTime').value || '23:59';
    const userIdInput = document.getElementById('editUserId').value.trim();

    let finalDate = null;
    if(datePart) {
        finalDate = new Date(`${datePart}T${timePart}:00`).toISOString();
    }

    const payload = {
        expires_at: finalDate,
        user_id: userIdInput || null
    };

    const res = await fetch(`${API_BASE}/keys/${keyId}`, {
        method: 'PUT',
        headers: getHeaders(),
        body: JSON.stringify(payload)
    });

    if(res.ok) {
        document.getElementById('editLicenseModal').style.display = 'none';
        loadKeys(); // Refresh Keys
        loadUsers(); // Refresh Users (da sich Verknüpfung geändert haben könnte)
        alert("Lizenz aktualisiert.");
    } else {
        alert("Fehler beim Speichern.");
    }
}

// --- GENERATOR ---
async function generateKeys() {
    const duration = document.getElementById('genDuration').value;
    const count = document.getElementById('genCount').value;
    
    const res = await fetch(`${API_BASE}/generate-keys`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ product: duration, count })
    });
    
    const data = await res.json();
    if(data.success) {
        document.getElementById('newKeysArea').style.display = 'block';
        document.getElementById('newKeysArea').textContent = data.keys.join('\n');
        loadKeys();
        initDashboard(); // Stats update
    }
}

// --- USER ACTIONS ---

async function toggleUserBlock(id, isBlocked) {
    if(!confirm(`Benutzer wirklich ${isBlocked ? 'entsperren' : 'sperren'}?`)) return;
    const endpoint = isBlocked ? 'unblock-user' : 'block-user';
    
    await fetch(`${API_BASE}/${endpoint}/${id}`, { method: 'POST', headers: getHeaders() });
    loadUsers();
    initDashboard(); 
}

// WIEDERHERGESTELLT: Device Reset
async function resetDevice(id) {
    if(!confirm(`Gerätebindung für Benutzer #${id} wirklich aufheben?`)) return;
    
    try {
        const res = await fetch(`${API_BASE}/reset-device/${id}`, { 
            method: 'POST', 
            headers: getHeaders() 
        });
        const data = await res.json();
        
        if(data.success) {
            alert("Gerätebindung aufgehoben.");
            loadUsers();
        } else {
            alert("Fehler: " + (data.error || "Unbekannt"));
        }
    } catch(e) {
        alert("Serverfehler beim Reset.");
    }
}

// Helper
function formatDate(iso) {
    if(!iso) return '-';
    return new Date(iso).toLocaleString('de-DE');
}
