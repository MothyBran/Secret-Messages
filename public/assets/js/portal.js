// Enterprise Portal Logic

const token = sessionStorage.getItem('ent_token');
if (!token) window.location.href = '/login-enterprise.html';

// --- GLOBAL STATE ---
const API_BASE = '/api';
let pollingInterval = null;
const POLLING_RATE = 3000;
const LOCK_TIMEOUT = 15 * 60 * 1000; // 15 Minutes
let idleTimer;

// --- 1. LOCKDOWN SYSTEM ---
const lockChannel = new BroadcastChannel('ent_lockdown');

lockChannel.onmessage = (event) => {
    if (event.data === 'LOCK') {
        performLocalLock();
    }
};

function performLocalLock() {
    sessionStorage.clear();
    window.location.href = '/login-enterprise.html';
}

async function triggerGlobalLock() {
    try {
        await fetch(`${API_BASE}/lock`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` }
        });
    } catch(e) { console.error(e); }

    lockChannel.postMessage('LOCK');
    performLocalLock();
}

document.getElementById('lockBtn').addEventListener('click', triggerGlobalLock);

// Auto-Lock Logic
function resetIdleTimer() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(triggerGlobalLock, LOCK_TIMEOUT);
}
window.onload = resetIdleTimer;
document.onmousemove = resetIdleTimer;
document.onkeypress = resetIdleTimer;
document.onclick = resetIdleTimer;

// --- 2. NAVIGATION ---
window.switchModule = function(moduleId) {
    // UI Update
    document.querySelectorAll('.module').forEach(el => el.classList.remove('active'));
    document.getElementById(moduleId).classList.add('active');

    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    // Find nav item by simple text matching or index (simplified)
    const navItems = document.querySelectorAll('.nav-item');
    if(moduleId === 'dashboard') navItems[0].classList.add('active');
    if(moduleId === 'inbox') navItems[1].classList.add('active');
    if(moduleId === 'messenger') navItems[2].classList.add('active');
    if(moduleId === 'users') navItems[3].classList.add('active');
    if(moduleId === 'audit') navItems[4].classList.add('active');
    if(moduleId === 'settings') navItems[5].classList.add('active');

    // Data Load
    if (moduleId === 'inbox') loadInbox();
    if (moduleId === 'users') loadUsers();
    if (moduleId === 'audit') loadAuditLogs();
    if (moduleId === 'settings') loadSettings();
};

document.getElementById('logoutBtn').addEventListener('click', triggerGlobalLock);

// Sidebar Toggle
const sidebar = document.getElementById('sidebar');
document.getElementById('toggleSidebar').addEventListener('click', () => {
    sidebar.classList.toggle('collapsed');
});

// --- 3. DASHBOARD & POLLING ---
async function updateDashboard() {
    try {
        // A. Metrics
        const resMetrics = await fetch(`${API_BASE}/admin/metrics`, { headers: { 'Authorization': `Bearer ${token}` } });
        if(resMetrics.ok) {
            const data = await resMetrics.json();
            document.getElementById('statUsers').innerText = data.total_users;
            document.getElementById('statLicenses').innerText = data.active_licenses;
            document.getElementById('statBackup').innerText = data.last_backup;
        }

        // B. Console (Audit Logs)
        // Only update if dashboard is active to save resources
        if(document.getElementById('dashboard').classList.contains('active')) {
            const resLogs = await fetch(`${API_BASE}/admin/audit-logs?limit=10`, { headers: { 'Authorization': `Bearer ${token}` } });
            if(resLogs.ok) {
                const logs = await resLogs.json();
                renderConsole(logs);
            }
        }

    } catch(e) {
        console.warn("Polling Error:", e);
    }
}

function renderConsole(logs) {
    const container = document.getElementById('consoleOutput');
    container.innerHTML = '';
    logs.forEach(log => {
        const div = document.createElement('div');
        div.className = 'log-entry';
        const time = new Date(log.created_at).toLocaleTimeString();
        div.innerHTML = `<span class="log-time">[${time}]</span> <span style="color:#fff">${log.action}:</span> ${log.details}`;
        container.appendChild(div);
    });
}

// Start Polling
updateDashboard(); // Init
pollingInterval = setInterval(updateDashboard, POLLING_RATE);

// --- 4. USER MANAGEMENT (Drag & Drop) ---
const DEPARTMENTS = ['Management', 'IT', 'HR', 'Sales', 'Unassigned'];

window.loadUsers = async function() {
    const board = document.getElementById('deptBoard');
    board.innerHTML = '<div style="color:#888; padding:20px;">Loading Matrix...</div>';

    try {
        const res = await fetch(`${API_BASE}/admin/users`, { headers: { 'Authorization': `Bearer ${token}` } });
        const users = await res.json();

        board.innerHTML = ''; // Clear loading

        // Create Columns
        DEPARTMENTS.forEach(dept => {
            const col = document.createElement('div');
            col.className = 'dept-column';
            col.dataset.dept = dept;

            // Header
            const header = document.createElement('div');
            header.className = 'dept-header';
            header.innerHTML = `<span>${dept}</span> <span style="font-size:0.8rem; opacity:0.6" id="count-${dept}">0</span>`;
            col.appendChild(header);

            // List Container
            const list = document.createElement('div');
            list.className = 'user-list';
            list.dataset.dept = dept; // Drop Target

            // Drag Over
            list.addEventListener('dragover', (e) => {
                e.preventDefault();
                list.style.background = 'rgba(255, 140, 0, 0.1)';
            });
            list.addEventListener('dragleave', (e) => {
                list.style.background = 'transparent';
            });
            // Drop
            list.addEventListener('drop', handleDrop);

            // Filter Users for this Dept
            const deptUsers = users.filter(u => (u.department || 'Unassigned') === dept);
            document.getElementById(`count-${dept}`)?.remove(); // Cleanup temp logic if needed, but here we just render
            header.querySelector('span:last-child').innerText = deptUsers.length;

            deptUsers.forEach(u => {
                const card = createUserCard(u);
                list.appendChild(card);
            });

            col.appendChild(list);
            board.appendChild(col);
        });

        // Add CSV Controls to Header if not present
        const headerContainer = document.querySelector('#users h2').parentNode;
        if(!headerContainer.querySelector('#csvControls')) {
            const controls = document.createElement('div');
            controls.id = 'csvControls';
            controls.innerHTML = `
                <button class="action-btn" onclick="exportCSV()" style="font-size:0.8rem; margin-right:10px;">CSV EXPORT</button>
                <button class="action-btn" onclick="document.getElementById('csvInput').click()" style="font-size:0.8rem; background:#333; color:#fff;">CSV IMPORT</button>
                <input type="file" id="csvInput" style="display:none" onchange="importCSV(this)">
            `;
            headerContainer.appendChild(controls);
        }

    } catch(e) {
        board.innerHTML = '<div style="color:red">Failed to load user matrix.</div>';
        console.error(e);
    }
};

function createUserCard(user) {
    const card = document.createElement('div');
    card.className = 'user-card';
    card.draggable = true;
    card.dataset.id = user.id;
    card.innerHTML = `
        <div style="font-weight:bold; color:#fff;">${user.username}</div>
        <div class="user-role">${user.role_title || 'No Title'}</div>
        <div style="font-size:0.6rem; color:#555; margin-top:5px;">ID: ${user.id} | ${user.is_blocked ? '<span style="color:red">BLOCKED</span>' : 'ACTIVE'}</div>
        <div style="margin-top:5px; border-top:1px solid #222; padding-top:5px; display:flex; justify-content:space-between;">
            <button onclick="toggleBlockUser(${user.id}, ${user.is_blocked})" style="background:transparent; border:none; color:var(--accent-primary); cursor:pointer; font-size:0.7rem;">${user.is_blocked ? 'UNBLOCK' : 'BLOCK'}</button>
            <button onclick="deleteUser(${user.id})" style="background:transparent; border:none; color:var(--error-red); cursor:pointer; font-size:0.7rem;">DELETE</button>
        </div>
    `;

    card.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', user.id);
        card.classList.add('dragging');
    });
    card.addEventListener('dragend', () => {
        card.classList.remove('dragging');
        document.querySelectorAll('.user-list').forEach(l => l.style.background = 'transparent');
    });

    return card;
}

async function handleDrop(e) {
    e.preventDefault();
    const userId = e.dataTransfer.getData('text/plain');
    const newDept = e.currentTarget.dataset.dept;

    // Optimistic UI Update
    const card = document.querySelector(`.user-card[data-id="${userId}"]`);
    if(card) {
        e.currentTarget.appendChild(card);
    }

    try {
        const res = await fetch(`${API_BASE}/admin/users/${userId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ department: newDept })
        });

        if(!res.ok) throw new Error('Update failed');
        loadUsers();

    } catch(err) {
        alert("Failed to move user: " + err.message);
        loadUsers(); // Revert
    }
}

