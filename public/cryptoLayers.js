// cryptoLayers.js - Hybrid Encryption (AES-GCM Core + Custom Obfuscation Layers)

// ========================================================
// 1. DER MATHEMATISCHE KERN (Web Crypto API - AES-GCM)
// ========================================================

// Hilfsfunktionen für AES
function str2ab(str) { return new TextEncoder().encode(str); }
function ab2str(buf) { return btoa(String.fromCharCode(...new Uint8Array(buf))); }
function str2ab_b64(str) { return Uint8Array.from(atob(str), c => c.charCodeAt(0)); }

async function generateKey(passcode, recipientName) { // <--- NEU: recipientName
    // Kombiniertes Salt, abhängig vom Empfänger
    const combinedSalt = "SecretMessagesSalt_v1_" + recipientName.toLowerCase().trim(); // Case-insensitive
    
    const keyMaterial = await window.crypto.subtle.importKey(
        "raw", str2ab(passcode), { name: "PBKDF2" }, false, ["deriveKey"]
    );
    return window.crypto.subtle.deriveKey(
        // PBKDF2 verwendet das kombinierte Salt
        { name: "PBKDF2", salt: str2ab(combinedSalt), iterations: 100000, hash: "SHA-256" },
        keyMaterial, { name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]
    );
}

// Interne AES Funktion (Der "Safe")
async function encryptAES(message, code, recipientName) { // <--- NEU: recipientName
    const key = await generateKey(code, recipientName); // <--- ÜBERGABE
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const encryptedContent = await window.crypto.subtle.encrypt(
        { name: "AES-GCM", iv: iv }, key, str2ab(message)
    );
    // Standard Format: IV:Ciphertext
    return `${ab2str(iv)}:${ab2str(encryptedContent)}`;
}

// Interne AES Entschlüsselung
async function decryptAES(encryptedString, code, recipientName) { // <--- NEU: recipientName
    const parts = encryptedString.split(':');
    if (parts.length !== 2) throw new Error("AES Format ungültig");
    
    const iv = str2ab_b64(parts[0]);
    const data = str2ab_b64(parts[1]);
    const key = await generateKey(code, recipientName); // <--- ÜBERGABE

    const decryptedContent = await window.crypto.subtle.decrypt(
        { name: "AES-GCM", iv: iv }, key, data
    );
    return new TextDecoder().decode(decryptedContent);
}


// ========================================================
// 2. DEINE "ALTE" LOGIK (Der Tarnumhang)
// ========================================================

// Wir nutzen hier vereinfachte Versionen deiner Algorithmen,
// die sicher mit dem AES-Output (Base64) umgehen können.

function reverseText(text) {
    return text.split('').reverse().join('');
}

function caesarCipher(text, code, recipientName, forward = true) {
    // Wir nutzen die Quersumme des Codes als Verschiebung
    let shift = 0;
    for(let i=0; i<code.length; i++) shift += parseInt(code[i]);
    shift += recipientName.length;
    shift = shift % 20; // Verschiebung begrenzen

    if (!forward) shift = -shift;

    return text.split('').map(char => {
        let c = char.charCodeAt(0);
        return String.fromCharCode(c + shift); 
    }).join('');
}

// Eine einfache Base64 Hülle ganz außen, damit es sauber aussieht
function outerWrap(text) {
    return btoa(text);
}

function outerUnwrap(text) {
    return atob(text);
}


// ========================================================
// 3. HAUPTFUNKTIONEN (Die Verknüpfung)
// ========================================================

export async function encryptFull(message, code, recipientName) { // <--- NEU
    try {
        // SCHRITT 1: Echte, harte AES Verschlüsselung (jetzt mit Recipient)
        const safeContent = await encryptAES(message, code, recipientName); // <--- ÜBERGABE
        
        // SCHRITT 2: Deine Algorithmen drüber laufen lassen (Obfuscation)
        // Reihenfolge: AES-String -> Reverse -> Caesar -> Base64
        let layer1 = reverseText(safeContent);
        let layer2 = caesarCipher(layer1, code, recipientName, true); // <--- ÜBERGABE
        let finalOutput = outerWrap(layer2); // Finales Base64 encoding

        return finalOutput;

    } catch (e) {
        console.error("Encryption failed:", e);
        throw new Error("Verschlüsselung fehlgeschlagen");
    }
}

export async function decryptFull(encryptedData, code, recipientName) { // <--- NEU
    try {
        // SCHRITT 1: Die äußeren Schichten entfernen (in umgekehrter Reihenfolge)
        // Base64 Decode -> Caesar Rückwärts -> Reverse Rückwärts
        let layer2 = outerUnwrap(encryptedData);
        let layer1 = caesarCipher(layer2, code, recipientName, false); // <--- ÜBERGABE
        let aesString = reverseText(layer1);

        // SCHRITT 2: Den Kern mit AES öffnen
        const originalMessage = await decryptAES(aesString, code, recipientName); // <--- ÜBERGABE
        
        return originalMessage;

    } catch (e) {
        console.error("Decryption failed:", e);
        // Wenn AES fehlschlägt, heißt das meistens: Tarnung war okay, aber Passwort falsch
        return "[Fehler: Code falsch oder Daten manipuliert]";
    }
}
