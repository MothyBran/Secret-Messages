// admin.js - Admin Panel Logic (Complete & Fixed)

console.log("🚀 ADMIN.JS GELADEN");

const API_BASE = '/api/admin';
const ENT_API_BASE = '/api/enterprise'; // Enterprise endpoint

let adminPassword = '';
let adminToken = ''; // Bearer Token

// Lokale Datenspeicher
let allUsers = [];
let allKeys = [];
let allPurchases = [];
let allBundles = [];
let allTickets = [];
let allEnterpriseKeys = [];
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

    const btns = document.querySelectorAll('.nav-tab');
    btns.forEach(btn => {
        if(btn.getAttribute('onclick') && btn.getAttribute('onclick').includes(tabName)) {
            btn.classList.add('active');
        }
    });

    if(tabName === 'mail') {
        window.loadSupportTickets();
    }
    if(tabName === 'stats') {
        window.loadStatistics();
    }
}


// --- HELPERS (MODALS & FEEDBACK) ---
let confirmCallback = null;

window.showConfirm = function(message, onConfirm, checkboxOptions = null) {
    document.getElementById('confirmMessage').textContent = message;

    // Checkbox Logic
    const cbArea = document.getElementById('confirmCheckboxArea');
    const cb = document.getElementById('confirmCascadeCheckbox');
    const cbLabel = document.getElementById('confirmCheckboxLabel');

    if (checkboxOptions) {
        cbArea.style.display = 'flex';
        cbLabel.textContent = checkboxOptions.label || 'Verknüpfte Daten ebenfalls löschen';
        cb.checked = false; // Default: unchecked (Safety)
    } else {
        cbArea.style.display = 'none';
        cb.checked = false;
    }

    document.getElementById('confirmModal').style.display = 'flex';

    confirmCallback = () => {
        // Pass checkbox state to callback if options provided
        onConfirm(checkboxOptions ? cb.checked : false);
    };
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
        setTimeout(() => toast.remove(), 400);
    }, 4000);
}

// Global functions
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

window.loadKeys = async function(silent = false) {
    try {
        const res = await fetch(`${API_BASE}/keys`, { headers: getHeaders() });
        allKeys = await res.json();
        filterKeys();
    } catch(e) { console.error("Load Keys Failed", e); }
};

window.loadBundles = async function(silent = false) {
    try {
        const res = await fetch(`${API_BASE}/bundles`, { headers: getHeaders() });
        allBundles = await res.json();
        filterBundles();
    } catch(e) { console.error("Load Bundles Failed", e); }
};

window.loadEnterpriseKeys = async function(silent = false) {
    try {
        const res = await fetch(`${API_BASE}/enterprise-keys`, { headers: getHeaders() });
        allEnterpriseKeys = await res.json();
        filterEnterpriseKeys();
    } catch(e) { console.error("Load Ent Keys Failed", e); }
};

window.globalRefreshLicenses = async function() {
    const btn = document.getElementById('globalRefreshLicensesBtn');
    if(btn) { btn.textContent = "⏳ Lade..."; btn.disabled = true; }

    try {
        await Promise.all([
            window.loadKeys(true),
            window.loadBundles(true),
            window.loadEnterpriseKeys(true)
        ]);
    } catch(e) { console.error("Global Refresh Failed", e); }

    if(btn) { btn.textContent = "↻ GLOBAL REFRESH"; btn.disabled = false; }
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
        if(typeof window.renderSupportTickets === 'function') {
             renderSupportTickets(allTickets);
        }
        renderMailInbox(allTickets);
    } catch(e) { console.error("Load Tickets Failed", e); }
    if(btn) { btn.textContent = "Refresh"; btn.disabled = false; }
};

// FIX: Add this wrapper function to prevent ReferenceErrors in older HTML bindings
window.renderSupportTickets = function(tickets) {
    renderMailInbox(tickets);
};

// --- ENTERPRISE LOGIC ---

window.generateEnterpriseKey = async function() {
    const client = document.getElementById('entClientName').value;
    const quota = document.getElementById('entQuota').value;
    const expiry = document.getElementById('entExpiry').value;

    if(!client || !quota) return window.showToast("Bitte Kunde und Quota angeben.", "error");

    const btn = document.getElementById('generateEnterpriseBtn');
    btn.disabled = true;

    try {
        const res = await fetch(`${API_BASE}/generate-enterprise`, {
            method: 'POST', headers: getHeaders(),
            body: JSON.stringify({ clientName: client, quota, expiresAt: expiry || null })
        });
        const data = await res.json();

        if(data.success) {
            window.showToast("Enterprise Key generiert!", "success");
            const area = document.getElementById('newEntKeyArea');
            area.style.display = 'block';
            area.textContent = `KEY: ${data.key}\nClient: ${client}\nQuota: ${quota}`;
            window.loadEnterpriseKeys();
        } else {
            window.showToast("Fehler: " + data.error, "error");
        }
    } catch(e) { window.showToast("Netzwerkfehler", "error"); }
    btn.disabled = false;
};

window.deleteEnterpriseKey = function(id) {
    window.showConfirm("Master Key unwiderruflich löschen? Alle verknüpften User werden getrennt.", async () => {
        try {
            const res = await fetch(`${API_BASE}/enterprise-keys/${id}`, { method: 'DELETE', headers: getHeaders() });
            if(res.ok) {
                window.showToast("Gelöscht.", "success");
                window.loadEnterpriseKeys();
            } else {
                window.showToast("Fehler beim Löschen.", "error");
            }
        } catch(e) { window.showToast("Netzwerkfehler", "error"); }
    });
};

