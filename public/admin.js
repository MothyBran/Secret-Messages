
// ---- Helpers ----
function formatDateDE(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function calcRemainingDays(iso) {
  if (!iso) return '—';
  const exp = new Date(iso).getTime();
  if (isNaN(exp)) return '—';
  const diff = Math.ceil((exp - Date.now()) / (1000*60*60*24));
  return diff >= 0 ? `${diff} Tage` : '0 Tage';
}

// admin.js - Admin Panel JavaScript

// Global variables
let adminPassword = '';
const API_BASE = '/api';

// DOM Ready
document.addEventListener('DOMContentLoaded', function() {
    // Login Button
    document.getElementById('loginBtn').addEventListener('click', handleLogin);
    
    // Enter key on password field
    document.getElementById('adminPassword').addEventListener('keypress', function(e) {
        if (e.key === 'Enter') handleLogin();
    });
    
    // Dashboard buttons
    document.getElementById('logoutBtn').addEventListener('click', handleLogout);
    document.getElementById('generateKeysBtn').addEventListener('click', generateKeys);
    document.getElementById('loadUsersBtn').addEventListener('click', loadUsers);
    document.getElementById('loadKeysBtn').addEventListener('click', loadKeys);
    
    // Initial focus
    document.getElementById('adminPassword').focus();
    
    // Auto-refresh stats every 30 seconds
    setInterval(() => {
        if (adminPassword) {
            refreshStats();
            checkSystemHealth();
        }
    }, 30000);
});

// Check system health
async function checkSystemHealth() {
    try {
        const response = await fetch(`${API_BASE}/health`);
        const data = await response.json();
        
        if (data.status === 'ok') {
            document.getElementById('systemStatus').textContent = 'System Status: Online ✅';
            document.getElementById('systemStatus').style.borderColor = '#00ff41';
        } else {
            document.getElementById('systemStatus').textContent = 'System Status: Error ❌';
            document.getElementById('systemStatus').style.borderColor = '#ff0033';
        }
    } catch (error) {
        document.getElementById('systemStatus').textContent = 'System Status: Verbindungsfehler ⚠️';
        document.getElementById('systemStatus').style.borderColor = '#ff0033';
    }
}

// Admin login
async function handleLogin() {
    const password = document.getElementById('adminPassword').value;
    const loginBtn = document.getElementById('loginBtn');
    const loginBtnText = document.getElementById('loginBtnText');
    const loginError = document.getElementById('loginError');
    
    if (!password) {
        loginError.textContent = 'Bitte Admin-Passwort eingeben';
        loginError.style.display = 'block';
        return;
    }
    
    loginBtn.disabled = true;
    loginBtnText.innerHTML = '<span class="spinner"></span>Prüfe...';
    
    try {
        const response = await fetch(`${API_BASE}/admin/stats`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ password })
        });
        
        const data = await response.json();
        
        if (data.success) {
            adminPassword = password;
            loginError.style.display = 'none';
            document.getElementById('loginForm').style.display = 'none';
            document.getElementById('dashboard').style.display = 'block';
            
            // Load stats
            loadStatistics(data.stats);
            checkSystemHealth();
        } else {
            loginError.textContent = data.error || 'Ungültiges Admin-Passwort';
            loginError.style.display = 'block';
        }
    } catch (error) {
        loginError.textContent = 'Verbindungsfehler zum Server';
        loginError.style.display = 'block';
    } finally {
        loginBtn.disabled = false;
        loginBtnText.textContent = 'ANMELDEN';
    }
}

// Load statistics
function loadStatistics(stats = {}) {
  const safe = (v) => (v !== undefined && v !== null) ? String(v) : '0';

  document.getElementById('totalKeys').textContent = safe(stats.totalKeys);
  document.getElementById('activeUsers').textContent = safe(stats.activeUsers);
  document.getElementById('activeSessions').textContent = safe(stats.activeSessions);
  document.getElementById('recentRegistrations').textContent = safe(stats.recentRegistrations);
}

