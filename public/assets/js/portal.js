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
    // Show Overlay instead of redirecting
    const overlay = document.getElementById('lockOverlay');
    overlay.style.display = 'flex';
    document.getElementById('unlockPass').focus();
    // Stop Polling
    clearInterval(pollingInterval);
}

// Global Lock (triggers overlay everywhere)
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

window.unlockInterface = async function() {
    const pwd = document.getElementById('unlockPass').value;
    const msg = document.getElementById('unlockMsg');
    const user = sessionStorage.getItem('ent_user');

    msg.innerText = "Verifying...";
    try {
        // Re-Login to verify password and get fresh token
        const res = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: user, password: pwd })
        });

        const data = await res.json();
        if(data.success) {
            sessionStorage.setItem('ent_token', data.token); // Refresh token
            document.getElementById('lockOverlay').style.display = 'none';
            document.getElementById('unlockPass').value = '';
            msg.innerText = "";
            // Restart Polling if not already running
            if (!pollingInterval) {
                pollingInterval = setInterval(updateDashboard, POLLING_RATE);
                updateDashboard();
            }
        } else {
            msg.innerText = "Wrong Password";
        }
    } catch(e) { msg.innerText = "Network Error"; }
};

window.logout = function() {
    // Explicit call to clear server session if needed, then client side
    fetch(`${API_BASE}/lock`, { method: 'POST', headers: { 'Authorization': `Bearer ${token}` } }).finally(() => {
        sessionStorage.clear();
        // Determine redirect target based on availability
        window.location.href = '/login.html';
    });
};

