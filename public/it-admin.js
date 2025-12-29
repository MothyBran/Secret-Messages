// it-admin.js - Local IT Admin Logic

import { decryptFull, encryptFull } from './cryptoLayers.js';

const API_BASE = '/api/admin';
let itToken = null;
const SERVER_IP = window.location.hostname;
let socket = null;

// TEST MODE DETECTION
const IS_TEST_MODE = window.location.pathname.includes('/test/enterprise-admin');

// Mock Data
const DUMMY_TICKETS = [
    { id: 'T-1001', user: 'M. Schmidt', subject: 'Login Problem', status: 'open', time: '10:30', msg: 'Ich kann mich nicht einloggen. Gerät nicht erkannt.' },
    { id: 'T-1002', user: 'Vertrieb_04', subject: 'Neue Lizenz', status: 'closed', time: '09:15', msg: 'Bitte um Zuweisung einer weiteren Lizenz für den neuen Laptop.' },
    { id: 'T-1003', user: 'K. Jansen', subject: 'Verschlüsselung', status: 'open', time: 'Yesterday', msg: 'Frage: Ist der Code 5-stellig oder 6-stellig?' }
];

const DUMMY_SLOTS = [
    { id: 101, name: 'M. Schmidt', dept: 'IT', status: 'online' },
    { id: 102, name: 'A. Weber', dept: 'Marketing', status: 'offline' },
    { id: 103, name: 'Vertrieb_04', dept: 'Sales', status: 'online' },
    { id: 104, name: 'L. Müller', dept: 'IT', status: 'online' },
    { id: 105, name: 'K. Jansen', dept: 'HR', status: 'offline' },
    { id: 106, name: 'T. Hoffmann', dept: 'Geschäftsführung', status: 'online' },
    { id: 107, name: 'S. Wagner', dept: 'Sales', status: 'offline' },
    { id: 108, name: 'J. Becker', dept: 'IT', status: 'online' },
    { id: 109, name: 'B. Schulz', dept: 'Marketing', status: 'offline' },
    { id: 110, name: 'Admin_01', dept: 'IT', status: 'online' },
    { id: 111, name: 'Frei', dept: '-', status: 'free' },
    { id: 112, name: 'Frei', dept: '-', status: 'free' },
    { id: 113, name: 'Frei', dept: '-', status: 'free' },
    { id: 114, name: 'Frei', dept: '-', status: 'free' },
    { id: 115, name: 'Frei', dept: '-', status: 'free' },
];

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
    // TEST MODE BYPASS
    if (IS_TEST_MODE) {
        console.log("⚠️ TEST MODE ACTIVE");
        itToken = "DUMMY_TOKEN";

        // Hide login if present
        const loginView = document.getElementById('login-view');
        if (loginView) loginView.style.display = 'none';
        // There is no #dashboard-view, we just show the default tab or the main grid is always visible
        showTab('dashboard');

        // Mock Hub Status
        updateHubUI(false, null);

        // Render Dummy Slots
        renderUserSlots(DUMMY_SLOTS);

        // Render Dummy Tickets
        renderTickets(DUMMY_TICKETS);

        // Mock Logs
        logEvent("System initialized in Sandbox Mode.");
        logEvent("15 Slots loaded.");
        logEvent("3 Mock Tickets loaded.");

    } else {
        // Real Mode: Check Session
        const stored = sessionStorage.getItem('sm_it_token');
        if (stored) {
            itToken = stored;
            showDashboard();
        } else {
            document.getElementById('login-view').style.display = 'flex';
        }
    }

    document.getElementById('itLoginForm')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const pw = document.getElementById('itPasswordInput').value;
        try {
            const res = await fetch(`${API_BASE}/auth`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password: pw })
            });
            const data = await res.json();
            if(data.success) {
                itToken = data.token;
                sessionStorage.setItem('sm_it_token', itToken);
                showDashboard();
            } else {
                showToast("Zugriff verweigert", "error");
            }
        } catch(e) { showToast("Verbindungsfehler", "error"); }
    });

    document.getElementById('logoutBtn')?.addEventListener('click', () => {
        sessionStorage.removeItem('sm_it_token');
        location.reload();
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
    if(!modal) return; // Should create if missing or assumes it exists in HTML

    // Find user in DUMMY_SLOTS if testing
    const user = DUMMY_SLOTS.find(u => u.id === id);

    currentEditingId = id;

    if(user && user.status !== 'free') {
        document.getElementById('editUserName').value = user.name;
        document.getElementById('editUserDept').value = user.dept;
        document.getElementById('btnBlockUser').style.display = 'inline-block';
        document.getElementById('btnBlockUser').textContent = user.status === 'blocked' ? 'Unblock' : 'Block';
        document.getElementById('btnDeleteUser').style.display = 'inline-block';
    } else {
        document.getElementById('editUserName').value = '';
        document.getElementById('editUserDept').value = '';
        document.getElementById('btnBlockUser').style.display = 'none';
        document.getElementById('btnDeleteUser').style.display = 'none';
    }

    modal.classList.add('active');
}

function handleUserSave(e) {
    e.preventDefault();
    const name = document.getElementById('editUserName').value;
    const dept = document.getElementById('editUserDept').value;

    if(IS_TEST_MODE) {
        const idx = DUMMY_SLOTS.findIndex(u => u.id === currentEditingId);
        if(idx > -1) {
            DUMMY_SLOTS[idx].name = name;
            DUMMY_SLOTS[idx].dept = dept;
            DUMMY_SLOTS[idx].status = 'offline'; // Assume allocated
            renderUserSlots(DUMMY_SLOTS);
            showToast("User updated (Mock)", "success");
        }
        document.getElementById('userModal').classList.remove('active');
        return;
    }

    // Real API call would go here
    showToast("API call not implemented for this action yet.", "info");
}

function toggleBlockUser() {
    if(IS_TEST_MODE) {
        const idx = DUMMY_SLOTS.findIndex(u => u.id === currentEditingId);
        if(idx > -1) {
            const isBlocked = DUMMY_SLOTS[idx].status === 'blocked';
            DUMMY_SLOTS[idx].status = isBlocked ? 'offline' : 'blocked';
            renderUserSlots(DUMMY_SLOTS);
            showToast(isBlocked ? "User Unblocked" : "User Blocked", "info");
        }
        document.getElementById('userModal').classList.remove('active');
    }
}

function deleteUser() {
    if(confirm("Delete this user assignment?")) {
        if(IS_TEST_MODE) {
            const idx = DUMMY_SLOTS.findIndex(u => u.id === currentEditingId);
            if(idx > -1) {
                DUMMY_SLOTS[idx].name = 'Frei';
                DUMMY_SLOTS[idx].dept = '-';
                DUMMY_SLOTS[idx].status = 'free';
                renderUserSlots(DUMMY_SLOTS);
                showToast("User deleted/freed", "success");
            }
            document.getElementById('userModal').classList.remove('active');
        }
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
    if(IS_TEST_MODE) return;
    try {
        const res = await fetch('/api/hub/status', {
            headers: { 'Authorization': `Bearer ${itToken}` }
        });
        const data = await res.json();
        updateHubUI(data.active, data.port);
    } catch(e) { console.log("Hub check failed", e); }
}

async function toggleHub(e) {
    if (IS_TEST_MODE) {
        const isStart = e.target.id === 'btnStartHub';
        showToast(isStart ? "LAN-Hub erfolgreich gestartet (Simulation)" : "LAN-Hub gestoppt", "success");
        updateHubUI(isStart, 3000);
        logEvent(isStart ? "Hub Process STARTED on Port 3000" : "Hub Process STOPPED");
        return;
    }

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

        if(!socket && !IS_TEST_MODE) connectMasterSocket();
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

    if(IS_TEST_MODE) {
        showToast(`Antwort an Ticket ${ticketId} gesendet (Mock).`, "success");
        // Update mock status
        const t = DUMMY_TICKETS.find(x => x.id === ticketId);
        if(t) t.status = 'closed';
        renderTickets(DUMMY_TICKETS);
        document.getElementById('ticketDetail').innerHTML = '<div style="color:#666; text-align:center; padding-top:50px;">Ticket erledigt.</div>';
    } else {
        // Real logic
        showToast("Senden...", "info");
    }
};

window.closeTicket = function(ticketId) {
    if(IS_TEST_MODE) {
        const t = DUMMY_TICKETS.find(x => x.id === ticketId);
        if(t) t.status = 'closed';
        renderTickets(DUMMY_TICKETS);
        document.getElementById('ticketDetail').innerHTML = '<div style="color:#666; text-align:center; padding-top:50px;">Ticket geschlossen.</div>';
        showToast("Ticket geschlossen.", "info");
    }
}

function addTicketToInbox(data) {
    const inbox = document.getElementById('ticketList');
    const div = document.createElement('div');
    div.className = 'ticket-item unread';
    div.innerHTML = `<div style="font-weight:bold; color:#fff;">User: ${data.fromUserId}</div><div style="font-size:0.8rem; color:#888;">${new Date(data.timestamp).toLocaleTimeString()}</div>`;
    div.onclick = () => {
        const detail = document.getElementById('ticketDetail');
        detail.innerHTML = `
            <h3>Anfrage von ${data.fromUserId}</h3>
            <p style="color:#ccc; margin-top:10px;">Payload (Encrypted):</p>
            <div style="background:#000; padding:10px; font-family:monospace; color:#00ff88; word-break:break-all;">${data.payload}</div>
            <div style="margin-top:20px;">
                <button onclick="window.decryptMessage('dec-${Date.now()}', '${data.payload}')" class="btn-action">Decrypt</button>
                <button onclick="window.replyToUser('${data.fromUserId}')" class="btn-action" style="margin-top:10px;">Reply</button>
            </div>
            <div id="dec-${Date.now()}"></div>
        `;
    };
    inbox.prepend(div);
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
    if(IS_TEST_MODE) {
        alert("Reply Simulation: Nachricht gesendet.");
        return;
    }
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
    if(IS_TEST_MODE) {
        showToast("Export Simulation: Keys downloaded.", "success");
        return;
    }
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
    if(IS_TEST_MODE) {
        showToast("Import Simulation: Employees loaded.", "success");
        return;
    }
    // Real logic would be upload
    showToast("Import wird verarbeitet...", "info");
}

async function resetDeviceBinding() {
    const userId = document.getElementById('resetUserId').value;
    if(!userId) return showToast("ID eingeben", "error");
    if(IS_TEST_MODE) {
        showToast("Reset Simulation: Device cleared.", "success");
        return;
    }
    try {
        const res = await fetch(`${API_BASE}/reset-device/${userId}`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${itToken}` }
        });
        if(res.ok) showToast("Gerätebindung gelöscht.", "success");
        else showToast("Fehler beim Reset", "error");
    } catch(e) { showToast("Fehler", "error"); }
}
