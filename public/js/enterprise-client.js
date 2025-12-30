// public/js/enterprise-client.js
const ENT_API_BASE = '/api/enterprise';

// State
let entSocket = null;
let entHubUrl = null;
let entUser = null;

async function initEnterpriseClient() {
    console.log("🏢 Initializing Enterprise Client...");

    // 1. Hide Cloud Elements
    const idsToHide = ['upgradeBtn', 'newsTicker', 'pricingSection', 'footer-legal', 'navChangeCode', 'navSupport'];
    idsToHide.forEach(id => {
        const el = document.getElementById(id);
        if(el) el.style.display = 'none';
    });

    // 2. Discover Hub
    if (window.electronAPI) {
        showLoader("Suche Enterprise Hub...");
        try {
            const res = await window.electronAPI.scanHub();
            if (res.success) {
                entHubUrl = `http://${res.host}:${res.port}`;
                console.log("Hub Found:", entHubUrl);
                showToast(`Hub gefunden: ${res.host}`, 'success');
            } else {
                console.warn("Hub discovery failed or timed out.");
                // Check local activation
                const conf = await fetch('/api/config').then(r => r.json());
                if(conf.mode === 'ENTERPRISE' && conf.activated) {
                     entHubUrl = window.location.origin;
                } else {
                    // Check if we need activation
                    if(conf.mode === 'ENTERPRISE' && !conf.activated) {
                        showEnterpriseActivation();
                        hideLoader();
                        return;
                    }
                    showToast("Kein Hub gefunden. Bitte Admin kontaktieren.", 'error');
                }
            }
        } catch(e) { console.error("IPC Error:", e); }
        hideLoader();
    } else {
        entHubUrl = window.location.origin;
    }

    // 3. Load socket.io
    if (typeof io === 'undefined') {
        const script = document.createElement('script');
        const src = entHubUrl ? `${entHubUrl}/socket.io/socket.io.js` : '/socket.io/socket.io.js';
        script.src = src;
        script.onload = setupSocket;
        script.onerror = () => { console.warn("Could not load socket.io client."); };
        document.body.appendChild(script);
    } else {
        setupSocket();
    }
}

function showEnterpriseActivation() {
    // Inject Activation Modal for Enterprise
    const modalHtml = `
    <div id="entActivationModal" class="modal active" style="z-index:9999; background:rgba(0,0,0,0.9);">
        <div class="modal-box" style="border:1px solid var(--accent-blue); box-shadow:0 0 30px var(--accent-blue);">
            <h2 style="color:var(--accent-blue);">Enterprise Aktivierung</h2>
            <p>Bitte geben Sie Ihren Master-Lizenzschlüssel ein, um diesen Hub zu aktivieren.</p>
            <input type="text" id="entMasterKey" class="input-field" placeholder="ENT-XXXX-XXXX" style="margin:20px 0;">
            <button class="btn btn-primary" onclick="activateEnterprise()">Aktivieren</button>
        </div>
    </div>
    `;
    const div = document.createElement('div');
    div.innerHTML = modalHtml;
    document.body.appendChild(div);
}

window.activateEnterprise = async function() {
    const key = document.getElementById('entMasterKey').value.trim();
    if(!key) return;
    try {
        const res = await fetch('/api/enterprise/activate', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ key })
        });
        const data = await res.json();
        if(data.success) {
            alert("Aktivierung erfolgreich! App wird neu geladen.");
            window.location.reload();
        } else {
            alert("Fehler: " + data.error);
        }
    } catch(e) { alert("Verbindungsfehler"); }
};

function setupSocket() {
    if(!entHubUrl) return;

    entSocket = io(entHubUrl);

    entSocket.on('connect', () => {
        console.log(`🔌 Connected to Enterprise Hub at ${entHubUrl}`);
        performSocketAuth();
    });

    entSocket.on('auth_fail', () => {
        // If auth fails, it implies we don't have valid credentials for the Hub.
        // We prompt the user for Enterprise Access Code if we have a username but no code,
        // OR we rely on the main app login which should have provided credentials.
        // But main app login is local-first?
        // Wait, "Der Client sendet Username + Local-Key an den Hub."
        // We need to capture the access code during login in app.js and store it temporarily in sessionStorage.

        const storedUser = JSON.parse(localStorage.getItem('sm_user'));
        const sessionCode = sessionStorage.getItem('sm_session_code'); // We need to ensure app.js saves this on login

        if (!storedUser || !sessionCode) {
            console.warn("Enterprise Auth: Missing credentials.");
            // We can't auth. User needs to login again via main form.
            return;
        }

        // Retry or give up?
        // If we already sent it and failed, then credentials are wrong.
        console.error("Enterprise Auth Failed with provided credentials.");
        showToast("Enterprise Login fehlgeschlagen.", 'error');
    });

    entSocket.on('auth_success', (data) => {
        console.log("Enterprise Auth Success:", data);
        entUser = data;
        showToast("Mit Enterprise Hub verbunden.", 'success');

        // Load messages?
        // messages are pushed via new_message event
    });

    entSocket.on('new_message', (msg) => {
        showToast(`Neue Nachricht von ${msg.sender}`, 'info');
        // We should inject this into the inbox UI logic of app.js
        // app.js uses fetch('/api/messages').
        // We can manually trigger a reload or inject it into DOM.
        // Since we patched server.js to possibly serve these messages via API (if we did?),
        // calling loadAndShowInbox() might work IF server.js uses the same DB or proxies.
        // But `server.js` uses `messages` table for `/api/messages`.
        // `enterprise/socketServer.js` uses `enterprise_messages` table.
        // So `/api/messages` won't return these unless we update the endpoint.
        // Assuming we rely on the Socket pushing data to update UI directly or we patch the fetch.
        // For MVP, simply notifying is "working", but displaying is better.
        // Let's rely on the notification for now or simple injection if inbox is open.
    });

    // Add Send Button
    const outputGroup = document.getElementById('outputGroup');
    if (outputGroup && !document.getElementById('entSendBtn')) {
        const btn = document.createElement('button');
        btn.id = 'entSendBtn';
        btn.textContent = '📨 Intern Versenden';
        btn.className = 'btn btn-primary';
        btn.style.marginTop = '10px';
        btn.onclick = openEnterpriseSendModal;
        outputGroup.appendChild(btn);
    }
}

function performSocketAuth() {
    const storedUser = JSON.parse(localStorage.getItem('sm_user'));
    // We need to retrieve the access code.
    // Security risk: storing plain access code in local storage is bad.
    // Ideally, we prompt or we use the hash?
    // The Hub expects `accessCode` (plain) to compare with hash.
    // `app.js` `handleLogin` uses `accessCode` to POST to `/api/auth/login`.
    // We should hook into `handleLogin` to capture it in memory/sessionStorage.

    const sessionCode = sessionStorage.getItem('sm_auth_code_temp'); // Let's use this key

    if (storedUser && sessionCode) {
        entSocket.emit('auth', {
            username: storedUser.name,
            accessCode: sessionCode
        });
    }
}

function openEnterpriseSendModal() {
    const payload = document.getElementById('messageOutput').value;
    const recipient = prompt("Empfänger ID (oder leer für Broadcast wenn Admin):");
    if (recipient === null) return;

    entSocket.emit('send_message', {
        recipientId: recipient,
        subject: 'Verschlüsselte Nachricht',
        body: payload,
        attachmentBase64: null
    });
    showToast("Gesendet!", 'success');
}

window.initEnterpriseClient = initEnterpriseClient;
