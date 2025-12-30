const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');

// We will load the server module but control its start
const { startServer } = require('./server.js');

let mainWindow;
let serverPort = 3000;
let isServerRunning = false;

// Path to offline certificate
const userDataPath = app.getPath('userData');
const certPath = path.join(userDataPath, 'offline-cert.json');

async function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        frame: true, // Standard Window Controls
        backgroundColor: '#050505',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true
        }
    });

    // Set Custom User Agent for Platform Identification
    const userAgent = mainWindow.webContents.getUserAgent() + " SecureMessages-Desktop";
    mainWindow.webContents.setUserAgent(userAgent);

    // Also inject a custom header for all requests (API calls etc.)
    const filter = { urls: ['*://*/*'] };
    mainWindow.webContents.session.webRequest.onBeforeSendHeaders(filter, (details, callback) => {
        details.requestHeaders['X-App-Client'] = 'SecureMessages-Desktop';
        callback({ requestHeaders: details.requestHeaders });
    });

    // Check for offline certificate
    if (fs.existsSync(certPath)) {
        console.log("Offline certificate found. Starting Local Server & Launcher.");
        // Ensure local server is running for the offline app
        await ensureLocalServer();
        // Load the local launcher which can then redirect to localhost:3000/app or localhost:3000/it-admin.html
        mainWindow.loadURL(`http://localhost:${serverPort}/launcher.html`);
    } else {
        console.log("No offline certificate. Cloud mode (License Check).");
        // Cloud Mode: Load remote app to activate license
        mainWindow.loadURL('https://www.secure-msg.app/app?action=activate');
    }

    mainWindow.on('closed', () => {
        mainWindow = null;
    });

    // Handle external links in default browser
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        if (url.startsWith('http:') || url.startsWith('https:')) {
            shell.openExternal(url);
            return { action: 'deny' };
        }
        return { action: 'allow' };
    });
}

async function ensureLocalServer() {
    if (!isServerRunning) {
        console.log("Starting local server...");
        // In a real desktop app, you might want to find a free port.
        // For now, we try 3000, if busy, we might fail or need retry logic.
        // But since this is a dedicated bundle, we assume control.
        try {
            startServer(serverPort);
            isServerRunning = true;
            // Allow some time for server to boot? Usually fast enough.
            await new Promise(r => setTimeout(r, 500));
        } catch (e) {
            console.error("Failed to start local server:", e);
        }
    }
}

app.whenReady().then(() => {
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

// IPC Handlers

ipcMain.handle('check-offline-cert', () => {
    return fs.existsSync(certPath);
});

ipcMain.handle('get-offline-cert', () => {
    try {
        if (fs.existsSync(certPath)) {
            const data = fs.readFileSync(certPath, 'utf8');
            return JSON.parse(data);
        }
    } catch (e) {
        console.error("Error reading cert:", e);
    }
    return null;
});

ipcMain.handle('save-offline-cert', (event, cert) => {
    try {
        fs.writeFileSync(certPath, JSON.stringify(cert));
        return true;
    } catch (e) {
        console.error("Failed to save cert:", e);
        return false;
    }
});

ipcMain.handle('launch-app', async () => {
    await ensureLocalServer();
    mainWindow.loadURL(`http://localhost:${serverPort}/app`);
});

ipcMain.handle('launch-admin', async () => {
    await ensureLocalServer();
    // Assuming IT Admin Hub is /admin or public/it-admin.html served via express
    // The prompt says "it-admin.html".
    // If served by express: http://localhost:3000/it-admin.html
    mainWindow.loadURL(`http://localhost:${serverPort}/it-admin.html`);
});

ipcMain.handle('start-local-server', async () => {
    await ensureLocalServer();
    return true;
});
