const { app, BrowserWindow, Tray, Menu, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { Bonjour } = require('bonjour-service');
const { exec } = require('child_process');

// FORCE ENTERPRISE MODE for Standalone .exe
process.env.APP_MODE = 'ENTERPRISE';

// 1. SET USER DATA PATH (Fix for SQLite/Config write permissions in .exe)
// We must do this BEFORE requiring server.js so the process.env is set
const userDataPath = app.getPath('userData');
process.env.USER_DATA_PATH = userDataPath;
console.log("📂 USER_DATA_PATH set to:", userDataPath);

// Require Server Logic (But do not auto-start yet, we control it)
const { startServer, stopServer } = require('./server');

// State
let mainWindow;
let tray;
let hubService = null;
let httpServer = null;

// Helper: Kill Zombie Instances on Port 3000
function killZombieInstances(port) {
    return new Promise((resolve) => {
        const platform = process.platform;
        const cmd = platform === 'win32'
            ? `netstat -ano | findstr :${port}`
            : `lsof -i :${port} -t`;

        exec(cmd, (err, stdout) => {
            if (err || !stdout) return resolve(); // No process found or error

            const lines = stdout.trim().split('\n');
            if (lines.length === 0) return resolve();

            // Extract PID
            let pids = [];
            if (platform === 'win32') {
                // TCP    0.0.0.0:3000           0.0.0.0:0              LISTENING       12345
                lines.forEach(line => {
                    const parts = line.trim().split(/\s+/);
                    const pid = parts[parts.length - 1];
                    if (pid && !isNaN(pid) && pid !== '0') pids.push(pid);
                });
            } else {
                pids = lines.map(l => l.trim()).filter(l => l);
            }

            // Exclude Self
            const myPid = process.pid.toString();
            pids = pids.filter(p => p !== myPid);

            if (pids.length === 0) return resolve();

            console.log(`Killing zombies on port ${port}:`, pids);

            // Kill
            const killCmd = platform === 'win32'
                ? `taskkill /F /PID ${pids.join(' /PID ')}`
                : `kill -9 ${pids.join(' ')}`;

            exec(killCmd, () => {
                // Wait a bit for release
                setTimeout(resolve, 1000);
            });
        });
    });
}

// Check Port Availability
function checkPort(port) {
    return new Promise((resolve, reject) => {
        const net = require('net');
        const server = net.createServer();
        server.once('error', (err) => {
            if (err.code === 'EADDRINUSE') {
                resolve(false); // Port busy
            } else {
                reject(err);
            }
        });
        server.once('listening', () => {
            server.close();
            resolve(true); // Port free
        });
        server.listen(port);
    });
}

async function initServer() {
    const PORT = process.env.PORT || 3000;

    // 0. Try to kill zombies first
    await killZombieInstances(PORT);

    // 1. Check if port is free
    const isFree = await checkPort(PORT);

    if (!isFree) {
        // Port is still busy.
        console.error(`Port ${PORT} is busy.`);
        dialog.showErrorBox(
            "Portkonflikt",
            `Der Port ${PORT} ist belegt. Bitte schließen Sie andere Web-Server oder Instanzen von SECURE-MSG.`
        );
        app.quit();
        return false;
    }

    // 2. Start Server
    try {
        httpServer = startServer(PORT);
        return true;
    } catch (e) {
        console.error("Server Start Failed:", e);
        dialog.showErrorBox("Server Fehler", "Der interne Server konnte nicht gestartet werden: " + e.message);
        app.quit();
        return false;
    }
}

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
    // Enterprise Mode: Load the IT-Admin Interface directly
    // The Server will redirect to /activation if not activated
    if (process.env.APP_MODE === 'ENTERPRISE') {
        mainWindow.loadURL(`http://localhost:${PORT}/enterprise`);
    } else {
        mainWindow.loadURL(`http://localhost:${PORT}/`);
    }

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


app.whenReady().then(async () => {
    const serverStarted = await initServer();
    if (serverStarted) {
        createWindow();
        createTray();
    }
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// Clean Exit
app.on('before-quit', async (event) => {
    console.log("Closing App...");
    app.isQuitting = true;
    if (httpServer) {
        event.preventDefault(); // Wait for server close
        await stopServer();
        console.log("Server Closed. Quitting Electron.");
        httpServer = null;
        app.quit();
    }
});
