// admin.js - Admin Panel Logic (Fixed Filtering & Search & Button Actions)

console.log("🚀 ADMIN.JS GELADEN");

const API_BASE = '/api/admin';
let adminPassword = '';
let adminToken = ''; // Bearer Token

// Lokale Datenspeicher
let allUsers = [];
let allKeys = [];
let allPurchases = [];
let allBundles = [];
let allTickets = [];
let currentBundleId = null;

// New Data Store for Ticket Inbox
let inboxTickets = [];
let currentTicketId = null;

// Helper für Headers
function getHeaders() {
    const headers = { 'Content-Type': 'application/json' };
    if (adminToken) {
        headers['Authorization'] = `Bearer ${adminToken}`;
    } else {
        headers['x-admin-password'] = adminPassword;
    }
    return headers;
}

// --- TABS LOGIC ---
window.switchTab = function(tabName) {
    document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.nav-tab').forEach(el => el.classList.remove('active'));
    document.getElementById(`tab-${tabName}`).classList.add('active');
    document.querySelectorAll('.nav-tab').forEach(btn => {
        if(btn.getAttribute('onclick') && btn.getAttribute('onclick').includes(tabName)) {
            btn.classList.add('active');
        }
    });
    if(tabName === 'mail') window.loadSupportTickets();
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
    requestAnimationFrame(() => toast.classList.add('show'));
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 400);
    }, 4000);
}

// --- DATA LOADING ---

window.loadUsers = async function() {
    const btn = document.getElementById('refreshUsersBtn');
    if(btn) { btn.textContent = "⏳..."; btn.disabled = true; }
    try {
        const res = await fetch(`${API_BASE}/users`, { headers: getHeaders() });
        allUsers = await res.json();
        renderUsersTable(allUsers);
    } catch(e) { console.error("Load Users Failed", e); }
    if(btn) { btn.textContent = "Refresh"; btn.disabled = false; }
};

window.loadPurchases = async function() {
    const btn = document.getElementById('refreshPurchasesBtn');
    if(btn) { btn.textContent = "⏳..."; btn.disabled = true; }
    try {
        const res = await fetch(`${API_BASE}/purchases`, { headers: getHeaders() });
        allPurchases = await res.json();
        renderPurchasesTable(allPurchases);
    } catch(e) { console.error("Load Purchases Failed", e); }
    if(btn) { btn.textContent = "Refresh"; btn.disabled = false; }
};

window.loadSupportTickets = async function() {
    const btn = document.getElementById('refreshSupportBtn');
    if(btn) { btn.textContent = "⏳..."; btn.disabled = true; }
    try {
        const res = await fetch(`${API_BASE}/support-tickets`, { headers: getHeaders() });
        allTickets = await res.json();
        renderMailInbox(allTickets);
    } catch(e) { console.error("Load Tickets Failed", e); }
    if(btn) { btn.textContent = "Refresh"; btn.disabled = false; }
};

window.loadSystemStatus = async function() {
     try {
        const res = await fetch(`${API_BASE}/system-status`, { headers: getHeaders() });
        const data = await res.json();
        if(data.success) {
            const st = data.status;
            const elDb = document.getElementById('sysDbStatus');
            const elTime = document.getElementById('sysTime');
            const elUptime = document.getElementById('sysUptime');

            if(elDb) {
                elDb.textContent = st.dbConnection;
                elDb.style.color = st.dbConnection === 'OK' ? 'var(--success-green)' : 'red';
            }
            if(elTime) {
                const d = new Date(st.serverTime);
                elTime.textContent = d.toLocaleTimeString('de-DE');
            }
            if(elUptime) {
                const uptimeH = (st.uptime / 3600).toFixed(1);
                elUptime.textContent = `${uptimeH} h`;
            }
        }
    } catch(e) { console.error("Sys Status Failed", e); }
}

// --- LICENSE MANAGEMENT ---

