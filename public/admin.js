// admin.js - Admin Panel Logic (Fixed & Robust)

const API_BASE = '/api/admin';
let adminPassword = '';

// Lokaler Speicher für Suche/Filter
let allUsers = [];
let allKeys = [];
let allPurchases = [];

// ==========================================
// INIT & EVENT LISTENERS
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    // 1. Session Check
    const storedPw = sessionStorage.getItem('sm_admin_pw');
    if(storedPw) {
        adminPassword = storedPw;
        initDashboard();
    }

    // 2. Login Form
    const loginForm = document.getElementById('adminLoginForm');
    if(loginForm) {
        loginForm.addEventListener('submit', (e) => {
            e.preventDefault();
            adminPassword = document.getElementById('adminPasswordInput').value;
            initDashboard();
        });
    }

    // 3. Logout
    document.getElementById('logoutBtn')?.addEventListener('click', () => {
        sessionStorage.removeItem('sm_admin_pw');
        location.reload();
    });

    // 4. Generator Action
    document.getElementById('generateBtn')?.addEventListener('click', generateKeys);

    // 5. Lizenz Speichern Action
    document.getElementById('saveLicenseBtn')?.addEventListener('click', saveLicenseChanges);

    // 6. SUCHE / FILTER (Neu!)
    document.getElementById('searchUser')?.addEventListener('input', (e) => {
        const term = e.target.value.toLowerCase();
        const filtered = allUsers.filter(u => 
            u.username.toLowerCase().includes(term) || 
            String(u.id).includes(term)
        );
        renderUsersTable(filtered);
    });
});

// ==========================================
// DASHBOARD LOGIC
// ==========================================

async function initDashboard() {
    // 1. Passwort prüfen
    if (!adminPassword) {
        // Fallback: Versuchen das Passwort aus dem Inputfeld zu holen, falls Variable leer
        const inputPw = document.getElementById('adminPasswordInput');
        if (inputPw) adminPassword = inputPw.value;
    }

    if (!adminPassword) {
        alert("Bitte Passwort eingeben.");
        return;
    }

    // 2. Header setzen (OHNE Content-Type, da GET Request!)
    const headers = { 
        'x-admin-password': adminPassword 
    };

    console.log("Sende Admin-Login Anfrage..."); // Debugging

    try {
        // Auth Check via Stats Endpoint
        const res = await fetch(`${API_BASE}/stats`, { headers });
        
        // HTTP Status prüfen bevor wir JSON parsen
        if (res.status === 403) {
            alert("Login fehlgeschlagen: Passwort falsch.");
            return;
        }
        
        if (!res.ok) {
            throw new Error(`Server Status: ${res.status}`);
        }

        const data = await res.json();
        
        if(data.success) {
            console.log("Admin Login erfolgreich!");
            sessionStorage.setItem('sm_admin_pw', adminPassword);
            document.getElementById('login-view').style.display = 'none';
            document.getElementById('dashboard-view').style.display = 'block';
            
            renderStats(data.stats);
            
            // Daten laden
            loadUsers();
            loadKeys();
            loadPurchases();
        } else {
            alert("Login fehlgeschlagen.");
        }
    } catch(e) {
        console.error("Dashboard Init Error:", e);
        alert("Fehler beim Verbinden: " + e.message);
    }
}

// ==========================================
// LOADERS (Daten holen)
// ==========================================

// An window binden, damit onclick="loadKeys()" im HTML funktioniert
window.loadKeys = async function() {
    try {
        const res = await fetch(`${API_BASE}/keys`, { headers: getHeaders() });
        allKeys = await res.json(); // Speichern für Edit/Filter
        renderKeysTable(allKeys);
    } catch(e) { console.error("Keys Error", e); }
};

window.loadUsers = async function() {
    try {
        const res = await fetch(`${API_BASE}/users`, { headers: getHeaders() });
        allUsers = await res.json(); // Speichern für Filter
        renderUsersTable(allUsers);
    } catch(e) { console.error("Users Error", e); }
};

