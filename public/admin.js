// admin.js - External JavaScript for Admin Panel
// Globale Variablen
let currentPage = 1;
let adminPassword = '';

// Event Listeners für CSP-Kompatibilität
document.addEventListener('DOMContentLoaded', function() {
    // Login Button
    const loginBtn = document.getElementById('loginBtn');
    if (loginBtn) loginBtn.addEventListener('click', adminLogin);
    
    // Logout Button
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) logoutBtn.addEventListener('click', logout);
    
    // Generate Keys Button
    const generateBtn = document.getElementById('generateBtn');
    if (generateBtn) generateBtn.addEventListener('click', generateKeys);
    
    // Key Management Buttons
    const loadKeysBtn = document.getElementById('loadKeysBtn');
    if (loadKeysBtn) loadKeysBtn.addEventListener('click', () => loadKeys(1));

    const refreshStatsBtn = document.getElementById('refreshStatsBtn');
    if (refreshStatsBtn) refreshStatsBtn.addEventListener('click', refreshStats);

    const exportKeysBtn = document.getElementById('exportKeysBtn');
    if (exportKeysBtn) exportKeysBtn.addEventListener('click', exportKeys);

    // Pagination Buttons
    const prevBtn = document.getElementById('prevBtn');
    if (prevBtn) prevBtn.addEventListener('click', () => loadKeys(currentPage - 1));

    const nextBtn = document.getElementById('nextBtn');
    if (nextBtn) nextBtn.addEventListener('click', () => loadKeys(currentPage + 1));

    // System Buttons
    const systemHealthBtn = document.getElementById('systemHealthBtn');
    if (systemHealthBtn) systemHealthBtn.addEventListener('click', checkSystemHealth);

    const systemLogsBtn = document.getElementById('systemLogsBtn');
    if (systemLogsBtn) systemLogsBtn.addEventListener('click', showSystemLogs);

    const clearSessionsBtn = document.getElementById('clearSessionsBtn');
    if (clearSessionsBtn) clearSessionsBtn.addEventListener('click', clearInactiveSessions);
    
    // Enter-Taste im Passwort-Feld
    const passwordField = document.getElementById('adminPassword');
    if (passwordField) {
        passwordField.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                adminLogin();
            }
        });
    }
    
    // Key Quantity Enter-Taste
    const keyQuantity = document.getElementById('keyQuantity');
    if (keyQuantity) {
        keyQuantity.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                generateKeys();
            }
        });
    }
    
    // System Status Check beim Laden
    setTimeout(checkSystemHealth, 1000);
});

// Admin Login Funktion
async function adminLogin() {
    const password = document.getElementById('adminPassword').value;
    const loginBtnText = document.getElementById('loginBtnText');
    const loginError = document.getElementById('loginError');
    
    if (!password) {
        showError('Bitte Passwort eingeben');
        return;
    }
    
    // Loading State
    if (loginBtnText) loginBtnText.textContent = 'ANMELDUNG...';
    
    try {
        const response = await fetch('/api/admin/stats', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password })
        });
        
        if (response.ok) {
            adminPassword = password; // Passwort für weitere Requests speichern
            
            // UI umschalten
            document.getElementById('loginForm').style.display = 'none';
            document.getElementById('dashboard').style.display = 'block';
            document.getElementById('dashboard').classList.add('fade-in');
            
            // Initial laden
            await refreshStats();
            await checkSystemHealth();
            
        } else {
            showError('Ungültiges Admin-Passwort');
            if (loginBtnText) loginBtnText.textContent = 'ANMELDEN';
        }
    } catch (error) {
        showError('Verbindungsfehler: ' + error.message);
        if (loginBtnText) loginBtnText.textContent = 'ANMELDEN';
    }
}

// Logout Funktion
function logout() {
    adminPassword = '';
    document.getElementById('dashboard').style.display = 'none';
    document.getElementById('loginForm').style.display = 'block';
    document.getElementById('adminPassword').value = '';
    document.getElementById('loginBtnText').textContent = 'ANMELDEN';
    hideError();
}