// Generate keys
async function generateKeys() {
  const quantity = parseInt(document.getElementById('keyQuantity').value);
  const generateBtn = document.getElementById('generateKeysBtn');
  const generateBtnText = document.getElementById('generateBtnText');
  const result = document.getElementById('generationResult');

  if (quantity < 1 || quantity > 100 || isNaN(quantity)) {
    result.className = 'alert error';
    result.textContent = 'Anzahl muss zwischen 1 und 100 liegen';
    result.style.display = 'block';
    return;
  }

  generateBtn.disabled = true;
  generateBtnText.innerHTML = '<span class="spinner"></span>Generiere...';

  try {
    const response = await fetch(`${API_BASE}/admin/generate-key`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        password: adminPassword,
        quantity
      })
    });

    const data = await response.json();

    if (data.success) {
      result.className = 'alert success';
      result.innerHTML = `<strong>✅ ${data.keys.length} Keys generiert!</strong><br><br>`;

      data.keys.forEach(key => {
        const keyCode = typeof key === 'string' ? key : key.key_code;
        result.innerHTML += `<span class="key-code">${keyCode}</span><br>`;
      });

      result.style.display = 'block';

      // Refresh stats
      refreshStats();
    } else {
      result.className = 'alert error';
      result.textContent = data.error || 'Fehler beim Generieren der Keys';
      result.style.display = 'block';
    }
  } catch (error) {
    console.error('Key generation error:', error);
    result.className = 'alert error';
    result.textContent = 'Verbindungsfehler zum Server';
    result.style.display = 'block';
  } finally {
    generateBtn.disabled = false;
    generateBtnText.textContent = 'KEYS GENERIEREN';
  }
}

// Load users
async function loadUsers() {
  const loadBtn = document.getElementById('loadUsersBtn');
  const loadBtnText = document.getElementById('loadUsersBtnText');
  const tableContainer = document.getElementById('userTableContainer');
  const tableBody = document.getElementById('userTableBody');

  loadBtn.disabled = true;
  loadBtnText.innerHTML = '<span class="spinner"></span>Lade...';

  try {
    const response = await fetch(`${API_BASE}/admin/users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ 
        password: adminPassword,
        page: 1,
        limit: 100
      })
    });

    const data = await response.json();

    if (data.success) {
      tableBody.innerHTML = '';

      const users = data.users || [];

      if (users.length > 0) {
        users.forEach(user => {
          const row = tableBody.insertRow();

          // OnlineStatus statt alter Status
          let statusText = '🔴 Offline';
          if (user.is_blocked) statusText = '⛔ Gesperrt';
          else if (user.is_online) statusText = '🟢 Online';

          row.innerHTML = `
            <td>${user.id}</td>
            <td>${user.name}</td>
            <td><span class="key-code">${user.key_code || '-'}</span></td>
            <td>${statusText}</td>
            <td>${formatDateDE(user.registered_at)}</td>
            <td>${user.last_login ? formatDateDE(user.last_login) : '—'}</td>
            <td>
              ${user.is_blocked
                ? `<button class="btn btn-small btn-success btn-unblock-user" data-id="${user.id}">Entsperren</button>`
                : `<button class="btn btn-small btn-danger btn-block-user" data-id="${user.id}">Sperren</button>`}
              <button class="btn btn-small btn-secondary btn-delete-user" data-id="${user.id}">Löschen</button>
            </td>
          `;
        });
      } else {
        const row = tableBody.insertRow();
        row.innerHTML = '<td colspan="7" style="text-align: center;">Keine Benutzer gefunden</td>';
      }

      tableContainer.style.display = 'block';
    } else {
      alert(data.error || 'Fehler beim Laden der Benutzer');
    }
  } catch (error) {
    console.error('Fehler beim Benutzerladen:', error);
    alert('Verbindungsfehler zum Server');
  } finally {
    loadBtn.disabled = false;
    loadBtnText.textContent = 'BENUTZER LADEN';
  }
}


// Refresh statistics
async function refreshStats() {
    try {
        const response = await fetch(`${API_BASE}/admin/stats`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ password: adminPassword })
        });
        
        const data = await response.json();
        
        if (data.success) {
            loadStatistics(data.stats);
        }
    } catch (error) {
        console.error('Error refreshing stats:', error);
    }
}

// Logout mit Token
async function handleLogout() {
  const token = localStorage.getItem('token');

  if (token) {
    try {
      await fetch(`${API_BASE}/auth/logout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        }
      });
    } catch (error) {
      console.error('Logout-Fehler:', error);
    }
  }

  // Local cleanup
  localStorage.removeItem('token');
  adminPassword = '';
  document.getElementById('adminPassword').value = '';
  document.getElementById('dashboard').style.display = 'none';
  document.getElementById('loginForm').style.display = 'flex';
  document.getElementById('loginError').style.display = 'none';
}
// Benuter sperren
  function sperreBenutzer(username) {
    if (users[username]) {
      users[username].gesperrt = true;
      localStorage.setItem("users", JSON.stringify(users));
      alert(`Benutzer ${username} wurde gesperrt.`);
      location.reload();
    }
  }
