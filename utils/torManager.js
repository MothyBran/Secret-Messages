const fs = require('fs');
const path = require('path');
const { spawn, execSync } = require('child_process');

const TOR_DIR = '/data/tor';
const HIDDEN_SERVICE_DIR = path.join(TOR_DIR, 'hidden_service');
const HOSTNAME_FILE = path.join(HIDDEN_SERVICE_DIR, 'hostname');
const TORRC_FILE = path.join(TOR_DIR, 'torrc');

let onionAddress = null;

const ensureDirectoryExists = (dir) => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    } else {
        fs.chmodSync(dir, 0o700);
    }
};

const setupTor = async () => {
    console.log("🧅 Initializing Tor Hidden Service...");

    // 1. Install/Check Tor
    try {
        console.log("   Checking Tor installation...");
        execSync('bash scripts/install_tor.sh', { stdio: 'inherit' });
    } catch (e) {
        console.error("❌ Tor installation script failed:", e.message);
        return;
    }

    // 2. Prepare Directories
    ensureDirectoryExists(TOR_DIR);
    ensureDirectoryExists(HIDDEN_SERVICE_DIR);

    // 3. Configure torrc
    const torrcContent = `
DataDirectory ${TOR_DIR}
HiddenServiceDir ${HIDDEN_SERVICE_DIR}
HiddenServicePort 80 127.0.0.1:3000
    `.trim();

    fs.writeFileSync(TORRC_FILE, torrcContent);
    console.log("   torrc configured.");

    // 4. Start Tor
    console.log("   Starting Tor process...");
    const torProcess = spawn('tor', ['-f', TORRC_FILE], {
        detached: true,
        stdio: 'ignore'
    });

    torProcess.unref();

    // 5. Wait for Hostname
    let attempts = 0;
    const maxAttempts = 20;

    const checkHostname = () => {
        if (fs.existsSync(HOSTNAME_FILE)) {
            const hostname = fs.readFileSync(HOSTNAME_FILE, 'utf8').trim();
            onionAddress = hostname;
            console.log(`✅ Tor Hidden Service Active: ${onionAddress}`);
        } else {
            attempts++;
            if (attempts < maxAttempts) {
                setTimeout(checkHostname, 2000);
            } else {
                console.warn("⚠️ Timeout waiting for Tor hostname. Tor might still be bootstrapping.");
            }
        }
    };

    setTimeout(checkHostname, 3000);
};

module.exports = {
    init: setupTor,
    getOnionAddress: () => onionAddress
};
