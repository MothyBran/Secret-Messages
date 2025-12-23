// admin.js - Admin Panel Logic (Complete & Fixed)

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
    // If we have a JWT token, use it. Otherwise fallback to x-admin-password (for legacy/disabled 2fa support)
    // Actually server logic now prefers Bearer. If we have 2FA enabled, we MUST use Bearer.
    // We send both or switch? Switch is cleaner.
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
    // Hide all contents
    document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.nav-tab').forEach(el => el.classList.remove('active'));

    // Show target
    document.getElementById(`tab-${tabName}`).classList.add('active');

    const btns = document.querySelectorAll('.nav-tab');
    btns.forEach(btn => {
        if(btn.getAttribute('onclick') && btn.getAttribute('onclick').includes(tabName)) {
            btn.classList.add('active');
        }
    });

    if(tabName === 'mail') {
        window.loadSupportTickets(); // Refresh inbox count
    }
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

window.loadSupportTickets = async function() {
    const btn = document.getElementById('refreshSupportBtn');
    if(btn) { btn.textContent = "⏳..."; btn.disabled = true; }
    try {
        const res = await fetch(`${API_BASE}/support-tickets`, { headers: getHeaders() });
        allTickets = await res.json();

        // Update both tables (Legacy tab and new Mail Service tab)
        renderSupportTickets(allTickets);
        renderMailInbox(allTickets);

    } catch(e) { console.error("Load Tickets Failed", e); }
    if(btn) { btn.textContent = "Refresh"; btn.disabled = false; }
};

window.closeTicket = function(id) {
    // Legacy function, keeping for compatibility if used elsewhere, but redirected to new logic
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
            // If currently viewing this ticket, refresh details to show status change
            if(currentTicketId === id) {
                // Fetch updated ticket or just optimistically update logic would happen in loadSupportTickets re-render
                // But selectTicket would need re-triggering or manual DOM update.
                // Simplest is to let loadSupportTickets handle list, and clear detail or keep it open.
                // Ideally re-select it to update badges.
                // We'll let loadSupportTickets refresh the list.
                // The Detail View might need a refresh. We can find it in allTickets after reload.

                // Let's just reset the detail view for clarity or re-select.
                // Waiting for loadSupportTickets to finish (it's async but we didn't await it strictly here)
                // Actually loadSupportTickets updates allTickets.
            }
        } else {
            window.showToast("Fehler beim Abschließen.", "error");
        }
    } catch(e) { window.showToast("Netzwerkfehler", "error"); }
};

// =========================================================
// NEW: MAIL SERVICE INBOX LOGIC
// =========================================================

window.showMailView = function(viewName) {
    // Buttons
    document.getElementById('btnMailInbox').classList.remove('active');
    document.getElementById('btnMailCompose').classList.remove('active');
    document.getElementById('btnMailSettings').classList.remove('active');

    // Content
    document.getElementById('view-mail-inbox').style.display = 'none';
    document.getElementById('view-mail-compose').style.display = 'none';
    document.getElementById('view-mail-settings').style.display = 'none';

    // Activate
    document.getElementById(`btnMail${viewName.charAt(0).toUpperCase() + viewName.slice(1)}`).classList.add('active');
    document.getElementById(`view-mail-${viewName}`).style.display = (viewName === 'inbox') ? 'flex' : 'block'; // inbox is flex

    if (viewName === 'inbox') window.loadSupportTickets();
    if (viewName === 'settings') window.loadMailTemplate();
};

