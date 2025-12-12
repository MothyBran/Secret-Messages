// admin.js - Logik für das Secret Messages Admin Panel (Refactored)

const API_BASE = '/api';
let adminPassword = '';

// ==========================================
// INIT & AUTH
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    // Check session storage for simple persistence during refresh
    const storedPw = sessionStorage.getItem('sm_admin_pw');
    if(storedPw) {
        adminPassword = storedPw;
        tryLogin();
    }

    // Login Form Listener
    document.getElementById('adminLoginForm').addEventListener('submit', (e) => {
        e.preventDefault();
        adminPassword = document.getElementById('adminPasswordInput').value;
        tryLogin();
    });

    // Logout
    document.getElementById('logoutBtn').addEventListener('click', () => {
        sessionStorage.removeItem('sm_admin_pw');
        location.reload();
    });

    // Event Delegation for Tables
    setupTableActions();
    
    // Generator
    document.getElementById('generateBtn').addEventListener('click', generateKeys);
    
    // Refresh btns
    document.getElementById('refreshUsersBtn').addEventListener('click', loadUsers);
});

async function tryLogin() {
    // Wir testen den Login, indem wir versuchen Daten zu laden
    const success = await loadStats();
    if (success) {
        document.getElementById('login-view').style.display = 'none';
        document.getElementById('dashboard-view').style.display = 'block';
        sessionStorage.setItem('sm_admin_pw', adminPassword);
        
        // Load rest of data
        loadUsers();
        loadKeys();
    } else {
        alert("Zugriff verweigert. Passwort falsch.");
        sessionStorage.removeItem('sm_admin_pw');
    }
}

// ==========================================
// API CALLS & DATA LOADING
// ==========================================

function getHeaders() {
    return { 
        'Content-Type': 'application/json',
        'x-admin-password': adminPassword
    };
}

async function loadStats() {
    try {
        // Da wir keine dedizierte Stats-Route haben in deinem alten Code,
        // nutzen wir die user-Route als Check und berechnen Stats lokal
        // oder wir rufen /api/admin/users und /api/admin/keys auf.
        
        const resUsers = await fetch(`${API_BASE}/admin/users`, { headers: getHeaders() });
        if(resUsers.status === 401 || resUsers.status === 403) return false;
        
        const users = await resUsers.json();
        
        const resKeys = await fetch(`${API_BASE}/admin/keys`, { headers: getHeaders() });
        const keys = await resKeys.json();

        // Stats berechnen
        document.getElementById('statUsers').textContent = users.length;
        document.getElementById('statKeys').textContent = keys.filter(k => k.is_active).length;
        
        // Umsatz Check (falls du eine Sales Route hast, sonst dummy)
        // const resSales = await fetch(`${API_BASE}/admin/sales`, { headers: getHeaders() });
        // const sales = await resSales.json();
        // let total = sales.reduce((sum, s) => sum + s.amount, 0) / 100;
        // document.getElementById('statRevenue').textContent = total.toFixed(2) + ' €';
        
        return true;
    } catch (e) {
        console.error(e);
        return false;
    }
}

async function loadUsers() {
    try {
        const res = await fetch(`${API_BASE}/admin/users`, { headers: getHeaders() });
        const users = await res.json();
        renderUsers(users);
    } catch (e) { console.error("Error loading users", e); }
}

async function loadKeys() {
    try {
        const res = await fetch(`${API_BASE}/admin/keys`, { headers: getHeaders() });
        const keys = await res.json();
        renderKeys(keys);
    } catch (e) { console.error("Error loading keys", e); }
}

// ==========================================
// RENDERING
// ==========================================

