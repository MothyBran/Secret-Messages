// cryptoLayers.js - Multi-Recipient Architecture & Hybrid Obfuscation
// Erfüllt die Anforderung: Public Access ODER Restricted List Access

// ========================================================
// 1. HILFSFUNKTIONEN (Tools)
// ========================================================

const textEnc = new TextEncoder();
const textDec = new TextDecoder();

// Konvertierung String <-> Base64 (UrlSafe)
function buf2base64(buffer) {
    return btoa(String.fromCharCode(...new Uint8Array(buffer)));
}
function base642buf(str) {
    return Uint8Array.from(atob(str), c => c.charCodeAt(0));
}

// Generiert einen echten Zufallsschlüssel (Master Key)
async function generateMasterKey() {
    return await window.crypto.subtle.generateKey(
        { name: "AES-GCM", length: 256 },
        true, ["encrypt", "decrypt"]
    );
}

// Importiert einen Key aus Raw-Daten (für die Tresore)
async function importKeyFromPass(passString, saltString) {
    const keyMaterial = await window.crypto.subtle.importKey(
        "raw", textEnc.encode(passString), { name: "PBKDF2" }, false, ["deriveKey"]
    );
    // Wir nutzen PBKDF2 um aus dem kurzen Code + ID einen starken 256-bit Key zu machen
    return window.crypto.subtle.deriveKey(
        { name: "PBKDF2", salt: textEnc.encode(saltString), iterations: 50000, hash: "SHA-256" },
        keyMaterial, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"] // false = key kann nicht exportiert werden
    );
}

// Exportiert den MasterKey, damit wir ihn in die Tresore legen können
async function exportMasterKey(key) {
    return await window.crypto.subtle.exportKey("raw", key);
}

// Importiert den MasterKey zurück (nachdem er aus dem Tresor geholt wurde)
async function importMasterKeyRaw(raw) {
    return await window.crypto.subtle.importKey(
        "raw", raw, { name: "AES-GCM" }, true, ["encrypt", "decrypt"]
    );
}

// ========================================================
// 2. DIE 4 ALGORITHMEN (Obfuscation Layers)
// ========================================================
// Diese Algorithmen verschleiern das JSON-Paket, NACHDEM es kryptografisch gesichert wurde.

// Algo 1: Spiegelung (Mirror)
function algoMirror(text) {
    return text.split('').reverse().join('');
}

// Algo 2: ASCII Shift basierend auf der Quersumme des Codes
function algoCaesar(text, code, forward = true) {
    let shift = 0;
    for(let char of code) shift += parseInt(char) || 0;
    shift = shift % 10 + 1; // Shift zwischen 1 und 10
    if (!forward) shift = -shift;

    // Wir shiften nur druckbare Zeichen, um das Format nicht zu zerstören
    return text.split('').map(c => {
        let code = c.charCodeAt(0);
        // Bereich: 32 (Space) bis 126 (~)
        if (code >= 32 && code <= 126) {
            return String.fromCharCode(((code - 32 + shift + 95) % 95) + 32);
        }
        return c;
    }).join('');
}

// Algo 3: Block-Swap (Tauscht erste und zweite Hälfte)
function algoBlockSwap(text) {
    const mid = Math.floor(text.length / 2);
    return text.substring(mid) + text.substring(0, mid);
}

// Algo 4: Dummy Injektion (Fügt an ungeraden Stellen sinnlose Zeichen ein - Simpel)
// Wir nutzen hier eine einfache Variante: Base64 "Verdrehung"
function algoMapSwap(text, forward = true) {
    // Tauscht A mit Z, a mit z (einfache Substitution)
    const mapSrc = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
    const mapDst = "ZYXWVUTSRQPONMLKJIHGFEDCBAzyxwvutsrqponmlkjihgfedcba";
    
    return text.split('').map(c => {
        const idx = forward ? mapSrc.indexOf(c) : mapDst.indexOf(c);
        return idx > -1 ? (forward ? mapDst[idx] : mapSrc[idx]) : c;
    }).join('');
}


// ========================================================
// 3. CORE LOGIC: ENCRYPTION
// ========================================================

/**
 * @param {string} message - Der Klartext
 * @param {string} accessCode - Der 5-stellige Code
 * @param {Array<string>} recipientIDs - Liste der User-IDs (Inkl. Absender!). Leer = Public.
 */
