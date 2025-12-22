// admin.js - Admin Panel Logic (Complete & Fixed)

console.log("🚀 ADMIN.JS GELADEN");

const API_BASE = '/api/admin';
let adminPassword = '';

// Lokale Datenspeicher
let allUsers = [];
let allKeys = [];
let allPurchases = [];
let allBundles = [];
let currentBundleId = null;

// Helper für Headers
function getHeaders() {
    return { 'Content-Type': 'application/json', 'x-admin-password': adminPassword };
}

// --- TABS LOGIC ---
window.switchTab = function(tabName) {
    // Hide all contents
    document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.nav-tab').forEach(el => el.classList.remove('active'));

    // Show target
    document.getElementById(`tab-${tabName}`).classList.add('active');

    // Highlight Tab Button
    // Find button that calls this function with this arg
    // Since we can't easily find the button element from function call without event,
    // we query selector for onclick attribute or use index.
    // Simpler: iterate buttons and check text or attribute.
    // We added onclick="switchTab('dashboard')"
    const btns = document.querySelectorAll('.nav-tab');
    btns.forEach(btn => {
        if(btn.getAttribute('onclick').includes(tabName)) {
            btn.classList.add('active');
        }
    });

    // Load data specific to tab if needed (lazy load optimization possible, but eager load is fine for now)
    // We load everything on initDashboard anyway.
}

// --- HELPERS (MODALS & FEEDBACK) ---
let confirmCallback = null;

window.showConfirm = function(message, onConfirm) {
    document.getElementById('confirmMessage').textContent = message;
    document.getElementById('confirmModal').style.display = 'flex';
    confirmCallback = onConfirm;
};

window.showMessage = function(title, message, isError = false) {
    const t = document.getElementById('msgTitle');
    t.textContent = title;
    t.style.color = isError ? 'var(--error-red)' : 'var(--accent-blue)';
    document.getElementById('msgText').textContent = message;
    document.getElementById('messageModal').style.display = 'flex';
};

// --- TOAST NOTIFICATIONS (ADMIN) ---
window.showToast = function(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return; // Fallback?

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
}

// Global functions must be attached to window for HTML onclick attributes to work
window.loadUsers = async function() {
    console.log("Funktion aufgerufen: loadUsers");
    const btn = document.getElementById('refreshUsersBtn');
    if(btn) { btn.textContent = "⏳..."; btn.disabled = true; }
    try {
        const res = await fetch(`${API_BASE}/users`, { headers: getHeaders() });
        allUsers = await res.json();
        renderUsersTable(allUsers);
    } catch(e) { console.error("Load Users Failed", e); }
    if(btn) { btn.textContent = "Refresh"; btn.disabled = false; }
};

window.loadKeys = async function() {
    console.log("Funktion aufgerufen: loadKeys");
    const btn = document.getElementById('refreshKeysBtn');
    if(btn) { btn.textContent = "⏳..."; btn.disabled = true; }
    try {
        const res = await fetch(`${API_BASE}/keys`, { headers: getHeaders() });
        allKeys = await res.json();
        renderKeysTable(allKeys);
    } catch(e) { console.error("Load Keys Failed", e); }
    if(btn) { btn.textContent = "Refresh"; btn.disabled = false; }
};

window.loadPurchases = async function() {
    console.log("Funktion aufgerufen: loadPurchases");
    const btn = document.getElementById('refreshPurchasesBtn');
    if(btn) { btn.textContent = "⏳..."; btn.disabled = true; }
    try {
        const res = await fetch(`${API_BASE}/purchases`, { headers: getHeaders() });
        allPurchases = await res.json();
        renderPurchasesTable(allPurchases);
    } catch(e) { console.error("Load Purchases Failed", e); }
    if(btn) { btn.textContent = "Refresh"; btn.disabled = false; }
};

window.loadBundles = async function() {
    const btn = document.getElementById('refreshBundlesBtn');
    if(btn) { btn.textContent = "⏳..."; btn.disabled = true; }
    try {
        const res = await fetch(`${API_BASE}/bundles`, { headers: getHeaders() });
        allBundles = await res.json();
        renderBundlesTable(allBundles);
    } catch(e) { console.error("Load Bundles Failed", e); }
    if(btn) { btn.textContent = "Refresh"; btn.disabled = false; }
};

