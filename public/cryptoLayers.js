// cryptoLayers.js - Multi-Recipient Architecture (KEIN Public Mode mehr)

const textEnc = new TextEncoder();
const textDec = new TextDecoder();

// ========================================================
// 1. HILFSFUNKTIONEN
// ========================================================
function buf2base64(buffer) { return btoa(String.fromCharCode(...new Uint8Array(buffer))); }
function base642buf(str) { return Uint8Array.from(atob(str), c => c.charCodeAt(0)); }

async function generateMasterKey() {
    return await window.crypto.subtle.generateKey(
        { name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]
    );
}

// Generiert den "Schlüssel zum Tresor" (KEK) basierend auf Code + UserID
async function importKeyFromPass(passString, userId) {
    // Salt-Präfix wie in der alten Version, kombiniert mit der UserID
    const combinedSalt = "SECRET_MSG_V2_SALT_LAYER_" + userId.trim().toLowerCase(); 

    const keyMaterial = await window.crypto.subtle.importKey(
        "raw", textEnc.encode(passString), { name: "PBKDF2" }, false, ["deriveKey"]
    );
    
    // Iterationen auf 100.000 hochgesetzt (High-Sec Standard)
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
    return await window.crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, true, ["encrypt", "decrypt"]);
}

// ========================================================
// 2. DIE 4 ALGORITHMEN (Obfuscation Layers)
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
// 3. CORE LOGIC: ENCRYPTION (NUR User-Slots)
// ========================================================

/**
 * @param {string} message - Der Klartext
 * @param {string} accessCode - Der 5-stellige Code
 * @param {Array<string>} recipientIDs - Liste der User-IDs (MUSS den Absender enthalten!)
 */
export async function encryptFull(message, accessCode, recipientIDs = []) {
    // recipientIDs MUSS hier gefüllt sein, da app.js das sicherstellt.
    if (recipientIDs.length === 0) throw new Error("Keine Empfänger-ID für Slot-Erstellung.");

    try {
        // 1. Master Key generieren
        const masterKey = await generateMasterKey();
        const masterKeyRaw = await exportMasterKey(masterKey);

        // 2. Nachricht mit Master Key verschlüsseln
        const ivMsg = window.crypto.getRandomValues(new Uint8Array(12));
        const encryptedMsgBuffer = await window.crypto.subtle.encrypt(
            { name: "AES-GCM", iv: ivMsg }, masterKey, textEnc.encode(message)
        );

        // 3. Schlüsseltresore (User Slots) bauen
        const slots = [];
        
        // NUR RESTRICTED SLOTS
        for (const userId of recipientIDs) {
            if(!userId) continue;
            
            // Der Schlüssel für den Tresor ist: 5-stelliger Code + UserID (als Salt-Basis)
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

        // 4. Das Paket schnüren
        const container = {
            v: 3, // Version (zur Kennzeichnung der neuen Logik)
            iv: buf2base64(ivMsg),
            p: buf2base64(encryptedMsgBuffer), // Payload
            s: slots // Die Tresore
        };
        
        let finalString = JSON.stringify(container);

        // 5. Die 4 Algorithmen anwenden
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
// 4. CORE LOGIC: DECRYPTION (NUR User-Slots)
// ========================================================

/**
 * @param {string} encryptedPackage - Der verschlüsselte String
 * @param {string} accessCode - Der 5-stellige Code
 * @param {string} currentUserId - Die ID des aktuell eingeloggten Users (MUSS vorhanden sein)
 */
export async function decryptFull(encryptedPackage, accessCode, currentUserId) {
    if (!currentUserId) throw new Error("Login erforderlich für Entschlüsselung.");

    try {
        // 1. Äußere Hülle entfernen (Algorithmen rückwärts)
        let rawStr = atob(encryptedPackage);
        rawStr = algoMirror(rawStr);
        rawStr = algoCaesar(rawStr, accessCode, false);
        rawStr = algoBlockSwap(rawStr);
        rawStr = algoMapSwap(rawStr, false);

        // 2. JSON parsen
        const container = JSON.parse(rawStr);
        if (!container.v || !container.s) throw new Error("Format ungültig");

        let masterKeyRaw = null;

        // 3. Den richtigen User-Tresor (Slot) finden und öffnen
        for (const slot of container.s) {
            try {
                // Wir probieren nur den Slot, der für den aktuellen User relevant ist
                if (slot.type === 'usr') {
                    // Verwende Code + Eigene UserID als Schlüssel zum Tresor
                    const kek = await importKeyFromPass(accessCode, currentUserId.trim());

                    // Versuch: MasterKey entschlüsseln
                    masterKeyRaw = await window.crypto.subtle.decrypt(
                        { name: "AES-GCM", iv: base642buf(slot.iv) },
                        kek,
                        base642buf(slot.data)
                    );

                    if(masterKeyRaw) break; // Erfolg!

                } 
                // Public Slots werden ignoriert oder fehlen in diesem Format

            } catch (err) {
                // Falscher Code im Tresor -> weiter
            }
        }

        if (!masterKeyRaw) {
            throw new Error("Keine Berechtigung oder falscher Code.");
        }

        // 4. Nachricht entschlüsseln
        const masterKey = await importMasterKeyRaw(masterKeyRaw);
        
        const decryptedBuffer = await window.crypto.subtle.decrypt(
            { name: "AES-GCM", iv: base642buf(container.iv) },
            masterKey,
            base642buf(container.p)
        );

        return textDec.decode(decryptedBuffer);

    } catch (e) {
        console.error("Decrypt Error:", e);
        // Generischer Fehler (wird von app.js abgefangen)
        throw new Error("Zugriff verweigert. Code falsch oder nicht berechtigt.");
    }
}
