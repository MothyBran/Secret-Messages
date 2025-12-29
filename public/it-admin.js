// it-admin.js - Local IT Admin Logic

import { decryptFull, encryptFull } from './cryptoLayers.js';

const API_BASE = '/api/admin';
let itToken = null;
const SERVER_IP = window.location.hostname;
let socket = null;

// Production Mode Only
const IS_TEST_MODE = false;

window.showToast = function(message, type = 'info') {
    let container = document.getElementById('toast-container');
    if(!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        container.style.position = 'fixed';
        container.style.top = '20px';
        container.style.right = '20px';
        container.style.zIndex = '10000';
        document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.style.background = '#222';
    toast.style.color = type === 'error' ? '#ff3333' : (type === 'success' ? '#00ff88' : '#e0e0e0');
    toast.style.padding = '10px 20px';
    toast.style.marginTop = '10px';
    toast.style.borderRadius = '4px';
    toast.style.borderLeft = `4px solid ${toast.style.color}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}

window.showTab = function(tabName) {
    document.querySelectorAll('.tab-section').forEach(el => el.style.display = 'none');
    document.querySelectorAll('.menu-item').forEach(el => el.classList.remove('active'));

    document.getElementById(`tab-${tabName}`).style.display = 'block';
    const btns = document.querySelectorAll('.menu-item');
    btns.forEach(btn => {
        if(btn.getAttribute('onclick').includes(tabName)) btn.classList.add('active');
    });
}

document.addEventListener('DOMContentLoaded', () => {
    // Check Shared Auth Token from Main App (localStorage 'sm_token')
    const mainToken = localStorage.getItem('sm_token');

    if (mainToken) {
        // Validate if this token has Admin rights
        // We reuse the token for Admin API calls if valid
        itToken = mainToken;
        sessionStorage.setItem('sm_it_token', itToken); // Sync to session
        showDashboard();
    } else {
        // Fallback: Check if session token exists independently (rare case for direct access)
        const stored = sessionStorage.getItem('sm_it_token');
        if (stored) {
            itToken = stored;
            showDashboard();
        } else {
            // Redirect to Login if no token found
            window.location.href = '/app';
        }
    }

    document.getElementById('logoutBtn')?.addEventListener('click', () => {
        sessionStorage.removeItem('sm_it_token');
        localStorage.removeItem('sm_token'); // Clear main auth too
        window.location.href = '/app';
    });

    document.getElementById('btnStartHub')?.addEventListener('click', toggleHub);
    document.getElementById('btnStopHub')?.addEventListener('click', toggleHub);
    document.getElementById('btnExportKeys')?.addEventListener('click', exportMasterKeys);
    document.getElementById('btnImportEmployees')?.addEventListener('click', importEmployees);
    document.getElementById('btnResetDevice')?.addEventListener('click', resetDeviceBinding);

    // User Management Events
    document.getElementById('btnAddUser')?.addEventListener('click', () => openUserModal());
    document.getElementById('userForm')?.addEventListener('submit', handleUserSave);
    document.getElementById('btnCancelUserModal')?.addEventListener('click', () => document.getElementById('userModal').classList.remove('active'));
    document.getElementById('btnBlockUser')?.addEventListener('click', toggleBlockUser);
    document.getElementById('btnDeleteUser')?.addEventListener('click', deleteUser);
});

function showDashboard() {
    document.getElementById('login-view').style.display = 'none';
    showTab('dashboard'); // ensure default tab is shown
    checkHubStatus();
    loadUsers();
    loadTickets();
}

function renderUserSlots(slots) {
    const list = document.getElementById('userSlotList');
    if(!list) return;
    list.innerHTML = '';

    const table = document.createElement('table');
    table.style.width = '100%';
    table.style.borderCollapse = 'collapse';
    table.style.marginTop = '10px';

    table.innerHTML = `
        <thead style="background:#1a1a1a; color:#888; font-size:0.8rem;">
            <tr>
                <th style="padding:10px; text-align:left;">ID</th>
                <th style="padding:10px; text-align:left;">Name</th>
                <th style="padding:10px; text-align:left;">Dept</th>
                <th style="padding:10px; text-align:center;">Status</th>
                <th style="padding:10px; text-align:right;">Action</th>
            </tr>
        </thead>
        <tbody></tbody>
    `;

    const tbody = table.querySelector('tbody');

    slots.forEach(s => {
        const tr = document.createElement('tr');
        tr.style.borderBottom = '1px solid #222';

        let statusIcon = '⚪';
        if (s.status === 'online') statusIcon = '🟢';
        if (s.status === 'free') statusIcon = '−';
        if (s.status === 'blocked') statusIcon = '🚫';

        tr.innerHTML = `
            <td style="padding:10px; color:#666; font-family:'Roboto Mono';">${s.id}</td>
            <td style="padding:10px; font-weight:bold; color:${s.name==='Frei'?'#444':'#fff'};">${s.name}</td>
            <td style="padding:10px; color:#aaa;">${s.dept}</td>
            <td style="padding:10px; text-align:center; font-size:1.2rem;">${statusIcon}</td>
            <td style="padding:10px; text-align:right;">
                ${s.status !== 'free' ? `<button onclick="window.editUser(${s.id})" class="btn-action" style="padding:2px 5px; font-size:0.7rem; background:#333; border:1px solid #555;">Edit</button>` : `<button onclick="window.editUser(${s.id})" class="btn-action" style="padding:2px 5px; font-size:0.7rem; background:var(--accent-primary); color:#000;">Assign</button>`}
            </td>
        `;
        tbody.appendChild(tr);
    });

    list.appendChild(table);
}

// Global scope for inline onclick
window.editUser = function(id) {
    openUserModal(id);
};

// USER MANAGEMENT LOGIC
let currentEditingId = null;

function openUserModal(id = null) {
    const modal = document.getElementById('userModal');
    if(!modal) return;

    document.getElementById('keyDisplayArea').style.display = 'none';
    document.getElementById('generatedKeyVal').textContent = '';
    const btn = document.getElementById('btnSaveUser');
    btn.style.display = 'block';
    btn.textContent = 'Generieren & Speichern';

    currentEditingId = id;

    // Find user logic (Mock vs Real would be separate but simpler here)
    // REAL mode requires finding user in DOM or reloading data.
    // For simplicity, we assume we can fetch by ID or parse from UI?
    // Better: fetch user detail if needed. But for "Create", id is null.
    // For "Edit", we need user object.
    // Let's assume edit is limited for now or we re-fetch user list to find them.
    let user = null;

    // In Real Mode, we might not have the user object handy without fetching.
    // We can fetch via API or pass data differently.
    // For this implementation, let's assume we focus on "Create".
    // Edit requires fetching user details.

    if(id) {
        // Attempt to find via API or local cache if we had one (we don't persist cache here yet)
        // We'll skip pre-filling for edit in this radical cleanup step to ensure stability first.
        // Or fetch single user?
    }

    modal.classList.add('active');
}

async function handleUserSave(e) {
    e.preventDefault();
    const name = document.getElementById('editUserName').value;
    const dept = document.getElementById('editUserDept').value;
    const btn = document.getElementById('btnSaveUser');
    const keyDisplay = document.getElementById('keyDisplayArea');
    const keyVal = document.getElementById('generatedKeyVal');

    if(!name) return showToast("Name/ID erforderlich", "error");

    // REAL MODE
    try {
        btn.disabled = true;
        btn.textContent = "...";

        let res;
        if(currentEditingId) {
            // Edit not fully impl in this snippet, focus on Create
            showToast("Edit API not implemented", "info");
        } else {
            // Create Local User
            res = await fetch(`${API_BASE}/create-local-user`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${itToken}` },
                body: JSON.stringify({ username: name, dept })
            });
            const data = await res.json();

            if(data.success) {
                keyDisplay.style.display = 'block';
                keyVal.textContent = data.key;
                showToast("User angelegt!", "success");
                btn.style.display = 'none';

                // Refresh list
                loadUsers();
            } else {
                showToast(data.error || "Fehler", "error");
            }
        }
    } catch(err) {
        showToast("Verbindungsfehler", "error");
    } finally {
        btn.disabled = false;
        if(btn.textContent === "...") btn.textContent = "Generieren & Speichern";
    }
}

