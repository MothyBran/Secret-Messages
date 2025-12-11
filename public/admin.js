// admin.js - Logik für das Secret Messages Admin Panel

// ==========================================
// KONFIGURATION & STATE
// ==========================================
const API_BASE = '/api';
let adminPassword = '';

// ==========================================
// HELPER FUNCTIONS
// ==========================================

function formatDateDE(isoString) {
    if (!isoString) return '—';
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return '—';
    return date.toLocaleString('de-DE', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
    });
}

function formatMoney(amount) {
    // Stripe speichert Beträge in Cent (z.B. 199 = 1,99€)
    return (amount / 100).toFixed(2).replace('.', ',') + ' €';
}

function calcRemainingDays(isoString) {
    if (!isoString) return '—';
    const exp = new Date(isoString).getTime();
    const now = Date.now();
    if (isNaN(exp)) return '—';
    
    const diff = Math.ceil((exp - now) / (1000 * 60 * 60 * 24));
    
    if (diff < 0) return '<span style="color:red">Abgelaufen</span>';
    return `<span style="color:#00ff41">${diff} Tage</span>`;
}

// ==========================================
// INITIALISIERUNG & EVENT LISTENERS
// ==========================================

document.addEventListener('DOMContentLoaded', () => {
    // Login Handling
    const loginBtn = document.getElementById('loginBtn');
    const pwInput = document.getElementById('adminPassword');
    
    if (loginBtn) loginBtn.addEventListener('click', handleLogin);
    if (pwInput) {
        pwInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') handleLogin();
        });
        pwInput.focus();
    }

    // Dashboard Actions
    document.getElementById('logoutBtn')?.addEventListener('click', handleLogout);
    document.getElementById('generateKeysBtn')?.addEventListener('click', generateKeys);
    
    // Load Data Buttons
    document.getElementById('loadUsersBtn')?.addEventListener('click', loadUsers);
    document.getElementById('loadKeysBtn')?.addEventListener('click', loadKeys);
    document.getElementById('loadPurchasesBtn')?.addEventListener('click', loadPurchases);
    
    // Filter
    document.getElementById('keysStatusFilter')?.addEventListener('change', loadKeys);
    
    // Globale Suche (Input Event)
    document.getElementById('globalSearch')?.addEventListener('keyup', filterAllTables);
    
    // FIX CSP: Event Delegation für alle dynamischen Buttons
    setupDelegatedListeners();
});

// ==========================================
// AUTHENTIFIZIERUNG
// ==========================================

async function handleLogin() {
    const pwInput = document.getElementById('adminPassword');
    const password = pwInput.value.trim();
    const errorDiv = document.getElementById('loginError');

    if (!password) return;

    // Wir testen das Passwort, indem wir versuchen, Stats zu laden
    try {
        const res = await fetch(`${API_BASE}/admin/stats`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password })
        });
        const data = await res.json();

        if (data.success) {
            // Login erfolgreich
            adminPassword = password;
            document.getElementById('loginForm').style.display = 'none';
            document.getElementById('dashboard').style.display = 'block';
            
            // Initial Data Load
            updateStats(data.stats);
            loadUsers(); // Lädt User sofort
            // Auto-Refresh Stats alle 30s
            setInterval(() => refreshStats(), 30000);
        } else {
            errorDiv.textContent = 'Falsches Passwort';
            errorDiv.style.display = 'block';
        }
    } catch (err) {
        console.error(err);
        errorDiv.textContent = 'Server-Verbindungsfehler';
        errorDiv.style.display = 'block';
    }
}

function handleLogout() {
    adminPassword = '';
    location.reload();
}

// ==========================================
// STATISTIKEN
// ==========================================

async function refreshStats() {
    if (!adminPassword) return;
    try {
        const res = await fetch(`${API_BASE}/admin/stats`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: adminPassword })
        });
        const data = await res.json();
        if (data.success) updateStats(data.stats);
    } catch (e) { console.error('Stats Update Error', e); }
}

