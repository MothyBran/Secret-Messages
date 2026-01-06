// public/cryptoLayers.js - Core Encryption Logic (ES Module)

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
// 2. KEY MANAGEMENT
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
        {
            name: "PBKDF2",
            salt: salt,
            iterations: 100000,
            hash: "SHA-256"
        },
        keyMaterial,
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"]
    );
}

let enterpriseKeys = [];
export function setEnterpriseKeys(keys) {
    enterpriseKeys = keys;
}

// ========================================================
// 3. MAIN FUNCTIONS
// ========================================================

export async function encryptFull(text, passcode, recipientIDs, currentUserId = null) {
    const allowed = [...recipientIDs];
    if (currentUserId) {
        if (!allowed.some(id => String(id) === String(currentUserId))) {
            allowed.push(currentUserId);
        }
    }

    const saltL1 = buf2base64(window.crypto.getRandomValues(new Uint8Array(16)));
    const layer1Data = {
        content: text,
        allowed_users: allowed,
        salt: saltL1
    };

    const jsonStr = JSON.stringify(layer1Data);
    const jsonBytes = textEnc.encode(jsonStr);
    const obfuscatedBytes = obfuscateBytes(jsonBytes, passcode);

    const saltL2 = window.crypto.getRandomValues(new Uint8Array(16));
    const key = await deriveKey(passcode, saltL2);

    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const encryptedBuffer = await window.crypto.subtle.encrypt(
        { name: "AES-GCM", iv: iv },
        key,
        obfuscatedBytes
    );

    const packed = new Uint8Array(16 + 12 + encryptedBuffer.byteLength);
    packed.set(saltL2, 0);
    packed.set(iv, 16);
    packed.set(new Uint8Array(encryptedBuffer), 28);

    return buf2base64(packed);
}

export async function decryptFull(encryptedBase64, passcode, currentUserId) {
    let decryptedBuffer;
    let success = false;

    // Standard Decryption
    try {
        let packed = base642buf(encryptedBase64);
        if (packed.byteLength >= 28) {
            const saltL2 = packed.slice(0, 16);
            const iv = packed.slice(16, 28);
            const ciphertext = packed.slice(28);
            const key = await deriveKey(passcode, saltL2);

            decryptedBuffer = await window.crypto.subtle.decrypt(
                { name: "AES-GCM", iv: iv },
                key,
                ciphertext
            );
            success = true;
        }
    } catch (e) {}

    if (!success) {
        throw new Error("Falscher Code");
    }

    const obfuscatedBytes = new Uint8Array(decryptedBuffer);
    const jsonBytes = deobfuscateBytes(obfuscatedBytes, passcode);

    let layer1Obj;
    try {
        const jsonStr = textDec.decode(jsonBytes);
        layer1Obj = JSON.parse(jsonStr);
    } catch(e) {
        throw new Error("Struktur beschädigt.");
    }

    if (!layer1Obj.allowed_users || !Array.isArray(layer1Obj.allowed_users)) {
        throw new Error("Ungültige Struktur.");
    }

    const isAllowed = layer1Obj.allowed_users.some(id => String(id) === String(currentUserId));

    if (isAllowed) {
        return layer1Obj.content;
    } else {
        throw new Error("Zugriff verweigert.");
    }
}

export async function encryptBackup(data, passcode) {
    const salt = window.crypto.getRandomValues(new Uint8Array(16));
    const key = await deriveKey(passcode, salt);
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const encoded = textEnc.encode(data);

    const encrypted = await window.crypto.subtle.encrypt(
        { name: "AES-GCM", iv: iv },
        key,
        encoded
    );

    const packed = new Uint8Array(16 + 12 + encrypted.byteLength);
    packed.set(salt, 0);
    packed.set(iv, 16);
    packed.set(new Uint8Array(encrypted), 28);

    return buf2base64(packed);
}

