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
        document.getElementById('systemStatus').textContent = 'System Status: Verbindungsfehler ❌';
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
function loadStatistics(stats) {
    document.getElementById('totalKeys').textContent = stats.totalKeys || '0';
    document.getElementById('activeUsers').textContent = stats.activeUsers || '0';
    document.getElementById('activeSessions').textContent = stats.activeSessions || '0';
    document.getElementById('recentRegistrations').textContent = stats.recentRegistrations || '0';
}

// Generate keys
async function generateKeys() {
    const quantity = parseInt(document.getElementById('keyQuantity').value);
    const generateBtn = document.getElementById('generateKeysBtn');
    const generateBtnText = document.getElementById('generateBtnText');
    const result = document.getElementById('generationResult');
    
    if (quantity < 1 || quantity > 100) {
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
                result.innerHTML += `<span class="key-code">${key}</span><br>`;
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
                limit: 50
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            tableBody.innerHTML = '';
            
            if (data.users && data.users.length > 0) {
                data.users.forEach(user => {
                    const row = tableBody.insertRow();
                    row.innerHTML = `
                        <td><span class="key-code">${user.key_code}</span></td>
                        <td>${user.username || '-'}</td>
                        <td>${user.is_active ? '✅ Aktiv' : '❌ Inaktiv'}</td>
                        <td>${user.activated_at ? new Date(user.activated_at).toLocaleDateString('de-DE') : '-'}</td>
                        <td>${user.last_used_at ? new Date(user.last_used_at).toLocaleDateString('de-DE') : '-'}</td>
                    `;
                });
            } else {
                const row = tableBody.insertRow();
                row.innerHTML = '<td colspan="5" style="text-align: center;">Keine Benutzer gefunden</td>';
            }
            
            tableContainer.style.display = 'block';
        } else {
            alert(data.error || 'Fehler beim Laden der Benutzer');
        }
    } catch (error) {
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

// Logout
function handleLogout() {
    adminPassword = '';
    document.getElementById('adminPassword').value = '';
    document.getElementById('dashboard').style.display = 'none';
    document.getElementById('loginForm').style.display = 'flex';
    document.getElementById('loginError').style.display = 'none';
}

function updateStatistics() {
  const users = JSON.parse(localStorage.getItem("users") || "{}");
  const activeSessions = Object.values(users).filter(u => u.loggedIn).length;
  const recentRegistrations = Object.values(users).filter(u =>
    Date.now() - new Date(u.createdAt || 0).getTime() < 7 * 24 * 60 * 60 * 1000
  ).length;

  document.getElementById("activeSessions").innerText = activeSessions;
  document.getElementById("recentRegistrations").innerText = recentRegistrations;
}

function sperreBenutzer(username) {
  const users = JSON.parse(localStorage.getItem("users") || "{}");
  if (users[username]) {
    users[username].gesperrt = true;
    localStorage.setItem("users", JSON.stringify(users));
    alert(`Benutzer ${username} wurde gesperrt.`);
    renderUserList();
  }
}

function loescheBenutzer(username) {
  const users = JSON.parse(localStorage.getItem("users") || "{}");
  if (confirm(`Benutzer ${username} wirklich löschen?`)) {
    delete users[username];
    localStorage.setItem("users", JSON.stringify(users));
    alert(`Benutzer ${username} gelöscht.`);
    renderUserList();
  }
}

function updateStatistics() {
    const users = JSON.parse(localStorage.getItem("users") || "{}");
    const activeSessions = Object.values(users).filter(u => u.loggedIn).length;
    const recentRegistrations = Object.values(users).filter(u =>
      Date.now() - new Date(u.createdAt || 0).getTime() < 7 * 24 * 60 * 60 * 1000
    ).length;

    document.getElementById("activeSessions").innerText = activeSessions;
    document.getElementById("recentRegistrations").innerText = recentRegistrations;
  }

  function sperreBenutzer(username) {
    const users = JSON.parse(localStorage.getItem("users") || "{}");
    if (users[username]) {
      users[username].gesperrt = true;
      localStorage.setItem("users", JSON.stringify(users));
      alert(`Benutzer ${username} wurde gesperrt.`);
      location.reload();
    }
  }

  function loescheBenutzer(username) {
    const users = JSON.parse(localStorage.getItem("users") || "{}");
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

      if (data.purchases.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="4" style="text-align:center;">Keine Käufe gefunden</td></tr>`;
      } else {
        data.purchases.forEach(purchase => {
          const row = document.createElement("tr");
          row.innerHTML = `
            <td>${purchase.buyer || '-'}</td>
            <td>${purchase.license}</td>
            <td>${purchase.price}</td>
            <td>${new Date(purchase.date).toLocaleDateString("de-DE")} ${new Date(purchase.date).toLocaleTimeString("de-DE")}</td>
          `;
          tableBody.appendChild(row);
        });
      }

      tableContainer.style.display = "block";
    } else {
      alert(data.error || "Fehler beim Laden der Käufe.");
    }
  } catch (error) {
    alert("Verbindungsfehler zum Server.");
  } finally {
    btn.disabled = false;
    btnText.textContent = "KÄUFE LADEN";
  }
}

document.getElementById("loadPurchasesBtn")?.addEventListener("click", loadPurchases);

  // Aufruf beim Laden
  updateStatistics();