window.generateBundle = async function() {
    const btn = document.getElementById('generateBundleBtn');
    const oldText = btn.textContent;
    btn.textContent = "Generiere..."; btn.disabled = true;

    const payload = {
        name: document.getElementById('bundleName').value,
        productCode: document.getElementById('bundleProduct').value,
        count: document.getElementById('bundleCount').value,
        idStem: document.getElementById('bundleIdStem').value,
        startNumber: document.getElementById('bundleStartNum').value
    };

    if(!payload.name || !payload.idStem) {
        window.showMessage("Info", "Bitte Name und ID-Stamm angeben.", true);
        btn.textContent = oldText; btn.disabled = false;
        return;
    }

    try {
        const res = await fetch(`${API_BASE}/generate-bundle`, {
            method: 'POST',
            headers: getHeaders(),
            body: JSON.stringify(payload)
        });
        const data = await res.json();

        if(data.success) {
            window.showMessage("Erfolg", `Bundle #${data.bundleId} erstellt mit ${payload.count} Keys.`);
            window.loadBundles();
            // Also refresh global keys if needed
            window.loadKeys();
        } else {
            window.showMessage("Fehler", data.error || "Fehler beim Erstellen", true);
        }
    } catch(e) { window.showMessage("Fehler", "Netzwerkfehler", true); }

    btn.textContent = oldText; btn.disabled = false;
};

window.openBundleDetails = async function(id) {
    currentBundleId = id;
    const modal = document.getElementById('bundleDetailsModal');
    const tbody = document.getElementById('bundleKeysBody');
    tbody.innerHTML = '<tr><td colspan="4">Lade...</td></tr>';
    modal.style.display = 'flex';

    try {
        const res = await fetch(`${API_BASE}/bundles/${id}/keys`, { headers: getHeaders() });
        const keys = await res.json();

        tbody.innerHTML = '';
        keys.forEach(k => {
            const tr = document.createElement('tr');

            const expStr = k.expires_at ? new Date(k.expires_at).toLocaleDateString() : '-';
            const statusStyle = k.is_active ? 'color:var(--success-green);' : 'color: #888;';
            const statusText = k.is_active ? 'Aktiv' : 'Frei';

            tr.innerHTML = `
                <td style="font-weight:bold; color:var(--accent-blue);">${k.assigned_user_id || '-'}</td>
                <td style="font-family:'Roboto Mono';">${k.key_code}</td>
                <td style="${statusStyle}">${statusText}</td>
                <td>${expStr}</td>
            `;
            tbody.appendChild(tr);
        });
    } catch(e) { tbody.innerHTML = '<tr><td colspan="4" style="color:red;">Fehler beim Laden.</td></tr>'; }
};

window.massExtendBundle = async function() {
    if(!currentBundleId) return;
    const dateStr = document.getElementById('massExtendParams').value;
    if(!dateStr) return alert("Bitte Datum wählen.");

    const newDate = new Date(dateStr);
    newDate.setHours(23, 59, 59); // End of day

    // Fix: Using existing showConfirm helper (which uses confirmModal in HTML)
    window.showConfirm(`Alle Keys dieses Bundles bis ${newDate.toLocaleDateString()} verlängern?`, async () => {
        try {
            const res = await fetch(`${API_BASE}/bundles/${currentBundleId}/extend`, {
                method: 'PUT',
                headers: getHeaders(),
                body: JSON.stringify({ expires_at: newDate.toISOString() })
            });
            if(res.ok) {
                window.showMessage("Erfolg", "Erfolgreich verlängert.");
                window.openBundleDetails(currentBundleId); // Refresh list
            } else {
                window.showMessage("Fehler", "Fehler bei der Verlängerung.", true);
            }
        } catch(e) { window.showMessage("Fehler", "Verbindungsfehler.", true); }
    });
};