window.loadKeys = async function() {
    try {
        const res = await fetch(`${API_BASE}/keys`, { headers: getHeaders() });
        allKeys = await res.json();
    } catch(e) { console.error("Load Keys Failed", e); }
};

window.loadBundles = async function() {
    try {
        const res = await fetch(`${API_BASE}/bundles`, { headers: getHeaders() });
        allBundles = await res.json();
    } catch(e) { console.error("Load Bundles Failed", e); }
};

window.refreshLicenses = async function() {
    const btn = document.getElementById('refreshAllLicensesBtn');
    if(btn) { btn.textContent = "⏳ Lade..."; btn.disabled = true; }

    await Promise.all([window.loadKeys(), window.loadBundles()]);

    // Trigger rendering for all sections with empty/current search terms
    filterAndRenderSingleKeys();
    filterAndRenderStandardBundles();
    filterAndRenderEnterpriseBundles();

    if(btn) { btn.textContent = "🔄 Alle Aktualisieren"; btn.disabled = false; }
};

// --- RENDERERS & FILTERS ---

// Section A: Single Keys (No Bundle ID)
function filterAndRenderSingleKeys() {
    const term = document.getElementById('searchKey')?.value.toLowerCase() || '';
    const filtered = allKeys.filter(k =>
        !k.bundle_id &&
        ((k.key_code && k.key_code.toLowerCase().includes(term)) ||
         (k.product_code && k.product_code.toLowerCase().includes(term)) ||
         (k.user_id && String(k.user_id).includes(term)))
    );
    renderSingleKeysTable(filtered);
}

