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

const prepareTor = () => {
    console.log("🧅 Preparing Tor Configuration...");

    // Check if Tor is installed (only check, don't fail if just preparing config)
    try {
        const check = execSync('tor --version', { stdio: 'pipe' }).toString();
        console.log(`   Tor version detected: ${check.trim().split('\n')[0]}`);
    } catch (e) {
        console.warn("⚠️ Tor is not installed or not in PATH. Please ensure it is installed.");
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

    // Always ensure config exists
    prepareTor();

    if (spawnProcess) {
        console.log("   Starting Tor process internally...");
        try {
            const torProcess = spawn('tor', ['-f', TORRC_FILE], {
                detached: true,
                stdio: 'ignore'
            });
            torProcess.unref();
        } catch (e) {
            console.error("❌ Failed to spawn Tor process:", e.message);
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
