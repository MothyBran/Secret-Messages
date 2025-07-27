
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