window.deleteBundle = function(id) {
    window.showConfirm("Bundle wirklich unwiderruflich löschen?", async () => {
        try {
            const res = await fetch(`${API_BASE}/bundles/${id}`, { method: 'DELETE', headers: getHeaders() });
            if(res.ok) {
                window.showToast("Bundle gelöscht.", "success");
                window.loadBundles();
            } else {
                window.showToast("Fehler beim Löschen.", "error");
            }
        } catch(e) { window.showToast("Netzwerkfehler", "error"); }
    });
};

window.editQuota = function(id, current) {
    const newVal = prompt("Neues Quota (Max User):", current);
    if(newVal && !isNaN(newVal)) {
        updateEnterpriseQuota(id, newVal);
    }
};

async function updateEnterpriseQuota(id, quota) {
    try {
        const res = await fetch(`${API_BASE}/enterprise-keys/${id}/quota`, {
            method: 'PUT', headers: getHeaders(),
            body: JSON.stringify({ quota: parseInt(quota) })
        });
        if(res.ok) {
            window.showToast("Quota aktualisiert.", "success");
            window.loadEnterpriseKeys();
        }
    } catch(e) { window.showToast("Fehler", "error"); }
}

window.toggleEnterpriseBlock = function(id, isBlocked) {
    window.showConfirm(`Master-Key ${isBlocked ? 'entsperren' : 'sperren'}?`, async () => {
        try {
            const res = await fetch(`${API_BASE}/enterprise-keys/${id}/toggle-block`, {
                method: 'POST', headers: getHeaders(),
                body: JSON.stringify({ blocked: !isBlocked })
            });
            if(res.ok) {
                window.showToast(isBlocked ? "Entsperrt." : "Gesperrt.", "success");
                window.loadEnterpriseKeys();
            } else {
                window.showToast("Fehler beim Ändern des Status.", "error");
            }
        } catch(e) { window.showToast("Netzwerkfehler", "error"); }
    });
};

// --- RENDERING & FILTERING ---

function filterKeys() {
    const q = document.getElementById('searchKey').value.toLowerCase();
    const filtered = allKeys.filter(k =>
        k.key_code.toLowerCase().includes(q) ||
        (k.user_id && String(k.user_id).includes(q))
    );
    renderKeysTable(filtered);
}

function filterBundles() {
    const q = document.getElementById('searchBundle').value.toLowerCase();
    const filtered = allBundles.filter(b =>
        (b.name && b.name.toLowerCase().includes(q)) ||
        b.order_number.toLowerCase().includes(q)
    );
    renderBundlesTable(filtered);
}

function filterEnterpriseKeys() {
    const q = document.getElementById('searchEnterprise').value.toLowerCase();
    const filtered = allEnterpriseKeys.filter(k =>
        k.key_code.toLowerCase().includes(q) ||
        (k.client_name && k.client_name.toLowerCase().includes(q))
    );
    renderEnterpriseTable(filtered);
}


// ... (Mail Service and other existing functions kept same)
window.closeTicket = function(id) {
    window.deleteTicket(id);
};

window.deleteTicket = function(id) {
    window.showConfirm("Möchten Sie dieses Ticket unwiderruflich löschen?", async () => {
        try {
            const res = await fetch(`${API_BASE}/messages/${id}`, { method: 'DELETE', headers: getHeaders() });
            if(res.ok) {
                window.loadSupportTickets();
                window.showMessage("Info", "Ticket gelöscht.");
                document.getElementById('ticketDetailContainer').innerHTML = '<div class="empty-state">Ticket gelöscht.</div>';
                currentTicketId = null;
            } else {
                window.showMessage("Fehler", "Konnte Ticket nicht löschen.", true);
            }
        } catch(e) { window.showMessage("Fehler", "Verbindungsfehler.", true); }
    });
};

window.markTicketClosed = async function(id) {
    try {
        const res = await fetch(`${API_BASE}/messages/${id}/status`, {
            method: 'PATCH',
            headers: getHeaders(),
            body: JSON.stringify({ status: 'closed' })
        });
        if(res.ok) {
            window.loadSupportTickets();
            window.showToast("Ticket manuell abgeschlossen.", "success");
        } else {
            window.showToast("Fehler beim Abschließen.", "error");
        }
    } catch(e) { window.showToast("Netzwerkfehler", "error"); }
};

// =========================================================
// MAIL SERVICE INBOX LOGIC
// =========================================================

