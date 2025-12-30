const { app, BrowserWindow, ipcMain, shell, Tray, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const { startServer } = require('./server.js');
const Bonjour = require('bonjour-service');
const licenseVault = require('./utils/licenseVault');

let mainWindow;
let tray = null;
let serverPort = 3000;
let isHubMode = false;
let bonjourInstance = null;

const userDataPath = app.getPath('userData');
// Initialize Vault Path immediately
licenseVault.setPath(userDataPath);
const vaultFilePath = path.join(userDataPath, 'license.vault');

// --- MDNS LOGIC ---
function startBonjourService() {
    // SECURITY: Ensure we are in Hub Mode before publishing
    if (!isHubMode) return;

    try {
        bonjourInstance = new Bonjour();
        console.log("📡 Publishing mDNS Service: SecureMsgHub");
        bonjourInstance.publish({ name: 'SecureMsgHub', type: 'http', port: serverPort });
    } catch (e) { console.error("Bonjour Error:", e); }
}

function findHubService(callback) {
    console.log("🔍 Searching for SecureMsgHub...");
    try {
        const browser = new Bonjour();
        browser.find({ type: 'http' }, (service) => {
            if (service.name === 'SecureMsgHub' || service.name.includes('SecureMsgHub')) {
                console.log('✅ Hub Found:', service.host, service.port, service.addresses);
                const ip = service.addresses.find(addr => addr.includes('.')) || service.addresses[0];
                callback(`http://${ip}:${service.port}`);
                browser.stop();
            }
        });
    } catch(e) { console.error("Discovery Error:", e); callback(null); }
}

// --- WINDOW LOGIC ---
async function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        frame: true,
        backgroundColor: '#050505',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true
        }
    });

    const userAgent = mainWindow.webContents.getUserAgent() + " SecureMessages-Desktop";
    mainWindow.webContents.setUserAgent(userAgent);

    mainWindow.webContents.session.webRequest.onBeforeSendHeaders({ urls: ['*://*/*'] }, (details, callback) => {
        details.requestHeaders['X-App-Client'] = 'SecureMessages-Desktop';
        callback({ requestHeaders: details.requestHeaders });
    });

    // STARTUP CHECK: Check for signed Vault instead of raw JSON
    if (fs.existsSync(vaultFilePath)) {
        // VALIDATE VAULT
        try {
            const vaultData = licenseVault.readVault();
            if (vaultData.tampered) {
                console.error("❌ Vault Tampered!");
                // Could show error page, but for now we might just fail to start server or show error
            }

            // HUB MODE
            console.log(`🚀 Starting in HUB MODE (Bundle: ${vaultData.bundleId})`);
            isHubMode = true;

            // Start Server with UserData Path
            startServer(serverPort, userDataPath);
            startBonjourService();
            createTray();

            setTimeout(() => {
                mainWindow.loadURL(`http://localhost:${serverPort}/it-admin.html`);
            }, 1000);

        } catch (e) {
            console.error("Startup Check Failed:", e);
        }
    } else {
        // SETUP / CLIENT MODE
        console.log("🔍 Starting in SETUP/CLIENT MODE");
        try {
            // Start server anyway to serve Launcher UI locally
            startServer(serverPort, userDataPath);
            setTimeout(() => {
                 mainWindow.loadURL(`http://localhost:${serverPort}/launcher.html`);
            }, 500);
        } catch(e) { console.error("Server start fail:", e); }
    }

    mainWindow.on('closed', () => {
        if (!isHubMode) mainWindow = null;
    });

    mainWindow.on('close', (event) => {
        if (isHubMode && tray) {
            event.preventDefault();
            mainWindow.hide();
            return false;
        }
    });
}

function createTray() {
    if (tray) return;
    const iconPath = path.join(__dirname, 'public/images/Logo_SM.png');
    // Ensure icon exists or fallback to avoid crash
    if(fs.existsSync(iconPath)) {
        tray = new Tray(iconPath);
    } else {
        // Fallback or skip tray icon if missing
        console.warn("Tray icon missing, skipping.");
        return;
    }

    const contextMenu = Menu.buildFromTemplate([
        { label: 'Secure Messages Hub', enabled: false },
        { type: 'separator' },
        { label: 'Open Dashboard', click: () => mainWindow.show() },
        { label: 'Quit Hub', click: () => {
            isHubMode = false;
            app.quit();
        }}
    ]);
    tray.setToolTip('Secure Messages LAN Hub');
    tray.setContextMenu(contextMenu);
    tray.on('double-click', () => mainWindow.show());
}

app.whenReady().then(() => {
    createWindow();
    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
        else mainWindow.show();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin' && !isHubMode) app.quit();
});

// IPC HANDLERS

ipcMain.handle('scan-hub', async () => {
    return new Promise((resolve) => {
        findHubService((url) => {
            resolve(url);
        });
        setTimeout(() => resolve(null), 5000);
    });
});

ipcMain.handle('connect-hub', async (event, url) => {
    mainWindow.loadURL(`${url}/app`);
});

ipcMain.handle('activate-admin', async (event, licenseKey) => {
    try {
        console.log(`🌐 Verifying Key: ${licenseKey}`);

        // Use fetch (Node 18+) for Cloud Verification
        const response = await fetch('https://secure-msg.app/api/auth/verify-master', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ licenseKey, deviceId: 'HUB-ADMIN' })
        });

        if(!response.ok) {
             const errText = await response.text();
             return { success: false, error: `Server Error: ${response.status} ${errText}` };
        }

        const data = await response.json();

        if (data.success) {
            // SECURELY SAVE VAULT LOCALLY
            licenseVault.createVault(data.bundleId, data.quota);

            console.log("✅ Activation Successful. Vault Created.");

            app.relaunch();
            app.quit();
            return { success: true };
        } else {
            return { success: false, error: data.error };
        }
    } catch (e) {
        console.error("Activation Exception:", e);
        return { success: false, error: "Verbindung fehlgeschlagen: " + e.message };
    }
});

ipcMain.handle('get-app-version', () => app.getVersion());