window.exportBundleCsv = async function() {
    if(!currentBundleId) return;
    try {
        const res = await fetch(`${API_BASE}/bundles/${currentBundleId}/keys`, { headers: getHeaders() });
        const keys = await res.json();

        let csvContent = "data:text/csv;charset=utf-8,AssignedID,LicenseKey,Status,ExpiresAt\n";
        keys.forEach(k => {
            csvContent += `${k.assigned_user_id || ''},${k.key_code},${k.is_active ? 'Active' : 'Free'},${k.expires_at || ''}\n`;
        });

        const encodedUri = encodeURI(csvContent);
        const link = document.createElement("a");
        link.setAttribute("href", encodedUri);
        link.setAttribute("download", `bundle_${currentBundleId}_export.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    } catch(e) { window.showMessage("Fehler", "Export fehlgeschlagen.", true); }
};

// --- MAINTENANCE & SHOP ---

window.loadMaintenanceStatus = async function() {
    try {
        const res = await fetch(`${API_BASE}/maintenance-status`, { headers: getHeaders() });
        const data = await res.json();
        if (data.success) {
            const toggle = document.getElementById('maintenanceToggle');
            const statusText = document.getElementById('maintenanceStateText');
            if (toggle) toggle.checked = data.maintenance;
            if (statusText) {
                statusText.textContent = data.maintenance ? "WARTUNG AKTIV" : "ONLINE";
                statusText.style.color = data.maintenance ? "orange" : "var(--success-green)";
            }
        }
    } catch (e) { console.error("Maintenance Status Load Failed", e); }
};

window.toggleMaintenance = async function() {
    const toggle = document.getElementById('maintenanceToggle');
    const isActive = toggle.checked;
    const statusText = document.getElementById('maintenanceStateText');
    statusText.textContent = "Updating...";

    try {
        const res = await fetch(`${API_BASE}/toggle-maintenance`, {
            method: 'POST', headers: getHeaders(),
            body: JSON.stringify({ active: isActive })
        });
        const data = await res.json();
        if (data.success) {
             statusText.textContent = data.maintenance ? "WARTUNG AKTIV" : "ONLINE";
             statusText.style.color = data.maintenance ? "orange" : "var(--success-green)";
             window.showMessage("Info", `Wartungsmodus ist nun ${data.maintenance ? 'AKTIV' : 'INAKTIV'}`);
        } else {
            toggle.checked = !isActive;
            window.showMessage("Fehler", "Konnte Status nicht ändern.", true);
        }
    } catch(e) { toggle.checked = !isActive; window.showMessage("Fehler", "Netzwerkfehler.", true); }
};

window.loadShopStatus = async function() {
    try {
        const res = await fetch(`${API_BASE}/shop-status`, { headers: getHeaders() });
        const data = await res.json();
        if (data.success) {
            const toggle = document.getElementById('shopToggle');
            const statusText = document.getElementById('shopStateText');
            if (toggle) toggle.checked = data.active;
            if (statusText) {
                statusText.textContent = data.active ? "AKTIV" : "OFFLINE";
                statusText.style.color = data.active ? "var(--success-green)" : "var(--error-red)";
            }
        }
    } catch (e) { console.error("Shop Status Load Failed", e); }
};

window.toggleShop = async function() {
    const toggle = document.getElementById('shopToggle');
    const isEnabled = toggle.checked;
    const statusText = document.getElementById('shopStateText');
    statusText.textContent = "Updating...";

    try {
        const res = await fetch(`${API_BASE}/toggle-shop`, {
            method: 'POST', headers: getHeaders(),
            body: JSON.stringify({ active: isEnabled })
        });
        const data = await res.json();
        if (data.success) {
             statusText.textContent = data.active ? "AKTIV" : "OFFLINE";
             statusText.style.color = data.active ? "var(--success-green)" : "var(--error-red)";
             window.showMessage("Info", `Shop ist nun ${data.active ? 'ONLINE' : 'OFFLINE'}`);
        } else {
            toggle.checked = !isEnabled;
            window.showMessage("Fehler", "Konnte Status nicht ändern.", true);
        }
    } catch(e) { toggle.checked = !isEnabled; window.showMessage("Fehler", "Netzwerkfehler.", true); }
};


window.resetDevice = function(id) {
    console.log("Funktion aufgerufen: resetDevice");
    window.showConfirm(`Gerätebindung für User #${id} löschen?`, async () => {
        await fetch(`${API_BASE}/reset-device/${id}`, { method: 'POST', headers: getHeaders() });
        window.loadUsers();
        window.showMessage("Erfolg", "Gerät zurückgesetzt.");
    });
};