document.getElementById('lockBtn').addEventListener('click', triggerGlobalLock);
document.getElementById('logoutBtn').removeEventListener('click', triggerGlobalLock); // Remove old listener
document.getElementById('logoutBtn').addEventListener('click', logout);

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

        // Add CSV & Create Controls to Header if not present
        const headerContainer = document.querySelector('#users h2').parentNode;
        if(!headerContainer.querySelector('#csvControls')) {
            const controls = document.createElement('div');
            controls.id = 'csvControls';
            controls.style.display = 'flex';
            controls.style.gap = '10px';
            controls.innerHTML = `
                <button class="action-btn" onclick="document.getElementById('createUserModal').style.display='flex'" style="font-size:0.8rem; background:var(--accent-primary); color:#000;">+ NEW USER</button>
                <button class="action-btn" onclick="exportCSV()" style="font-size:0.8rem; background:#333; color:#fff;">EXPORT CSV</button>
                <button class="action-btn" onclick="document.getElementById('csvInput').click()" style="font-size:0.8rem; background:#333; color:#fff;">IMPORT CSV</button>
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

window.submitCreateUser = async function() {
    const u = document.getElementById('newUsername').value;
    const p = document.getElementById('newPassword').value;
    const d = document.getElementById('newDept').value;
    const r = document.getElementById('newRole').value;

    if(!u || !p) return alert("Username and Password required");

    try {
        const res = await fetch(`${API_BASE}/admin/users`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ username: u, password: p, department: d, role_title: r })
        });

        const data = await res.json();
        if(data.success) {
            document.getElementById('createUserModal').style.display = 'none';
            // Clear fields
            document.getElementById('newUsername').value = '';
            document.getElementById('newPassword').value = '';
            loadUsers();
        } else {
            alert("Error: " + data.error);
        }
    } catch(e) { alert("Network Error"); }
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

// --- 7. MESSENGER (Hybrid Enterprise Logic) ---
let currentAttachment = null;
let currentEncryptedBlob = null; // Store result for Send/Copy/Download

// Switch Logic
window.setMessengerMode = function(mode) {
    document.querySelectorAll('.msg-toggle-btn').forEach(b => b.classList.remove('active'));

    if(mode === 'encrypt') {
        document.getElementById('toggleEncrypt').classList.add('active');
        document.getElementById('modeEncrypt').style.display = 'block';
        document.getElementById('modeDecrypt').style.display = 'none';
    } else {
        document.getElementById('toggleDecrypt').classList.add('active');
        document.getElementById('modeEncrypt').style.display = 'none';
        document.getElementById('modeDecrypt').style.display = 'block';
    }
};

// A. File Handling
document.getElementById('fileInput').addEventListener('change', handleFileSelect);
// Drag & Drop
const dropZone = document.getElementById('dropZone');
dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.style.borderColor = 'var(--accent-primary)'; });
dropZone.addEventListener('dragleave', (e) => { dropZone.style.borderColor = '#333'; });
dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.style.borderColor = '#333';
    if(e.dataTransfer.files.length) handleFileSelect({ target: { files: e.dataTransfer.files } });
});

function handleFileSelect(e) {
    const file = e.target.files[0];
    if(!file) return;

    // Limit 5MB
    if(file.size > 5 * 1024 * 1024) {
        alert("Datei zu groß (Max 5MB)");
        return;
    }

    const reader = new FileReader();
    reader.onload = function(evt) {
        currentAttachment = evt.target.result; // Base64 Data URL
        document.getElementById('fileInfo').innerText = `✓ ${file.name} angehängt (${Math.round(file.size/1024)}KB)`;
        document.getElementById('msgPayload').disabled = true;
        document.getElementById('msgPayload').placeholder = "Datei angehängt. Texteingabe deaktiviert.";
    };
    reader.readAsDataURL(file);
}

// B. Encrypt
document.getElementById('btnEncrypt').addEventListener('click', async () => {
    const status = document.getElementById('msgStatus');
    const recipient = document.getElementById('msgRecipient').value;
    const passcode = document.getElementById('msgPasscode').value;
    // Payload is either text or attachment
    const payload = currentAttachment || document.getElementById('msgPayload').value;

    if(!recipient) return status.innerText = "Fehler: Empfänger-ID fehlt";
    if(!passcode || passcode.length !== 5) return status.innerText = "Fehler: 5-stelliger Code erforderlich";
    if(!payload) return status.innerText = "Fehler: Kein Inhalt";

    status.innerText = "Verschlüssele...";
    status.style.color = "var(--accent-primary)";

    try {
        const senderId = sessionStorage.getItem('ent_user');
        const supplement = document.getElementById('settingSupplement').value;

        // HYBRID ENCRYPTION
        // Use encryptHybrid which formats output as "IVHex:CipherHex::SenderID"
        currentEncryptedBlob = await window.encryptHybrid(payload, passcode, supplement, senderId, [recipient]);

        status.innerText = "VERSCHLÜSSELUNG ERFOLGREICH.";
        status.style.color = "#00ff88";

        // Also populate decrypt input for testing flow? No, keep separate.
        // We do NOT overwrite the input field in this design, we keep the clean input.
    } catch(e) {
        console.error(e);
        status.innerText = "Fehler: " + e.message;
        status.style.color = "red";
    }
});

// C. Actions (Copy, Download, Send, Clear)
document.getElementById('btnCopy').addEventListener('click', () => {
    if(!currentEncryptedBlob) return alert("Erst verschlüsseln!");
    navigator.clipboard.writeText(currentEncryptedBlob);
    alert("Verschlüsseltes Paket in Zwischenablage kopiert!");
});

document.getElementById('btnDownload').addEventListener('click', () => {
    if(!currentEncryptedBlob) return alert("Erst verschlüsseln!");
    const blob = new Blob([currentEncryptedBlob], { type: 'text/plain' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `SECURE-MSG_${Date.now()}.txt`;
    link.click();
});

document.getElementById('btnClear').addEventListener('click', () => {
    document.getElementById('msgRecipient').value = '';
    document.getElementById('msgPasscode').value = '';
    document.getElementById('msgPayload').value = '';
    document.getElementById('msgPayload').disabled = false;
    document.getElementById('msgPayload').placeholder = "";
    document.getElementById('fileInfo').innerText = '';
    document.getElementById('msgStatus').innerText = 'Bereit.';
    document.getElementById('msgStatus').style.color = '#fff';
    currentAttachment = null;
    currentEncryptedBlob = null;
});

document.getElementById('btnSend').addEventListener('click', async () => {
    const status = document.getElementById('msgStatus');
    if(!currentEncryptedBlob) return status.innerText = "Fehler: Erst verschlüsseln!";

    const recipient = document.getElementById('msgRecipient').value;

    status.innerText = "Sende Datenstrahl...";
    try {
        const res = await fetch(`${API_BASE}/messages`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({
                recipientId: recipient,
                payload: currentEncryptedBlob,
                encrypted: true
            })
        });
        const data = await res.json();
        if(data.success) {
            status.innerText = "BEAM ERFOLGREICH.";
            status.style.color = "#00ff88";
        } else { throw new Error(data.error); }
    } catch(e) {
        status.innerText = "Sende-Fehler: " + e.message;
        status.style.color = "red";
    }
});

// D. Decrypt Logic
document.getElementById('btnDecrypt').addEventListener('click', async () => {
    const cipher = document.getElementById('decInput').value;
    const passcode = document.getElementById('decPasscode').value;
    const output = document.getElementById('decOutput');

    if(!cipher || !passcode) return alert("Daten fehlen");

    try {
        const user = sessionStorage.getItem('ent_user');
        const supplement = document.getElementById('settingSupplement').value;
        if(window.setEnterpriseKeys) window.setEnterpriseKeys([supplement]);

        const decryptedPayload = await window.decryptFull(cipher, passcode, user);

        // Render
        output.innerHTML = '';
        if(decryptedPayload.startsWith('data:')) {
            // Media
            if(decryptedPayload.startsWith('data:image')) {
                output.innerHTML = `<img src="${decryptedPayload}" style="max-width:100%; border:1px solid #333;">`;
            } else {
                output.innerHTML = `<a href="${decryptedPayload}" download="decrypted_file" style="color:var(--accent-primary)">DATEI DOWNLOADEN</a>`;
            }
        } else {
            // Text
            output.innerHTML = `<div style="padding:10px; color:#fff;">${decryptedPayload.replace(/\n/g, '<br>')}</div>`;
        }
    } catch(e) {
        output.innerHTML = `<span style="color:red">Entschlüsselung fehlgeschlagen: ${e.message}</span>`;
    }
});

document.getElementById('btnDecClear').addEventListener('click', () => {
    document.getElementById('decInput').value = '';
    document.getElementById('decPasscode').value = '';
    document.getElementById('decOutput').innerHTML = '<span style="color:#666;">Warte auf Eingabe...</span>';
});
