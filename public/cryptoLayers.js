// public/cryptoLayers.js - Rewrite for Multi-Layer Encryption & Group Access Control

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

// Obfuscation: Shifts bytes of the UTF-8 encoded string
function obfuscateBytes(bytes, passcode) {
    const shifts = getPasscodeShifts(passcode);
    const result = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) {
        const shift = shifts[i % shifts.length];
        // We use modular addition on bytes (0-255)
        result[i] = (bytes[i] + shift) % 256;
    }
    return result;
}

function deobfuscateBytes(bytes, passcode) {
    const shifts = getPasscodeShifts(passcode);
    const result = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) {
        const shift = shifts[i % shifts.length];
        // Reverse modular addition
        let val = bytes[i] - shift;
        if (val < 0) val += 256;
        result[i] = val;
    }
    return result;
}


// ========================================================
// 2. KEY MANAGEMENT (Layer 2)
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

// ========================================================
// 3. MAIN FUNCTIONS
// ========================================================

/**
 * Encrypts a message using multi-layer protection.
 * @param {string} text - The message content.
 * @param {string} passcode - 5-digit passcode.
 * @param {string[]} recipientIDs - List of allowed User IDs.
 * @param {string|null} currentUserId - The ID of the sender (to ensure they are included).
 */
export async function encryptFull(text, passcode, recipientIDs, currentUserId = null) {
    // Input Handling: Ensure sender is in the list
    const allowed = [...recipientIDs];
    if (currentUserId) {
        // Check if ID exists (case-insensitive usually preferred, but strict here matches prompt implies)
        // Prompt says: "Prüfe vor dem Start, ob die ID des aktuellen Users ... enthalten ist."
        if (!allowed.some(id => String(id) === String(currentUserId))) {
            allowed.push(currentUserId);
        }
    } else {
        console.warn("encryptFull: currentUserId missing. Sender might be locked out.");
    }

    // Layer 1: Payload Construction & Obfuscation
    const saltL1 = buf2base64(window.crypto.getRandomValues(new Uint8Array(16)));
    const layer1Data = {
        content: text,
        allowed_users: allowed,
        salt: saltL1
    };

    // Serialisierung
    const jsonStr = JSON.stringify(layer1Data);
    const jsonBytes = textEnc.encode(jsonStr);

    // Deterministische Modifikation (Obfuscation)
    const obfuscatedBytes = obfuscateBytes(jsonBytes, passcode);

    // Layer 2: Key Derivation
    const saltL2 = window.crypto.getRandomValues(new Uint8Array(16));
    const key = await deriveKey(passcode, saltL2);

    // Layer 3: AES-GCM Encryption
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const encryptedBuffer = await window.crypto.subtle.encrypt(
        { name: "AES-GCM", iv: iv },
        key,
        obfuscatedBytes
    );

    // Layer 4: Encoding (Packing)
    // Structure: SaltL2 (16 bytes) | IV (12 bytes) | Ciphertext
    const packed = new Uint8Array(16 + 12 + encryptedBuffer.byteLength);
    packed.set(saltL2, 0);
    packed.set(iv, 16);
    packed.set(new Uint8Array(encryptedBuffer), 28);

    return buf2base64(packed);
}

/**
 * Decrypts a message and verifies group access.
 * @param {string} encryptedBase64 - The encrypted string.
 * @param {string} passcode - 5-digit passcode.
 * @param {string} currentUserId - The ID of the user attempting to decrypt.
 */
export async function decryptFull(encryptedBase64, passcode, currentUserId) {
    let packed;
    try {
        packed = base642buf(encryptedBase64);
    } catch (e) {
        throw new Error("Ungültiges Format (Base64)");
    }

    if (packed.byteLength < 28) {
        throw new Error("Ungültiges Format (zu kurz)");
    }

    // Reverse Layer 4: Unpack
    const saltL2 = packed.slice(0, 16);
    const iv = packed.slice(16, 28);
    const ciphertext = packed.slice(28);

    // Reverse Layer 2: Key Derivation
    const key = await deriveKey(passcode, saltL2);

    // Reverse Layer 3: AES-GCM Decryption
    let decryptedBuffer;
    try {
        decryptedBuffer = await window.crypto.subtle.decrypt(
            { name: "AES-GCM", iv: iv },
            key,
            ciphertext
        );
    } catch (e) {
        throw new Error("Falscher Code"); // Decryption failed usually means wrong key (passcode)
    }

    // Reverse Layer 1: De-obfuscation & Parsing
    const obfuscatedBytes = new Uint8Array(decryptedBuffer);
    const jsonBytes = deobfuscateBytes(obfuscatedBytes, passcode);

    let layer1Obj;
    try {
        const jsonStr = textDec.decode(jsonBytes);
        layer1Obj = JSON.parse(jsonStr);
    } catch(e) {
        throw new Error("Fehler beim Parsen der Nachricht (Struktur beschädigt).");
    }

    // Validation (Group Check)
    if (!layer1Obj.allowed_users || !Array.isArray(layer1Obj.allowed_users)) {
        throw new Error("Ungültige Nachrichtenstruktur: Fehlende Empfängerliste.");
    }

    const isAllowed = layer1Obj.allowed_users.some(id => String(id) === String(currentUserId));

    if (isAllowed) {
        return layer1Obj.content;
    } else {
        throw new Error("Zugriff verweigert: Du stehst nicht auf der Empfängerliste.");
    }
}
