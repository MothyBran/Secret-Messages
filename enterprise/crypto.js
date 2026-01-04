const crypto = require('crypto');

/**
 * Enterprise Encryption Helper
 * Implements strict key derivation and Multi-Layer Encryption compatible with WebApp.
 */

const ALGORITHM = 'aes-256-gcm';
const ITERATIONS = 100000;
const KEY_LEN = 32; // 256 bits

// ==========================================
// 1. HELPERS (Obfuscation / Encoding)
// ==========================================

function getPasscodeShifts(passcode) {
    return passcode.split('').map(d => parseInt(d, 10));
}

/**
 * Obfuscates bytes by shifting them based on the passcode.
 * Matches public/cryptoLayers.js logic.
 */
function obfuscateBytes(buffer, passcode) {
    const shifts = getPasscodeShifts(passcode);
    const result = Buffer.alloc(buffer.length);
    for (let i = 0; i < buffer.length; i++) {
        const shift = shifts[i % shifts.length];
        // result[i] = (buffer[i] + shift) % 256;
        result[i] = (buffer[i] + shift) & 0xFF;
    }
    return result;
}

// ==========================================
// 2. CORE CRYPTO
// ==========================================

/**
 * Derives the encryption key using PBKDF2.
 */
function deriveKey(masterKey, passcode, senderId, recipientIds) {
    const allIds = [senderId, ...recipientIds].sort();
    const saltString = `${masterKey}|${passcode}|${allIds.join(',')}`;

    // We use a fixed salt for PBKDF2 to match WebApp logic
    return crypto.pbkdf2Sync(saltString, 'SECURE_MSG_ENTERPRISE_V1', ITERATIONS, KEY_LEN, 'sha512');
}

/**
 * Encrypts a message payload using the full WebApp Layer Stack.
 * Layer 1: JSON Wrap + Obfuscation
 * Layer 2: AES-GCM
 * @param {string} text - The plaintext message.
 * @param {Buffer} key - The derived key.
 * @param {string} passcode - The passcode (needed for Layer 1).
 * @param {string} senderId - ID of sender (for JSON allowed_users).
 * @param {Array<string>} recipientIds - IDs of recipients.
 * @returns {Object} { payload: 'CipherHex:TagHex', iv: 'IVHex' }
 */
function encrypt(text, key, passcode, senderId, recipientIds) {
    // LAYER 1: Construct JSON Object
    const allowed_users = [senderId, ...recipientIds];
    // Remove duplicates if any
    const uniqueUsers = [...new Set(allowed_users)];

    const layer1Data = {
        content: text,
        allowed_users: uniqueUsers,
        salt: crypto.randomBytes(16).toString('base64') // Random salt for the JSON structure
    };

    const jsonStr = JSON.stringify(layer1Data);
    const jsonBuffer = Buffer.from(jsonStr, 'utf8');

    // LAYER 1.5: Obfuscate
    const obfuscatedBuffer = obfuscateBytes(jsonBuffer, passcode);

    // LAYER 2: Encrypt (AES-GCM)
    const iv = crypto.randomBytes(12); // WebCrypto uses 12 bytes usually
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

    let encrypted = cipher.update(obfuscatedBuffer);
    encrypted = Buffer.concat([encrypted, cipher.final()]);

    const authTag = cipher.getAuthTag();

    // Return Hex strings
    return {
        // We join Cipher and Tag for storage/transport
        // Note: Node keeps them separate, but our Custom Format expects them.
        payload: encrypted.toString('hex') + ':' + authTag.toString('hex'),
        iv: iv.toString('hex')
    };
}

/**
 * Decrypts a message payload.
 * Reverse of encrypt.
 */
function decrypt(encryptedPayload, ivHex, key, passcode) {
    // 1. Parse Cipher:Tag
    const parts = encryptedPayload.split(':');
    if (parts.length !== 2) throw new Error("Invalid Payload Format (Expected Cipher:Tag)");

    const ciphertext = Buffer.from(parts[0], 'hex');
    const authTag = Buffer.from(parts[1], 'hex');
    const iv = Buffer.from(ivHex, 'hex');

    // 2. Decrypt AES-GCM
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    let decryptedBuffer;
    try {
        decryptedBuffer = decipher.update(ciphertext);
        decryptedBuffer = Buffer.concat([decryptedBuffer, decipher.final()]);
    } catch(e) {
        throw new Error("Decryption Failed (Auth Tag Mismatch)");
    }

    // 3. De-obfuscate (Reverse Shift)
    // Deobfuscation is: val - shift
    const shifts = getPasscodeShifts(passcode);
    const result = Buffer.alloc(decryptedBuffer.length);
    for (let i = 0; i < decryptedBuffer.length; i++) {
        const shift = shifts[i % shifts.length];
        let val = decryptedBuffer[i] - shift;
        if (val < 0) val += 256;
        result[i] = val;
    }

    // 4. Parse JSON
    try {
        const jsonStr = result.toString('utf8');
        const data = JSON.parse(jsonStr);
        return data.content;
    } catch(e) {
        throw new Error("Structure Damaged (JSON Parse Error)");
    }
}

/**
 * Generates a "Key-Zusatz" (Key Supplement) for external contacts.
 */
function generateKeySupplement(masterKey) {
    return crypto.createHmac('sha256', 'ENTERPRISE_SUPPLEMENT_V1')
                 .update(masterKey)
                 .digest('hex')
                 .substring(0, 16)
                 .toUpperCase();
}

module.exports = {
    deriveKey,
    encrypt,
    decrypt,
    generateKeySupplement
};
