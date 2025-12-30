const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const VAULT_PATH = path.join(__dirname, '../data/license.vault');
const SALT = 'secure-msg-enterprise-salt';

function loadVault() {
    if (!fs.existsSync(VAULT_PATH)) {
        return { used_slots: 0, user_quota: 0 };
    }
    try {
        const content = fs.readFileSync(VAULT_PATH, 'utf8');
        const [data, hash] = content.split('::');
        const calculatedHash = crypto.createHmac('sha256', SALT).update(data).digest('hex');

        if (hash !== calculatedHash) {
            console.error("CRITICAL: License Vault Tampered!");
            return { used_slots: 0, user_quota: 0, tampered: true };
        }
        return JSON.parse(Buffer.from(data, 'base64').toString('utf8'));
    } catch (e) {
        console.error("Vault Load Error:", e);
        return { used_slots: 0, user_quota: 0 };
    }
}

function saveVault(data) {
    const jsonStr = JSON.stringify(data);
    const base64Data = Buffer.from(jsonStr).toString('base64');
    const hash = crypto.createHmac('sha256', SALT).update(base64Data).digest('hex');
    fs.writeFileSync(VAULT_PATH, `${base64Data}::${hash}`);
}

module.exports = {
    initVault: (quota) => {
        const current = loadVault();
        if (current.user_quota !== quota) {
            current.user_quota = quota;
            saveVault(current);
        }
    },
    checkQuota: () => {
        const current = loadVault();
        if(current.tampered) throw new Error("Lizenz-Datei manipuliert!");
        return current.used_slots < current.user_quota;
    },
    incrementUsed: () => {
        const current = loadVault();
        if(current.tampered) throw new Error("Lizenz-Datei manipuliert!");
        if (current.used_slots >= current.user_quota) throw new Error("Quota exceeded");
        current.used_slots++;
        saveVault(current);
        return current.used_slots;
    },
    getStats: () => {
        const current = loadVault();
        return { used: current.used_slots, total: current.user_quota, tampered: !!current.tampered };
    }
};
