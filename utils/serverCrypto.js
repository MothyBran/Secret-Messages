const crypto = require('crypto');

/**
 * Encrypts a plaintext string using AES-256-GCM.
 * The key is derived from the passcode using PBKDF2 to match client-side logic.
 *
 * Client Logic (cryptoLayers.js):
 * 1. PBKDF2(passcode, salt, 100000, 32, 'sha256') -> Key
 * 2. AES-GCM(iv, key, data) -> Encrypted
 * 3. Pack: Salt(16) + IV(12) + Ciphertext + Tag
 *
 * @param {string} text - Plaintext to encrypt
 * @param {string} passcode - User access code
 * @returns {string} Base64 encoded encrypted string (Salt+IV+Cipher+Tag)
 */
function encryptServerSide(text, passcode) {
    // 1. Generate Salt (16 bytes)
    const salt = crypto.randomBytes(16);

    // 2. Derive Key (PBKDF2) - Match client params
    // iterations: 100000, keylen: 32 (256 bit), digest: 'sha256'
    const key = crypto.pbkdf2Sync(passcode, salt, 100000, 32, 'sha256');

    // 3. Generate IV (12 bytes)
    const iv = crypto.randomBytes(12);

    // 4. Encrypt (AES-256-GCM)
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

    // Encrypt data
    let ciphertext = cipher.update(text, 'utf8'); // Buffer
    const finalBuffer = cipher.final(); // Buffer
    ciphertext = Buffer.concat([ciphertext, finalBuffer]);

    const authTag = cipher.getAuthTag(); // 16 bytes

    // 5. Pack: Salt(16) + IV(12) + Ciphertext + Tag(16)
    // Note: cryptoLayers.js expects ciphertext to include tag at the end for WebCrypto decrypt?
    // Let's re-verify cryptoLayers.js `decryptFull`:
    // const ciphertext = packed.slice(28); -> This is passed to WebCrypto decrypt.
    // WebCrypto AES-GCM decrypt expects the tag to be appended to the ciphertext.
    // So yes, we pack it all together.

    const packed = Buffer.concat([salt, iv, ciphertext, authTag]);

    return packed.toString('base64');
}

module.exports = { encryptServerSide };