window.showMailView = function(viewName) {
    document.getElementById('btnMailInbox').classList.remove('active');
    document.getElementById('btnMailCompose').classList.remove('active');
    document.getElementById('btnMailSettings').classList.remove('active');

    document.getElementById('view-mail-inbox').style.display = 'none';
    document.getElementById('view-mail-compose').style.display = 'none';
    document.getElementById('view-mail-settings').style.display = 'none';

    document.getElementById(`btnMail${viewName.charAt(0).toUpperCase() + viewName.slice(1)}`).classList.add('active');
    document.getElementById(`view-mail-${viewName}`).style.display = (viewName === 'inbox') ? 'flex' : 'block';

    if (viewName === 'inbox') window.loadSupportTickets();
    if (viewName === 'settings') window.loadMailTemplate();
};

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

        let statusClass = 'status-open';
        let statusText = 'OFFEN';
        if (t.status === 'in_progress') { statusClass = 'status-progress'; statusText = 'IN BEARBEITUNG'; }
        if (t.status === 'closed') { statusClass = 'status-closed'; statusText = 'ABGESCHLOSSEN'; }

        item.innerHTML = `
            <div class="mail-item-header">
                <span>${t.username || 'Gast'}</span>
                <span>${new Date(t.created_at).toLocaleDateString()}</span>
            </div>
            <div class="mail-item-subject">${t.ticket_id} | ${t.subject}</div>
            <div class="mail-item-status ${statusClass}">${statusText}</div>
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
             await fetch(`${API_BASE}/support-tickets/${ticket.id}/status`, {
                method: 'PUT',
                headers: getHeaders(),
                body: JSON.stringify({ status: 'in_progress' })
            });
            ticket.status = 'in_progress';
            renderMailInbox(allTickets);
        } catch(e) { console.error("Status update failed", e); }
    }

    let template = "";
    try {
        const res = await fetch(`${API_BASE}/settings/ticket_reply_template`, { headers: getHeaders() });
        const data = await res.json();
        if(data.success && data.value) template = data.value;
    } catch(e) {}

    const replyBody = template.replace('{username}', ticket.username || 'Nutzer').replace('[TEXT]', '\n\n');

    let statusClass = 'status-open';
    if (ticket.status === 'in_progress') statusClass = 'status-progress';
    if (ticket.status === 'closed') statusClass = 'status-closed';

    detailContainer.innerHTML = `
        <div class="detail-header">
            <div class="detail-subject" style="display:flex; justify-content:space-between; align-items:center;">
                <div>
                    ${ticket.subject}
                    <span class="status-badge ${statusClass}" style="margin-left:10px; font-size:0.6em; vertical-align:middle;">${ticket.status}</span>
                </div>
                <div style="display:flex; gap:10px;">
                     <button class="btn-icon" title="Als abgeschlossen markieren" style="background:none; border:none; cursor:pointer; font-size:1.5rem; color:var(--success-green);" onclick="markTicketClosed(${ticket.id})">✅</button>
                     <button class="btn-icon" title="Löschen" style="background:none; border:none; cursor:pointer; font-size:1.5rem; color:var(--error-red);" onclick="deleteTicket(${ticket.id})">🗑️</button>
                </div>
            </div>
            <div class="detail-meta">
                <span>Von: <strong style="color:#fff;">${ticket.username || 'Gast'}</strong> (${ticket.email || 'Keine Mail'})</span>
                <span>ID: ${ticket.ticket_id}</span>
                <span>${new Date(ticket.created_at).toLocaleString()}</span>
            </div>
        </div>

        <div class="detail-body">
            ${ticket.message}
        </div>
    `;

    if (ticket.username) {
        const replyDiv = document.createElement('div');
        replyDiv.className = 'reply-section';
        replyDiv.innerHTML = `
            <h4 style="color:#fff; margin-bottom:10px;">Antworten</h4>
            <textarea id="ticketReplyBody" class="reply-textarea">${replyBody}</textarea>
            <div style="text-align:right;">
                <button onclick="sendTicketReply(${ticket.id}, '${ticket.username}')" class="btn-action">Senden & Schließen</button>
            </div>
        `;
        detailContainer.appendChild(replyDiv);
    } else {
        const info = document.createElement('div');
        info.className = 'reply-section';
        info.innerHTML = `<p style="color:#888;">Antwort nur per E-Mail möglich (${ticket.email || 'Keine Email'}). <br>Gast-Tickets können nicht über das System beantwortet werden.</p>`;
        detailContainer.appendChild(info);
    }
}

window.sendTicketReply = async function(dbId, username) {
    const btn = event.target;
    const oldText = btn.textContent;
    btn.textContent = "Sende..."; btn.disabled = true;

    const message = document.getElementById('ticketReplyBody').value;
    if(!message.trim()) {
        window.showToast("Bitte Nachricht eingeben.", "error");
        btn.textContent = oldText; btn.disabled = false;
        return;
    }

    try {
        const res = await fetch(`${API_BASE}/support-tickets/${dbId}/reply`, {
            method: 'POST',
            headers: getHeaders(),
            body: JSON.stringify({ message, username })
        });
        const data = await res.json();

        if (data.success) {
            window.showToast("Antwort gesendet. Ticket geschlossen.", "success");
            window.loadSupportTickets();
            document.getElementById('ticketDetailContainer').innerHTML = '<div class="empty-state">Ticket geschlossen.</div>';
            currentTicketId = null;
        } else {
            window.showToast("Fehler: " + data.error, "error");
        }
    } catch(e) { window.showToast("Netzwerkfehler", "error"); }

    btn.textContent = oldText; btn.disabled = false;
};

window.loadMailTemplate = async function() {
    try {
        const res = await fetch(`${API_BASE}/settings/ticket_reply_template`, { headers: getHeaders() });
        const data = await res.json();
        if(data.success && data.value) {
            document.getElementById('templateEditor').value = data.value;
        } else {
            document.getElementById('templateEditor').value = "Hallo {username},\n\n[TEXT]\n\nMit freundlichen Grüßen,\nIhr Support-Team";
        }
    } catch(e) {}
};

window.saveMailTemplate = async function() {
    const val = document.getElementById('templateEditor').value;
    try {
        await fetch(`${API_BASE}/settings`, {
            method: 'POST', headers: getHeaders(),
            body: JSON.stringify({ key: 'ticket_reply_template', value: val })
        });
        window.showToast("Vorlage gespeichert.", "success");
    } catch(e) { window.showToast("Fehler beim Speichern.", "error"); }
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
    newDate.setHours(23, 59, 59);

    window.showConfirm(`Alle Keys dieses Bundles bis ${newDate.toLocaleDateString()} verlängern?`, async () => {
        try {
            const res = await fetch(`${API_BASE}/bundles/${currentBundleId}/extend`, {
                method: 'PUT',
                headers: getHeaders(),
                body: JSON.stringify({ expires_at: newDate.toISOString() })
            });
            if(res.ok) {
                window.showMessage("Erfolg", "Erfolgreich verlängert.");
                window.openBundleDetails(currentBundleId);
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
    window.showConfirm(`Gerätebindung für User #${id} löschen?`, async () => {
        await fetch(`${API_BASE}/reset-device/${id}`, { method: 'POST', headers: getHeaders() });
        window.loadUsers();
        window.showMessage("Erfolg", "Gerät zurückgesetzt.");
    });
};