// Benuter löschen
  function loescheBenutzer(username) {
    if (confirm(`Benutzer ${username} wirklich löschen?`)) {
      delete users[username];
      localStorage.setItem("users", JSON.stringify(users));
      alert(`Benutzer ${username} gelöscht.`);
      location.reload();
    }
  }

// Load Purchases
async function loadPurchases() {
  const btn = document.getElementById("loadPurchasesBtn");
  const btnText = document.getElementById("loadPurchasesBtnText");
  const tableBody = document.getElementById("purchaseTableBody");
  const tableContainer = document.getElementById("purchaseTableContainer");

  btn.disabled = true;
  btnText.innerHTML = '<span class="spinner"></span>Lade...';

  try {
    const response = await fetch(`${API_BASE}/admin/purchases`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: adminPassword })
    });

    const data = await response.json();

    if (data.success) {
      tableBody.innerHTML = "";

      if (!data.purchases || data.purchases.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="5" style="text-align:center;">Keine Käufe gefunden</td></tr>`;
      } else {
        data.purchases.forEach(purchase => {
          const row = document.createElement("tr");
          row.innerHTML = `
            <td>${purchase.id}</td>
            <td>${purchase.buyer || '-'}</td>
            <td>${purchase.license || '-'}</td>
            <td>${purchase.price || '-'}</td>
            <td>${formatDateDE(purchase.date)}</td>
          `;
          tableBody.appendChild(row);
        });
      }

      tableContainer.style.display = "block";
    } else {
      alert(data.error || "Fehler beim Laden der Käufe.");
    }
  } catch (error) {
    console.error("Fehler beim Laden der Käufe:", error);
    alert("Verbindungsfehler zum Server.");
  } finally {
    btn.disabled = false;
    btnText.textContent = "KÄUFE LADEN";
  }
}

// Determine key status
function computeKeyStatus(k) {
  const isActive = !!k.is_active;
  const activatedAt = k.activated_at ? new Date(k.activated_at).getTime() : null;
  const expires = k.expires_at ? new Date(k.expires_at).getTime() : null;
  const now = Date.now();

  if (!activatedAt) return 'inactive';            // noch nicht gekoppelt
  if (expires && expires <= now) return 'expired'; // abgelaufen
  if (!isActive) return 'blocked';  // manuell gesperrt
  if (isActive && activatedAt) return 'active'; // korrekt aktiv
  return 'inactive';
}

// Product label helper
function productLabel(code) {
  if (!code) return '-';
  const map = { '1m':'1m','3m':'3m','6m':'6m','12m':'1y','1y':'1y','unl':'unl','unlimited':'unl' };
  return map[code] || code;
}

// Admin actions
async function adminActivateKey(id) {
  const code = prompt("Laufzeit wählen: 1m, 3m, 6m, 12m, unl", "1m");
  if (!code) return;
  const resp = await fetch(`${API_BASE}/admin/keys/${id}/activate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: adminPassword, product_code: code })
  });
  const data = await resp.json();
  if (!data.success) return alert(data.error || 'Aktivierung fehlgeschlagen');
  await loadKeys();
}

async function adminBlockKey(id) {
  if (!confirm("Diesen Key sperren?")) return;
  const resp = await fetch(`${API_BASE}/admin/keys/${id}/disable`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: adminPassword })
  });
  const data = await resp.json();
  if (!data.success) return alert(data.error || 'Sperren fehlgeschlagen');
  await loadKeys();
}

window.adminActivateKey = adminActivateKey;
window.adminBlockKey = adminBlockKey;

document.getElementById('keysStatusFilter')?.addEventListener('change', () => loadKeys());