window.loadPurchases = async function() {
    try {
        const res = await fetch(`${API_BASE}/purchases`, { headers: getHeaders() });
        allPurchases = await res.json();
        renderPurchasesTable(allPurchases);
    } catch(e) { console.error("Purchases Error", e); }
};

// ==========================================
// RENDERERS (Tabelle bauen)
// ==========================================

function renderStats(stats) {
    if(!stats) return;
    document.getElementById('stUsersActive').textContent = stats.users_active;
    document.getElementById('stUsersBlocked').textContent = stats.users_blocked;
    document.getElementById('stKeysActive').textContent = stats.keys_active;
    document.getElementById('stKeysExpired').textContent = stats.keys_expired;
    document.getElementById('stPurchases').textContent = stats.purchases_count;
    document.getElementById('stRevenue').textContent = (stats.revenue_total / 100).toFixed(2) + ' €';
}

function renderKeysTable(keys) {
    const tbody = document.getElementById('keysTableBody');
    tbody.innerHTML = '';
    
    keys.forEach(k => {
        const tr = document.createElement('tr');
        
        // Status berechnen
        let status = '<span class="status-free">Frei</span>';
        const now = new Date();
        const exp = k.expires_at ? new Date(k.expires_at) : null;

        if (exp && exp < now) {
            status = '<span class="status-expired">Abgelaufen</span>';
        } else if (k.user_id || k.username || k.is_active) {
            status = '<span class="status-active">Aktiv</span>';
        }

        const userIdDisplay = k.user_id ? `<span style="color:#fff;">${k.user_id}</span>` : '<span style="color:#444;">-</span>';
        const expiryDisplay = k.expires_at ? new Date(k.expires_at).toLocaleDateString() : 'Lifetime';

        // WICHTIG: Wir übergeben beim Edit nur die ID, nicht das ganze Objekt (vermeidet Syntaxfehler)
        tr.innerHTML = `
            <td style="font-family:'Roboto Mono'; letter-spacing:1px;">${k.key_code}</td>
            <td>${k.product_code || 'std'}</td>
            <td>${status}</td>
            <td>${userIdDisplay}</td>
            <td>${new Date(k.created_at).toLocaleDateString()}</td>
            <td>${expiryDisplay}</td>
            <td>
                <button class="btn-icon" onclick="openEditLicenseModal(${k.id})" title="Bearbeiten">⚙️</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function renderUsersTable(users) {
    const tbody = document.getElementById('usersTableBody');
    tbody.innerHTML = '';

    users.forEach(u => {
        const tr = document.createElement('tr');
        const status = u.is_blocked ? '<span class="status-expired">GESPERRT</span>' : '<span class="status-active">AKTIV</span>';
        
        const deviceIcon = u.allowed_device_id ? '📱' : '⚪';
        const deviceTitle = u.allowed_device_id ? 'Gerät gebunden' : 'Kein Gerät';
        
        // Sicherstellen, dass ID eine Zahl oder String ist
        const uid = u.id; 
        
        tr.innerHTML = `
            <td>#${uid}</td>
            <td style="font-weight:bold;">${u.username}</td>
            <td>${status}</td>
            <td>${formatDate(u.last_login)}</td>
            <td style="text-align:center;" title="${deviceTitle}">${deviceIcon}</td>
            <td>
                <div style="display:flex; gap:5px;">
                    <button class="btn-icon" onclick="resetDevice('${uid}')" title="Gerät resetten" style="color:var(--warning-orange);">📱</button>
                    <button class="btn-icon" onclick="toggleUserBlock('${uid}', ${u.is_blocked})" title="${u.is_blocked ? 'Entsperren' : 'Sperren'}">
                        ${u.is_blocked ? '🔓' : '🛑'}
                    </button>
                </div>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function renderPurchasesTable(purchases) {
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
}

// ==========================================
// ACTIONS (Bearbeiten, Generieren, Sperren)
// ==========================================

// --- LIZENZ BEARBEITEN ---
let currentEditingKeyId = null;

// Wird vom HTML Button aufgerufen -> Sucht Objekt in allKeys
window.openEditLicenseModal = function(id) {
    const key = allKeys.find(k => k.id === id);
    if(!key) return alert("Fehler: Lizenz nicht gefunden.");

    currentEditingKeyId = key.id;
    document.getElementById('editKeyId').value = key.id;
    document.getElementById('editKeyCode').value = key.key_code;
    document.getElementById('editUserId').value = key.user_id || '';
    
    if(key.expires_at) {
        const d = new Date(key.expires_at);
        // ISO String sicher formatieren für Input Date
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        const hh = String(d.getHours()).padStart(2, '0');
        const min = String(d.getMinutes()).padStart(2, '0');

        document.getElementById('editExpiryDate').value = `${yyyy}-${mm}-${dd}`;
        document.getElementById('editExpiryTime').value = `${hh}:${min}`;
    } else {
        document.getElementById('editExpiryDate').value = '';
        document.getElementById('editExpiryTime').value = '';
    }
    
    document.getElementById('editLicenseModal').style.display = 'flex';
};

async function saveLicenseChanges() {
    if(!currentEditingKeyId) return;

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

    const res = await fetch(`${API_BASE}/keys/${currentEditingKeyId}`, {
        method: 'PUT',
        headers: getHeaders(),
        body: JSON.stringify(payload)
    });

    if(res.ok) {
        document.getElementById('editLicenseModal').style.display = 'none';
        loadKeys(); // Neu laden
        loadUsers(); // User Update prüfen
        alert("Gespeichert.");
    } else {
        alert("Fehler beim Speichern.");
    }
}

// --- GENERATOR ---
async function generateKeys() {
    const duration = document.getElementById('genDuration').value;
    const count = document.getElementById('genCount').value;
    const btn = document.getElementById('generateBtn');
    
    btn.disabled = true;
    btn.textContent = "...";

    try {
        const res = await fetch(`${API_BASE}/generate-keys`, {
            method: 'POST',
            headers: getHeaders(),
            body: JSON.stringify({ product: duration, count })
        });
        
        const data = await res.json();
        if(data.success) {
            const area = document.getElementById('newKeysArea');
            area.style.display = 'block';
            area.textContent = data.keys.join('\n');
            loadKeys(); 
            // Stats neu laden (via initDashboard ist etwas overkill, aber sicher)
            const statsRes = await fetch(`${API_BASE}/stats`, { headers: getHeaders() });
            const statsData = await statsRes.json();
            if(statsData.success) renderStats(statsData.stats);
        } else {
            alert("Fehler: " + data.error);
        }
    } catch(e) {
        alert("Generierung fehlgeschlagen.");
    } finally {
        btn.disabled = false;
        btn.textContent = "Generieren";
    }
}

// --- USER ACTIONS (Sperren & Reset) ---
window.toggleUserBlock = async function(id, isBlocked) {
    if(!confirm(`Benutzer wirklich ${isBlocked ? 'entsperren' : 'sperren'}?`)) return;
    const endpoint = isBlocked ? 'unblock-user' : 'block-user';
    await fetch(`${API_BASE}/${endpoint}/${id}`, { method: 'POST', headers: getHeaders() });
    loadUsers();
};

window.resetDevice = async function(id) {
    if(!confirm(`Gerätebindung für ID #${id} löschen?`)) return;
    try {
        const res = await fetch(`${API_BASE}/reset-device/${id}`, { 
            method: 'POST', headers: getHeaders() 
        });
        const data = await res.json();
        if(data.success) {
            alert("Gerät gelöscht.");
            loadUsers();
        } else {
            alert("Fehler.");
        }
    } catch(e) { alert("Serverfehler."); }
};

// Helper
function formatDate(iso) {
    if(!iso) return '-';
    return new Date(iso).toLocaleString('de-DE');
}