window.toggleUserBlock = function(id, isBlocked) {
    window.showConfirm(`Benutzer ${isBlocked ? 'entsperren' : 'sperren'}?`, async () => {
        const endpoint = isBlocked ? 'unblock-user' : 'block-user';
        await fetch(`${API_BASE}/${endpoint}/${id}`, { method: 'POST', headers: getHeaders() });
        window.loadUsers();
        window.showMessage("Info", `Benutzer ${isBlocked ? 'entsperrt' : 'gesperrt'}.`);
    });
};

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

window.deleteKey = function(id, keyCode, hasUser) {
    const msg = `Möchten Sie die Lizenz '${keyCode}' wirklich löschen?`;
    let options = null;

    if (hasUser) {
        options = { label: 'Zugehöriges Benutzerkonto ebenfalls löschen' };
    }

    window.showConfirm(msg, async (cascade) => {
        const url = `${API_BASE}/keys/${id}` + (cascade ? '?cascade=true' : '');
        try {
            const res = await fetch(url, { method: 'DELETE', headers: getHeaders() });
            if(res.ok) {
                window.loadKeys();
                window.loadUsers(); // Refresh users in case one was deleted
                window.showToast(cascade ? "Lizenz & User gelöscht." : "Lizenz gelöscht.", "success");
            } else {
                window.showToast("Fehler beim Löschen.", "error");
            }
        } catch(e) { window.showToast("Netzwerkfehler.", "error"); }
    }, options);
};

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
            if(adminToken) sessionStorage.setItem('sm_admin_token', adminToken);
            if(adminPassword) sessionStorage.setItem('sm_admin_pw', adminPassword);

            document.getElementById('login-view').style.display = 'none';
            document.getElementById('dashboard-view').style.display = 'block';

            renderStats(data.stats);
            window.loadMaintenanceStatus();
            window.loadShopStatus();
            window.loadUsers();
            window.globalRefreshLicenses(); // Loads Keys, Bundles, Enterprise
            window.loadPurchases();
            window.loadSupportTickets();
            loadSystemStatus();
            window.switchTab('dashboard');
            window.check2FAStatus();

        } else {
            if(res.status === 403) {
                sessionStorage.removeItem('sm_admin_token');
                sessionStorage.removeItem('sm_admin_pw');
                document.getElementById('login-view').style.display = 'flex';
                if(document.getElementById('adminPasswordInput').value) {
                     window.showMessage("Fehler", "Zugriff verweigert (Token/Passwort ungültig).", true);
                }
            } else {
                 window.showMessage("Fehler", "Verbindungsfehler.", true);
            }
        }
    } catch(e) { console.error(e); window.showMessage("Fehler", "Server nicht erreichbar.", true); }
}

async function performLogin(password, token2fa) {
    try {
        const headers = { 'Content-Type': 'application/json' };
        if (token2fa) {
            headers['x-admin-2fa-token'] = token2fa;
        }

        const res = await fetch(`${API_BASE}/auth`, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify({ password: password })
        });
        const data = await res.json();

        if(data.success) {
            if(data.token) {
                adminToken = data.token;
            }
            adminPassword = password;
            initDashboard();
        } else {
            window.showMessage("Login Fehler", data.error || "Unbekannter Fehler", true);
        }
    } catch(e) {
        window.showMessage("Login Fehler", "Verbindung fehlgeschlagen", true);
    }
}

// 2FA LOGIC
window.check2FAStatus = async function() {
    try {
        const res = await fetch(`${API_BASE}/settings/admin_2fa_enabled`, { headers: getHeaders() });
        const data = await res.json();
        const enabled = (data.value === 'true');

        if (enabled) {
            document.getElementById('2faStartArea').style.display = 'none';
            document.getElementById('2faSetupArea').style.display = 'none';
            document.getElementById('2faStatusArea').style.display = 'block';
        } else {
            document.getElementById('2faStartArea').style.display = 'block';
            document.getElementById('2faSetupArea').style.display = 'none';
            document.getElementById('2faStatusArea').style.display = 'none';
        }
    } catch(e) {}
};

