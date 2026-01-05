// public/assets/js/enterprise-crypto.js - Isolated Enterprise Encryption Logic
// Standard Script (Non-Module) implementation for Portal compatibility

const textEnc = new TextEncoder();
const textDec = new TextDecoder();

// ========================================================
// 1. HELPERS
// ========================================================

function buf2base64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

function base642buf(base64) {
    const binary_string = atob(base64);
    const len = binary_string.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binary_string.charCodeAt(i);
    }
    return bytes;
}

function getPasscodeShifts(passcode) {
    return passcode.split('').map(d => parseInt(d, 10));
}

function obfuscateBytes(bytes, passcode) {
    const shifts = getPasscodeShifts(passcode);
    const result = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) {
        const shift = shifts[i % shifts.length];
        result[i] = (bytes[i] + shift) % 256;
    }
    return result;
}

function deobfuscateBytes(bytes, passcode) {
    const shifts = getPasscodeShifts(passcode);
    const result = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) {
        const shift = shifts[i % shifts.length];
        let val = bytes[i] - shift;
        if (val < 0) val += 256;
        result[i] = val;
    }
    return result;
}

// ========================================================
// 2. KEY MANAGEMENT (Enterprise Specific)
// ========================================================

async function deriveKey(passcode, salt) {
    const keyMaterial = await window.crypto.subtle.importKey(
        "raw",
        textEnc.encode(passcode),
        { name: "PBKDF2" },
        false,
        ["deriveKey"]
    );
    return window.crypto.subtle.deriveKey(
        { name: "PBKDF2", salt: salt, iterations: 100000, hash: "SHA-256" },
        keyMaterial,
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"]
    );
}

// Enterprise Hybrid Key Derivation
// Logic: Final_Key = PBKDF2(User_Passcode + Master_Key_Supplement)
// Note: We use a fixed salt or derived salt?
// The previous logic used 'Supplement' as part of the Key Material input.
// Prompt says: "PBKDF2(User_Passcode + Master_Key_Supplement)".
// Implementation: Combine Passcode + Supplement string, use standard salt.
async function deriveEnterpriseKey(supplement, passcode) {
    const combinedSecret = `${passcode}${supplement}`;
    const saltBuffer = new TextEncoder().encode("SECURE_MSG_ENTERPRISE_HYBRID_V1"); // Fixed Domain Salt

    const keyMaterial = await window.crypto.subtle.importKey(
        "raw",
        textEnc.encode(combinedSecret),
        { name: "PBKDF2" },
        false,
        ["deriveKey"]
    );

    return window.crypto.subtle.deriveKey(
        { name: "PBKDF2", salt: saltBuffer, iterations: 100000, hash: "SHA-512" },
        keyMaterial,
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"]
    );
}

let enterpriseKeys = [];
window.setEnterpriseKeys = function(keys) {
    enterpriseKeys = keys;
};

// ========================================================
// 3. MAIN FUNCTIONS
// ========================================================

// Standard Encryption (Layer 3 Alternate)
async function encryptHybrid(text, passcode, supplement, senderId, recipientIds) {
    // 1. Prepare Payload (Layer 1 same as Full)
    const allowed = [senderId, ...recipientIds];
    const saltL1 = buf2base64(window.crypto.getRandomValues(new Uint8Array(16)));
    const layer1Data = { content: text, allowed_users: allowed, salt: saltL1 };
    const jsonBytes = textEnc.encode(JSON.stringify(layer1Data));
    const obfuscatedBytes = obfuscateBytes(jsonBytes, passcode);

    // 2. Derive Enterprise Key (Layer 2 Hybrid)
    // Using simple concatenation logic as requested: Passcode + Supplement
    const key = await deriveEnterpriseKey(supplement, passcode);

    // 3. Encrypt (Layer 3)
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const encryptedBuffer = await window.crypto.subtle.encrypt(
        { name: "AES-GCM", iv: iv },
        key,
        obfuscatedBytes
    );

    // 4. Format Output: "IVHex:CipherHex:TagHex::SenderID"
    function buf2hex(buffer) {
        return [...new Uint8Array(buffer)].map(x => x.toString(16).padStart(2, '0')).join('');
    }

    const ivHex = buf2hex(iv);
    const cipherHex = buf2hex(encryptedBuffer); // Contains Tag at end

    return `${ivHex}:${cipherHex}::${senderId}`;
}

async function decryptFull(encryptedBase64, passcode, currentUserId) {
    let decryptedBuffer;
    let success = false;

    // A. Standard Decryption (Base64 Packed) - Optional Fallback
    try {
        let packed = base642buf(encryptedBase64);
        if (packed.byteLength >= 28) {
            const saltL2 = packed.slice(0, 16);
            const iv = packed.slice(16, 28);
            const ciphertext = packed.slice(28);
            const key = await deriveKey(passcode, saltL2);
            decryptedBuffer = await window.crypto.subtle.decrypt({ name: "AES-GCM", iv: iv }, key, ciphertext);
            success = true;
        }
    } catch (e) {}

    // B. Enterprise Decryption
    if (!success && enterpriseKeys.length > 0) {
        try {
            if (encryptedBase64.includes('::')) {
                const parts = encryptedBase64.split('::');
                const core = parts[0];
                const segments = core.split(':');
                if (segments.length === 2) {
                    const iv = new Uint8Array(segments[0].match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
                    const combinedCipher = new Uint8Array(segments[1].match(/.{1,2}/g).map(byte => parseInt(byte, 16)));

                    for (const entKey of enterpriseKeys) {
                        try {
                            const derivedKey = await deriveEnterpriseKey(entKey, passcode);
                            decryptedBuffer = await window.crypto.subtle.decrypt({ name: "AES-GCM", iv: iv }, derivedKey, combinedCipher);
                            success = true;
                            break;
                        } catch (e) { continue; }
                    }
                }
            }
        } catch (e) { console.error("Hybrid Decrypt Error", e); }
    }

    if (!success) throw new Error("Falscher Code oder Schlüssel.");

    // Reverse Layer 1
    const obfuscatedBytes = new Uint8Array(decryptedBuffer);
    const jsonBytes = deobfuscateBytes(obfuscatedBytes, passcode);
    let layer1Obj;
    try {
        const jsonStr = textDec.decode(jsonBytes);
        layer1Obj = JSON.parse(jsonStr);
    } catch(e) { throw new Error("Struktur beschädigt."); }

    return layer1Obj.content;
}

async function encryptBackup(data, passcode) {
    const salt = window.crypto.getRandomValues(new Uint8Array(16));
    const key = await deriveKey(passcode, salt);
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const encoded = textEnc.encode(data);
    const encrypted = await window.crypto.subtle.encrypt({ name: "AES-GCM", iv: iv }, key, encoded);
    const packed = new Uint8Array(16 + 12 + encrypted.byteLength);
    packed.set(salt, 0); packed.set(iv, 16); packed.set(new Uint8Array(encrypted), 28);
    return buf2base64(packed);
}

// Global Assignment
window.encryptHybrid = encryptHybrid;
window.decryptFull = decryptFull;
window.encryptBackup = encryptBackup;
