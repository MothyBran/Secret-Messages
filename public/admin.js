// admin.js - Admin Panel Logic (Fixed: Buttons & Filter)

const API_BASE = '/api/admin';
let adminPassword = '';

// Lokale Datenspeicher für Suche/Filter
let allUsers = [];
let allKeys = [];

// ==========================================
// INIT
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    // 1. Session prüfen
    const storedPw = sessionStorage.getItem('sm_admin_pw');
    if(storedPw) {
        adminPassword = storedPw;
        initDashboard(); // Versucht Login mit gespeichertem PW
    }

    // 2. Login Event
    document.getElementById('adminLoginForm')?.addEventListener('submit', (e) => {
        e.preventDefault();
        adminPassword = document.getElementById('adminPasswordInput').value;
        initDashboard();
    });

    // 3. Logout
    document.getElementById('logoutBtn')?.addEventListener('click', () => {
        sessionStorage.removeItem('sm_admin_pw');
        location.reload();
    });

    // 4. Generator Button
    document.getElementById('generateBtn')?.addEventListener('click', generateKeys);

    // 5. Lizenz speichern Button (Modal)
    document.getElementById('saveLicenseBtn')?.addEventListener('click', saveLicenseChanges);

    // 6. SUCHE / FILTER LOGIK (Neu hinzugefügt)
    document.getElementById('searchUser')?.addEventListener('input', (e) => {
        const term = e.target.value.toLowerCase();
        
        // Filtere die lokal gespeicherten User
        const filtered = allUsers.filter(u => 
            (u.username && u.username.toLowerCase().includes(term)) || 
            String(u.id).includes(term)
        );
        renderUsersTable(filtered);
    });
});

// ==========================================
// DASHBOARD LOGIC
// ==========================================

function getHeaders() {
    return { 
        'Content-Type': 'application/json', 
        'x-admin-password': adminPassword 
    };
}

async function initDashboard() {
    try {
        // Wir nutzen /stats als Login-Check
        const res = await fetch(`${API_BASE}/stats`, { headers: getHeaders() });
        const data = await res.json();
        
        if(data.success) {
            // Login erfolgreich
            sessionStorage.setItem('sm_admin_pw', adminPassword);
            document.getElementById('login-view').style.display = 'none';
            document.getElementById('dashboard-view').style.display = 'block';
            
            renderStats(data.stats);
            
            // Tabellen laden
            loadUsers();
            loadKeys();
        } else {
            alert("Login fehlgeschlagen. Passwort falsch?");
        }
    } catch(e) {
        console.error(e);
        alert("Server nicht erreichbar.");
    }
}

// ==========================================
// LOAD DATA FUNCTIONS (Global verfügbar via window)
// ==========================================

window.loadUsers = async function() {
    try {
        const res = await fetch(`${API_BASE}/users`, { headers: getHeaders() });
        allUsers = await res.json(); // In globale Variable speichern
        renderUsersTable(allUsers);  // Tabelle zeichnen
    } catch(e) { console.error("Load Users Error", e); }
};

window.loadKeys = async function() {
    try {
        const res = await fetch(`${API_BASE}/keys`, { headers: getHeaders() });
        allKeys = await res.json(); // In globale Variable speichern
        renderKeysTable(allKeys);   // Tabelle zeichnen
    } catch(e) { console.error("Load Keys Error", e); }
};

// ==========================================
// RENDER TABLES
// ==========================================

function renderStats(stats) {
    if(!stats) return;
    // IDs müssen mit admin.html übereinstimmen (dort fehlen evtl. manche IDs, 
    // daher prüfen wir hier nur die Basics oder fügen sie bei Bedarf ein)
    // Falls du keine Stats-Kacheln hast, wird das hier ignoriert.
}

