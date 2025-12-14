// cryptoLayers.js - Enterprise Edition (Compression + High Security)
// Version 4.1: Fix Reversible Obfuscation

const textEnc = new TextEncoder();
const textDec = new TextDecoder();

// ========================================================
// 1. HILFSFUNKTIONEN (Tools & Compression)
// ========================================================

function buf2base64(buffer) { return btoa(String.fromCharCode(...new Uint8Array(buffer))); }
function base642buf(str) { return Uint8Array.from(atob(str), c => c.charCodeAt(0)); }

async function compressData(text) {
    const stream = new Blob([text]).stream();
    const compressed = stream.pipeThrough(new CompressionStream("gzip"));
    return await new Response(compressed).arrayBuffer();
}

async function decompressData(buffer) {
    const stream = new Blob([buffer]).stream();
    const decompressed = stream.pipeThrough(new DecompressionStream("gzip"));
    const resp = await new Response(decompressed).arrayBuffer();
    return textDec.decode(resp);
}

// ========================================================
// 2. KEY MANAGEMENT (High Security)
// ========================================================

async function generateMasterKey() {
    return await window.crypto.subtle.generateKey(
        { name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]
    );
}

async function importKeyFromPass(passString, userId) {
    const combinedSalt = "SECRET_MSG_V2_SALT_LAYER_" + userId.trim().toLowerCase(); 
    const keyMaterial = await window.crypto.subtle.importKey(
        "raw", textEnc.encode(passString), { name: "PBKDF2" }, false, ["deriveKey"]
    );
    return window.crypto.subtle.deriveKey(
        { name: "PBKDF2", salt: textEnc.encode(combinedSalt), iterations: 100000, hash: "SHA-256" },
        keyMaterial, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]
    );
}

async function exportMasterKey(key) { return await window.crypto.subtle.exportKey("raw", key); }

async function importMasterKeyRaw(raw) {
    return await window.crypto.subtle.importKey(
        "raw", raw, { name: "AES-GCM" }, true, ["encrypt", "decrypt"]
    );
}

// ========================================================
// 3. OBFUSCATION LAYERS (Tarnung)
// ========================================================

function algoMirror(text) { return text.split('').reverse().join(''); }

function algoCaesar(text, code, forward = true) {
    let shift = 0;
    for(let char of code) shift += parseInt(char) || 0;
    shift = shift % 15 + 1; 
    if (!forward) shift = -shift;
    return text.split('').map(c => {
        let code = c.charCodeAt(0);
        if (code >= 32 && code <= 126) return String.fromCharCode(((code - 32 + shift + 95) % 95) + 32);
        return c;
    }).join('');
}

// FIXED: Reversible Block Swap
function algoBlockSwap(text, forward = true) {
    const n = text.length;
    const mid = Math.floor(n / 2);
    // Encrypt: Left(0..mid) moves to end. Right(mid..n) moves to start.
    // Decrypt: To reverse, we need to shift the other way.

    if(forward) {
        return text.substring(mid) + text.substring(0, mid);
    } else {
        // Since forward shifted by `mid` to the left (cyclically),
        // reverse shifts by `mid` to the right.
        // Right shift by `mid` is equivalent to Left shift by `n - mid`.
        return text.substring(n - mid) + text.substring(0, n - mid);
    }
}

function algoMapSwap(text, forward = true) {
    const mapSrc = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    const mapDst = "9876543210zyxwvutsrqponmlkjihgfedcbaZYXWVUTSRQPONMLKJIHGFEDCBA";
    return text.split('').map(c => {
        const idx = forward ? mapSrc.indexOf(c) : mapDst.indexOf(c);
        return idx > -1 ? (forward ? mapDst[idx] : mapSrc[idx]) : c;
    }).join('');
}

// ========================================================
// 4. CORE LOGIC: ENCRYPTION
// ========================================================

export async function encryptFull(message, accessCode, recipientIDs = []) {
    if (recipientIDs.length === 0) throw new Error("Keine Empfänger-ID für Slot-Erstellung.");

    try {
        console.log("🔒 Start Encryption (v4 Compressed)...");
        const payloadBuffer = await compressData(message);
        const masterKey = await generateMasterKey();
        const masterKeyRaw = await exportMasterKey(masterKey);
        const ivMsg = window.crypto.getRandomValues(new Uint8Array(12));
        
        const encryptedMsgBuffer = await window.crypto.subtle.encrypt(
            { name: "AES-GCM", iv: ivMsg }, masterKey, payloadBuffer
        );

        const slots = [];
        for (const userId of recipientIDs) {
            if(!userId) continue;
            const kek = await importKeyFromPass(accessCode, userId.trim());
            const ivSlot = window.crypto.getRandomValues(new Uint8Array(12));
            const wrappedKey = await window.crypto.subtle.encrypt(
                { name: "AES-GCM", iv: ivSlot }, kek, masterKeyRaw
            );
            slots.push({ type: 'usr', iv: buf2base64(ivSlot), data: buf2base64(wrappedKey) });
        }

        const container = { v: 4, iv: buf2base64(ivMsg), p: buf2base64(encryptedMsgBuffer), s: slots };
        let finalString = JSON.stringify(container);

        // Tarnung
        finalString = algoMapSwap(finalString, true);
        finalString = algoBlockSwap(finalString, true); // FIXED
        finalString = algoCaesar(finalString, accessCode, true);
        finalString = algoMirror(finalString);

        return btoa(finalString);

    } catch (e) {
        console.error("Encrypt Error:", e);
        throw new Error("Verschlüsselung fehlgeschlagen");
    }
}

// ========================================================
// 5. CORE LOGIC: DECRYPTION
// ========================================================

export async function decryptFull(encryptedPackage, accessCode, currentUserId) {
    if (!currentUserId) throw new Error("Login erforderlich für Entschlüsselung.");

    try {
        console.log("🔓 Start Decryption...");

        let rawStr = atob(encryptedPackage);
        rawStr = algoMirror(rawStr);
        rawStr = algoCaesar(rawStr, accessCode, false);
        rawStr = algoBlockSwap(rawStr, false); // FIXED
        rawStr = algoMapSwap(rawStr, false);

        const container = JSON.parse(rawStr);
        if (!container.v || !container.s) throw new Error("Format ungültig");

        let masterKeyRaw = null;
        for (const slot of container.s) {
            try {
                if (slot.type === 'usr') {
                    const kek = await importKeyFromPass(accessCode, currentUserId.trim());
                    masterKeyRaw = await window.crypto.subtle.decrypt(
                        { name: "AES-GCM", iv: base642buf(slot.iv) }, kek, base642buf(slot.data)
                    );
                    if(masterKeyRaw) break; 
                } 
            } catch (err) { }
        }

        if (!masterKeyRaw) throw new Error("Keine Berechtigung oder falscher Code.");

        const masterKey = await importMasterKeyRaw(masterKeyRaw);
        const decryptedBuffer = await window.crypto.subtle.decrypt(
            { name: "AES-GCM", iv: base642buf(container.iv) }, masterKey, base642buf(container.p)
        );

        if (container.v >= 4) {
            console.log("📦 Erkannt: Komprimierte Nachricht (v4)");
            return await decompressData(decryptedBuffer);
        } else {
            console.log("📄 Erkannt: Legacy Nachricht (v" + container.v + ")");
            return textDec.decode(decryptedBuffer);
        }

    } catch (e) {
        console.error("Decrypt Error:", e);
        throw new Error("Zugriff verweigert. Code falsch oder nicht berechtigt.");
    }
}