export async function encryptFull(message, accessCode, recipientIDs = []) {
    try {
        console.log("🔒 Verschlüsselung startet...", { recipients: recipientIDs.length });

        // 1. Master Key generieren (zufällig für diese eine Nachricht)
        const masterKey = await generateMasterKey();
        const masterKeyRaw = await exportMasterKey(masterKey);

        // 2. Nachricht mit Master Key verschlüsseln
        const ivMsg = window.crypto.getRandomValues(new Uint8Array(12));
        const encryptedMsgBuffer = await window.crypto.subtle.encrypt(
            { name: "AES-GCM", iv: ivMsg }, masterKey, textEnc.encode(message)
        );

        // 3. Schlüsseltresore (Key Slots) bauen
        const slots = [];
        const isPublic = recipientIDs.length === 0;

        if (isPublic) {
            // FALL 1: PUBLIC (Keine Empfänger)
            // Wir verschlüsseln den MasterKey NUR mit dem 5-stelligen Code
            // Salt ist fix, damit jeder mit dem Code den Key generieren kann
            const salt = "PUBLIC_ACCESS_SALT"; 
            const kek = await importKeyFromPass(accessCode, salt); // Key Encryption Key
            
            const ivSlot = window.crypto.getRandomValues(new Uint8Array(12));
            const wrappedKey = await window.crypto.subtle.encrypt(
                { name: "AES-GCM", iv: ivSlot }, kek, masterKeyRaw
            );
            
            slots.push({
                type: 'pub',
                iv: buf2base64(ivSlot),
                data: buf2base64(wrappedKey)
            });
            
        } else {
            // FALL 2: RESTRICTED (Liste von Empfängern)
            // Wir erstellen einen Slot für JEDEN Empfänger
            for (const userId of recipientIDs) {
                if(!userId) continue;
                
                // Der Schlüssel für den Tresor ist: 5-stelliger Code + UserID
                // Salt ist die UserID selbst (macht es unique pro User)
                const kek = await importKeyFromPass(accessCode, userId.trim());
                
                const ivSlot = window.crypto.getRandomValues(new Uint8Array(12));
                const wrappedKey = await window.crypto.subtle.encrypt(
                    { name: "AES-GCM", iv: ivSlot }, kek, masterKeyRaw
                );

                slots.push({
                    type: 'usr',
                    // Wir speichern NICHT die UserID im Klartext, um Anonymität zu wahren.
                    // Stattdessen versuchen wir beim Entschlüsseln alle Slots.
                    // Aber zur Optimierung speichern wir einen Hash der UserID, 
                    // damit der Client weiß, welchen Slot er probieren soll?
                    // NEIN: User wollte "muss nicht wissen welche Empfänger".
                    // Am sichersten: Wir speichern KEINE ID. Der Client probiert einfach alle Slots durch.
                    iv: buf2base64(ivSlot),
                    data: buf2base64(wrappedKey)
                });
            }
        }

        // 4. Das Paket schnüren (JSON)
        const container = {
            v: 2, // Version
            iv: buf2base64(ivMsg),
            p: buf2base64(encryptedMsgBuffer), // Payload
            s: slots // Die Tresore
        };
        
        let finalString = JSON.stringify(container);

        // 5. Die 4 Algorithmen anwenden (Layering)
        // Reihenfolge: Swap -> BlockSwap -> Caesar -> Mirror
        finalString = algoMapSwap(finalString, true);
        finalString = algoBlockSwap(finalString);
        finalString = algoCaesar(finalString, accessCode, true);
        finalString = algoMirror(finalString);

        // 6. Finale Hülle (Base64) damit es sauber kopierbar ist
        return btoa(finalString);

    } catch (e) {
        console.error("Encrypt Error:", e);
        throw new Error("Verschlüsselung fehlgeschlagen");
    }
}


// ========================================================
// 4. CORE LOGIC: DECRYPTION
// ========================================================

/**
 * @param {string} encryptedPackage - Der verschlüsselte String
 * @param {string} accessCode - Der 5-stellige Code
 * @param {string} currentUserId - Die ID des aktuell eingeloggten Users
 */
export async function decryptFull(encryptedPackage, accessCode, currentUserId) {
    try {
        console.log("🔓 Entschlüsselung startet...", { user: currentUserId });

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

        // 3. Den richtigen Tresor (Slot) finden
        // Wir probieren JETZT beides: 
        // A) Einen persönlichen Slot (wenn User eingeloggt)
        // B) Einen öffentlichen Slot (falls vorhanden)
        
        for (const slot of container.s) {
            try {
                let kek; // Key Encryption Key

                if (slot.type === 'pub') {
                    // FALL A: Public Slot (Jeder mit Code)
                    // Wir versuchen es IMMER, egal wer eingeloggt ist
                    kek = await importKeyFromPass(accessCode, "PUBLIC_ACCESS_SALT");
                } 
                else if (slot.type === 'usr' && currentUserId) {
                    // FALL B: User Slot (Nur für mich)
                    kek = await importKeyFromPass(accessCode, currentUserId.trim());
                } else {
                    // Slot nicht für uns relevant
                    continue;
                }

                // Versuch: MasterKey entschlüsseln
                masterKeyRaw = await window.crypto.subtle.decrypt(
                    { name: "AES-GCM", iv: base642buf(slot.iv) },
                    kek,
                    base642buf(slot.data)
                );

                if(masterKeyRaw) {
                    console.log(`✅ Gültiger Slot gefunden! Typ: ${slot.type}`);
                    break; // Erfolg! Raus aus der Schleife
                }

            } catch (err) {
                // Falscher Slot/Code -> weiter zum nächsten
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
        throw new Error("Zugriff verweigert. Code falsch oder nicht berechtigt.");
    }
}
