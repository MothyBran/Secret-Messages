// cryptoLayers.js - Multi-Recipient Architecture & Hybrid Obfuscation (Final High-Sec)
// Kombiniert Multi-User Slots mit High-Security Parametern der alten Version.

const textEnc = new TextEncoder();
const textDec = new TextDecoder();

// ========================================================
// 1. HILFSFUNKTIONEN
// ========================================================

// Robuste Base64 Konvertierung (UrlSafe handled by Standard Base64 for internal use)
function buf2base64(buffer) {
    return btoa(String.fromCharCode(...new Uint8Array(buffer)));
}
function base642buf(str) {
    return Uint8Array.from(atob(str), c => c.charCodeAt(0));
}

// ========================================================
// 2. KRYPTOGRAFISCHER KERN (AES-GCM + PBKDF2)
// ========================================================

// Generiert den Master Key (Zufällig pro Nachricht)
async function generateMasterKey() {
    return await window.crypto.subtle.generateKey(
        { name: "AES-GCM", length: 256 },
        true, ["encrypt", "decrypt"]
    );
}

// Generiert den "Schlüssel zum Tresor" (KEK) basierend auf Code + UserID
async function importKeyFromPass(passString, uniqueSaltID) {
    // 1. Importiere das Passwort (den 5-stelligen Code)
    const keyMaterial = await window.crypto.subtle.importKey(
        "raw", textEnc.encode(passString), { name: "PBKDF2" }, false, ["deriveKey"]
    );

    // 2. Erstelle ein komplexes Salt (Wie in der alten Version, aber dynamisch)
    // Wir kombinieren einen festen App-Salt mit der User-ID (oder Public-Salt)
    const combinedSalt = "SECRET_MSG_V2_SALT_LAYER_" + uniqueSaltID.trim().toLowerCase();

    // 3. PBKDF2 Ableitung (100.000 Iterationen für maximale Sicherheit gegen Brute-Force)
    return window.crypto.subtle.deriveKey(
        { 
            name: "PBKDF2", 
            salt: textEnc.encode(combinedSalt), 
            iterations: 100000, // Hochgesetzt auf 100k (wie in deiner alten Version)
            hash: "SHA-256" 
        },
        keyMaterial, 
        { name: "AES-GCM", length: 256 }, 
        false, 
        ["encrypt", "decrypt"]
    );
}

// Export/Import für den MasterKey (um ihn in die Slots zu legen)
async function exportMasterKey(key) { return await window.crypto.subtle.exportKey("raw", key); }
async function importMasterKeyRaw(raw) {
    return await window.crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, true, ["encrypt", "decrypt"]);
}

// ========================================================
// 3. DIE 4 ALGORITHMEN (Obfuscation Layers)
// ========================================================
// Diese verschleiern das Datenpaket, basierend auf dem 5-stelligen Code.

// Algo 1: Spiegelung
function algoMirror(text) { return text.split('').reverse().join(''); }

// Algo 2: Dynamischer Caesar (Zahlendreher/Shift)
// Basiert auf der Quersumme des Codes
function algoCaesar(text, code, forward = true) {
    let shift = 0;
    for(let char of code) shift += parseInt(char) || 0;
    shift = shift % 15 + 1; // Shift zwischen 1 und 15
    if (!forward) shift = -shift;

    return text.split('').map(c => {
        let code = c.charCodeAt(0);
        // Wir shiften nur den lesbaren ASCII Bereich (32-126) um JSON nicht zu zerstören
        if (code >= 32 && code <= 126) {
            return String.fromCharCode(((code - 32 + shift + 95) % 95) + 32);
        }
        return c;
    }).join('');
}

// Algo 3: Block-Swap (Hälften tauschen)
function algoBlockSwap(text) {
    const mid = Math.floor(text.length / 2);
    return text.substring(mid) + text.substring(0, mid);
}

// Algo 4: Map Swap (Zeichentauschtabelle)
function algoMapSwap(text, forward = true) {
    const mapSrc = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    const mapDst = "9876543210zyxwvutsrqponmlkjihgfedcbaZYXWVUTSRQPONMLKJIHGFEDCBA";
    
    return text.split('').map(c => {
        const idx = forward ? mapSrc.indexOf(c) : mapDst.indexOf(c);
        return idx > -1 ? (forward ? mapDst[idx] : mapSrc[idx]) : c;
    }).join('');
}

// ========================================================
// 4. HAUPTFUNKTION: VERSCHLÜSSELN
// ========================================================