function renderMailInbox(tickets) {
    const container = document.getElementById('ticketListBody');
    if (!container) return;

    // Filter out only registered user tickets if needed? No, show all.
    // Count open tickets
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

    // Sort: Open first, then by date desc
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
    renderMailInbox(allTickets); // Re-render to update active class

    const detailContainer = document.getElementById('ticketDetailContainer');

    // 1. Mark as In Progress if Open
    if (ticket.status === 'open') {
        try {
             await fetch(`${API_BASE}/support-tickets/${ticket.id}/status`, {
                method: 'PUT',
                headers: getHeaders(),
                body: JSON.stringify({ status: 'in_progress' })
            });
            ticket.status = 'in_progress'; // Optimistic update
            renderMailInbox(allTickets);
        } catch(e) { console.error("Status update failed", e); }
    }

    // 2. Load Template
    let template = "";
    try {
        const res = await fetch(`${API_BASE}/settings/ticket_reply_template`, { headers: getHeaders() });
        const data = await res.json();
        if(data.success && data.value) template = data.value;
    } catch(e) {}

    // Replace Placeholder
    const replyBody = template.replace('{username}', ticket.username || 'Nutzer').replace('[TEXT]', '\n\n');

    // 3. Render Detail View
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

    // 4. Add Reply Section (Only if not closed or if we allow re-opening?)
    // Requirement says: "Sobald der Admin antwortet... wechselt Status auf abgeschlossen."
    // We allow replying even if closed? Maybe. But let's assume standard flow.

    if (ticket.username) { // Only for registered users (or if we implement email reply logic here later)
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
            // Refresh
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
            // Default fallback
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

// =========================================================
// OLD LOGIC PRESERVED BELOW
// =========================================================

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
            // Save what we have
            if(adminToken) sessionStorage.setItem('sm_admin_token', adminToken);
            if(adminPassword) sessionStorage.setItem('sm_admin_pw', adminPassword);

            document.getElementById('login-view').style.display = 'none';
            document.getElementById('dashboard-view').style.display = 'block';
            renderStats(data.stats);
            window.loadMaintenanceStatus();
            window.loadShopStatus();
            window.loadUsers();
            window.loadKeys();
            window.loadPurchases();
            window.loadBundles();
            window.loadSupportTickets();
            loadSystemStatus();

            // Set default tab
            window.switchTab('dashboard');
            window.check2FAStatus();

        } else {
            // Stats call failed?
            if(res.status === 403) {
                // If it was a session resume attempt, clear it and show login
                sessionStorage.removeItem('sm_admin_token');
                sessionStorage.removeItem('sm_admin_pw');
                document.getElementById('login-view').style.display = 'flex';
                // If this was an explicit login, show error
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
            adminPassword = password; // Keep it as backup? Or purely rely on token?
            // If we have token, we prefer token. But getHeaders uses what is available.

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
    // Check global settings via endpoint or just infer from UI flow?
    // Usually we check /settings/admin_2fa_enabled
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
        // Check current status first
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

            // Show QR
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

// DOM Event Listeners
document.addEventListener('DOMContentLoaded', () => {
    const storedToken = sessionStorage.getItem('sm_admin_token');
    const storedPw = sessionStorage.getItem('sm_admin_pw');

    if(storedToken) {
        adminToken = storedToken;
        if(storedPw) adminPassword = storedPw; // Restore legacy just in case
        initDashboard();
    } else if(storedPw) {
        // Legacy resume
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

    // Refresh Buttons (Using IDs from HTML update)
    document.getElementById('refreshUsersBtn')?.addEventListener('click', window.loadUsers);
    document.getElementById('refreshKeysBtn')?.addEventListener('click', window.loadKeys);
    document.getElementById('refreshPurchasesBtn')?.addEventListener('click', window.loadPurchases);
    document.getElementById('refreshBundlesBtn')?.addEventListener('click', window.loadBundles);
    document.getElementById('refreshSupportBtn')?.addEventListener('click', window.loadSupportTickets);
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

function renderSupportTickets(tickets) {
    const tbody = document.getElementById('supportTableBody');
    if(!tbody) return;
    tbody.innerHTML = '';
    tickets.forEach(t => {
        const tr = document.createElement('tr');

        // 1. Ticket ID
        const tdId = document.createElement('td');
        tdId.style.fontFamily = "'Roboto Mono'";
        tdId.style.fontSize = "0.8rem";
        tdId.style.color = "var(--accent-blue)";
        tdId.textContent = t.ticket_id;
        tr.appendChild(tdId);

        // 2. Username
        const tdUser = document.createElement('td');
        if (t.username) {
            tdUser.textContent = t.username;
            tdUser.style.fontWeight = "bold";
            tdUser.style.color = "#fff";
        } else {
            tdUser.textContent = "(Gast)";
            tdUser.style.color = "#888";
        }
        tr.appendChild(tdUser);

        // 3. Email
        const tdEmail = document.createElement('td');
        tdEmail.textContent = t.email || '-';
        tr.appendChild(tdEmail);

        // 4. Subject
        const tdSubj = document.createElement('td');
        tdSubj.textContent = t.subject;
        tr.appendChild(tdSubj);

        // 5. Message (Truncated)
        const tdMsg = document.createElement('td');
        tdMsg.textContent = t.message;
        tdMsg.title = t.message; // Tooltip shows full text
        tdMsg.style.fontSize = "0.8rem";
        tdMsg.style.color = "#ccc";
        tdMsg.style.maxWidth = "300px";
        tdMsg.style.whiteSpace = "nowrap";
        tdMsg.style.overflow = "hidden";
        tdMsg.style.textOverflow = "ellipsis";
        tr.appendChild(tdMsg);

        // 6. Created At
        const tdDate = document.createElement('td');
        tdDate.textContent = new Date(t.created_at).toLocaleString('de-DE');
        tr.appendChild(tdDate);

        // 7. Actions
        const tdActions = document.createElement('td');

        // Reply Button (Only if Username exists) - Redirects to Inbox now!
        if (t.username && t.username.length > 0) {
            const btnReply = document.createElement('button');
            btnReply.className = "btn-icon";
            btnReply.textContent = "📤";
            btnReply.title = "Via Postfach antworten";
            btnReply.style.cursor = "pointer";
            btnReply.style.border = "none";
            btnReply.style.background = "none";
            btnReply.style.fontSize = "1.2rem";
            btnReply.style.marginRight = "10px";

            // Securely attach event handler -> Redirect to Mail Tab
            btnReply.onclick = () => window.switchTab('mail');
            tdActions.appendChild(btnReply);
        }

        // Delete Button
        const btnDelete = document.createElement('button');
        btnDelete.className = "btn-icon";
        btnDelete.textContent = "🗑️";
        btnDelete.title = "Löschen";
        btnDelete.style.cursor = "pointer";
        btnDelete.style.border = "none";
        btnDelete.style.background = "none";
        btnDelete.style.fontSize = "1.2rem";
        btnDelete.style.color = "var(--error-red)";

        // Securely attach event handler
        btnDelete.onclick = () => window.closeTicket(t.id);
        tdActions.appendChild(btnDelete);

        tr.appendChild(tdActions);
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