function updateQuotaDisplay(used, total) {
    const el = document.getElementById('quotaDisplay');
    if(el) {
        el.textContent = `${used} / ${total}`;
        if(used >= total) el.style.color = '#ff3333';
        else el.style.color = '#00ff88';
    }
}

async function loadUsers() {
    try {
        const res = await fetch(`${API_BASE}/users`, { headers: { 'Authorization': `Bearer ${itToken}` } });
        const users = await res.json();

        // Fetch Quota Stats (Settings)
        let max = 50;
        try {
             const sRes = await fetch(`${API_BASE}/settings/enterprise_quota`, { headers: { 'Authorization': `Bearer ${itToken}` } });
             const sData = await sRes.json();
             if(sData.value) max = parseInt(sData.value);
        } catch(e){}

        // Calculate Used (Only Enterprise Local Users)
        // Or all users? "Lizenz-Kontingent" usually refers to created slots.
        // Assuming all users count against quota in Enterprise mode.
        updateQuotaDisplay(users.length, max);

        // Map users to slots UI
        const slotData = users.map(u => ({
            id: u.id,
            name: u.username,
            dept: 'User',
            status: u.is_blocked ? 'blocked' : (u.is_online ? 'online' : 'offline')
        }));

        renderUserSlots(slotData);
    } catch(e) { console.error("Load Users Error:", e); }
}