function updateStats(stats) {
    if (!stats) return;
    document.getElementById('activeUsers').innerText = stats.activeUsers || 0;
    document.getElementById('activeSessions').innerText = stats.activeSessions || 0;
    document.getElementById('recentRegistrations').innerText = stats.recentRegistrations || 0;
    
    // Falls Key-Count mitgesendet wird (Optional, je nach server.js)
    if (stats.totalKeys !== undefined) {
        document.getElementById('totalKeys').innerText = stats.totalKeys;
    }
}

// ==========================================
// 1. KEY GENERATOR
// ==========================================

async function generateKeys() {
    const qty = document.getElementById('keyQuantity').value;
    const prod = document.getElementById('keyProduct').value;
    const resultDiv = document.getElementById('generationResult');
    const btn = document.getElementById('generateKeysBtn');

    btn.disabled = true;
    btn.innerText = 'Generiere...';

    try {
        const res = await fetch(`${API_BASE}/admin/generate-keys`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                password: adminPassword,
                count: parseInt(qty),
                product: prod
            })
        });
        const data = await res.json();

        if (data.success) {
            let html = `<h4 style="color:#00ff41; margin-bottom:10px;">${data.keys.length} Keys erstellt:</h4>`;
            data.keys.forEach(k => {
                html += `<div class="key-code" style="margin-bottom:5px;">${k}</div>`;
            });
            resultDiv.innerHTML = html;
            resultDiv.style.display = 'block';
            loadKeys(); // Tabelle aktualisieren
        } else {
            alert('Fehler: ' + (data.error || 'Unbekannt'));
        }
    } catch (err) {
        alert('Serverfehler beim Generieren.');
    } finally {
        btn.disabled = false;
        btn.innerText = 'GENERIEREN';
    }
}

// ==========================================
// 2. USER TABELLE LADEN
// ==========================================

async function loadUsers() {
    const tbody = document.getElementById('userTableBody');
    const btn = document.getElementById('loadUsersBtn');
    
    btn.disabled = true;
    // FIX: Colspan auf 8 erhöht, da Device-Spalte hinzugefügt wird
    tbody.innerHTML = '<tr><td colspan="8" class="text-center">Lade Daten...</td></tr>'; 

    try {
        const res = await fetch(`${API_BASE}/admin/users`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: adminPassword })
        });
        const data = await res.json();

        if (data.success && data.users.length > 0) {
            tbody.innerHTML = '';
            data.users.forEach(u => {
                const row = document.createElement('tr');
                
                const isBlocked = u.is_blocked; // Boolean vom Server
                const device = u.allowed_device_id || '—'; 
                
                // FIX CSP: onclick entfernt, Klassen und data-Attribute hinzugefügt
                row.innerHTML = `
                    <td style="color:#888;">${u.id}</td>
                    <td style="font-weight:bold;">${u.username}</td>
                    <td>${u.license_key ? `<span class="key-code">${u.license_key}</span>` : '—'}</td>
                    
                    <td style="font-size:0.8em; color:#bbb;">
                        ${device}
                    </td>

                    <td>${isBlocked ? '<span class="status-blocked">Gesperrt</span>' : '<span class="status-active">Aktiv</span>'}</td>
                    
                    <td>${formatDateDE(u.registered_at)}</td> 
                    
                    <td>${formatDateDE(u.last_login)}</td>
                    <td>
                        <button class="btn-small action-reset-device" data-user-id="${u.id}" 
                                title="Devicebindung aufheben" 
                                ${u.allowed_device_id ? '' : 'disabled'}>⟲ Device</button>
                                
                        <button class="btn-small btn-danger action-toggle-block" data-user-id="${u.id}" data-blocked-status="${isBlocked}">
                            ${isBlocked ? 'Entsperren' : 'Sperren'}
                        </button>
                    </td>
                `;
                tbody.appendChild(row);
            });
        } else {
            // FIX: Colspan auf 8 erhöht
            tbody.innerHTML = '<tr><td colspan="8" class="text-center">Keine User gefunden</td></tr>';
        }
    } catch (err) {
        // FIX: Colspan auf 8 erhöht
        tbody.innerHTML = `<tr><td colspan="8" style="color:red">Fehler: ${err.message}</td></tr>`;
    } finally {
        btn.disabled = false;
    }
}