export async function encryptFull(message, accessCode, recipientIDs = []) {
    try {
        // A. Master Key erstellen & Nachricht damit verschlüsseln
        const masterKey = await generateMasterKey();
        const masterKeyRaw = await exportMasterKey(masterKey);
        
        const ivMsg = window.crypto.getRandomValues(new Uint8Array(12));
        const encryptedMsgBuffer = await window.crypto.subtle.encrypt(
            { name: "AES-GCM", iv: ivMsg }, masterKey, textEnc.encode(message)
        );

        // B. Tresore (Slots) erstellen
        const slots = [];
        const isPublic = recipientIDs.length === 0;

        if (isPublic) {
            // PUBLIC SLOT (Jeder mit Code)
            const kek = await importKeyFromPass(accessCode, "PUBLIC_GLOBAL_SALT");
            const ivSlot = window.crypto.getRandomValues(new Uint8Array(12));
            const wrappedKey = await window.crypto.subtle.encrypt(
                { name: "AES-GCM", iv: ivSlot }, kek, masterKeyRaw
            );
            slots.push({ type: 'pub', iv: buf2base64(ivSlot), data: buf2base64(wrappedKey) });
        } else {
            // USER SLOTS (Für jeden Empfänger + Absender)
            // Hier fließt die ID des Empfängers in die Verschlüsselung ein!
            for (const userId of recipientIDs) {
                if(!userId) continue;
                
                // Salt ist jetzt "SECRET_MSG_V2_SALT_LAYER_" + userId
                const kek = await importKeyFromPass(accessCode, userId.trim());
                
                const ivSlot = window.crypto.getRandomValues(new Uint8Array(12));
                const wrappedKey = await window.crypto.subtle.encrypt(
                    { name: "AES-GCM", iv: ivSlot }, kek, masterKeyRaw
                );
                slots.push({ type: 'usr', iv: buf2base64(ivSlot), data: buf2base64(wrappedKey) });
            }
        }

        // C. Paket schnüren
        let container = JSON.stringify({ 
            v: 3, // Version 3 (High-Sec)
            iv: buf2base64(ivMsg), 
            p: buf2base64(encryptedMsgBuffer), 
            s: slots 
        });

        // D. Tarnkappen-Algorithmen anwenden (Hängen nur vom Code ab)
        // Reihenfolge: MapSwap -> BlockSwap -> Caesar -> Mirror
        container = algoMapSwap(container, true);
        container = algoBlockSwap(container);
        container = algoCaesar(container, accessCode, true);
        container = algoMirror(container);

        // E. Finale Base64 Hülle
        return btoa(container);

    } catch (e) {
        console.error("Encrypt Error:", e);
        throw new Error("Verschlüsselung fehlgeschlagen");
    }
}

// ========================================================
// 5. HAUPTFUNKTION: ENTSCHLÜSSELN
// ========================================================

export async function decryptFull(encryptedPackage, accessCode, currentUserId) {
    try {
        // A. Äußere Hülle entfernen
        let rawStr = atob(encryptedPackage);
        
        // Algorithmen rückwärts: Mirror -> Caesar -> BlockSwap -> MapSwap
        rawStr = algoMirror(rawStr);
        rawStr = algoCaesar(rawStr, accessCode, false);
        rawStr = algoBlockSwap(rawStr);
        rawStr = algoMapSwap(rawStr, false);

        // B. JSON parsen
        const container = JSON.parse(rawStr);
        if (!container.s) throw new Error("Format ungültig");

        let masterKeyRaw = null;

        // C. Passenden Slot suchen & öffnen
        for (const slot of container.s) {
            try {
                let kek;

                // Prüfen: Ist es ein Public Slot?
                if (slot.type === 'pub') {
                    kek = await importKeyFromPass(accessCode, "PUBLIC_GLOBAL_SALT");
                } 
                // Prüfen: Ist es ein Slot für MICH?
                else if (slot.type === 'usr' && currentUserId) {
                    kek = await importKeyFromPass(accessCode, currentUserId.trim());
                } 
                else {
                    continue; // Nicht mein Slot
                }

                // Versuch den Slot zu öffnen
                masterKeyRaw = await window.crypto.subtle.decrypt(
                    { name: "AES-GCM", iv: base642buf(slot.iv) },
                    kek,
                    base642buf(slot.data)
                );

                if (masterKeyRaw) break; // Erfolg! Wir haben den MasterKey

            } catch (err) {
                // Falscher Code oder falscher Slot -> weiterprobieren
            }
        }

        if (!masterKeyRaw) throw new Error("Kein gültiger Schlüssel gefunden.");

        // D. Nachricht entschlüsseln
        const masterKey = await importMasterKeyRaw(masterKeyRaw);
        
        const decryptedBuffer = await window.crypto.subtle.decrypt(
            { name: "AES-GCM", iv: base642buf(container.iv) },
            masterKey,
            base642buf(container.p)
        );

        return textDec.decode(decryptedBuffer);

    } catch (e) {
        console.error("Decrypt Fehler:", e);
        // Generischer Fehler für Sicherheit
        throw new Error("Entschlüsselung fehlgeschlagen. Code falsch oder keine Berechtigung.");
    }
}