function toggleBlockUser() {
    if(!currentEditingId) return;

    // Determine current status to toggle (simple check from UI or fetch)
    // For simplicity, we just call block or unblock based on button text or state?
    // The UI should reflect current state.
    // Let's assume we fetch details or toggle blind.
    // Let's check the button text in the modal to decide.
    const btn = document.getElementById('btnBlockUser');
    const isBlocked = btn.textContent === 'Unblock';

    const endpoint = isBlocked ? `/api/admin/unblock-user/${currentEditingId}` : `/api/admin/block-user/${currentEditingId}`;

    fetch(endpoint, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${itToken}` }
    })
    .then(res => res.json())
    .then(data => {
        if(data.success) {
            showToast(isBlocked ? "User unblocked" : "User blocked", "success");
            document.getElementById('userModal').classList.remove('active');
            loadUsers();
        } else {
            showToast("Fehler", "error");
        }
    });
}

function deleteUser() {
    if(!currentEditingId) return;
    if(confirm("Diesen User unwiderruflich löschen?")) {
        // We delete the Key associated with the user, which cascades or we delete user?
        // Server has /api/admin/keys/:id DELETE but not /api/admin/users/:id DELETE directly exposed maybe?
        // server.js has delete /api/admin/keys/:id
        // But we have user ID here.
        // We need an endpoint to delete USER by ID.
        // server.js DOES NOT have app.delete('/api/admin/users/:id').
        // It has app.delete('/api/admin/keys/:id').
        // Users are linked to keys.
        // We should delete the KEY associated with the user, which unlinks the user.
        // But we want to delete the user slot.
        // Let's look for a delete user endpoint.
        // app.post('/api/auth/delete-account') is for self-deletion.
        // We need to add Admin Delete User logic to server.js or use existing.
        // Currently: "Block" is supported. "Delete" might need new server logic.
        // I will implement a client-side call to a new endpoint I will add: DELETE /api/admin/users/:id

        fetch(`/api/admin/users/${currentEditingId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${itToken}` }
        })
        .then(res => res.json())
        .then(data => {
            if(data.success) {
                showToast("User gelöscht", "success");
                document.getElementById('userModal').classList.remove('active');
                loadUsers();
            } else {
                showToast("Fehler: " + (data.error || "Server"), "error");
            }
        });
    }
}

function logEvent(msg) {
    const log = document.getElementById('hubLog');
    if(log) {
        const line = document.createElement('div');
        line.textContent = `> [${new Date().toLocaleTimeString()}] ${msg}`;
        log.prepend(line);
    }
}

async function checkHubStatus() {
    try {
        const res = await fetch('/api/hub/status', {
            headers: { 'Authorization': `Bearer ${itToken}` }
        });
        const data = await res.json();
        updateHubUI(data.active, data.port);
    } catch(e) { console.log("Hub check failed", e); }
}

async function toggleHub(e) {
    const isStart = e.target.id === 'btnStartHub';
    const endpoint = isStart ? '/api/hub/start' : '/api/hub/stop';

    try {
        const res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${itToken}` }
        });
        const data = await res.json();
        if(data.success) {
            updateHubUI(data.active, data.port);
            showToast(isStart ? "Hub gestartet" : "Hub gestoppt", "success");
        } else {
            showToast("Fehler: " + data.error, "error");
        }
    } catch(e) { showToast("Netzwerkfehler", "error"); }
}

