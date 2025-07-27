
// cryptoLayers.js

// ============================
// 🔁 Utility-Funktionen
// ============================

// Custom Mapping (Zeichenersetzung)
function customMap(text) {
    const map = {
        'A': '@', 'B': '#', 'C': '$', 'D': '%', 'E': '&', 'F': '*', 'G': '+', 'H': '!', 'I': '=', 'J': '?',
        'K': '^', 'L': '~', 'M': '€', 'N': '§', 'O': '(', 'P': ')', 'Q': '[', 'R': ']', 'S': '{', 'T': '}',
        'U': '<', 'V': '>', 'W': '/', 'X': '-', 'Y': '_', 'Z': '|',
        'a': '1', 'b': '2', 'c': '3', 'd': '4', 'e': '5', 'f': '6', 'g': '7', 'h': '8', 'i': '9', 'j': '0'
    };
    return text.split('').map(c => map[c] || c).join('');
}

function customUnmap(text) {
    const reversed = Object.fromEntries(Object.entries({
        'A': '@', 'B': '#', 'C': '$', 'D': '%', 'E': '&', 'F': '*', 'G': '+', 'H': '!', 'I': '=', 'J': '?',
        'K': '^', 'L': '~', 'M': '€', 'N': '§', 'O': '(', 'P': ')', 'Q': '[', 'R': ']', 'S': '{', 'T': '}',
        'U': '<', 'V': '>', 'W': '/', 'X': '-', 'Y': '_', 'Z': '|',
        'a': '1', 'b': '2', 'c': '3', 'd': '4', 'e': '5', 'f': '6', 'g': '7', 'h': '8', 'i': '9', 'j': '0'
    }).map(([k, v]) => [v, k]));
    return text.split('').map(c => reversed[c] || c).join('');
}

// Buchstabenverschiebung
function shift(text, amount) {
    return text.split('').map(char => {
        const code = char.charCodeAt(0);
        return String.fromCharCode(code + amount);
    }).join('');
}

function unshift(text, amount) {
    return shift(text, -amount);
}

// Spiegelung
function mirror(text) {
    return text.split('').reverse().join('');
}

// 5-stelliger Code als Zeichenverschiebung
function codeTransform(text, code, reverse = false) {
    const shifts = code.split('').map(d => parseInt(d));
    const len = shifts.length;
    return text.split('').map((char, i) => {
        const amount = reverse ? -shifts[i % len] : shifts[i % len];
        return String.fromCharCode(char.charCodeAt(0) + amount);
    }).join('');
}

// Base64 mit UTF-8
function base64Encode(str) {
    return btoa(unescape(encodeURIComponent(str)));
}
function base64Decode(str) {
    return decodeURIComponent(escape(atob(str)));
}

// AES-256 (WebCryptoAPI)
async function aesEncrypt(text, key) {
    const enc = new TextEncoder();
    const iv = crypto.getRandomValues(new Uint8Array(16));
    const cryptoKey = await crypto.subtle.importKey('raw', await digestKey(key), { name: 'AES-CBC' }, false, ['encrypt']);
    const encrypted = await crypto.subtle.encrypt({ name: 'AES-CBC', iv }, cryptoKey, enc.encode(text));
    return base64Encode(String.fromCharCode(...iv) + String.fromCharCode(...new Uint8Array(encrypted)));
}

async function aesDecrypt(encoded, key) {
    const raw = base64Decode(encoded);
    const iv = Uint8Array.from(raw.slice(0, 16).split('').map(c => c.charCodeAt(0)));
    const data = Uint8Array.from(raw.slice(16).split('').map(c => c.charCodeAt(0)));
    const cryptoKey = await crypto.subtle.importKey('raw', await digestKey(key), { name: 'AES-CBC' }, false, ['decrypt']);
    const decrypted = await crypto.subtle.decrypt({ name: 'AES-CBC', iv }, cryptoKey, data);
    return new TextDecoder().decode(decrypted);
}

async function digestKey(key) {
    const enc = new TextEncoder();
    return await crypto.subtle.digest('SHA-256', enc.encode(key));
}

// ============================
// 🔐 Hauptfunktionen
// ============================

export async function encryptFull(message, code) {
    let text = message;
    text = customMap(text);
    text = codeTransform(text, code);
    text = base64Encode(text);
    text = await aesEncrypt(text, code);
    text = shift(text, 3);
    text = mirror(text);
    text = base64Encode(text);
    text = await aesEncrypt(text, code);
    text = shift(text, 2);
    text = codeTransform(text, code);
    return text;
}

export async function decryptFull(encryptedText, code) {
    let text = encryptedText;
    text = codeTransform(text, code, true);
    text = unshift(text, 2);
    text = await aesDecrypt(text, code);
    text = base64Decode(text);
    text = mirror(text);
    text = unshift(text, 3);
    text = await aesDecrypt(text, code);
    text = base64Decode(text);
    text = codeTransform(text, code, true);
    text = customUnmap(text);
    return text;
}