window.toggleUserBlock = function(id, isBlocked) {
    console.log("Funktion aufgerufen: toggleUserBlock");
    window.showConfirm(`Benutzer ${isBlocked ? 'entsperren' : 'sperren'}?`, async () => {
        const endpoint = isBlocked ? 'unblock-user' : 'block-user';
        await fetch(`${API_BASE}/${endpoint}/${id}`, { method: 'POST', headers: getHeaders() });
        window.loadUsers();
        window.showMessage("Info", `Benutzer ${isBlocked ? 'entsperrt' : 'gesperrt'}.`);
    });
};

let currentEditingKeyId = null;

window.openEditLicenseModal = function(id) {
    console.log("Funktion aufgerufen: openEditLicenseModal");
    const key = allKeys.find(k => k.id === id);
    if(!key) return;

    currentEditingKeyId = key.id;
    document.getElementById('editKeyId').value = key.id;
    document.getElementById('editKeyCode').value = key.key_code;
    document.getElementById('editUserId').value = key.user_id || ''; // Populate User ID

    if(key.expires_at) {
        const d = new Date(key.expires_at);
        if(!isNaN(d.getTime())) {
             document.getElementById('editExpiryDate').value = d.toISOString().split('T')[0];
             const hh = String(d.getHours()).padStart(2, '0');
             const mm = String(d.getMinutes()).padStart(2, '0');
             document.getElementById('editExpiryTime').value = `${hh}:${mm}`;
        } else {
             document.getElementById('editExpiryDate').value = '';
             document.getElementById('editExpiryTime').value = '';
        }
    } else {
        document.getElementById('editExpiryDate').value = '';
        document.getElementById('editExpiryTime').value = '';
    }
    document.getElementById('editLicenseModal').style.display = 'flex';
};

window.saveLicenseChanges = async function() {
    console.log("Funktion aufgerufen: saveLicenseChanges");
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
        user_id: userId ? parseInt(userId) : null
    };

    try {
        const res = await fetch(`${API_BASE}/keys/${currentEditingKeyId}`, {
            method: 'PUT', headers: getHeaders(),
            body: JSON.stringify(payload)
        });

        if(res.ok) {
            document.getElementById('editLicenseModal').style.display = 'none';
            window.loadKeys();
            window.loadUsers();
            window.showMessage("Erfolg", "Änderungen gespeichert.");
        } else {
            try {
                const errData = await res.json();
                window.showMessage("Fehler", errData.error || "Speichern fehlgeschlagen.", true);
            } catch(e) {
                window.showMessage("Fehler", "Unbekannter Serverfehler (Status " + res.status + ")", true);
            }
        }
    } catch(e) { window.showMessage("Fehler", "Serverfehler: " + e.message, true); }
}

window.deleteKey = function(id) {
    window.showConfirm("Lizenz wirklich unwiderruflich löschen?", async () => {
        try {
            const res = await fetch(`${API_BASE}/keys/${id}`, { method: 'DELETE', headers: getHeaders() });
            if(res.ok) {
                window.loadKeys();
                window.showMessage("Gelöscht", "Lizenz wurde entfernt.");
            } else {
                window.showMessage("Fehler", "Konnte nicht löschen.", true);
            }
        } catch(e) { window.showMessage("Fehler", "Netzwerkfehler.", true); }
    });
};

window.generateKeys = async function() {
    console.log("Funktion aufgerufen: generateKeys");
    const duration = document.getElementById('genDuration').value;
    const count = document.getElementById('genCount').value || 1;
    try {
        const res = await fetch(`${API_BASE}/generate-keys`, {
            method: 'POST',
            headers: getHeaders(),
            body: JSON.stringify({ productCode: duration, count: count })
        });
        const data = await res.json();
        if(data.success) {
            const area = document.getElementById('newKeysArea');
            if(area) {
                area.style.display = 'block';
                area.textContent = data.keys.join('\n');
            }
            window.loadKeys();
            window.showMessage("Erfolg", "Keys generiert.");
        } else {
            window.showMessage("Fehler", data.error || 'Unbekannt', true);
        }
    } catch(e) { window.showMessage("Fehler", "Fehler beim Generieren.", true); }
}