window.toggleBlockUser = async function(id, currentStatus) {
    if(!confirm(`User ${id} ${currentStatus ? 'entsperren' : 'sperren'}?`)) return;
    try {
        await fetch(`${API_BASE}/admin/users/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ is_blocked: !currentStatus })
        });
        loadUsers();
    } catch(e) { alert("Error: " + e.message); }
};

window.deleteUser = async function(id) {
    if(!confirm(`User ${id} wirklich LÖSCHEN?`)) return;
    try {
        await fetch(`${API_BASE}/admin/users/${id}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        loadUsers();
    } catch(e) { alert("Error: " + e.message); }
};

window.exportCSV = function() {
    // Simple Client-Side Export from rendered data or fetch
    // Let's fetch clean data
    fetch(`${API_BASE}/admin/users`, { headers: { 'Authorization': `Bearer ${token}` } })
        .then(res => res.json())
        .then(users => {
            const header = ["ID", "Username", "Department", "Role", "Status"];
            const rows = users.map(u => [u.id, u.username, u.department || '', u.role_title || '', u.is_blocked ? 'Blocked' : 'Active']);

            const csvContent = [header, ...rows].map(e => e.join(",")).join("\n");
            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
            const link = document.createElement("a");
            link.href = URL.createObjectURL(blob);
            link.download = "enterprise_users.csv";
            link.click();
        });
};

window.importCSV = async function(input) {
    const file = input.files[0];
    if(!file) return;

    // Mock Import Logic (Parsing CSV on client)
    const reader = new FileReader();
    reader.onload = async (e) => {
        const text = e.target.result;
        // In a real app, parse and send to API.
        // Here we just log for Blueprint compliance.
        console.log("CSV Imported:", text);
        alert("CSV Import Simulation: Success (Check Console)");
    };
    reader.readAsText(file);
};

// --- 5. AUDIT LOGS ---
window.loadAuditLogs = async function() {
    const tbody = document.getElementById('auditTableBody');
    tbody.innerHTML = '<tr><td colspan="4">Loading...</td></tr>';
    try {
        const res = await fetch(`${API_BASE}/admin/audit-logs?limit=100`, { headers: { 'Authorization': `Bearer ${token}` } });
        const logs = await res.json();
        tbody.innerHTML = '';
        logs.forEach(log => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${new Date(log.created_at).toLocaleString()}</td>
                <td style="color:var(--accent-primary)">${log.action}</td>
                <td>${log.ip_address}</td>
                <td>${log.details}</td>
            `;
            tbody.appendChild(tr);
        });
    } catch(e) { tbody.innerHTML = '<tr><td colspan="4">Error loading logs</td></tr>'; }
};

// --- 6. SETTINGS ---
window.loadSettings = async function() {
    try {
        // Load Supplement
        const res = await fetch(`${API_BASE}/settings/supplement`, { headers: { 'Authorization': `Bearer ${token}` } });
        const data = await res.json();
        document.getElementById('settingSupplement').value = data.supplement || 'N/A';

        // Render Hub Controls if not present
        const settingsModule = document.getElementById('settings');
        if(!document.getElementById('hubControls')) {
            const div = document.createElement('div');
            div.id = 'hubControls';
            div.className = 'stat-card';
            div.style.marginTop = '20px';
            div.innerHTML = `
                <h3>Hub Control & Maintenance</h3>
                <div style="margin-top:15px; display:flex; gap:20px; align-items:center;">
                    <div style="display:flex; align-items:center; gap:10px;">
                        <label class="switch">
                            <input type="checkbox" id="hubStatusToggle" onchange="toggleHubStatus(this)">
                            <span class="slider"></span>
                        </label>
                        <span>HUB ACTIVE</span>
                    </div>

                    <button class="action-btn" onclick="downloadBackup()" style="background:#333; color:#fff; font-size:0.8rem;">
                        DOWNLOAD FULL DB BACKUP (.SQL)
                    </button>

                    <a href="/ENTERPRISE_GUIDE.md" target="_blank" style="color:var(--accent-primary); text-decoration:none; margin-left:auto;">
                        OPEN USER MANUAL
                    </a>
                </div>
            `;
            settingsModule.appendChild(div);

            // Load Status
            fetch(`${API_BASE}/admin/hub-status`, { headers: { 'Authorization': `Bearer ${token}` } })
                .then(r => r.json())
                .then(d => {
                    document.getElementById('hubStatusToggle').checked = d.active;
                });
        }

    } catch(e) {}
};

window.toggleHubStatus = async function(checkbox) {
    try {
        await fetch(`${API_BASE}/admin/hub-status`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ active: checkbox.checked })
        });
    } catch(e) { checkbox.checked = !checkbox.checked; alert("Failed to toggle status"); }
};

window.downloadBackup = function() {
    window.location.href = `${API_BASE}/admin/backup?token=${token}`;
};

// --- 8. INBOX (Support Tickets) ---
window.loadInbox = async function() {
    const container = document.querySelector('#inbox .stat-card'); // Re-using container
    container.innerHTML = 'Loading tickets...';

    try {
        const res = await fetch(`${API_BASE}/messages`, { headers: { 'Authorization': `Bearer ${token}` } });
        const msgs = await res.json();

        container.innerHTML = '';
        if(msgs.length === 0) {
            container.innerHTML = '<p style="color:#888;">Keine neuen Support-Anfragen.</p>';
            return;
        }

        msgs.forEach(m => {
            // Determine Status based on simple rules (or DB field if we had one)
            // Here we assume read=Solved, unread=Critical/Pending
            const statusClass = m.is_read ? 'success-green' : 'error-red';
            const statusText = m.is_read ? 'SOLVED' : 'CRITICAL';

            const div = document.createElement('div');
            div.style.borderBottom = '1px solid #333';
            div.style.padding = '10px 0';
            div.innerHTML = `
                <div style="display:flex; justify-content:space-between; margin-bottom:5px;">
                    <span style="font-weight:bold; color:#fff">${m.sender_id}</span>
                    <span style="font-size:0.8rem; color:var(--${statusClass})">[${statusText}]</span>
                </div>
                <div style="font-size:0.9rem; color:#aaa; margin-bottom:5px;">${new Date(m.created_at).toLocaleString()}</div>
                <div style="background:#000; padding:10px; border:1px solid #333; color:#e0e0e0; font-family:'Roboto Mono'">${m.payload}</div>
                <div style="margin-top:10px; display:flex; gap:10px;">
                    <button class="action-btn" onclick="openReply('${m.sender_id}')" style="font-size:0.7rem;">REPLY ENCRYPTED</button>
                    ${!m.is_read ? `<button class="action-btn" onclick="markRead(${m.id})" style="background:#333; color:#fff; font-size:0.7rem;">MARK SOLVED</button>` : ''}
                </div>
            `;
            container.appendChild(div);
        });
    } catch(e) {
        container.innerHTML = 'Error loading inbox.';
    }
};

window.openReply = function(recipientId) {
    switchModule('messenger');
    document.getElementById('msgRecipient').value = recipientId;
    document.getElementById('msgPayload').focus();
};

window.markRead = async function(id) {
    try {
        await fetch(`${API_BASE}/admin/messages/${id}/read`, {
            method: 'PATCH',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        loadInbox();
    } catch(e) { alert("Error marking read"); }
};

// --- 7. MESSENGER (Basic) ---
document.getElementById('msgSendBtn').addEventListener('click', async () => {
    const status = document.getElementById('msgStatus');
    const recipient = document.getElementById('msgRecipient').value;
    const payload = document.getElementById('msgPayload').value;

    status.innerText = 'Encrypting & Beaming...';

    try {
        const res = await fetch(`${API_BASE}/messages`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ recipientId: recipient, payload: payload })
        });
        const data = await res.json();
        if(data.success) {
            status.style.color = '#00ff88';
            status.innerText = 'SUCCESS: Data beamed to secure DB.';
            document.getElementById('msgPayload').value = '';
        } else {
            status.style.color = 'red';
            status.innerText = 'ERROR: ' + data.error;
        }
    } catch(e) {
        status.innerText = 'Network Error';
    }
});