function renderUsers(users) {
    const tbody = document.getElementById('usersTableBody');
    tbody.innerHTML = '';
    
    users.forEach(user => {
        const tr = document.createElement('tr');
        
        // Status Logik
        let statusClass = user.is_blocked ? 'status-blocked' : 'status-active';
        let statusText = user.is_blocked ? 'GESPERRT' : 'AKTIV';
        
        // Device ID Kürzen für Anzeige
        let devId = user.allowed_device_id ? 
            `<span title="${user.allowed_device_id}">${user.allowed_device_id.substring(0, 8)}...</span>` : 
            '<span style="color:#555">Kein Gerät</span>';

        tr.innerHTML = `
            <td>#${user.id}</td>
            <td style="font-weight:bold; color:#fff;">${user.username}</td>
            <td class="${statusClass}">${statusText}</td>
            <td>${formatDate(user.last_login)}</td>
            <td>${devId}</td>
            <td>
                <button class="action-btn toggle-block-btn" data-id="${user.id}" data-blocked="${user.is_blocked}">
                    ${user.is_blocked ? '🔓 Freigeben' : '🛑 Sperren'}
                </button>
                <button class="action-btn btn-danger-small reset-device-btn" data-id="${user.id}">
                    📱 Reset Device
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });

    // Suchfilter Logic (Simple Client Side)
    document.getElementById('searchUser').addEventListener('keyup', (e) => {
        const term = e.target.value.toLowerCase();
        Array.from(tbody.rows).forEach(row => {
            const name = row.cells[1].textContent.toLowerCase();
            row.style.display = name.includes(term) ? '' : 'none';
        });
    });
}

function renderKeys(keys) {
    const tbody = document.getElementById('keysTableBody');
    tbody.innerHTML = ''; // Limit auf die letzten 50 zur Performance
    
    // Sortieren: Neueste zuerst
    keys.sort((a,b) => new Date(b.created_at) - new Date(a.created_at));
    
    keys.slice(0, 100).forEach(key => {
        const tr = document.createElement('tr');
        
        let status = 'Frei';
        if (!key.is_active) status = 'Inaktiv';
        if (key.activated_at) status = 'Benutzt';
        
        // Ablaufdatum Check
        let expiryDisplay = formatDate(key.expires_at);
        if(!key.expires_at) expiryDisplay = "Lifetime";
        
        tr.innerHTML = `
            <td style="font-family:'Roboto Mono'; letter-spacing:1px;">${key.key_code}</td>
            <td>${key.product_code || 'Standard'}</td>
            <td>${status}</td>
            <td>${formatDate(key.created_at)}</td>
            <td>${expiryDisplay}</td>
        `;
        tbody.appendChild(tr);
    });
}

// ==========================================
// ACTIONS
// ==========================================

function setupTableActions() {
    const userTable = document.getElementById('usersTableBody');
    
    userTable.addEventListener('click', async (e) => {
        const target = e.target;
        
        // BLOCK / UNBLOCK
        if(target.classList.contains('toggle-block-btn')) {
            const userId = target.dataset.id;
            const isBlocked = target.dataset.blocked === 'true';
            
            if(!confirm(`Benutzer ${isBlocked ? 'entsperren' : 'sperren'}?`)) return;
            
            await fetch(`${API_BASE}/admin/users/${userId}/block`, {
                method: 'POST',
                headers: getHeaders(),
                body: JSON.stringify({ block: !isBlocked })
            });
            loadUsers();
        }
        
        // RESET DEVICE
        if(target.classList.contains('reset-device-btn')) {
            const userId = target.dataset.id;
            if(!confirm("Gerätebindung für diesen Nutzer wirklich aufheben?")) return;
            
            await fetch(`${API_BASE}/admin/users/${userId}/reset-device`, {
                method: 'POST',
                headers: getHeaders()
            });
            alert("Gerätebindung aufgehoben.");
            loadUsers();
        }
    });
}

async function generateKeys() {
    const duration = document.getElementById('genDuration').value;
    const count = parseInt(document.getElementById('genCount').value) || 1;
    
    const btn = document.getElementById('generateBtn');
    btn.disabled = true;
    btn.textContent = "Generating...";
    
    try {
        const res = await fetch(`${API_BASE}/admin/generate-keys`, {
            method: 'POST',
            headers: getHeaders(),
            body: JSON.stringify({ productCode: duration, count: count })
        });
        
        const data = await res.json();
        if(data.success) {
            // Keys anzeigen
            const area = document.getElementById('newKeysArea');
            area.style.display = 'block';
            area.textContent = data.keys.join('\n');
            loadKeys(); // Tabelle aktualisieren
            loadStats(); // Stats aktualisieren
        } else {
            alert("Fehler: " + data.error);
        }
    } catch(e) {
        alert("Fehler beim Generieren");
    } finally {
        btn.disabled = false;
        btn.textContent = "Generieren";
    }
}

// ==========================================
// HELPERS
// ==========================================
function formatDate(iso) {
    if(!iso) return '-';
    const d = new Date(iso);
    if(isNaN(d)) return '-';
    return d.toLocaleDateString('de-DE') + ' ' + d.toLocaleTimeString('de-DE', {hour:'2-digit', minute:'2-digit'});
}
