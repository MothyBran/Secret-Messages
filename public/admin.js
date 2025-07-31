// admin.js - Admin Panel JavaScript (Refactored)

const API_BASE = '/api';
let adminPassword = '';

// Helpers
function formatDateDE(iso) {
  return iso ? new Date(iso).toLocaleString('de-DE') : '—';
}
function calcRemainingDays(iso) {
  if (!iso) return '—';
  const diff = Math.ceil((new Date(iso) - Date.now())/(1000*60*60*24));
  return diff>=0? `${diff} Tage` : '0 Tage';
}
function computeUserStatus(u) {
  return u.is_blocked ? '⛔ Gesperrt' : '✅ Aktiv';
}
function computeKeyStatus(k) {
  if (k.expires_at && new Date(k.expires_at) <= Date.now()) return 'Abgelaufen';
  return k.is_active ? '✅ Aktiv' : '⏳ Inaktiv';
}

// DOM Ready
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('loginBtn').onclick = handleLogin;
  document.getElementById('adminPassword').onkeypress = e => { if(e.key==='Enter') handleLogin(); };
  document.getElementById('logoutBtn').onclick = handleLogout;
  document.getElementById('generateKeysBtn').onclick = generateKeys;
  document.getElementById('loadUsersBtn').onclick = loadUsers;
  document.getElementById('loadKeysBtn').onclick = loadKeys;
  document.getElementById('loadPurchasesBtn').onclick = loadPurchases;
  setInterval(() => { if(adminPassword) refreshStats(); }, 30000);
});

// Admin login
async function handleLogin() {
  const pw = document.getElementById('adminPassword').value;
  const res = await fetch(`${API_BASE}/admin/stats`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({password:pw}) });
  const data = await res.json();
  if(data.stats) {
    adminPassword = pw;
    document.getElementById('loginForm').style.display='none';
    document.getElementById('dashboard').style.display='block';
    refreshStats();
  } else alert('Login fehlgeschlagen');
}

async function refreshStats() {
  const res = await fetch(`${API_BASE}/admin/stats`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:adminPassword})});
  const { stats } = await res.json();
  if(stats) {
    document.getElementById('totalKeys').textContent = stats.totalKeys;
    document.getElementById('activeUsers').textContent = stats.activeUsers;
    document.getElementById('activeSessions').textContent = stats.activeSessions;
    document.getElementById('recentRegistrations').textContent = stats.recentRegistrations;
  }
}

function handleLogout() {
  adminPassword = '';
  document.getElementById('dashboard').style.display='none';
  document.getElementById('loginForm').style.display='flex';
}

// Generate Keys
async function generateKeys() {
  const qty = parseInt(document.getElementById('keyQuantity').value);
  const res = await fetch(`${API_BASE}/admin/generate-key`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({password:adminPassword,quantity:qty}) });
  const data = await res.json();
  const out = document.getElementById('generationResult');
  if(data.keys) {
    out.className='alert success'; out.innerHTML = `<strong>${data.keys.length} Keys generiert</strong><br>` + data.keys.map(k=>`<div>${k}</div>`).join(''); out.style.display='block';
    refreshStats();
  } else {
    out.className='alert error'; out.textContent='Fehler'; out.style.display='block';
  }
}

// Load Users
async function loadUsers() {
  const res = await fetch(`${API_BASE}/admin/users`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:adminPassword,page:1,limit:50})});
  const { users } = await res.json();
  const tbody = document.getElementById('userTableBody'); tbody.innerHTML='';
  users.forEach(u=>{
    const tr = tbody.insertRow();
    tr.innerHTML = `
      <td>${u.id}</td>
      <td>${u.username}</td>
      <td>${computeUserStatus(u)}</td>
      <td>${formatDateDE(u.registered_at)}</td>
      <td>${formatDateDE(u.last_login)}</td>
      <td>${u.key_code||'—'}</td>
    `;
  });
  document.getElementById('userTableContainer').style.display='block';
}

// Load Keys
async function loadKeys() {
  const res = await fetch(`${API_BASE}/admin/license-keys`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:adminPassword,page:1,limit:100})});
  const { keys } = await res.json();
  const tbody = document.getElementById('keysTableBody'); tbody.innerHTML='';
  keys.forEach(k=>{
    const st = computeKeyStatus(k);
    const tr = tbody.insertRow();
    tr.innerHTML = `
      <td>${k.id}</td>
      <td>${k.key_code}</td>
      <td>${k.product_code||'—'}</td>
      <td>${st}</td>
      <td>${formatDateDE(k.created_at)}</td>
      <td>${formatDateDE(k.expires_at)}</td>
      <td>${k.assigned_user||'—'}</td>
    `;
  });
  document.getElementById('keysTableContainer').style.display='block';
}

// Load Purchases
async function loadPurchases() {
  const res = await fetch(`${API_BASE}/admin/purchases`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:adminPassword})});
  const { purchases } = await res.json();
  const tbody = document.getElementById('purchaseTableBody'); tbody.innerHTML='';
  purchases.forEach(p=>{
    const tr = tbody.insertRow();
    tr.innerHTML = `
      <td>${p.buyer}</td>
      <td>${p.license}</td>
      <td>${p.price.toFixed(2)} €</td>
      <td>${formatDateDE(p.date)}</td>
    `;
  });
  document.getElementById('purchaseTableContainer').style.display='block';
}
