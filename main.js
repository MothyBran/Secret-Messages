const { app, BrowserWindow, Tray, Menu, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { Bonjour } = require('bonjour-service');

// FORCE ENTERPRISE MODE for Standalone .exe
process.env.APP_MODE = 'ENTERPRISE';

const server = require('./server'); // Requires and starts the server instance in this process

// State
let mainWindow;
let tray;
let hubService = null;
let isHub = false;

// Check Enterprise Config
const configPath = path.join(__dirname, 'data', 'enterprise_config.json');
let config = {};
try {
    if(fs.existsSync(configPath)) {
        // Simple read (encryption handled in enterprise/config.js but we just need existence check here)
        // We assume if file exists and has content, we might be a hub.
        // But for simplicity, we let the Server process determine if it should ACT as a Hub (Activation).
        // Here we decide UI behavior.
        // However, server.js handles the APP_MODE logic.
        // If we are Client, we still run server.js to serve the UI?
        // YES, because we need to serve /app files.
        // But the Client shouldn't broadcast.
        // server.js checks APP_MODE=ENTERPRISE.
        // We need to tell server.js if it's a HUB or CLIENT?
        // Actually, server.js logic I wrote: "if (IS_ENTERPRISE) { ... discovery.start() }"
        // This starts broadcasting ALWAYS.
        // We need to change server.js to only broadcast if ACTIVATED (Hub).
        // If not activated, it might be a Client searching.
    }
} catch(e) {}


function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        icon: path.join(__dirname, 'public/assets/icon.png'),
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js')
        }
    });

    const PORT = process.env.PORT || 3000;

    // Default load: The local server app
    mainWindow.loadURL(`http://localhost:${PORT}/`);

    mainWindow.on('minimize', (event) => {
        event.preventDefault();
        mainWindow.hide();
    });

    mainWindow.on('close', (event) => {
        if (!app.isQuitting) {
            event.preventDefault();
            mainWindow.hide();
        }
        return false;
    });
}

function createTray() {
    tray = new Tray(path.join(__dirname, 'public/assets/icon.png'));
    const contextMenu = Menu.buildFromTemplate([
        { label: 'Open App', click: () => mainWindow.show() },
        { label: 'Quit', click: () => {
            app.isQuitting = true;
            app.quit();
        }}
    ]);
    tray.setToolTip('Secure Messages Enterprise');
    tray.setContextMenu(contextMenu);
    tray.on('double-click', () => mainWindow.show());
}

// IPC HANDLERS
ipcMain.handle('scan-hub', async () => {
    return new Promise((resolve) => {
        console.log("🔍 Scanning for Hub...");
        const bonjour = new Bonjour();
        const browser = bonjour.find({ type: 'sm-msg-hub' });

        let found = false;

        browser.on('up', (service) => {
            console.log('Found Hub:', service);
            if(service.txt && service.txt.type === 'enterprise-hub') {
                found = true;
                hubService = service;
                bonjour.destroy();
                resolve({ success: true, host: service.referer.address, port: service.port });
            }
        });

        // Timeout 5s
        setTimeout(() => {
            if(!found) {
                bonjour.destroy();
                resolve({ success: false });
            }
        }, 5000);
    });
});

ipcMain.handle('get-hub-config', () => {
    return hubService ? { host: hubService.referer.address, port: hubService.port } : null;
});


app.whenReady().then(() => {
    createWindow();
    createTray();
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
