function updateStatistics() {
  const allUsers = JSON.parse(localStorage.getItem("users") || "{}");
  const activeSessions = Object.values(allUsers).filter(u => u.loggedIn).length;
  const recentRegistrations = Object.values(allUsers).filter(u => {
    const created = new Date(u.createdAt || Date.now());
    return Date.now() - created.getTime() < 7 * 24 * 60 * 60 * 1000;
  });

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