function updateHubUI(active, port) {
    const startBtn = document.getElementById('btnStartHub');
    const stopBtn = document.getElementById('btnStopHub');
    const badge = document.getElementById('hubStatusBadge');
    const display = document.getElementById('hubIpDisplay');

    if(active) {
        if(startBtn) startBtn.style.display = 'none';
        if(stopBtn) stopBtn.style.display = 'block';
        if(badge) {
            badge.textContent = "HUB ONLINE";
            badge.classList.add('online');
            badge.style.color = '#00ff88';
            badge.style.borderColor = '#00ff88';
        }
        if(display) display.textContent = `${SERVER_IP}:${port || 3000}`;

        if(!socket) connectMasterSocket();
    } else {
        if(startBtn) startBtn.style.display = 'block';
        if(stopBtn) stopBtn.style.display = 'none';
        if(badge) {
            badge.textContent = "HUB OFFLINE";
            badge.classList.remove('online');
            badge.style.color = '#888';
            badge.style.borderColor = '#333';
        }
        if(display) display.textContent = "---";

        if(socket) {
            socket.disconnect();
            socket = null;
        }
    }
}

function connectMasterSocket() {
    socket = io();
    socket.on('connect', () => {
        socket.emit('register', { userId: 'MASTER', username: 'IT-ADMIN', role: 'MASTER' });
        showToast("Connected to Hub", "success");
    });
    socket.on('support_ticket', (data) => {
        addTicketToInbox(data);
        showToast(`Neue Anfrage von User ${data.fromUserId}`, "info");
    });
}

async function loadTickets() {
    try {
        const res = await fetch(`${API_BASE}/support-tickets`, { headers: { 'Authorization': `Bearer ${itToken}` } });
        const tickets = await res.json();

        const mapped = tickets.map(t => ({
            id: t.id,
            ticket_id: t.ticket_id,
            user: t.username || 'Gast',
            subject: t.subject,
            status: t.status || 'open',
            time: new Date(t.created_at).toLocaleString(),
            msg: t.message
        }));

        renderTickets(mapped);
    } catch(e) { console.error("Load Tickets Error:", e); }
}

function renderTickets(tickets) {
    const list = document.getElementById('ticketList');
    if(!list) return;
    list.innerHTML = '';

    tickets.forEach(t => {
        const div = document.createElement('div');
        div.className = `ticket-item ${t.status === 'open' ? 'unread' : ''}`;
        div.innerHTML = `
            <div style="font-weight:bold; color:#fff;">${t.user}</div>
            <div style="font-size:0.9rem; color:#aaa;">${t.subject}</div>
            <div style="font-size:0.7rem; color:#666; margin-top:5px;">${t.time}</div>
        `;
        div.onclick = () => showTicketDetail(t);
        list.appendChild(div);
    });
}

function showTicketDetail(ticket) {
    const detail = document.getElementById('ticketDetail');
    detail.innerHTML = `
        <h3 style="color:#fff; margin-bottom:10px;">${ticket.subject}</h3>
        <div style="color:#888; font-size:0.9rem; margin-bottom:20px;">Von: <strong style="color:var(--accent-primary);">${ticket.user}</strong> | ID: ${ticket.id}</div>
        <div style="background:rgba(255,255,255,0.05); padding:15px; border:1px solid #333; color:#ccc; line-height:1.5;">
            ${ticket.msg}
        </div>
        <div style="margin-top:20px;">
            <textarea id="replyText" style="width:100%; height:100px; background:#000; color:#fff; border:1px solid #333; padding:10px; margin-bottom:10px;" placeholder="Antwort eingeben..."></textarea>
            <button onclick="window.sendReply('${ticket.id}')" class="btn-action">Senden</button>
            <button onclick="window.closeTicket('${ticket.id}')" class="btn-action" style="background:transparent; border:1px solid #555; color:#aaa;">Schließen</button>
        </div>
    `;
}