window.start2FASetup = async function() {
    try {
        const res = await fetch(`${API_BASE}/settings/admin_2fa_enabled`, { headers: getHeaders() });
        const sData = await res.json();
        if(sData.value === 'true') {
            window.showMessage("Info", "2FA ist bereits aktiv.");
            window.check2FAStatus();
            return;
        }

        const setupRes = await fetch(`${API_BASE}/2fa-setup`, { method: 'GET', headers: getHeaders() });
        const data = await setupRes.json();

        if(data.success) {
            document.getElementById('2faStartArea').style.display = 'none';
            document.getElementById('2faSetupArea').style.display = 'block';
            document.getElementById('2faStatusArea').style.display = 'none';
            const qrContainer = document.getElementById('2faQrDisplay');
            qrContainer.innerHTML = `<img src="${data.qrCode}" style="width:200px; height:200px;">`;
            window.pending2FASecret = data.secret;
        } else {
            window.showMessage("Fehler", data.error || "Setup fehlgeschlagen", true);
        }
    } catch(e) { window.showMessage("Fehler", "Netzwerkfehler", true); }
};

window.confirm2FASetup = async function() {
    const code = document.getElementById('verify2faInput').value;
    if(!code || code.length !== 6) return window.showToast("Bitte 6-stelligen Code eingeben", "error");

    try {
        const res = await fetch(`${API_BASE}/2fa/verify`, {
            method: 'POST',
            headers: getHeaders(),
            body: JSON.stringify({ token: code, secret: window.pending2FASecret })
        });
        const data = await res.json();

        if(data.success) {
            window.showToast("2FA erfolgreich aktiviert!", "success");
            window.check2FAStatus();
        } else {
            window.showToast("Code ungültig.", "error");
        }
    } catch(e) { window.showToast("Verbindungsfehler", "error"); }
};

window.disable2FA = function() {
    window.showConfirm("2FA wirklich deaktivieren?", async () => {
        try {
            const res = await fetch(`${API_BASE}/2fa/disable`, { method: 'POST', headers: getHeaders() });
            if(res.ok) {
                window.showToast("2FA deaktiviert.", "info");
                window.check2FAStatus();
            } else {
                window.showToast("Fehler beim Deaktivieren.", "error");
            }
        } catch(e) { window.showToast("Fehler", "error"); }
    });
};

document.addEventListener('DOMContentLoaded', () => {
    const storedToken = sessionStorage.getItem('sm_admin_token');
    const storedPw = sessionStorage.getItem('sm_admin_pw');

    if(storedToken) {
        adminToken = storedToken;
        if(storedPw) adminPassword = storedPw;
        initDashboard();
    } else if(storedPw) {
        adminPassword = storedPw;
        initDashboard();
    }

    document.getElementById('adminLoginForm')?.addEventListener('submit', (e) => {
        e.preventDefault();
        const pw = document.getElementById('adminPasswordInput').value;
        const t2fa = document.getElementById('admin2faInput').value;
        performLogin(pw, t2fa);
    });

    document.getElementById('logoutBtn')?.addEventListener('click', () => {
        sessionStorage.removeItem('sm_admin_pw');
        sessionStorage.removeItem('sm_admin_token');
        location.reload();
    });

    document.getElementById('maintenanceToggle')?.addEventListener('change', window.toggleMaintenance);
    document.getElementById('shopToggle')?.addEventListener('change', window.toggleShop);

    document.getElementById('generateBtn')?.addEventListener('click', window.generateKeys);
    document.getElementById('saveLicenseBtn')?.addEventListener('click', window.saveLicenseChanges);
    document.getElementById('cancelLicenseBtn')?.addEventListener('click', () => {
        document.getElementById('editLicenseModal').style.display = 'none';
    });

    // NEW: Close User Licenses Modal
    document.getElementById('closeUserLicensesBtn')?.addEventListener('click', () => {
        document.getElementById('userLicensesModal').style.display = 'none';
    });

    document.getElementById('refreshUsersBtn')?.addEventListener('click', window.loadUsers);
    document.getElementById('globalRefreshLicensesBtn')?.addEventListener('click', window.globalRefreshLicenses);
    document.getElementById('refreshPurchasesBtn')?.addEventListener('click', window.loadPurchases);
    document.getElementById('refreshBundlesBtn')?.addEventListener('click', window.loadBundles);
    document.getElementById('refreshSupportBtn')?.addEventListener('click', window.loadSupportTickets);
    document.getElementById('generateBundleBtn')?.addEventListener('click', window.generateBundle);
    document.getElementById('closeBundleModalBtn')?.addEventListener('click', () => document.getElementById('bundleDetailsModal').style.display='none');
    document.getElementById('massExtendBtn')?.addEventListener('click', window.massExtendBundle);
    document.getElementById('exportBundleBtn')?.addEventListener('click', window.exportBundleCsv);

    document.getElementById('generateEnterpriseBtn')?.addEventListener('click', window.generateEnterpriseKey);
    document.getElementById('searchKey')?.addEventListener('input', window.filterKeys);
    document.getElementById('searchBundle')?.addEventListener('input', window.filterBundles);
    document.getElementById('searchEnterprise')?.addEventListener('input', window.filterEnterpriseKeys);

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

    setupInfoTooltips();
});