function renderSingleKeysTable(keys) {
    const tbody = document.getElementById('singleKeysTableBody');
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
        if (k.expires_at) expiry = new Date(k.expires_at).toLocaleDateString('de-DE');
        else if (k.is_active) expiry = 'Lifetime';

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

// Section B: Standard Bundles (No ENT- prefix)
function filterAndRenderStandardBundles() {
    const term = document.getElementById('searchStandardBundle')?.value.toLowerCase() || '';
    const filtered = allBundles.filter(b =>
        (!b.order_number || !b.order_number.startsWith('ENT')) &&
        ((b.name && b.name.toLowerCase().includes(term)) ||
         (b.order_number && b.order_number.toLowerCase().includes(term)))
    );
    renderStandardBundlesTable(filtered);
}

function renderStandardBundlesTable(bundles) {
    const tbody = document.getElementById('standardBundlesTableBody');
    if(!tbody) return;
    tbody.innerHTML = '';
    bundles.forEach(b => {
        const tr = document.createElement('tr');
        const active = b.active_count || 0;
        const total = b.total_keys || 0;

        tr.innerHTML = `
            <td style="font-weight:bold; color:var(--accent-blue);">${b.name || '-'}</td>
            <td style="font-family:'Roboto Mono'">${b.order_number}</td>
            <td>${total} Keys</td>
            <td><span class="status-badge" style="color:${active>0?'var(--success-green)':'#888'}">${active > 0 ? 'Aktiv' : 'Inaktiv'}</span></td>
            <td>${new Date(b.created_at).toLocaleDateString('de-DE')}</td>
            <td>
                <div style="display:flex; gap:10px;">
                    <button class="btn-icon" onclick="openBundleDetails(${b.id}, false)" title="Details" style="cursor:pointer; border:none; background:none; font-size:1.2rem;">📂</button>
                    <button class="btn-icon" onclick="deleteBundle(${b.id})" title="Bundle Löschen" style="cursor:pointer; border:none; background:none; font-size:1.2rem; color:var(--error-red);">🗑️</button>
                </div>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

// Section C: Enterprise Bundles (ENT- prefix)
function filterAndRenderEnterpriseBundles() {
    const term = document.getElementById('searchEntBundle')?.value.toLowerCase() || '';
    const filtered = allBundles.filter(b =>
        (b.order_number && b.order_number.startsWith('ENT')) &&
        ((b.name && b.name.toLowerCase().includes(term)) ||
         (b.master_key && b.master_key.toLowerCase().includes(term)))
    );
    renderEnterpriseBundlesTable(filtered);
}

function renderEnterpriseBundlesTable(bundles) {
    const tbody = document.getElementById('enterpriseBundlesTableBody');
    if(!tbody) return;
    tbody.innerHTML = '';
    bundles.forEach(b => {
        const tr = document.createElement('tr');
        const masterKey = b.master_key || 'N/A';
        const userKeysCount = (b.total_keys || 0) - 1;

        tr.innerHTML = `
            <td style="font-weight:bold; color:gold;">${b.name || '-'}</td>
            <td style="font-family:'Roboto Mono'; color:#fff;">${masterKey}</td>
            <td>${userKeysCount} Slots</td>
            <td>
                <div style="display:flex; align-items:center; gap:10px;">
                    <button class="btn-icon" onclick="openBundleDetails(${b.id}, true)" title="Details" style="cursor:pointer; border:none; background:none; font-size:1.2rem;">📂</button>
                    <button class="btn-outline" style="padding:2px 8px; font-size:0.7rem;" onclick="copyBundleUserKeys(${b.id})">Kopieren</button>
                    <button class="btn-icon" onclick="deleteBundle(${b.id})" title="Enterprise Bundle Löschen" style="cursor:pointer; border:none; background:none; font-size:1.2rem; color:var(--error-red);">🗑️</button>
                </div>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

// --- ACTIONS ---

window.generateKeys = async function() {
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
            window.refreshLicenses();
            window.showMessage("Erfolg", "Keys generiert.");
        } else {
            window.showMessage("Fehler", data.error || 'Unbekannt', true);
        }
    } catch(e) { window.showMessage("Fehler", "Fehler beim Generieren.", true); }
}

window.generateBundle = async function() {
    const payload = {
        name: document.getElementById('bundleName').value,
        productCode: document.getElementById('bundleProduct').value,
        count: document.getElementById('bundleCount').value,
        idStem: document.getElementById('bundleIdStem').value,
        startNumber: document.getElementById('bundleStartNum').value
    };
    if(!payload.name || !payload.idStem) return window.showMessage("Info", "Bitte Name und ID-Stamm angeben.", true);

    try {
        const res = await fetch(`${API_BASE}/generate-bundle`, {
            method: 'POST', headers: getHeaders(), body: JSON.stringify(payload)
        });
        const data = await res.json();
        if(data.success) {
            window.showMessage("Erfolg", `Bundle #${data.bundleId} erstellt.`);
            window.refreshLicenses();
        } else {
            window.showMessage("Fehler", data.error || "Fehler", true);
        }
    } catch(e) { window.showMessage("Fehler", "Netzwerkfehler", true); }
};

window.generateEnterpriseBundle = async function() {
    const payload = {
        name: document.getElementById('entBundleName').value,
        userCount: document.getElementById('entUserCount').value
    };
    if(!payload.name) return window.showMessage("Info", "Bitte Firmen-Namen angeben.", true);

    try {
        const res = await fetch(`${API_BASE}/generate-enterprise-bundle`, {
            method: 'POST', headers: getHeaders(), body: JSON.stringify(payload)
        });
        const data = await res.json();
        if(data.success) {
            window.showMessage("Erfolg", `Enterprise Bundle erstellt.`);
            window.refreshLicenses();
        } else {
            window.showMessage("Fehler", data.error, true);
        }
    } catch(e) { window.showMessage("Fehler", "Netzwerkfehler", true); }
};

window.openBundleDetails = async function(id, isEnterprise) {
    currentBundleId = id;
    const modal = document.getElementById('bundleDetailsModal');
    const tbody = document.getElementById('bundleKeysBody');
    const thead = modal.querySelector('thead tr');
    const controls = document.getElementById('massExtendControls');

    // Hide mass extend for Enterprise
    if(controls) controls.style.display = isEnterprise ? 'none' : 'flex';
    document.getElementById('bundleModalTitle').textContent = isEnterprise ? "Enterprise Bundle Details" : "Bundle Details";

    // Privacy Mode for Enterprise: Adjust Table Headers
    if (isEnterprise) {
        thead.innerHTML = `
            <th>Role</th>
            <th>Key</th>
        `;
    } else {
        thead.innerHTML = `
            <th>Assigned ID</th>
            <th>Key</th>
            <th>Status</th>
            <th>Ablauf</th>
        `;
    }

    tbody.innerHTML = '<tr><td colspan="4">Lade...</td></tr>';
    modal.style.display = 'flex';

    try {
        const res = await fetch(`${API_BASE}/bundles/${id}/keys`, { headers: getHeaders() });
        const keys = await res.json();

        tbody.innerHTML = '';
        keys.forEach(k => {
            const tr = document.createElement('tr');

            if (isEnterprise) {
                // Enterprise View: Only Role/ID and Key
                // Identify Master by Assigned ID convention or product code if available (API returns basic fields)
                // We use assigned_user_id to guess.
                const isMaster = k.assigned_user_id && k.assigned_user_id.includes('_Admin');
                const roleStyle = isMaster ? 'color:gold; font-weight:bold;' : 'color:#fff;';

                tr.innerHTML = `
                    <td style="${roleStyle}">${k.assigned_user_id || 'User'}</td>
                    <td style="font-family:'Roboto Mono';">${k.key_code}</td>
                `;
            } else {
                // Standard View
                const expStr = k.expires_at ? new Date(k.expires_at).toLocaleDateString() : '-';
                const statusStyle = k.is_active ? 'color:var(--success-green);' : 'color: #888;';
                const statusText = k.is_active ? 'Aktiv' : 'Frei';

                tr.innerHTML = `
                    <td style="font-weight:bold; color:var(--accent-blue);">${k.assigned_user_id || '-'}</td>
                    <td style="font-family:'Roboto Mono';">${k.key_code}</td>
                    <td style="${statusStyle}">${statusText}</td>
                    <td>${expStr}</td>
                `;
            }
            tbody.appendChild(tr);
        });
    } catch(e) { tbody.innerHTML = '<tr><td colspan="4" style="color:red;">Fehler beim Laden.</td></tr>'; }
};

window.deleteBundle = function(id) {
    window.showConfirm("Warnung: Löschen entfernt das Bundle und ALLE Keys unwiderruflich!", async () => {
        try {
            const res = await fetch(`${API_BASE}/bundles/${id}`, { method: 'DELETE', headers: getHeaders() });
            if(res.ok) {
                window.refreshLicenses();
                window.showMessage("Gelöscht", "Bundle entfernt.");
            } else {
                window.showMessage("Fehler", "Löschen fehlgeschlagen", true);
            }
        } catch(e) { window.showMessage("Fehler", "Netzwerkfehler", true); }
    });
};

window.copyBundleUserKeys = async function(id) {
    try {
        const res = await fetch(`${API_BASE}/bundles/${id}/keys`, { headers: getHeaders() });
        const keys = await res.json();
        const userKeys = keys.filter(k => !k.assigned_user_id || !k.assigned_user_id.includes('_Admin')).map(k => k.key_code);

        if(userKeys.length > 0) {
            navigator.clipboard.writeText(userKeys.join('\n'));
            window.showToast(`${userKeys.length} User-Keys kopiert.`, 'success');
        } else {
            window.showToast("Keine User-Keys gefunden.", 'error');
        }
    } catch(e) { window.showToast("Fehler beim Laden.", 'error'); }
};

window.massExtendBundle = async function() {
    if(!currentBundleId) return;
    const dateStr = document.getElementById('massExtendParams').value;
    if(!dateStr) return alert("Bitte Datum wählen.");

    const newDate = new Date(dateStr);
    newDate.setHours(23, 59, 59);

    window.showConfirm(`Alle Keys verlängern bis ${newDate.toLocaleDateString()}?`, async () => {
        try {
            const res = await fetch(`${API_BASE}/bundles/${currentBundleId}/extend`, {
                method: 'PUT', headers: getHeaders(),
                body: JSON.stringify({ expires_at: newDate.toISOString() })
            });
            if(res.ok) {
                window.showMessage("Erfolg", "Erfolgreich verlängert.");
                window.openBundleDetails(currentBundleId, false);
            } else {
                window.showMessage("Fehler", "Fehler bei Verlängerung.", true);
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
        const link = document.createElement("a");
        link.href = encodeURI(csvContent);
        link.download = `bundle_${currentBundleId}_export.csv`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    } catch(e) { window.showMessage("Fehler", "Export fehlgeschlagen.", true); }
};

// --- SINGLE KEY ACTIONS ---

window.deleteKey = function(id) {
    window.showConfirm("Lizenz löschen?", async () => {
        try {
            const res = await fetch(`${API_BASE}/keys/${id}`, { method: 'DELETE', headers: getHeaders() });
            if(res.ok) {
                window.refreshLicenses();
                window.showMessage("Gelöscht", "Lizenz entfernt.");
            } else {
                window.showMessage("Fehler", "Fehler beim Löschen.", true);
            }
        } catch(e) { window.showMessage("Fehler", "Netzwerkfehler", true); }
    });
};

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
        document.getElementById('editExpiryTime').value = d.toTimeString().substring(0,5);
    } else {
        document.getElementById('editExpiryDate').value = '';
        document.getElementById('editExpiryTime').value = '';
    }
    document.getElementById('editLicenseModal').style.display = 'flex';
};

window.saveLicenseChanges = async function() {
    if(!currentEditingKeyId) return;
    const dateStr = document.getElementById('editExpiryDate').value;
    const timeStr = document.getElementById('editExpiryTime').value || '23:59';
    const userId = document.getElementById('editUserId').value.trim();
    let finalIsoString = null;
    if(dateStr) finalIsoString = new Date(`${dateStr}T${timeStr}:00`).toISOString();

    try {
        const res = await fetch(`${API_BASE}/keys/${currentEditingKeyId}`, {
            method: 'PUT', headers: getHeaders(),
            body: JSON.stringify({ expires_at: finalIsoString, user_id: userId ? parseInt(userId) : null })
        });
        if(res.ok) {
            document.getElementById('editLicenseModal').style.display = 'none';
            window.refreshLicenses();
            window.showMessage("Erfolg", "Gespeichert.");
        } else {
            window.showMessage("Fehler", "Speichern fehlgeschlagen.", true);
        }
    } catch(e) { window.showMessage("Fehler", "Serverfehler", true); }
};

// --- INITIALIZATION ---

function renderUsersTable(users) {
    const tbody = document.getElementById('usersTableBody');
    if(!tbody) return;
    tbody.innerHTML = '';
    users.forEach(u => {
        const tr = document.createElement('tr');
        const status = u.is_blocked ? '<span style="color:var(--error-red);">GESPERRT</span>' : '<span style="color:var(--success-green);">AKTIV</span>';
        const deviceIcon = u.allowed_device_id ? '📱' : '⚪';
        tr.innerHTML = `
            <td>#${u.id}</td>
            <td style="font-weight:bold; color:#fff;">${u.username}</td>
            <td>${status}</td>
            <td>${u.last_login ? new Date(u.last_login).toLocaleString('de-DE') : '-'}</td>
            <td style="text-align:center;">${deviceIcon}</td>
            <td>
                <div style="display:flex; gap:10px;">
                    <button class="btn-icon" onclick="resetDevice('${u.id}')" title="Reset Device">📱</button>
                    <button class="btn-icon" onclick="toggleUserBlock('${u.id}', ${u.is_blocked})" title="Block">${u.is_blocked ? '🔓' : '🛑'}</button>
                </div>
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

function renderMailInbox(tickets) {
    const container = document.getElementById('ticketListBody');
    if (!container) return;
    const openCount = tickets.filter(t => t.status !== 'closed').length;
    const badge = document.getElementById('mailServiceBadge');
    if(badge) {
        badge.textContent = `(${openCount})`;
        badge.style.display = openCount > 0 ? 'inline' : 'none';
    }
    if (tickets.length === 0) {
        container.innerHTML = '<div class="empty-state">Keine Tickets vorhanden.</div>';
        return;
    }
    container.innerHTML = '';
    tickets.sort((a,b) => {
        if (a.status === 'open' && b.status !== 'open') return -1;
        if (a.status !== 'open' && b.status === 'open') return 1;
        return new Date(b.created_at) - new Date(a.created_at);
    });
    tickets.forEach(t => {
        const item = document.createElement('div');
        item.className = 'mail-item';
        if (t.status === 'open') item.classList.add('unread');
        if (currentTicketId === t.id) item.classList.add('active');
        let statusText = 'OFFEN';
        if (t.status === 'in_progress') statusText = 'BEARBEITUNG';
        if (t.status === 'closed') statusText = 'ABGESCHLOSSEN';
        item.innerHTML = `
            <div class="mail-item-header"><span>${t.username || 'Gast'}</span><span>${new Date(t.created_at).toLocaleDateString()}</span></div>
            <div class="mail-item-subject">${t.ticket_id} | ${t.subject}</div>
            <div class="mail-item-status status-${t.status.replace('_','')}">${statusText}</div>
        `;
        item.onclick = () => selectTicket(t);
        container.appendChild(item);
    });
}

async function selectTicket(ticket) {
    currentTicketId = ticket.id;
    renderMailInbox(allTickets);
    const detailContainer = document.getElementById('ticketDetailContainer');
    if (ticket.status === 'open') {
        try {
             await fetch(`${API_BASE}/support-tickets/${ticket.id}/status`, { method: 'PUT', headers: getHeaders(), body: JSON.stringify({ status: 'in_progress' }) });
             ticket.status = 'in_progress';
             renderMailInbox(allTickets);
        } catch(e) {}
    }
    let template = "";
    try {
        const res = await fetch(`${API_BASE}/settings/ticket_reply_template`, { headers: getHeaders() });
        const data = await res.json();
        if(data.success && data.value) template = data.value;
    } catch(e) {}
    const replyBody = template.replace('{username}', ticket.username || 'Nutzer').replace('[TEXT]', '\n\n');
    detailContainer.innerHTML = `
        <div class="detail-header">
            <div class="detail-subject" style="display:flex; justify-content:space-between;">
                <div>${ticket.subject}</div>
                <div>
                     <button class="btn-icon" onclick="markTicketClosed(${ticket.id})" title="Abschließen">✅</button>
                     <button class="btn-icon" onclick="deleteTicket(${ticket.id})" title="Löschen" style="color:var(--error-red);">🗑️</button>
                </div>
            </div>
            <div class="detail-meta">Von: <strong>${ticket.username||'Gast'}</strong> (${ticket.email||'-'}) | ID: ${ticket.ticket_id}</div>
        </div>
        <div class="detail-body">${ticket.message}</div>
    `;
    if (ticket.username) {
        const replyDiv = document.createElement('div');
        replyDiv.className = 'reply-section';
        replyDiv.innerHTML = `
            <h4 style="color:#fff; margin-bottom:10px;">Antworten</h4>
            <textarea id="ticketReplyBody" class="reply-textarea">${replyBody}</textarea>
            <div style="text-align:right;"><button onclick="sendTicketReply(${ticket.id}, '${ticket.username}')" class="btn-action">Senden & Schließen</button></div>
        `;
        detailContainer.appendChild(replyDiv);
    }
}

window.sendTicketReply = async function(dbId, username) {
    const message = document.getElementById('ticketReplyBody').value;
    if(!message.trim()) return;
    try {
        const res = await fetch(`${API_BASE}/support-tickets/${dbId}/reply`, { method: 'POST', headers: getHeaders(), body: JSON.stringify({ message, username }) });
        const data = await res.json();
        if (data.success) {
            window.showToast("Antwort gesendet.", "success");
            window.loadSupportTickets();
            document.getElementById('ticketDetailContainer').innerHTML = '<div class="empty-state">Ticket geschlossen.</div>';
        } else { window.showToast("Fehler: " + data.error, "error"); }
    } catch(e) { window.showToast("Netzwerkfehler", "error"); }
};

window.markTicketClosed = async function(id) {
    try {
        const res = await fetch(`${API_BASE}/messages/${id}/status`, { method: 'PATCH', headers: getHeaders(), body: JSON.stringify({ status: 'closed' }) });
        if(res.ok) { window.loadSupportTickets(); window.showToast("Ticket abgeschlossen.", "success"); }
    } catch(e) {}
};

window.deleteTicket = function(id) {
    window.showConfirm("Ticket löschen?", async () => {
        try {
            const res = await fetch(`${API_BASE}/messages/${id}`, { method: 'DELETE', headers: getHeaders() });
            if(res.ok) { window.loadSupportTickets(); document.getElementById('ticketDetailContainer').innerHTML = ''; window.showMessage("Info", "Gelöscht."); }
        } catch(e) {}
    });
};

// --- STARTUP ---

async function initDashboard() {
    try {
        const res = await fetch(`${API_BASE}/stats`, { headers: getHeaders() });
        const data = await res.json();
        if(data.success) {
            if(adminToken) sessionStorage.setItem('sm_admin_token', adminToken);
            document.getElementById('login-view').style.display = 'none';
            document.getElementById('dashboard-view').style.display = 'block';

            const setVal = (id, val) => { const el = document.getElementById(id); if(el) el.textContent = val; };
            setVal('stUsersActive', data.stats.users_active);
            setVal('stKeysActive', data.stats.keys_active);
            setVal('stPurchases', data.stats.purchases_count);
            setVal('stRevenue', (data.stats.revenue_total / 100).toFixed(2) + ' €');
            setVal('stBundlesActive', data.stats.bundles_active || 0);
            setVal('stKeysUnassigned', data.stats.bundle_keys_unassigned || 0);

            // Load All Data
            window.loadUsers();
            window.loadPurchases();
            window.loadSupportTickets();
            window.refreshLicenses();
            window.loadSystemStatus(); // FIXED: Restore Sys Status

            window.switchTab('dashboard');
            window.check2FAStatus();
        } else {
             if(res.status === 403) {
                sessionStorage.removeItem('sm_admin_token');
                document.getElementById('login-view').style.display = 'flex';
             }
        }
    } catch(e) {}
}

async function performLogin(password) {
    try {
        const res = await fetch(`${API_BASE}/auth`, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ password }) });
        const data = await res.json();
        if(data.success) {
            adminToken = data.token;
            initDashboard();
        } else { window.showMessage("Fehler", "Login fehlgeschlagen", true); }
    } catch(e) { window.showMessage("Fehler", "Netzwerkfehler", true); }
}

window.check2FAStatus = async function() {
    try {
        const res = await fetch(`${API_BASE}/settings/admin_2fa_enabled`, { headers: getHeaders() });
        const data = await res.json();
        if (data.value === 'true') {
            document.getElementById('2faStartArea').style.display = 'none';
            document.getElementById('2faStatusArea').style.display = 'block';
        } else {
            document.getElementById('2faStartArea').style.display = 'block';
            document.getElementById('2faStatusArea').style.display = 'none';
        }
    } catch(e) {}
};

window.start2FASetup = async function() {
    try {
        const res = await fetch(`${API_BASE}/2fa-setup`, { headers: getHeaders() });
        const data = await res.json();
        if(data.success) {
            document.getElementById('2faStartArea').style.display = 'none';
            document.getElementById('2faSetupArea').style.display = 'block';
            document.getElementById('2faQrDisplay').innerHTML = `<img src="${data.qrCode}" style="width:200px;">`;
            window.pending2FASecret = data.secret;
        }
    } catch(e) {}
};

window.confirm2FASetup = async function() {
    const code = document.getElementById('verify2faInput').value;
    try {
        const res = await fetch(`${API_BASE}/2fa/verify`, { method: 'POST', headers: getHeaders(), body: JSON.stringify({ token: code, secret: window.pending2FASecret }) });
        const data = await res.json();
        if(data.success) { window.showToast("2FA Aktiviert", "success"); window.check2FAStatus(); document.getElementById('2faSetupArea').style.display='none'; }
        else { window.showToast("Code ungültig", "error"); }
    } catch(e) {}
};

window.disable2FA = function() {
    window.showConfirm("2FA deaktivieren?", async () => {
        await fetch(`${API_BASE}/2fa/disable`, { method: 'POST', headers: getHeaders() });
        window.check2FAStatus();
    });
};

document.addEventListener('DOMContentLoaded', () => {
    const storedToken = sessionStorage.getItem('sm_admin_token');
    if(storedToken) { adminToken = storedToken; initDashboard(); }

    document.getElementById('adminLoginForm')?.addEventListener('submit', (e) => {
        e.preventDefault();
        performLogin(document.getElementById('adminPasswordInput').value);
    });

    // Search Listeners
    document.getElementById('searchUser')?.addEventListener('input', (e) => {
        const term = e.target.value.toLowerCase();
        renderUsersTable(allUsers.filter(u => u.username?.toLowerCase().includes(term) || String(u.id).includes(term)));
    });
    document.getElementById('searchKey')?.addEventListener('input', () => filterAndRenderSingleKeys());

    document.getElementById('searchStandardBundle')?.addEventListener('input', () => filterAndRenderStandardBundles());
    document.getElementById('searchEntBundle')?.addEventListener('input', () => filterAndRenderEnterpriseBundles());

    document.getElementById('searchPurchase')?.addEventListener('input', (e) => {
        const term = e.target.value.toLowerCase();
        renderPurchasesTable(allPurchases.filter(p => p.email?.toLowerCase().includes(term) || p.product?.toLowerCase().includes(term)));
    });

    // FIXED: Restore Missing Button Event Listeners
    document.getElementById('maintenanceToggle')?.addEventListener('change', window.toggleMaintenance);
    document.getElementById('shopToggle')?.addEventListener('change', window.toggleShop);

    document.getElementById('generateBtn')?.addEventListener('click', window.generateKeys);
    document.getElementById('saveLicenseBtn')?.addEventListener('click', window.saveLicenseChanges);
    document.getElementById('cancelLicenseBtn')?.addEventListener('click', () => {
        document.getElementById('editLicenseModal').style.display = 'none';
    });

    document.getElementById('refreshUsersBtn')?.addEventListener('click', window.loadUsers);
    document.getElementById('refreshAllLicensesBtn')?.addEventListener('click', window.refreshLicenses);
    document.getElementById('refreshPurchasesBtn')?.addEventListener('click', window.loadPurchases);
    document.getElementById('refreshSupportBtn')?.addEventListener('click', window.loadSupportTickets);

    document.getElementById('generateBundleBtn')?.addEventListener('click', window.generateBundle);
    document.getElementById('generateEntBundleBtn')?.addEventListener('click', window.generateEnterpriseBundle);
    document.getElementById('closeBundleModalBtn')?.addEventListener('click', () => document.getElementById('bundleDetailsModal').style.display='none');
    document.getElementById('massExtendBtn')?.addEventListener('click', window.massExtendBundle);
    document.getElementById('exportBundleBtn')?.addEventListener('click', window.exportBundleCsv);

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
});