// Keys Generieren
async function generateKeys() {
    const quantity = parseInt(document.getElementById('keyQuantity').value) || 1;
    const expiry = parseInt(document.getElementById('keyExpiry').value) || null;
    const generateBtnText = document.getElementById('generateBtnText');
    const output = document.getElementById('generatedKeysOutput');
    
    if (quantity < 1 || quantity > 100) {
        alert('Anzahl muss zwischen 1 und 100 liegen');
        return;
    }
    
    // Loading State
    if (generateBtnText) generateBtnText.textContent = 'GENERIERE...';
    
    try {
        const response = await fetch('/api/admin/generate-key', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                password: adminPassword, 
                quantity: quantity,
                expiresIn: expiry
            })
        });
        
        const result = await response.json();
        
        if (result.success) {
            // Keys anzeigen
            const keysHtml = result.keys.map((key, index) => `
                <div class="generated-key-item">
                    <span class="key-number">${index + 1}.</span>
                    <span class="key-code">${key.key}</span>
                    <button class="copy-btn" data-key="${key.key}">📋</button>
                </div>
            `).join('');
            
            output.innerHTML = `
                <h4>✅ ${quantity} Keys erfolgreich generiert:</h4>
                <div class="keys-list">${keysHtml}</div>
                <button class="btn" id="exportGeneratedBtn" style="margin-top: 15px;">Als CSV exportieren</button>
            `;
            output.style.display = 'block';
            
            // Copy-Button Event Listeners hinzufügen
            output.querySelectorAll('.copy-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const key = e.target.getAttribute('data-key');
                    copyToClipboard(key, e.target);
                });
            });
            
            // Export Button Event Listener
            const exportBtn = document.getElementById('exportGeneratedBtn');
            if (exportBtn) {
                exportBtn.addEventListener('click', () => exportGeneratedKeys(result.keys));
            }
            
            // Statistiken aktualisieren
            await refreshStats();
            
            // Felder zurücksetzen
            document.getElementById('keyQuantity').value = '1';
            document.getElementById('keyExpiry').value = '';
            
        } else {
            alert('Fehler beim Generieren: ' + result.error);
        }
        
    } catch (error) {
        alert('Verbindungsfehler: ' + error.message);
    } finally {
        if (generateBtnText) generateBtnText.textContent = 'Keys Generieren';
    }
}

// Statistiken laden
async function refreshStats() {
    try {
        const response = await fetch('/api/admin/stats', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: adminPassword })
        });
        
        const result = await response.json();
        
        if (result.success) {
            document.getElementById('totalKeys').textContent = result.stats.totalKeys;
            document.getElementById('activeKeys').textContent = result.stats.activeKeys;
            document.getElementById('activeSessions').textContent = result.stats.activeSessions;
            document.getElementById('dailyUsage').textContent = result.stats.dailyUsage;
            
            // Animate counters
            animateCounters();
        }
    } catch (error) {
        console.error('Stats loading error:', error);
    }
}

// Keys laden
async function loadKeys(page = 1) {
    const loading = document.getElementById('keysLoading');
    const table = document.getElementById('keysTable');
    const pagination = document.getElementById('keysPagination');
    
    // Loading anzeigen
    loading.style.display = 'block';
    table.style.display = 'none';
    
    try {
        const response = await fetch('/api/admin/keys', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                password: adminPassword, 
                page: page,
                limit: 20
            })
        });
        
        const result = await response.json();
        
        if (result.success) {
            const tbody = document.getElementById('keysTableBody');
            tbody.innerHTML = result.keys.map(key => `
                <tr>
                    <td>${key.id}</td>
                    <td class="key-code">${key.key_code}</td>
                    <td>
                        <span class="status-badge ${key.is_active ? 'active' : 'inactive'}">
                            ${key.is_active ? 'Aktiv' : 'Inaktiv'}
                        </span>
                    </td>
                    <td>${formatDate(key.created_at)}</td>
                    <td>${key.activated_at ? formatDate(key.activated_at) : '-'}</td>
                    <td>${key.activated_ip || '-'}</td>
                    <td>${key.usage_count}</td>
                    <td>${key.expires_at ? formatDate(key.expires_at) : 'Unbegrenzt'}</td>
                </tr>
            `).join('');
            
            // Pagination
            currentPage = page;
            document.getElementById('pageInfo').textContent = 
                `Seite ${page} von ${result.pagination.pages}`;
            
            document.getElementById('prevBtn').disabled = page <= 1;
            document.getElementById('nextBtn').disabled = page >= result.pagination.pages;
            
            // UI anzeigen
            loading.style.display = 'none';
            table.style.display = 'table';
            pagination.style.display = 'flex';
        }
        
    } catch (error) {
        console.error('Keys loading error:', error);
        loading.style.display = 'none';
    }
}

// System Health Check
async function checkSystemHealth() {
    try {
        const response = await fetch('/api/health');
        const result = await response.json();
        
        const statusEl = document.getElementById('systemStatus');
        const serverTime = document.getElementById('serverTime');
        const systemVersion = document.getElementById('systemVersion');
        
        if (result.status === 'ok') {
            statusEl.textContent = 'System Status: ✅ Online';
            statusEl.className = 'status-badge online';
            
            if (serverTime) serverTime.textContent = new Date(result.timestamp).toLocaleString('de-DE');
            if (systemVersion) systemVersion.textContent = result.version || '1.0.0';
            
            // Environment Info
            const envEl = document.getElementById('systemEnvironment');
            const dbEl = document.getElementById('databaseType');
            if (envEl) envEl.textContent = 'Production';
            if (dbEl) dbEl.textContent = 'SQLite';
            
            // Uptime berechnen
            const uptimeEl = document.getElementById('systemUptime');
            if (uptimeEl) {
                const startTime = new Date(result.timestamp);
                const now = new Date();
                const diffMs = now - startTime;
                const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
                uptimeEl.textContent = `${diffHours} Stunden`;
            }
        } else {
            statusEl.textContent = 'System Status: ❌ Fehler';
            statusEl.className = 'status-badge offline';
        }
        
    } catch (error) {
        const statusEl = document.getElementById('systemStatus');
        statusEl.textContent = 'System Status: ⚠️ Verbindungsfehler';
        statusEl.className = 'status-badge error';
    }
}

