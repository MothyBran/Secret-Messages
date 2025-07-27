
document.addEventListener("DOMContentLoaded", function () {
    const loginBtn = document.getElementById("loginBtn");
    const registerBtn = document.getElementById("registerBtn");
    const encryptBtn = document.getElementById("encryptBtn");
    const decryptBtn = document.getElementById("decryptBtn");
    const copyBtn = document.getElementById("copyBtn");
    const logoutBtn = document.getElementById("logoutBtn");
    const deleteAccountBtn = document.getElementById("deleteAccountBtn");

    loginBtn?.addEventListener("click", login);
    registerBtn?.addEventListener("click", register);
    encryptBtn?.addEventListener("click", encryptMessage);
    decryptBtn?.addEventListener("click", decryptMessage);
    copyBtn?.addEventListener("click", copyToClipboard);
    logoutBtn?.addEventListener("click", logout);
    deleteAccountBtn?.addEventListener("click", deleteAccount);

    checkLoginStatus();
});

async function encryptMessage() {
    const code = document.getElementById('messageCode').value;
    const message = document.getElementById('messageInput').value;

    if (!code || code.length !== 5) {
        alert('Bitte geben Sie einen 5-stelligen Sicherheitscode ein');
        return;
    }

    if (!message) {
        alert('Bitte geben Sie eine Nachricht ein');
        return;
    }

    try {
        const encrypted = await window.encryptFull(message, code);
        document.getElementById('messageOutput').value = encrypted;
        document.getElementById('outputGroup').style.display = 'block';
    } catch (error) {
        alert('Fehler bei der Verschlüsselung');
        console.error(error);
    }
}

async function decryptMessage() {
    const code = document.getElementById('messageCode').value;
    const encrypted = document.getElementById('messageInput').value;

    if (!code || code.length !== 5) {
        alert('Bitte geben Sie einen 5-stelligen Sicherheitscode ein');
        return;
    }

    if (!encrypted) {
        alert('Bitte geben Sie den verschlüsselten Text ein');
        return;
    }

    try {
        const decrypted = await window.decryptFull(encrypted, code);
        document.getElementById('messageOutput').value = decrypted;
        document.getElementById('outputGroup').style.display = 'block';
    } catch (error) {
        alert('Fehler bei der Entschlüsselung');
        console.error(error);
    }
}

// Weitere Standardfunktionen wie login, logout etc. bleiben unverändert
