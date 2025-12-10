// cryptoLayers.js - Modern AES-GCM Encryption (Secure)

// Hilfsfunktion: String zu ArrayBuffer
function str2ab(str) {
    return new TextEncoder().encode(str);
}

// Hilfsfunktion: ArrayBuffer zu Base64 String
function ab2str(buf) {
    return btoa(String.fromCharCode(...new Uint8Array(buf)));
}

// Hilfsfunktion: Base64 String zu ArrayBuffer
function str2ab_b64(str) {
    return Uint8Array.from(atob(str), c => c.charCodeAt(0));
}

// 1. Schlüssel aus dem 5-stelligen Code generieren (SHA-256 Hashing)
// Damit wird aus "12345" ein echter 256-Bit Krypto-Schlüssel
async function generateKey(passcode) {
    const keyMaterial = await window.crypto.subtle.importKey(
        "raw",
        str2ab(passcode),
        { name: "PBKDF2" },
        false,
        ["deriveKey"]
    );

    // Wir nutzen PBKDF2 mit einem festen Salt (für diese Demo), 
    // um Brute-Force etwas zu erschweren. 
    // Ideal wäre ein zufälliger Salt pro Nachricht, aber das ändert dein Datenformat.
    return window.crypto.subtle.deriveKey(
        {
            name: "PBKDF2",
            salt: str2ab("SecretMessagesSalt_v1"), 
            iterations: 100000, // Hohe Iterationen gegen Brute-Force
            hash: "SHA-256"
        },
        keyMaterial,
        { name: "AES-GCM", length: 256 },
        true,
        ["encrypt", "decrypt"]
    );
}

// HAUPTFUNKTIONEN

// Verschlüsseln
export async function encryptFull(message, code) {
    try {
        const key = await generateKey(code);
        const iv = window.crypto.getRandomValues(new Uint8Array(12)); // Zufälliger Initialisierungsvektor
        
        const encryptedContent = await window.crypto.subtle.encrypt(
            {
                name: "AES-GCM",
                iv: iv
            },
            key,
            str2ab(message)
        );

        // Wir müssen IV und Content zusammenpacken, um es später zu entschlüsseln
        // Format: IV (Base64) : EncryptedData (Base64)
        const ivStr = ab2str(iv);
        const dataStr = ab2str(encryptedContent);
        
        return `${ivStr}:${dataStr}`;
    } catch (e) {
        console.error("Encryption Error:", e);
        throw new Error("Verschlüsselung fehlgeschlagen");
    }
}

// Entschlüsseln
export async function decryptFull(encryptedString, code) {
    try {
        // Format splitten
        const parts = encryptedString.split(':');
        if (parts.length !== 2) throw new Error("Ungültiges Format");
        
        const iv = str2ab_b64(parts[0]);
        const data = str2ab_b64(parts[1]);
        const key = await generateKey(code);

        const decryptedContent = await window.crypto.subtle.decrypt(
            {
                name: "AES-GCM",
                iv: iv
            },
            key,
            data
        );

        return new TextDecoder().decode(decryptedContent);
    } catch (e) {
        console.error("Decryption Error:", e);
        // WICHTIG: Bei AES-GCM schlägt die Entschlüsselung fehl, 
        // wenn der Code falsch ist oder der Text manipuliert wurde.
        return "[Fehler: Falscher Code oder manipulierte Daten]"; 
    }
}
