// cryptoLayers.js - Enterprise Edition (Compression + High Security)
// Version 4: GZIP Compression integriert für kleinere QR-Codes

const textEnc = new TextEncoder();
const textDec = new TextDecoder();

// ========================================================
// 1. HILFSFUNKTIONEN (Tools & Compression)
// ========================================================

function buf2base64(buffer) { return btoa(String.fromCharCode(...new Uint8Array(buffer))); }
function base642buf(str) { return Uint8Array.from(atob(str), c => c.charCodeAt(0)); }

// --- NEU: KOMPRIMIERUNG (GZIP) ---
async function compressData(text) {
    // Wandelt Text in GZIP-komprimierte Bytes um
    const stream = new Blob([text]).stream();
    const compressed = stream.pipeThrough(new CompressionStream("gzip"));
    return await new Response(compressed).arrayBuffer();
}

async function decompressData(buffer) {
    // Wandelt GZIP-Bytes zurück in Text
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
    // WICHTIG: Wir behalten deinen Salt-Prefix bei für Konsistenz!
    const combinedSalt = "SECRET_MSG_V2_SALT_LAYER_" + userId.trim().toLowerCase(); 

    const keyMaterial = await window.crypto.subtle.importKey(
        "raw", textEnc.encode(passString), { name: "PBKDF2" }, false, ["deriveKey"]
    );
    
    // WICHTIG: Wir bleiben bei deinen 100.000 Iterationen!
    return window.crypto.subtle.deriveKey(
        { 
            name: "PBKDF2", 
            salt: textEnc.encode(combinedSalt), 
            iterations: 100000, 
            hash: "SHA-256" 
        },
        keyMaterial, 
        { name: "AES-GCM", length: 256 }, 
        false, 
        ["encrypt", "decrypt"]
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

function algoBlockSwap(text) {
    const mid = Math.floor(text.length / 2);
    return text.substring(mid) + text.substring(0, mid);
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
// 4. CORE LOGIC: ENCRYPTION (v4 with Compression)
// ========================================================

export async function encryptFull(message, accessCode, recipientIDs = []) {
    // Sicherheits-Check: Mindestens ein Empfänger (Absender selbst) muss dabei sein
    if (recipientIDs.length === 0) throw new Error("Keine Empfänger-ID für Slot-Erstellung.");

    try {
        console.log("🔒 Start Encryption (v4 Compressed)...");

        // 1. KOMPRIMIEREN (Hier sparen wir Platz für den QR Code!)
        const payloadBuffer = await compressData(message);

        // 2. Master Key generieren
        const masterKey = await generateMasterKey();
        const masterKeyRaw = await exportMasterKey(masterKey);

        // 3. Komprimierte Daten verschlüsseln
        const ivMsg = window.crypto.getRandomValues(new Uint8Array(12));
        
        // Wir verschlüsseln den komprimierten Buffer, nicht den Text!
        const encryptedMsgBuffer = await window.crypto.subtle.encrypt(
            { name: "AES-GCM", iv: ivMsg }, masterKey, payloadBuffer
        );

        // 4. User-Tresore (Slots) bauen
        const slots = [];
        
        for (const userId of recipientIDs) {
            if(!userId) continue;
            
            const kek = await importKeyFromPass(accessCode, userId.trim());
            const ivSlot = window.crypto.getRandomValues(new Uint8Array(12));
            const wrappedKey = await window.crypto.subtle.encrypt(
                { name: "AES-GCM", iv: ivSlot }, kek, masterKeyRaw
            );

            slots.push({
                type: 'usr',
                iv: buf2base64(ivSlot),
                data: buf2base64(wrappedKey)
            });
        }

        // 5. Paket schnüren -> VERSION 4 (Signalisiert Komprimierung)
        const container = {
            v: 4, 
            iv: buf2base64(ivMsg),
            p: buf2base64(encryptedMsgBuffer), 
            s: slots
        };
        
        let finalString = JSON.stringify(container);

        // 6. Tarnung
        finalString = algoMapSwap(finalString, true);
        finalString = algoBlockSwap(finalString);
        finalString = algoCaesar(finalString, accessCode, true);
        finalString = algoMirror(finalString);

        return btoa(finalString);

    } catch (e) {
        console.error("Encrypt Error:", e);
        throw new Error("Verschlüsselung fehlgeschlagen");
    }
}


// ========================================================
// 5. CORE LOGIC: DECRYPTION (Auto-Detect v2/v3/v4)
// ========================================================

export async function decryptFull(encryptedPackage, accessCode, currentUserId) {
    if (!currentUserId) throw new Error("Login erforderlich für Entschlüsselung.");

    try {
        console.log("🔓 Start Decryption...");

        // 1. Tarnung entfernen
        let rawStr = atob(encryptedPackage);
        rawStr = algoMirror(rawStr);
        rawStr = algoCaesar(rawStr, accessCode, false);
        rawStr = algoBlockSwap(rawStr);
        rawStr = algoMapSwap(rawStr, false);

        // 2. JSON parsen
        const container = JSON.parse(rawStr);
        if (!container.v || !container.s) throw new Error("Format ungültig");

        let masterKeyRaw = null;

        // 3. Tresor öffnen
        for (const slot of container.s) {
            try {
                if (slot.type === 'usr') {
                    // Verwendet deine High-Sec Logik zum Öffnen
                    const kek = await importKeyFromPass(accessCode, currentUserId.trim());

                    masterKeyRaw = await window.crypto.subtle.decrypt(
                        { name: "AES-GCM", iv: base642buf(slot.iv) },
                        kek,
                        base642buf(slot.data)
                    );

                    if(masterKeyRaw) break; 
                } 
            } catch (err) { }
        }

        if (!masterKeyRaw) throw new Error("Keine Berechtigung oder falscher Code.");

        // 4. Nachricht entschlüsseln
        const masterKey = await importMasterKeyRaw(masterKeyRaw);
        
        const decryptedBuffer = await window.crypto.subtle.decrypt(
            { name: "AES-GCM", iv: base642buf(container.iv) },
            masterKey,
            base642buf(container.p)
        );

        // 5. ENTPACKEN (Logik-Weiche)
        if (container.v >= 4) {
            // Ab Version 4 nutzen wir GZIP
            console.log("📦 Erkannt: Komprimierte Nachricht (v4)");
            return await decompressData(decryptedBuffer);
        } else {
            // Alte Versionen (v2, v3) waren Plain Text
            console.log("📄 Erkannt: Legacy Nachricht (v" + container.v + ")");
            return textDec.decode(decryptedBuffer);
        }

    } catch (e) {
        console.error("Decrypt Error:", e);
        throw new Error("Zugriff verweigert. Code falsch oder nicht berechtigt.");
    }
}
