const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const SALT = 'secure-msg-enterprise-salt';
let VAULT_PATH = null; // Set dynamically

function getVaultPath() {
    if (VAULT_PATH) return VAULT_PATH;
    // Fallback for dev/testing if not set
    return path.join(__dirname, '../data/license.vault');
}

function setVaultPath(basePath) {
    if (!fs.existsSync(basePath)) {
        try { fs.mkdirSync(basePath, { recursive: true }); } catch(e) {}
    }
    VAULT_PATH = path.join(basePath, 'license.vault');
    console.log(`🔒 Vault Path set to: ${VAULT_PATH}`);
}

function loadVault() {
    const p = getVaultPath();
    if (!fs.existsSync(p)) {
        return { used_slots: 0, user_quota: 0, bundleId: null };
    }
    try {
        const content = fs.readFileSync(p, 'utf8');
        const [data, hash] = content.split('::');
        if (!data || !hash) return { used_slots: 0, user_quota: 0, bundleId: null };

        const calculatedHash = crypto.createHmac('sha256', SALT).update(data).digest('hex');

        if (hash !== calculatedHash) {
            console.error("CRITICAL: License Vault Tampered!");
            return { used_slots: 0, user_quota: 0, tampered: true };
        }
        return JSON.parse(Buffer.from(data, 'base64').toString('utf8'));
    } catch (e) {
        console.error("Vault Load Error:", e);
        return { used_slots: 0, user_quota: 0, bundleId: null };
    }
}

function saveVault(data) {
    const p = getVaultPath();
    const jsonStr = JSON.stringify(data);
    const base64Data = Buffer.from(jsonStr).toString('base64');
    const hash = crypto.createHmac('sha256', SALT).update(base64Data).digest('hex');
    fs.writeFileSync(p, `${base64Data}::${hash}`);
}

module.exports = {
    setPath: setVaultPath,

    // Create new vault (Used by Activation)
    createVault: (bundleId, quota) => {
        const data = {
            bundleId: bundleId,
            user_quota: quota,
            used_slots: 0,
            created_at: new Date().toISOString()
        };
        saveVault(data);
    },

    // Read current state
    readVault: () => {
        const d = loadVault();
        return {
            bundleId: d.bundleId,
            quota: d.user_quota,
            used: d.used_slots,
            tampered: !!d.tampered
        };
    },

    checkQuota: () => {
        const current = loadVault();
        if(current.tampered) throw new Error("Lizenz-Datei manipuliert!");
        return current.used_slots < current.user_quota;
    },

    incrementUsed: () => {
        const current = loadVault();
        if(current.tampered) throw new Error("Lizenz-Datei manipuliert!");
        if (current.used_slots >= current.user_quota) throw new Error("Benutzer-Limit erreicht! Bitte Lizenz erweitern.");
        current.used_slots++;
        saveVault(current);
        return current.used_slots;
    }
};