export async function decryptBackup(encryptedBase64, passcode) {
    let packed;
    try { packed = base642buf(encryptedBase64); } catch(e) { throw new Error("Ungültiges Format"); }

    const salt = packed.slice(0, 16);
    const iv = packed.slice(16, 28);
    const ciphertext = packed.slice(28);

    const key = await deriveKey(passcode, salt);

    try {
        const decrypted = await window.crypto.subtle.decrypt(
            { name: "AES-GCM", iv: iv },
            key,
            ciphertext
        );
        return textDec.decode(decrypted);
    } catch(e) {
        throw new Error("Falscher Code.");
    }
}

// ========================================================
// 4. PROFILE TRANSFER (EXPORT/IMPORT)
// ========================================================

/**
 * Creates the export package { uid, pik } and encrypts it with the 4-layer system.
 */
export async function exportProfilePackage(uid, pik, passcode) {
    // 1. Create JSON Payload
    const payload = JSON.stringify({ uid, pik });

    // 2. Encrypt using standard mechanism (Layer 1 wrapper + Obfuscation + AES)
    // We treat 'uid' as the sole allowed user to reuse logic structure,
    // but effectively we just need a secure container.
    return await encryptFull(payload, passcode, [uid], uid);
}

/**
 * Decrypts the import package on the new device.
 * Bypasses 'allowed_users' check because the new device IS the user (but not yet logged in).
 */
export async function importProfilePackage(encryptedString, passcode) {
    let decryptedBuffer;
    let success = false;

    // Layer 4 (AES-GCM) & Layer 3 (PBKDF2)
    try {
        let packed = base642buf(encryptedString);
        if (packed.byteLength >= 28) {
            const saltL2 = packed.slice(0, 16);
            const iv = packed.slice(16, 28);
            const ciphertext = packed.slice(28);
            const key = await deriveKey(passcode, saltL2);

            decryptedBuffer = await window.crypto.subtle.decrypt(
                { name: "AES-GCM", iv: iv },
                key,
                ciphertext
            );
            success = true;
        }
    } catch (e) {}

    if (!success) throw new Error("Falscher Code");

    // Layer 2 (Obfuscation)
    const obfuscatedBytes = new Uint8Array(decryptedBuffer);
    const jsonBytes = deobfuscateBytes(obfuscatedBytes, passcode);

    // Layer 1 (JSON Wrapper)
    let layer1Obj;
    try {
        const jsonStr = textDec.decode(jsonBytes);
        layer1Obj = JSON.parse(jsonStr);
    } catch(e) { throw new Error("Struktur beschädigt."); }

    // Inner Payload { uid, pik }
    try {
        const innerPayload = JSON.parse(layer1Obj.content);
        if (!innerPayload.pik || !innerPayload.uid) throw new Error("Ungültiges Format");
        return innerPayload; // Returns { uid, pik }
    } catch (e) { throw new Error("Paket-Inhalt ungültig."); }
}

/**
 * Generates the Proof for the server: SHA256(SHA256(PIK) + timestamp)
 * Note: Server stores registration_key_hash which IS SHA256(PIK).
 */
export async function generateTransferProof(pik, timestamp) {
    // 1. Calculate SHA256(PIK) -> Matches DB 'registration_key_hash'
    const pikBuf = textEnc.encode(pik);
    const pikHashBuf = await window.crypto.subtle.digest('SHA-256', pikBuf);
    const pikHashHex = Array.from(new Uint8Array(pikHashBuf)).map(b => b.toString(16).padStart(2, '0')).join('');

    // 2. Calculate SHA256(pikHashHex + timestamp) -> Proof
    const msg = pikHashHex + timestamp;
    const msgBuf = textEnc.encode(msg);
    const proofBuf = await window.crypto.subtle.digest('SHA-256', msgBuf);
    return Array.from(new Uint8Array(proofBuf)).map(b => b.toString(16).padStart(2, '0')).join('');
}
