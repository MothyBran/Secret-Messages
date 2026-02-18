const fs = require('fs');
const path = require('path');
const { spawn, execSync } = require('child_process');

// Determine Data Directory (Consistent with server.js)
const DATA_DIR = process.env.DATA_PATH || path.join(__dirname, '../data');
const TOR_DIR = path.join(DATA_DIR, 'tor');
const HIDDEN_SERVICE_DIR = path.join(TOR_DIR, 'hidden_service');
const HOSTNAME_FILE = path.join(HIDDEN_SERVICE_DIR, 'hostname');
const TORRC_FILE = path.join(TOR_DIR, 'torrc');

let onionAddress = null;
let torExecutable = 'tor'; // Default to PATH

const ensureDirectoryExists = (dir) => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    } else {
        try {
            fs.chmodSync(dir, 0o700);
        } catch (e) {
            // Ignore permission errors on Windows or if not owner
        }
    }
};

const findTorPath = () => {
    // 1. Try default PATH first
    try {
        const check = execSync('tor --version', { stdio: 'pipe' }).toString();
        const version = check.trim().split('\n')[0];
        console.log(`   Tor found in PATH: ${version}`);
        return 'tor';
    } catch (e) {
        // Continue to explicit paths
    }

    // 2. Check common absolute paths
    const commonPaths = [
        '/usr/bin/tor',
        '/usr/sbin/tor',
        '/bin/tor',
        '/usr/local/bin/tor',
        '/opt/homebrew/bin/tor' // macOS
    ];

    for (const p of commonPaths) {
        if (fs.existsSync(p)) {
            try {
                // Verify it's executable and get version
                // accessSync checks permissions (R_OK | X_OK)
                fs.accessSync(p, fs.constants.X_OK);
                const check = execSync(`${p} --version`, { stdio: 'pipe' }).toString();
                const version = check.trim().split('\n')[0];
                console.log(`   Tor found at ${p}: ${version}`);
                return p;
            } catch (err) {
                // Skip if not executable or fails
            }
        }
    }

    return null;
};

const prepareTor = () => {
    console.log("🧅 Preparing Tor Configuration...");

    let torAvailable = false;

    // Check if Tor is installed (PATH or Absolute)
    const foundPath = findTorPath();
    if (foundPath) {
        torExecutable = foundPath;
        torAvailable = true;
    } else {
        console.warn("⚠️ Tor is not installed or not in PATH. Please ensure it is installed.");
        torAvailable = false;
    }

    ensureDirectoryExists(TOR_DIR);
    ensureDirectoryExists(HIDDEN_SERVICE_DIR);

    // Dynamic torrc creation
    // Fix: Ensure proper newlines and valid config
    const torrcContent = `DataDirectory ${TOR_DIR}\nHiddenServiceDir ${HIDDEN_SERVICE_DIR}\nHiddenServicePort 80 127.0.0.1:3000\n`;

    try {
        fs.writeFileSync(TORRC_FILE, torrcContent);
        console.log(`   torrc created at ${TORRC_FILE}`);
    } catch (e) {
        console.error("❌ Failed to write torrc:", e.message);
    }

    return torAvailable;
};

const pollHostname = () => {
    let attempts = 0;
    const maxAttempts = 60; // Wait up to 2 minutes (2s interval)

    const check = () => {
        if (fs.existsSync(HOSTNAME_FILE)) {
            try {
                const hostname = fs.readFileSync(HOSTNAME_FILE, 'utf8').trim();
                if (hostname) {
                    onionAddress = hostname;
                    console.log(`✅ Tor Hidden Service Active: ${onionAddress}`);
                    return;
                }
            } catch (e) {
                console.warn("   Error reading hostname file:", e.message);
            }
        }

        attempts++;
        if (attempts < maxAttempts) {
            setTimeout(check, 2000);
        } else {
            console.warn("⚠️ Timeout waiting for Tor hostname. Service might not be running.");
        }
    };

    check();
};

const init = async (spawnProcess = true) => {
    console.log("🧅 Initializing Tor Manager...");

    // Always ensure config exists and check availability
    const torAvailable = prepareTor();

    if (spawnProcess) {
        if (torAvailable) {
            console.log(`   Starting Tor process internally (${torExecutable})...`);
            try {
                const torProcess = spawn(torExecutable, ['-f', TORRC_FILE], {
                    detached: true,
                    stdio: 'ignore'
                });

                // Critical: Handle spawn errors to prevent crash
                torProcess.on('error', (err) => {
                    console.error("❌ Tor Process Error:", err.message);
                });

                torProcess.unref();
            } catch (e) {
                console.error("❌ Failed to spawn Tor process:", e.message);
            }
        } else {
            console.warn("⚠️ Tor executable not found. Skipping internal start.");
        }
    } else {
        console.log("   Tor process managed externally. Watching for hostname...");
    }

    // Start polling for hostname
    pollHostname();
};

module.exports = {
    init,
    prepare: prepareTor,
    getOnionAddress: () => onionAddress
};