async function loadSystemStatus() {
     try {
        const res = await fetch(`${API_BASE}/system-status`, { headers: getHeaders() });
        const data = await res.json();
        if(data.success) {
            const st = data.status;
            document.getElementById('sysDbStatus').textContent = st.dbConnection;
            document.getElementById('sysDbStatus').style.color = st.dbConnection === 'OK' ? 'var(--success-green)' : 'red';

            const d = new Date(st.serverTime);
            document.getElementById('sysTime').textContent = d.toLocaleTimeString('de-DE');

            const uptimeH = (st.uptime / 3600).toFixed(1);
            document.getElementById('sysUptime').textContent = `${uptimeH} h`;
        }
    } catch(e) { console.error("Sys Status Failed", e); }
}

async function initDashboard() {
    try {
        const res = await fetch(`${API_BASE}/stats`, { headers: getHeaders() });
        const data = await res.json();

        if(data.success) {
            sessionStorage.setItem('sm_admin_pw', adminPassword);
            document.getElementById('login-view').style.display = 'none';
            document.getElementById('dashboard-view').style.display = 'block';
            renderStats(data.stats);
            window.loadMaintenanceStatus();
            window.loadShopStatus();
            window.loadUsers();
            window.loadKeys();
            window.loadPurchases();
            window.loadBundles();
            loadSystemStatus();

            // Set default tab
            window.switchTab('dashboard');

        } else {
            window.showMessage("Fehler", "Passwort falsch.", true);
        }
    } catch(e) { console.error(e); window.showMessage("Fehler", "Server nicht erreichbar.", true); }
}

// DOM Event Listeners
document.addEventListener('DOMContentLoaded', () => {
    const storedPw = sessionStorage.getItem('sm_admin_pw');
    if(storedPw) { adminPassword = storedPw; initDashboard(); }

    document.getElementById('adminLoginForm')?.addEventListener('submit', (e) => {
        e.preventDefault();
        adminPassword = document.getElementById('adminPasswordInput').value;
        initDashboard();
    });

    document.getElementById('logoutBtn')?.addEventListener('click', () => {
        sessionStorage.removeItem('sm_admin_pw');
        location.reload();
    });

    document.getElementById('maintenanceToggle')?.addEventListener('change', window.toggleMaintenance);
    document.getElementById('shopToggle')?.addEventListener('change', window.toggleShop);

    document.getElementById('generateBtn')?.addEventListener('click', window.generateKeys);
    document.getElementById('saveLicenseBtn')?.addEventListener('click', window.saveLicenseChanges);
    document.getElementById('cancelLicenseBtn')?.addEventListener('click', () => {
        document.getElementById('editLicenseModal').style.display = 'none';
    });

    // Refresh Buttons (Using IDs from HTML update)
    document.getElementById('refreshUsersBtn')?.addEventListener('click', window.loadUsers);
    document.getElementById('refreshKeysBtn')?.addEventListener('click', window.loadKeys);
    document.getElementById('refreshPurchasesBtn')?.addEventListener('click', window.loadPurchases);
    document.getElementById('refreshBundlesBtn')?.addEventListener('click', window.loadBundles);
    document.getElementById('generateBundleBtn')?.addEventListener('click', window.generateBundle);
    document.getElementById('closeBundleModalBtn')?.addEventListener('click', () => document.getElementById('bundleDetailsModal').style.display='none');
    document.getElementById('massExtendBtn')?.addEventListener('click', window.massExtendBundle);
    document.getElementById('exportBundleBtn')?.addEventListener('click', window.exportBundleCsv);

    // Modal Events
    document.getElementById('btnConfirmYes')?.addEventListener('click', () => {
        if(confirmCallback) confirmCallback();
        document.getElementById('confirmModal').style.display = 'none';
        confirmCallback = null;
    });
    document.getElementById('btnConfirmNo')?.addEventListener('click', () => {
        document.getElementById('confirmModal').style.display = 'none';
        confirmCallback = null;
    });
    document.getElementById('btnMsgOk')?.addEventListener('click', () => {
        document.getElementById('messageModal').style.display = 'none';
    });

    // --- FILTER LISTENERS ---
    document.getElementById('searchUser')?.addEventListener('input', (e) => {
        const term = e.target.value.toLowerCase();
        const filtered = allUsers.filter(u => 
            (u.username && u.username.toLowerCase().includes(term)) || 
            String(u.id).includes(term)
        );
        renderUsersTable(filtered);
    });

    document.getElementById('searchKey')?.addEventListener('input', (e) => {
        const term = e.target.value.toLowerCase();
        const filtered = allKeys.filter(k => 
            (k.key_code && k.key_code.toLowerCase().includes(term)) ||
            (k.product_code && k.product_code.toLowerCase().includes(term)) ||
            (k.user_id && String(k.user_id).includes(term))
        );
        renderKeysTable(filtered);
    });

    document.getElementById('searchPurchase')?.addEventListener('input', (e) => {
        const term = e.target.value.toLowerCase();
        const filtered = allPurchases.filter(p => 
            (p.email && p.email.toLowerCase().includes(term)) ||
            (p.id && p.id.toLowerCase().includes(term))
        );
        renderPurchasesTable(filtered);
    });
});