// NEW: Open User Licenses Modal
window.openUserLicensesModal = async function(userId) {
    const modal = document.getElementById('userLicensesModal');
    const tbody = document.getElementById('userLicensesBody');
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;">Lade...</td></tr>';
    modal.style.display = 'flex';

    try {
        const res = await fetch(`${API_BASE}/users/${userId}/licenses`, { headers: getHeaders() });
        const keys = await res.json();

        tbody.innerHTML = '';
        if (keys.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;">Keine Lizenzen gefunden.</td></tr>';
            return;
        }

        keys.forEach(k => {
            const tr = document.createElement('tr');
            let status = '<span style="color:#888;">Inaktiv</span>';
            const now = new Date();
            const exp = k.expires_at ? new Date(k.expires_at) : null;

            if (exp && exp < now) status = '<span style="color:var(--error-red);">Abgelaufen</span>';
            else if (k.is_active) status = '<span style="color:var(--success-green);">Aktiv</span>';

            let expiry = k.expires_at ? new Date(k.expires_at).toLocaleDateString('de-DE') : 'Lifetime';
            let activated = k.activated_at ? new Date(k.activated_at).toLocaleDateString('de-DE') : '-';

            tr.innerHTML = `
                <td style="font-family:'Roboto Mono'; color:var(--accent-blue);">${k.key_code}</td>
                <td>${k.product_code || 'Standard'}</td>
                <td>${status}</td>
                <td>${activated}</td>
                <td>${expiry}</td>
            `;
            tbody.appendChild(tr);
        });

    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="5" style="color:red; text-align:center;">Fehler: ${e.message}</td></tr>`;
    }
};

const INFO_TEXTS = {
    traffic: "Diese Statistik zeigt die anonymisierten Seitenaufrufe der Landingpage, des Shops und der WebApp. Sie hilft zu verstehen, wie effektiv Marketingmaßnahmen Besucher in das System leiten.",
    sales: "Analyse der Produkt-Performance. Vergleicht Erstkäufe mit Verlängerungen. Eine hohe Verlängerungsrate ist ein Indikator für hohe Nutzerzufriedenheit.",
    finance: "Kumulierter Brutto-Umsatz aller erfolgreich abgeschlossenen Transaktionen (Status: completed). Dient der finanziellen Planung und Budgetierung.",
    system: "Überwachung der Systemintegrität. Zeigt die Nutzung des QR-Transfers sowie die Anzahl blockierter Angriffsversuche auf die Infrastruktur.",
    support: "Verhältnis zwischen FAQ-Aufrufen und Support-Anfragen. Ein Anstieg der FAQ-Nutzung bei gleichbleibenden Ticketzahlen zeigt eine erfolgreiche Entlastung des Supports."
};

function setupInfoTooltips() {
    const tooltip = document.getElementById('adminTooltip');
    if (!tooltip) return;

    // Open logic
    document.querySelectorAll('.info-trigger').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();

            // Check if already open on this element
            if(tooltip.classList.contains('visible') && tooltip.dataset.activeKey === btn.dataset.infoKey) {
                tooltip.classList.remove('visible');
                return;
            }

            const key = btn.dataset.infoKey;
            const text = INFO_TEXTS[key];

            if (text) {
                tooltip.textContent = text;
                tooltip.dataset.activeKey = key;

                // Positioning
                const rect = btn.getBoundingClientRect();
                tooltip.style.top = (rect.bottom + 10) + 'px';
                tooltip.style.left = (rect.left - 300 + 20) + 'px'; // Shift left to keep in viewport (simple logic)

                // Bounds check (Simple)
                if(parseFloat(tooltip.style.left) < 10) tooltip.style.left = '10px';

                tooltip.classList.add('visible');
            }
        });
    });

    // Close logic (Global click)
    document.addEventListener('click', (e) => {
        if (tooltip.classList.contains('visible')) {
            tooltip.classList.remove('visible');
        }
    });

    // Also close on ESC
    document.addEventListener('keydown', (e) => {
        if(e.key === 'Escape') tooltip.classList.remove('visible');
    });
}

function renderStats(stats) {
    if(!stats) return;
    const setVal = (id, val) => { const el = document.getElementById(id); if(el) el.textContent = val; };
    setVal('stUsersActive', stats.users_active);
    setVal('stUsersBlocked', stats.users_blocked);
    setVal('stKeysActive', stats.keys_active);
    setVal('stKeysExpired', stats.keys_expired);
    setVal('stPurchases', stats.purchases_count);
    setVal('stRevenue', (stats.revenue_total / 100).toFixed(2) + ' €');
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

        // Active License Display
        let licenseDisplay = '<span style="color:#666;">-</span>';
        if (u.key_code) {
             licenseDisplay = `<span style="color:var(--accent-blue); font-family:'Roboto Mono';">${u.key_code}</span>`;
        }

        const countDisplay = `<span onclick="openUserLicensesModal('${u.id}')" style="cursor:pointer; text-decoration:underline; color:#fff; font-weight:bold; padding:2px 6px; background:#333; border-radius:4px;">${u.license_count || 0}</span>`;

        tr.innerHTML = `
            <td>#${u.id}</td>
            <td style="font-weight:bold; color:#fff;">${u.username}</td>
            <td>${status}</td>
            <td>${licenseDisplay}</td>
            <td style="text-align:center;">${countDisplay}</td>
            <td>${u.last_login ? new Date(u.last_login).toLocaleString('de-DE') : '-'}</td>
            <td style="text-align:center;">${deviceIcon}</td>
            <td>
                <div style="display:flex; gap:10px;">
                    <button class="btn-icon" onclick="resetDevice('${u.id}')" title="Reset Device" style="cursor:pointer; border:none; background:none; font-size:1.2rem;">📱</button>
                    <button class="btn-icon" onclick="toggleUserBlock('${u.id}', ${u.is_blocked})" title="Block" style="cursor:pointer; border:none; background:none; font-size:1.2rem;">${u.is_blocked ? '🔓' : '🛑'}</button>
                    <button class="btn-icon" onclick="deleteUser('${u.id}', '${u.username.replace(/'/g, "\\'")}', ${!!u.license_key_id})" title="Benutzer Löschen" style="cursor:pointer; border:none; background:none; font-size:1.2rem; color:var(--error-red);">🗑️</button>
                </div>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

window.deleteUser = function(id, username, hasLicense) {
    const msg = `Möchten Sie den Benutzer '${username}' wirklich löschen?`;
    let options = null;

    if (hasLicense) {
        options = { label: 'Verknüpfte Lizenz ebenfalls löschen' };
    }

    window.showConfirm(msg, async (cascade) => {
        const url = `${API_BASE}/users/${id}` + (cascade ? '?cascade=true' : '');
        try {
            const res = await fetch(url, { method: 'DELETE', headers: getHeaders() });
            if(res.ok) {
                window.loadUsers();
                window.loadKeys(); // Refresh keys as they might be deleted/updated
                window.showToast(cascade ? "Benutzer & Lizenz gelöscht." : "Benutzer gelöscht.", "success");
            } else {
                window.showToast("Fehler beim Löschen.", "error");
            }
        } catch(e) { window.showToast("Netzwerkfehler", "error"); }
    }, options);
};

function renderBundlesTable(bundles) {
    const tbody = document.getElementById('bundlesTableBody');
    if(!tbody) return;
    tbody.innerHTML = '';
    bundles.forEach(b => {
        const tr = document.createElement('tr');
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
                <button class="btn-icon" onclick="deleteBundle(${b.id})" title="Bundle löschen" style="cursor:pointer; border:none; background:none; font-size:1.2rem; color:var(--error-red);">🗑️</button>
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

        // Show Username instead of ID
        const userDisplay = k.username ? `<span style="color:var(--accent-blue); font-weight:bold;">${k.username}</span>` : '-';

        tr.innerHTML = `
            <td style="font-family:'Roboto Mono'">${k.key_code}</td>
            <td>${k.product_code || 'std'}</td>
            <td>${status}</td>
            <td>${userDisplay}</td>
            <td>${new Date(k.created_at).toLocaleDateString('de-DE')}</td>
            <td>${expiry}</td>
            <td>
                 <button class="btn-icon" onclick="openEditLicenseModal(${k.id})" style="cursor:pointer; border:none; background:none; font-size:1.2rem;">⚙️</button>
                 <button class="btn-icon" onclick="deleteKey('${k.id}', '${k.key_code.replace(/'/g, "\\'")}', ${!!k.user_id})" style="cursor:pointer; border:none; background:none; font-size:1.2rem; color:var(--error-red);">🗑️</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function renderEnterpriseTable(keys) {
    const tbody = document.getElementById('enterpriseTableBody');
    if(!tbody) return;
    tbody.innerHTML = '';
    keys.forEach(k => {
        const tr = document.createElement('tr');
        const total = k.max_users || 0;

        let status = '<span style="color:orange;">OFFEN</span>';
        if (k.is_blocked) status = '<span style="color:var(--error-red); font-weight:bold;">GESPERRT</span>';
        else if (k.is_active) status = '<span style="color:var(--success-green);">AKTIV</span>';

        const blockIcon = k.is_blocked ? '🔓' : '🛑';
        const blockTitle = k.is_blocked ? 'Entsperren' : 'Sperren';

        tr.innerHTML = `
            <td style="font-family:'Roboto Mono'; font-weight:bold; color:orange;">${k.key_code}</td>
            <td>${k.client_name || '-'}</td>
            <td>${total}</td>
            <td>${status}</td>
            <td>${new Date(k.created_at).toLocaleDateString('de-DE')}</td>
            <td>
                <button class="btn-icon" onclick="toggleEnterpriseBlock(${k.id}, ${k.is_blocked})" title="${blockTitle}" style="cursor:pointer; border:none; background:none; font-size:1.2rem;">${blockIcon}</button>
                <button class="btn-icon" onclick="editQuota(${k.id}, ${total})" title="Quota bearbeiten" style="cursor:pointer; border:none; background:none; font-size:1.2rem;">✏️</button>
                <button class="btn-icon" onclick="deleteEnterpriseKey(${k.id})" title="Löschen" style="cursor:pointer; border:none; background:none; font-size:1.2rem; color:var(--error-red);">🗑️</button>
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

// Attach to window so filter events work
window.filterKeys = filterKeys;
window.filterBundles = filterBundles;
window.filterEnterpriseKeys = filterEnterpriseKeys;


// --- STATISTICS ---
let currentStatsData = null;
let charts = {};

window.loadStatistics = async function() {
    const startEl = document.getElementById('statsStart');
    const endEl = document.getElementById('statsEnd');

    // Set default dates if empty
    if(!startEl.value || !endEl.value) {
        const end = new Date();
        const start = new Date();
        start.setDate(start.getDate() - 30);

        endEl.value = end.toISOString().split('T')[0];
        startEl.value = start.toISOString().split('T')[0];
    }

    try {
        const query = `?startDate=${startEl.value}&endDate=${endEl.value}`;
        const res = await fetch(`${API_BASE}/stats/advanced${query}`, { headers: getHeaders() });
        const data = await res.json();

        if(data.success) {
            currentStatsData = data;
            renderKpis(data);
            renderCharts(data);
        } else {
            window.showToast(data.error || "Fehler beim Laden der Statistik", "error");
        }
    } catch(e) {
        console.error("Stats Load Error", e);
        window.showToast("Netzwerkfehler", "error");
    }
};

function renderKpis(data) {
    const today = new Date().toISOString().split('T')[0];
    const trafficToday = data.traffic.find(t => t.day === today);
    document.getElementById('kpiVisitors').textContent = trafficToday ? trafficToday.visitors : 0;

    const totalRev = data.finance.reduce((acc, curr) => acc + parseFloat(curr.revenue), 0);
    document.getElementById('kpiRevenue').textContent = (totalRev / 100).toFixed(2) + ' €';

    const totalSales = data.finance.reduce((acc, curr) => acc + parseInt(curr.sales), 0);
    document.getElementById('kpiLicenses').textContent = totalSales;

    if(allTickets.length > 0) {
        const active = allTickets.filter(t => t.status !== 'closed').length;
        document.getElementById('kpiSupport').textContent = active;
    } else {
        document.getElementById('kpiSupport').textContent = data.support.tickets;
    }

    const pikPercent = data.system.pik_total > 0
        ? Math.round((data.system.pik_migrated / data.system.pik_total) * 100)
        : 0;
    document.getElementById('pikPercent').textContent = pikPercent + '%';
    document.getElementById('pikBar').style.width = pikPercent + '%';
}

function renderCharts(data) {
    if(typeof Chart === 'undefined') return;

    const colors = {
        blue: '#00BFFF',
        green: '#00ff88',
        orange: 'orange',
        bg: 'rgba(255, 255, 255, 0.1)',
        grid: '#333'
    };

    renderChart('chartTraffic', 'line', {
        labels: data.traffic.map(d => d.day),
        datasets: [{
            label: 'Besucher',
            data: data.traffic.map(d => d.visitors),
            borderColor: colors.blue,
            backgroundColor: 'rgba(0, 191, 255, 0.1)',
            fill: true,
            tension: 0.4
        }, {
            label: 'Seitenaufrufe',
            data: data.traffic.map(d => d.page_views),
            borderColor: colors.green,
            borderDash: [5, 5],
            fill: false
        }]
    });

    const productLabels = Object.keys(data.products);
    const productValues = Object.values(data.products);
    renderChart('chartProducts', 'bar', {
        labels: productLabels,
        datasets: [{
            label: 'Verkäufe',
            data: productValues,
            backgroundColor: [colors.blue, colors.green, colors.orange, '#888']
        }]
    });

    renderChart('chartFinance', 'line', {
        labels: data.finance.map(d => d.day),
        datasets: [{
            type: 'bar',
            label: 'Umsatz (€)',
            data: data.finance.map(d => d.revenue / 100),
            backgroundColor: colors.orange
        }]
    });

    renderChart('chartSupport', 'doughnut', {
        labels: ['Tickets', 'FAQ Aufrufe'],
        datasets: [{
            data: [data.support.tickets, data.support.faq_views],
            backgroundColor: [colors.blue, '#444'],
            borderWidth: 0
        }]
    }, { cutout: '70%', maintainAspectRatio: false });
}

function renderChart(canvasId, type, data, extraOptions = {}) {
    const ctx = document.getElementById(canvasId).getContext('2d');
    if(charts[canvasId]) { charts[canvasId].destroy(); }

    const options = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { labels: { color: '#ccc' } } },
        scales: (type === 'doughnut') ? {} : {
            x: { grid: { color: '#333' }, ticks: { color: '#888' } },
            y: { grid: { color: '#333' }, ticks: { color: '#888' } }
        },
        ...extraOptions
    };
    charts[canvasId] = new Chart(ctx, { type, data, options });
}

/**
 * EXPORT STATISTICS CSV
 * Generates a client-side CSV file from the currently loaded statistics data.
 *
 * Structure:
 * - Date (YYYY-MM-DD)
 * - Visitors (Unique IPs)
 * - Page Views (Total Hits)
 * - Revenue (Cents)
 * - Sales (Count)
 *
 * Data is merged from 'traffic' and 'finance' arrays by date key.
 */
window.exportStatisticsCSV = function() {
    if(!currentStatsData) return window.showToast("Keine Daten geladen.", "error");

    const d = currentStatsData;
    let csv = "Datum,Besucher,Seitenaufrufe,Umsatz,Verkaeufe\n";

    const dates = new Set([...d.traffic.map(x=>x.day), ...d.finance.map(x=>x.day)]);
    const sortedDates = Array.from(dates).sort();

    sortedDates.forEach(date => {
        const t = d.traffic.find(x => x.day === date) || { visitors:0, page_views:0 };
        const f = d.finance.find(x => x.day === date) || { revenue:0, sales:0 };
        csv += `${date},${t.visitors},${t.page_views},${f.revenue},${f.sales}\n`;
    });

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `statistics_export_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
};