// ---- Keys Loader ----
async function loadKeys() {
  const btn = document.getElementById("loadKeysBtn");
  const btnText = document.getElementById("loadKeysBtnText") || btn;
  const tableBody = document.getElementById("keysTableBody");
  const tableContainer = document.getElementById("keysTableContainer");
  const statusFilter = document.getElementById("keysStatusFilter");

  if (!tableBody) return;

  if (btn) btn.disabled = true;
  if (btnText) btnText.innerHTML = '<span class="spinner"></span>Lade...';

  try {
    const response = await fetch(`${API_BASE}/admin/license-keys`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        password: adminPassword,
        page: 1,
        limit: 100,
        status: statusFilter ? statusFilter.value : 'all'
      })
    });

    const data = await response.json();

    if (data.success) {
      tableBody.innerHTML = "";
      const keys = data.keys || [];

      if (keys.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="7" style="text-align:center;">Keine Keys gefunden</td></tr>';
      } else {
        keys.forEach(k => {
          const st = computeKeyStatus(k);
          let statusText = '✅ Aktiv';
          if (st === 'inactive') statusText = '⏳ Inaktiv';
          if (st === 'expired') statusText = '❌ Abgelaufen';
          if (st === 'blocked') statusText = '⛔ Gesperrt';

          const created = k.created_at || null;
          const activated = k.activated_at || null;
          const expires = st === 'active' ? (k.expires_at || null) : null;
          const remaining = st === 'active' ? calcRemainingDays(expires) : '—';
          const product = k.product_code || '-';
          
          const row = document.createElement("tr");
          row.innerHTML = `
            <td><span class="key-code">${k.key_code}</span></td>
            <td>${product}</td>
            <td>${statusText}</td>
            <td>${formatDateDE(created)}</td>
            <td>${activated ? formatDateDE(activated) : '—'}</td>
            <td>${expires ? formatDateDE(expires) : '—'}</td>
            <td>${remaining}</td>
            <td>
              ${st === 'inactive'
                ? `<button class="btn btn-small btn-danger action-delete" data-id="${k.id}">❌</button>`
                : st === 'active'
                  ? `<button class="btn btn-small action-activate" data-id="${k.id}">⏳</button>`
                  : ''
              }
            </td>
          `;
          tableBody.appendChild(row);
        });
      }

      if (tableContainer) tableContainer.style.display = "block";
    } else {
      alert(data.error || "Fehler beim Laden der Lizenz-Keys.");
    }
  } catch (error) {
    console.error("Fehler beim Laden der Lizenz-Keys:", error);
    alert("Verbindungsfehler zum Server.");
  } finally {
    if (btn) btn.disabled = false;
    if (btnText) btnText.textContent = "KEYS LADEN";
  }
}

// ---- Event delegation for key actions (CSP-safe) ----
// Nur Laufzeit (Produktcode) ändern
document.getElementById('keysTableContainer')?.addEventListener('click', async (ev) => {
  const btn = ev.target.closest('button');
  if (!btn) return;

  const id = btn.dataset.id;
  if (!id) return;

  if (btn.classList.contains('action-activate')) {
    const code = prompt("Laufzeit wählen: 1m, 3m, 6m, 12m, unl", "1m");
    if (!code) return;

    try {
      const resp = await fetch(`${API_BASE}/admin/keys/${id}/activate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: adminPassword, product_code: code })
      });
      const data = await resp.json();
      if (!data.success) return alert(data.error || 'Aktivierung fehlgeschlagen');
      await loadKeys();
    } catch {
      alert('Serverfehler bei Aktivierung.');
    }
  }

  if (btn.classList.contains('action-delete')) {
    if (!confirm("Diesen Lizenz-Key wirklich löschen?")) return;

    try {
      const res = await fetch(`${API_BASE}/admin/keys/${id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: adminPassword })
      });
      const data = await res.json();
      if (data.success) {
        alert('Key gelöscht.');
        await loadKeys();
      } else {
        alert(data.error || 'Fehler beim Löschen');
      }
    } catch {
      alert('Verbindungsfehler beim Löschen');
    }
  }
});