function renderUsersTable(users) {
    const tbody = document.getElementById('usersTableBody');
    tbody.innerHTML = '';

    users.forEach(u => {
        const tr = document.createElement('tr');
        
        const status = u.is_blocked ? 
            '<span style="color:var(--error-red); font-weight:bold;">GESPERRT</span>' : 
            '<span style="color:var(--success-green);">AKTIV</span>';
            
        const deviceIcon = u.allowed_device_id ? '📱' : '⚪';
        const deviceTooltip = u.allowed_device_id ? 'Gerät gebunden' : 'Kein Gerät';

        tr.innerHTML = `
            <td>#${u.id}</td>
            <td style="font-weight:bold; color:#fff;">${u.username}</td>
            <td>${status}</td>
            <td>${u.last_login ? new Date(u.last_login).toLocaleString() : '-'}</td>
            <td style="text-align:center;" title="${deviceTooltip}">${deviceIcon}</td>
            <td>
                <div style="display:flex; gap:10px;">
                    <button class="btn-icon" onclick="resetDevice('${u.id}')" title="Gerät entkoppeln" style="cursor:pointer; background:none; border:none; font-size:1.2rem;">
                        📱
                    </button>
                    <button class="btn-icon" onclick="toggleUserBlock('${u.id}', ${u.is_blocked})" title="Sperren/Entsperren" style="cursor:pointer; background:none; border:none; font-size:1.2rem;">
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
    tbody.innerHTML = '';

    keys.forEach(k => {
        const tr = document.createElement('tr');
        
        let status = '<span style="color:#888;">Frei</span>';
        const now = new Date();
        const exp = k.expires_at ? new Date(k.expires_at) : null;

        if (exp && exp < now) status = '<span style="color:var(--error-red);">Abgelaufen</span>';
        else if (k.user_id || k.is_active) status = '<span style="color:var(--success-green);">Aktiv</span>';

        const expiry = k.expires_at ? new Date(k.expires_at).toLocaleDateString() : 'Lifetime';

        // WICHTIG: Wir übergeben beim Klick nur die ID! onclick="openEdit...(${k.id})"
        tr.innerHTML = `
            <td style="font-family:'Roboto Mono'">${k.key_code}</td>
            <td>${k.product_code || 'std'}</td>
            <td>${status}</td>
            <td>${new Date(k.created_at).toLocaleDateString()}</td>
            <td>${expiry}</td>
            <td>
                 <button class="btn-icon" onclick="openEditLicenseModal(${k.id})" style="cursor:pointer; background:none; border:none; font-size:1.2rem;">
                    ⚙️
                 </button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

// ==========================================
// ACTIONS (Global via window)
// ==========================================

// 1. Gerät zurücksetzen
window.resetDevice = async function(id) {
    if(!confirm(`Gerätebindung für User #${id} wirklich aufheben?`)) return;
    
    try {
        const res = await fetch(`${API_BASE}/reset-device/${id}`, { 
            method: 'POST', 
            headers: getHeaders() 
        });
        const data = await res.json();
        if(data.success) {
            alert("Gerät erfolgreich entkoppelt.");
            loadUsers(); // Tabelle aktualisieren
        } else {
            alert("Fehler: " + (data.error || "Unbekannt"));
        }
    } catch(e) { alert("Serverfehler beim Reset."); }
};

// 2. User Sperren/Entsperren
window.toggleUserBlock = async function(id, isBlocked) {
    if(!confirm(`Benutzer wirklich ${isBlocked ? 'entsperren' : 'sperren'}?`)) return;
    
    const endpoint = isBlocked ? 'unblock-user' : 'block-user';
    try {
        const res = await fetch(`${API_BASE}/${endpoint}/${id}`, { 
            method: 'POST', 
            headers: getHeaders() 
        });
        if(res.ok) {
            loadUsers();
        } else {
            alert("Fehler beim Ändern des Status.");
        }
    } catch(e) { alert("Verbindungsfehler."); }
};

// 3. Lizenz Editor öffnen
let currentEditingKeyId = null;

window.openEditLicenseModal = function(id) {
    // Wir suchen das Objekt anhand der ID im lokalen Speicher
    const key = allKeys.find(k => k.id === id);
    if(!key) return alert("Fehler: Schlüssel lokal nicht gefunden.");

    currentEditingKeyId = key.id;
    
    // Werte in das Modal füllen
    document.getElementById('editKeyId').value = key.id;
    document.getElementById('editKeyCode').value = key.key_code;
    document.getElementById('editUserId').value = key.user_id || ''; // User ID falls vorhanden
    
    // Datum formatieren für <input type="date">
    if(key.expires_at) {
        const d = new Date(key.expires_at);
        document.getElementById('editExpiryDate').value = d.toISOString().split('T')[0];
        
        // Zeit extrahieren (HH:MM)
        const hh = String(d.getHours()).padStart(2, '0');
        const mm = String(d.getMinutes()).padStart(2, '0');
        document.getElementById('editExpiryTime').value = `${hh}:${mm}`;
    } else {
        document.getElementById('editExpiryDate').value = '';
        document.getElementById('editExpiryTime').value = '';
    }
    
    // Modal anzeigen
    document.getElementById('editLicenseModal').style.display = 'flex';
};

// 4. Lizenz speichern (im Modal)
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
            method: 'PUT',
            headers: getHeaders(),
            body: JSON.stringify(payload)
        });
        
        if(res.ok) {
            document.getElementById('editLicenseModal').style.display = 'none';
            loadKeys(); // Keys neu laden
            loadUsers(); // Users auch neu laden (wegen Verknüpfung)
            alert("Lizenz aktualisiert.");
        } else {
            alert("Fehler beim Speichern.");
        }
    } catch(e) { alert("Serverfehler."); }
}

// 5. Generator
async function generateKeys() {
    const duration = document.getElementById('genDuration').value; // z.B. '1m'
    const count = document.getElementById('genCount')?.value || 1;
    
    try {
        const res = await fetch(`${API_BASE}/generate-keys`, {
            method: 'POST',
            headers: getHeaders(),
            body: JSON.stringify({ product: duration, count: count })
        });
        const data = await res.json();
        
        if(data.success) {
            alert(data.keys.length + " Keys generiert!");
            loadKeys(); // Tabelle aktualisieren
            // Optional: Keys irgendwo anzeigen, falls gewünscht
        } else {
            alert("Fehler: " + data.error);
        }
    } catch(e) { alert("Generator Fehler."); }
}
