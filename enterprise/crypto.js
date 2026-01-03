const crypto = require('crypto');

/**
 * Enterprise Encryption Helper
 * Implements strict key derivation:
 * Key = PBKDF2(MasterKey + Passcode + SortedIDs)
 */

const ALGORITHM = 'aes-256-gcm';
const ITERATIONS = 100000;
const KEY_LEN = 32; // 256 bits

/**
 * Derives the encryption key.
 * @param {string} masterKey - The Enterprise Master Key.
 * @param {string} passcode - The 5-digit user passcode (or Admin password).
 * @param {string} senderId - ID of the sender.
 * @param {Array<string>} recipientIds - Array of recipient IDs.
 * @returns {Buffer} The 32-byte derived key.
 */
function deriveKey(masterKey, passcode, senderId, recipientIds) {
    // 1. Sort IDs alphabetically to ensure consistent salt regardless of who is encrypting/decrypting
    const allIds = [senderId, ...recipientIds].sort();

    // 2. Construct the salt components
    // Salt format: "MASTER_KEY|PASSCODE|ID1,ID2,ID3"
    const saltString = `${masterKey}|${passcode}|${allIds.join(',')}`;

    // 3. PBKDF2 derivation
    // We use the saltString as the 'password' concept and a static salt or part of the string as salt.
    // To be strictly robust, we should use a random salt, but the requirement implies deterministic regeneration
    // based on these 4 factors without storing an extra random salt per conversation group.
    // So we treat the combination of these factors as the seed.
    // We use a fixed salt for the PBKDF2 function itself to satisfy the API,
    // relying on the high entropy of the MasterKey + IDs for uniqueness.

    return crypto.pbkdf2Sync(saltString, 'SECURE_MSG_ENTERPRISE_V1', ITERATIONS, KEY_LEN, 'sha512');
}

/**
 * Encrypts a message payload.
 * @param {string} text - The plaintext message.
 * @param {Buffer} key - The derived key.
 * @returns {Object} { payload: hexString, iv: hexString, authTag: hexString }
 */
function encrypt(text, key) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const authTag = cipher.getAuthTag().toString('hex');

    // We pack authTag with payload for simplicity in storage, or return separately.
    // Standard practice: Prepend AuthTag or return it.
    // Let's append it to payload to keep DB schema simple (Payload + IV).

    return {
        payload: encrypted + ':' + authTag,
        iv: iv.toString('hex')
    };
}

/**
 * Decrypts a message payload.
 * @param {string} encryptedPayload - Format "ciphertext:authtag" (hex).
 * @param {string} ivHex - The IV in hex.
 * @param {Buffer} key - The derived key.
 * @returns {string} The plaintext.
 */
function decrypt(encryptedPayload, ivHex, key) {
    const parts = encryptedPayload.split(':');
    if (parts.length !== 2) throw new Error("Invalid Payload Format");

    const ciphertext = parts[0];
    const authTag = Buffer.from(parts[1], 'hex');
    const iv = Buffer.from(ivHex, 'hex');

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(ciphertext, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
}

/**
 * Generates a "Key-Zusatz" (Key Supplement) for external contacts.
 * Derived from Master Key but does not reveal it.
 * @param {string} masterKey
 * @returns {string} A public-safe string.
 */
function generateKeySupplement(masterKey) {
    // We hash the master key with a specific context string.
    // This allows the main app to verify/use it without knowing the raw Master Key,
    // assuming the main app also uses a derivation scheme (Hybrid-Messenger).
    return crypto.createHmac('sha256', 'ENTERPRISE_SUPPLEMENT_V1')
                 .update(masterKey)
                 .digest('hex')
                 .substring(0, 16) // Shorten for usability (16 chars)
                 .toUpperCase();
}

module.exports = {
    deriveKey,
    encrypt,
    decrypt,
    generateKeySupplement
};