// Event Delegation für Benutzeraktionen
document.addEventListener('click', async (e) => {
  const btn = e.target;

  // Sperren
  if (btn.classList.contains('btn-block-user')) {
    const userId = btn.dataset.id;
    if (!confirm('Benutzer wirklich sperren?')) return;

    try {
      const res = await fetch(`${API_BASE}/admin/block-user/${userId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: adminPassword })
      });
      const data = await res.json();
      if (data.success) {
        alert('Benutzer gesperrt.');
        loadUsers(); // neu laden
      } else {
        alert(data.error || 'Fehler beim Sperren');
      }
    } catch (err) {
      alert('Verbindungsfehler beim Sperren');
    }
  }

  // Entsperren
  if (btn.classList.contains('btn-unblock-user')) {
    const userId = btn.dataset.id;
    if (!confirm('Benutzer wirklich entsperren?')) return;

    try {
      const res = await fetch(`${API_BASE}/admin/unblock-user/${userId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: adminPassword })
      });
      const data = await res.json();
      if (data.success) {
        alert('Benutzer entsperrt.');
        loadUsers(); // neu laden
      } else {
        alert(data.error || 'Fehler beim Entsperren');
      }
    } catch (err) {
      alert('Verbindungsfehler beim Entsperren');
    }
  }

  // Löschen
  if (btn.classList.contains('btn-delete-user')) {
    const userId = btn.dataset.id;
    if (!confirm('Benutzer wirklich löschen?')) return;
    if (!confirm('Letzte Warnung: Dieser Vorgang ist unwiderruflich.')) return;

    try {
      const res = await fetch(`${API_BASE}/admin/delete-user/${userId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: adminPassword })
      });
      const data = await res.json();
      if (data.success) {
        alert('Benutzer gelöscht.');
        loadUsers(); // neu laden
      } else {
        alert(data.error || 'Fehler beim Löschen');
      }
    } catch (err) {
      alert('Verbindungsfehler beim Löschen');
    }
  }
});

// ---- Safe initializer at end ----
(function () {
  function attach() {
    const loginBtn  = document.getElementById('loginBtn');
    const pw        = document.getElementById('adminPassword');
    const logoutBtn = document.getElementById('logoutBtn');
    const genBtn    = document.getElementById('generateKeysBtn');
    const usersBtn  = document.getElementById('loadUsersBtn');
    const keysBtn   = document.getElementById('loadKeysBtn');
    const statusFilter = document.getElementById('keysStatusFilter');
    const purchasesBtn = document.getElementById('loadPurchasesBtn');

    if (loginBtn)  loginBtn.addEventListener('click', handleLogin);
    if (pw)        pw.addEventListener('keypress', e => { if (e.key === 'Enter') handleLogin(); });
    if (logoutBtn) logoutBtn.addEventListener('click', handleLogout);
    if (genBtn)    genBtn.addEventListener('click', generateKeys);
    if (usersBtn)  usersBtn.addEventListener('click', loadUsers);
    if (keysBtn)   keysBtn.addEventListener('click', loadKeys);
    if (purchasesBtn) purchasesBtn.addEventListener('click', loadPurchases);
    if (statusFilter) statusFilter.addEventListener('change', () => loadKeys());

    if (pw) pw.focus();

    setInterval(() => {
      if (adminPassword) {
        refreshStats();
        checkSystemHealth();
      }
    }, 30000);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', attach);
  } else {
    attach();
  }
})();



// Lizenz-Key löschen
async function deleteLicenseKey(keyCode) {
  if (!confirm('Diesen Key wirklich löschen?')) return;

  try {
    const res = await fetch(`${API_BASE}/admin/delete-key`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: adminPassword, key: keyCode })
    });

    const data = await res.json();

    if (data.success) {
      alert('Key gelöscht.');
      loadKeys();
    } else {
      alert(data.error || 'Fehler beim Löschen des Keys.');
    }
  } catch (err) {
    console.error('Fehler beim Löschen:', err);
    alert('Verbindungsfehler beim Löschen des Keys.');
  }
}


// Event delegation for Lizenz-Key löschen
document.getElementById('keysTableContainer')?.addEventListener('click', async (ev) => {
  const btn = ev.target.closest('button');
  if (!btn || !btn.classList.contains('action-delete-key')) return;

  const keyCodeEl = btn.closest('tr')?.querySelector('.key-code');
  const keyCode = keyCodeEl?.textContent?.trim();
  if (!keyCode) return;

  await deleteLicenseKey(keyCode);
});