// Keys exportieren
async function exportKeys() {
    try {
        const response = await fetch('/api/admin/keys', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                password: adminPassword, 
                page: 1,
                limit: 1000 // Alle Keys
            })
        });
        
        const result = await response.json();
        
        if (result.success) {
            // CSV erstellen
            const csvHeader = 'ID,Key Code,Status,Erstellt,Aktiviert,IP-Adresse,Nutzung,Ablauf\n';
            const csvRows = result.keys.map(key => [
                key.id,
                key.key_code,
                key.is_active ? 'Aktiv' : 'Inaktiv',
                key.created_at,
                key.activated_at || '',
                key.activated_ip || '',
                key.usage_count,
                key.expires_at || 'Unbegrenzt'
            ].join(',')).join('\n');
            
            // Download
            const csvContent = csvHeader + csvRows;
            downloadCSV(csvContent, `secret-messages-keys-${new Date().toISOString().split('T')[0]}.csv`);
        }
        
    } catch (error) {
        alert('Export-Fehler: ' + error.message);
    }
}

// Generated Keys exportieren
function exportGeneratedKeys(keys) {
    const csvHeader = 'Key Code,Generated At\n';
    const csvRows = keys.map(key => [
        key.key,
        new Date().toISOString()
    ].join(',')).join('\n');
    
    const csvContent = csvHeader + csvRows;
    downloadCSV(csvContent, `generated-keys-${new Date().toISOString().split('T')[0]}.csv`);
}

// Inactive Sessions löschen
async function clearInactiveSessions() {
    if (!confirm('Wirklich alle inaktiven Sessions löschen?')) return;
    
    try {
        // Hier würde ein entsprechender API-Endpoint aufgerufen
        alert('Funktion wird implementiert...\n\nAktuelle inaktive Sessions werden automatisch nach 30 Tagen gelöscht.');
    } catch (error) {
        alert('Fehler: ' + error.message);
    }
}

// System Logs anzeigen
function showSystemLogs() {
    const logWindow = window.open('', '_blank', 'width=800,height=600');
    logWindow.document.write(`
        <html>
        <head><title>System Logs</title></head>
        <body style="font-family: 'Courier New', monospace; background: #000; color: #00ff41; padding: 20px;">
            <h1>🔍 System Logs</h1>
            <p>Feature wird implementiert...</p>
            <p>Logs können über Railway Dashboard → Deployments → View Logs eingesehen werden.</p>
            <button onclick="window.close()" style="margin-top: 20px; padding: 10px 20px; background: #00ff41; color: #000; border: none; border-radius: 5px; cursor: pointer;">Schließen</button>
        </body>
        </html>
    `);
}

// Hilfsfunktionen
function showError(message) {
    const errorEl = document.getElementById('loginError');
    if (errorEl) {
        errorEl.textContent = message;
        errorEl.style.display = 'block';
    }
}

function hideError() {
    const errorEl = document.getElementById('loginError');
    if (errorEl) errorEl.style.display = 'none';
}

function formatDate(dateString) {
    if (!dateString) return '-';
    return new Date(dateString).toLocaleString('de-DE');
}

function copyToClipboard(text, button) {
    navigator.clipboard.writeText(text).then(() => {
        // Kurze Bestätigung
        const originalText = button.textContent;
        button.textContent = '✅';
        setTimeout(() => {
            button.textContent = originalText;
        }, 1000);
    }).catch(() => {
        // Fallback für ältere Browser
        const textArea = document.createElement('textarea');
        textArea.value = text;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
        alert('Key kopiert: ' + text);
    });
}

function downloadCSV(content, filename) {
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    
    if (link.download !== undefined) {
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        link.setAttribute('download', filename);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }
}

function animateCounters() {
    const counters = document.querySelectorAll('.stat-number');
    counters.forEach(counter => {
        const target = parseInt(counter.textContent);
        if (isNaN(target)) return;
        
        let current = 0;
        const increment = Math.max(1, Math.ceil(target / 20));
        
        const updateCounter = () => {
            if (current < target) {
                current += increment;
                if (current > target) current = target;
                counter.textContent = current;
                setTimeout(updateCounter, 50);
            }
        };
        
        updateCounter();
    });
}