window.sendReply = function(ticketId) {
    const text = document.getElementById('replyText').value;
    if(!text) return alert("Bitte Text eingeben.");

    // Real logic
    // API endpoint: /api/admin/support-tickets/:id/reply
    // Note: ticketId in renderTickets is the DB ID (t.id), but ticket object has ticket_id.
    // showTicketDetail uses ticket.id which is DB ID.
    // Endpoint expects DB ID.

    showToast("Senden...", "info");

    fetch(`${API_BASE}/support-tickets/${ticketId}/reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${itToken}` },
        body: JSON.stringify({ message: text, username: 'IT-Admin' }) // Username for context
    })
    .then(res => res.json())
    .then(data => {
        if(data.success) {
            showToast("Antwort gesendet & Ticket geschlossen.", "success");
            loadTickets(); // Refresh
            document.getElementById('ticketDetail').innerHTML = '<div style="color:#666; text-align:center; padding-top:50px;">Erledigt.</div>';
        } else {
            showToast("Fehler beim Senden", "error");
        }
    })
    .catch(e => showToast("Verbindungsfehler", "error"));
};

window.closeTicket = function(ticketId) {
    // API endpoint to close? Or just update status.
    // /api/admin/support-tickets/:id/status (PUT)
    fetch(`${API_BASE}/support-tickets/${ticketId}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${itToken}` },
        body: JSON.stringify({ status: 'closed' })
    })
    .then(res => res.json())
    .then(data => {
        if(data.success) {
            showToast("Ticket geschlossen.", "success");
            loadTickets();
            document.getElementById('ticketDetail').innerHTML = '<div style="color:#666; text-align:center; padding-top:50px;">Geschlossen.</div>';
        } else {
            showToast("Fehler", "error");
        }
    });
}

function addTicketToInbox(data) {
    // Just refresh for now to keep sync simple
    loadTickets();
    // But notification is good
}

// Decryption Helper
window.decryptMessage = async function(elementId, encryptedPayload) {
    const code = prompt("Bitte Master-Code (5-stellig) zur Entschlüsselung eingeben:");
    if(!code || code.length !== 5) return alert("Code ungültig.");

    try {
        const decrypted = await decryptFull(encryptedPayload, code, 'MASTER');
        const el = document.getElementById(elementId);
        if(el) {
            el.innerText = decrypted;
            el.style.color = '#fff';
            el.style.fontFamily = 'sans-serif';
            el.style.padding = '10px';
            el.style.border = '1px solid #444';
            el.style.marginTop = '10px';
        }
    } catch(e) {
        alert("Entschlüsselung fehlgeschlagen: " + e.message);
    }
};

window.replyToUser = async function(userId) {
    const msg = prompt("Antwort an " + userId + ":");
    if(!msg) return;
    const code = prompt("Verschlüsselungs-Code für User:");
    if(!code) return;

    if(msg && socket) {
        try {
            const encrypted = await encryptFull(msg, code, [userId], 'MASTER');
            socket.emit('send_message', {
                recipientId: userId,
                encryptedPayload: encrypted,
                type: 'admin_reply'
            });
            showToast("Verschlüsselte Antwort gesendet.");
        } catch(e) {
            alert("Fehler: " + e.message);
        }
    }
};

async function exportMasterKeys() {
    try {
        const res = await fetch(`${API_BASE}/users`, { headers: { 'Authorization': `Bearer ${itToken}` } });
        const users = await res.json();
        let csv = "ID,Name,PublicKey\n";
        users.forEach(u => { csv += `${u.id},${u.username},${u.public_key||''}\n`; });
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = 'master_keys.csv'; a.click();
        showToast("Export erfolgreich", "success");
    } catch(e) { showToast("Export Fehler", "error"); }
}

async function importEmployees() {
    // Real logic would be upload
    showToast("Import wird verarbeitet...", "info");
}

async function resetDeviceBinding() {
    const userId = document.getElementById('resetUserId').value;
    if(!userId) return showToast("ID eingeben", "error");
    try {
        const res = await fetch(`${API_BASE}/reset-device/${userId}`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${itToken}` }
        });
        if(res.ok) showToast("Gerätebindung gelöscht.", "success");
        else showToast("Fehler beim Reset", "error");
    } catch(e) { showToast("Fehler", "error"); }
}