// AKTION: User Sperren/Entsperren
async function toggleUserBlock(userId, currentStatus) {
    if (!confirm(currentStatus ? 'User entsperren?' : 'User wirklich sperren?')) return;
    
    // Bestimme den korrekten Backend-Endpunkt
    const action = currentStatus ? 'unblock-user' : 'block-user'; 
    
    try {
        const res = await fetch(`${API_BASE}/admin/${action}/${userId}`, { 
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: adminPassword })
        });
        
        if (res.ok) {
            console.log(`User ${userId} erfolgreich ${action}t.`);
            loadUsers(); // User-Liste neu laden
        } else {
            const data = await res.json();
            alert('Aktion fehlgeschlagen: ' + (data.error || res.statusText));
        }
    } catch (e) {
        alert('Serverfehler beim Sperren/Entsperren. Bitte Konsole prüfen.');
    }
}

// AKTION: Device Reset
async function resetUserDevice(userId) {
    if (!confirm('Gerätebindung für User ' + userId + ' wirklich zurücksetzen?')) return;
    
    try {
        const res = await fetch(`${API_BASE}/admin/reset-device/${userId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: adminPassword })
        });
        
        if (res.ok) {
            alert('Gerätebindung erfolgreich zurückgesetzt!');
            loadUsers(); // User-Liste neu laden
        } else {
            const data = await res.json();
            alert('Reset fehlgeschlagen: ' + (data.error || res.statusText));
        }
    } catch (e) {
        alert('Serverfehler beim Device Reset.');
    }
}

// ==========================================
// 3. ZAHLUNGEN LADEN (Verknüpfte Daten)
// ==========================================

async function loadPurchases() {
    const tbody = document.getElementById('purchaseTableBody');
    const btn = document.getElementById('loadPurchasesBtn');

    btn.disabled = true;
    tbody.innerHTML = '<tr><td colspan="6" class="text-center">Lade Zahlungsdaten...</td></tr>';

    try {
        const res = await fetch(`${API_BASE}/admin/purchases`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: adminPassword })
        });
        const data = await res.json();

        if (data.success && data.purchases && data.purchases.length > 0) {
            tbody.innerHTML = '';
            data.purchases.forEach(p => {
                // Keys formatieren
                let keysHtml = '<span style="color:#555;">—</span>';
                if (p.keys && Array.isArray(p.keys) && p.keys.length > 0) {
                    keysHtml = p.keys.map(k => `<span class="key-code" style="font-size:0.85em;">${k}</span>`).join('<br>');
                }

                const row = document.createElement('tr');
                row.innerHTML = `
                    <td>${formatDateDE(p.date)}</td>
                    <td style="color:#fff; font-weight:bold;">${p.email}</td>
                    <td>${formatMoney(p.amount)} <small>${p.currency.toUpperCase()}</small></td>
                    <td>${keysHtml}</td>
                    <td style="font-size:0.8em; color:#666;">${p.id}</td>
                    <td>${p.status === 'completed' ? '✅ Bezahlt' : '⚠️ ' + p.status}</td>
                `;
                tbody.appendChild(row);
            });
        } else {
            tbody.innerHTML = '<tr><td colspan="6" class="text-center">Keine Käufe gefunden</td></tr>';
        }
    } catch (err) {
        console.error(err);
        tbody.innerHTML = `<tr><td colspan="6" style="color:red">Fehler: ${err.message}</td></tr>`;
    } finally {
        btn.disabled = false;
    }
}

// ==========================================
// 4. ALLE KEYS LADEN
// ==========================================

async function loadKeys() {
    const tbody = document.getElementById('keysTableBody');
    const btn = document.getElementById('loadKeysBtn');
    const filter = document.getElementById('keysStatusFilter').value;

    btn.disabled = true;
    tbody.innerHTML = '<tr><td colspan="7" class="text-center">Lade Keys...</td></tr>';

    try {
        const res = await fetch(`${API_BASE}/admin/keys`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: adminPassword, filter })
        });
        const data = await res.json();

        if (data.success && data.keys.length > 0) {
            tbody.innerHTML = '';
            data.keys.forEach(k => {
                // Status bestimmen
                let statusBadge = '<span class="status-active">Frei</span>';
                if (k.is_active) statusBadge = '<span class="status-active">Benutzt</span>';
                
                const row = document.createElement('tr');
                row.innerHTML = `
                    <td><span class="key-code">${k.key_code}</span></td>
                    <td>${k.product_code || 'Standard'}</td>
                    <td>${k.is_active ? '🔴 Aktiviert' : '🟢 Frei'}</td>
                    <td>${k.username || '—'}</td>
                    <td>${formatDateDE(k.created_at)}</td> 
                    <td>${calcRemainingDays(k.expires_at)}</td>
                    <td>
                        <button class="btn-small btn-danger action-delete-key" data-key-id="${k.id}">X</button>
                    </td>
                `;
                tbody.appendChild(row);
            });
        } else {
            tbody.innerHTML = '<tr><td colspan="7" class="text-center">Keine Keys für Filter: ' + filter + '</td></tr>';
        }
    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="7" style="color:red">Fehler: ${err.message}</td></tr>`;
    } finally {
        btn.disabled = false;
    }
}

// AKTION: Key Löschen
async function deleteKey(id) {
    if (!confirm('WARNUNG: Key wirklich unwiderruflich löschen?')) return;
    
    try {
        const res = await fetch(`${API_BASE}/admin/keys/${id}`, {
            method: 'DELETE', // DELETE Methode
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: adminPassword }) // Admin Passwort senden
        });
        
        if (res.ok) {
            console.log(`Key ${id} erfolgreich gelöscht.`);
            loadKeys();
        } else {
            const data = await res.json();
            alert('Löschen fehlgeschlagen: ' + (data.error || res.statusText));
        }
    } catch (e) { 
        alert('Serverfehler beim Löschen. Bitte Konsole prüfen.'); 
    }
}