// --- RENDERERS ---

function renderStats(stats) {
    if(!stats) return;
    const setVal = (id, val) => { const el = document.getElementById(id); if(el) el.textContent = val; };
    setVal('stUsersActive', stats.users_active);
    setVal('stUsersBlocked', stats.users_blocked);
    setVal('stKeysActive', stats.keys_active);
    setVal('stKeysExpired', stats.keys_expired);
    setVal('stPurchases', stats.purchases_count);
    setVal('stRevenue', (stats.revenue_total / 100).toFixed(2) + ' €');

    // New Stats
    setVal('stBundlesActive', stats.bundles_active || 0);
    setVal('stKeysUnassigned', stats.bundle_keys_unassigned || 0);
}

function renderUsersTable(users) {
    const tbody = document.getElementById('usersTableBody');
    if(!tbody) return;
    tbody.innerHTML = '';
    users.forEach(u => {
        const tr = document.createElement('tr');
        const status = u.is_blocked ? '<span style="color:var(--error-red); font-weight:bold;">GESPERRT</span>' : '<span style="color:var(--success-green);">AKTIV</span>';
        const deviceIcon = u.allowed_device_id ? '📱' : '⚪';
        // Note: onclick uses global window functions now
        tr.innerHTML = `
            <td>#${u.id}</td>
            <td style="font-weight:bold; color:#fff;">${u.username}</td>
            <td>${status}</td>
            <td>${u.last_login ? new Date(u.last_login).toLocaleString('de-DE') : '-'}</td>
            <td style="text-align:center;">${deviceIcon}</td>
            <td>
                <div style="display:flex; gap:10px;">
                    <button class="btn-icon" onclick="resetDevice('${u.id}')" title="Reset Device" style="cursor:pointer; border:none; background:none; font-size:1.2rem;">📱</button>
                    <button class="btn-icon" onclick="toggleUserBlock('${u.id}', ${u.is_blocked})" title="Block" style="cursor:pointer; border:none; background:none; font-size:1.2rem;">${u.is_blocked ? '🔓' : '🛑'}</button>
                </div>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function renderBundlesTable(bundles) {
    const tbody = document.getElementById('bundlesTableBody');
    if(!tbody) return;
    tbody.innerHTML = '';
    bundles.forEach(b => {
        const tr = document.createElement('tr');
        // Calculate progress
        const active = b.active_count || 0;
        const total = b.total_keys || 0;
        const progress = Math.round((active/total)*100);

        tr.innerHTML = `
            <td style="font-weight:bold; color:var(--accent-blue);">${b.name || '-'}</td>
            <td style="font-family:'Roboto Mono'">${b.order_number}</td>
            <td>${total} Keys</td>
            <td>${active} (${progress}%)</td>
            <td>${new Date(b.created_at).toLocaleDateString('de-DE')}</td>
            <td>
                <button class="btn-icon" onclick="openBundleDetails(${b.id})" style="cursor:pointer; border:none; background:none; font-size:1.2rem;">📂</button>
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
        
        let expiry = '-';
        if (k.expires_at) {
            expiry = new Date(k.expires_at).toLocaleDateString('de-DE');
        } else if (k.is_active) {
            expiry = 'Lifetime';
        }
        const userIdDisplay = k.user_id ? `<span style="color:var(--accent-blue); font-weight:bold;">#${k.user_id}</span>` : '-';

        tr.innerHTML = `
            <td style="font-family:'Roboto Mono'">${k.key_code}</td>
            <td>${k.product_code || 'std'}</td>
            <td>${status}</td>
            <td>${userIdDisplay}</td>
            <td>${new Date(k.created_at).toLocaleDateString('de-DE')}</td>
            <td>${expiry}</td>
            <td>
                 <button class="btn-icon" onclick="openEditLicenseModal(${k.id})" style="cursor:pointer; border:none; background:none; font-size:1.2rem;">⚙️</button>
                 <button class="btn-icon" onclick="deleteKey('${k.id}')" style="cursor:pointer; border:none; background:none; font-size:1.2rem; color:var(--error-red);">🗑️</button>
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
// --- MAIL SERVICE ---
window.toggleRecipientInput = function() {
    const type = document.getElementById('msgRecipientType').value;
    document.getElementById('msgRecipientId').style.display = (type === 'single') ? 'block' : 'none';
};

window.toggleSubjectInput = function() {
    const val = document.getElementById('msgSubjectSelect').value;
    document.getElementById('msgSubjectCustom').style.display = (val === 'custom') ? 'block' : 'none';
};

window.sendAdminMessage = async function() {
    const btn = event.currentTarget;
    const oldText = btn.textContent;
    btn.textContent = "Sende..."; btn.disabled = true;

    const type = document.getElementById('msgRecipientType').value; // broadcast / single
    const recipientId = (type === 'single') ? document.getElementById('msgRecipientId').value.trim() : null;

    const subjSelect = document.getElementById('msgSubjectSelect').value;
    const subject = (subjSelect === 'custom') ? document.getElementById('msgSubjectCustom').value.trim() : subjSelect;

    const body = document.getElementById('msgBody').value.trim();
    const expiry = document.getElementById('msgExpiry').value;

    if (!subject || !body) {
        window.showMessage("Info", "Bitte Betreff und Nachricht eingeben.", true);
        btn.textContent = oldText; btn.disabled = false;
        return;
    }
    if (type === 'single' && !recipientId) {
        window.showMessage("Info", "Bitte User ID angeben.", true);
        btn.textContent = oldText; btn.disabled = false;
        return;
    }

    let msgType = 'general';
    if (subject.includes('Support')) msgType = 'support';
    if (type === 'single' && msgType === 'general') msgType = 'automated'; // Default for single

    // Payload
    const payload = {
        recipientId: recipientId, // null if broadcast
        subject: subject,
        body: body,
        type: msgType,
        expiresAt: expiry ? new Date(expiry).toISOString() : null
    };

    // Set default expiry for broadcasts if not set (7 days)
    if (!payload.recipientId && !payload.expiresAt) {
        const d = new Date(); d.setDate(d.getDate() + 7);
        payload.expiresAt = d.toISOString();
    }

    try {
        const res = await fetch(`${API_BASE}/send-message`, {
            method: 'POST',
            headers: getHeaders(),
            body: JSON.stringify(payload)
        });
        const data = await res.json();

        if (data.success) {
            window.showMessage("Erfolg", "Nachricht wurde versendet.");
            document.getElementById('msgBody').value = '';
            document.getElementById('msgRecipientId').value = '';
        } else {
            window.showMessage("Fehler", data.error || "Senden fehlgeschlagen", true);
        }
    } catch(e) { window.showMessage("Fehler", "Netzwerkfehler", true); }

    btn.textContent = oldText; btn.disabled = false;
};
