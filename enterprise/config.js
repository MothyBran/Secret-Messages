// enterprise/config.js
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { machineIdSync } = require('node-machine-id');

// File path for the vault
const CONFIG_FILE = path.join(__dirname, '..', 'data', 'enterprise_config.json');

// Ensure data directory exists
const dataDir = path.dirname(CONFIG_FILE);
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

// Get Machine ID for signing/encryption
let machineKey = null;
try {
    machineKey = machineIdSync();
} catch (e) {
    console.warn("Could not retrieve Machine ID, falling back to static (INSECURE for Prod)");
    machineKey = "fallback-key-dev-only";
}

const ALGORITHM = 'aes-256-cbc';

function encrypt(text) {
    const iv = crypto.randomBytes(16);
    const key = crypto.scryptSync(machineKey, 'salt', 32);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    let encrypted = cipher.update(JSON.stringify(text));
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    return iv.toString('hex') + ':' + encrypted.toString('hex');
}

function decrypt(text) {
    try {
        const textParts = text.split(':');
        const iv = Buffer.from(textParts.shift(), 'hex');
        const encryptedText = Buffer.from(textParts.join(':'), 'hex');
        const key = crypto.scryptSync(machineKey, 'salt', 32);
        const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
        let decrypted = decipher.update(encryptedText);
        decrypted = Buffer.concat([decrypted, decipher.final()]);
        return JSON.parse(decrypted.toString());
    } catch (e) {
        console.error("Config Decryption Failed:", e.message);
        return null;
    }
}

const defaults = {
    activated: false,
    bundleId: null,
    totalLicenses: 0,
    usedLicenses: 0,
    users: [], // { username, localKey, isOpenRecipient }
    masterKey: null
};

module.exports = {
    load: () => {
        if (!fs.existsSync(CONFIG_FILE)) return defaults;
        try {
            const raw = fs.readFileSync(CONFIG_FILE, 'utf8');
            return decrypt(raw) || defaults;
        } catch (e) {
            return defaults;
        }
    },
    save: (data) => {
        const encrypted = encrypt(data);
        fs.writeFileSync(CONFIG_FILE, encrypted);
    }
};