// ==========================================
// SUCHFUNKTION (Frontend Filter)
// ==========================================

function filterAllTables() {
    const input = document.getElementById('globalSearch');
    const filter = input.value.toUpperCase();
    const tables = document.querySelectorAll('.data-table');

    tables.forEach(table => {
        const rows = table.getElementsByTagName('tr');
        // Wir starten bei 1, um den Header zu überspringen
        for (let i = 1; i < rows.length; i++) {
            const row = rows[i];
            const txtValue = row.textContent || row.innerText;
            
            if (txtValue.toUpperCase().indexOf(filter) > -1) {
                row.style.display = '';
            } else {
                row.style.display = 'none';
            }
        }
    });
}


// ==========================================
// FIX CSP: EVENT DELEGATION
// ==========================================

function setupDelegatedListeners() {
    const dashboard = document.getElementById('dashboard');
    if (!dashboard) return;

    dashboard.addEventListener('click', (e) => {
        const target = e.target.closest('button');
        if (!target) return;

        // 1. User Sperren/Entsperren
        if (target.classList.contains('action-toggle-block')) {
            const userId = target.dataset.userId;
            // Daten-Attribut ist ein String, muss zu Boolean konvertiert werden
            const currentStatus = target.dataset.blockedStatus === 'true'; 
            toggleUserBlock(userId, currentStatus);
        }

        // 2. User Device Reset
        if (target.classList.contains('action-reset-device')) {
            const userId = target.dataset.userId;
            resetUserDevice(userId);
        }
        
        // 3. Key Löschen
        if (target.classList.contains('action-delete-key')) {
            const keyId = target.dataset.keyId;
            deleteKey(keyId);
        }
    });
}
