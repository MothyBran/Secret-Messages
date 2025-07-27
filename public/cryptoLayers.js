
// === cryptoLayers.js ===
// UTF-8 safe Base64 encoding/decoding
export function base64Encode(str) {
    return btoa(unescape(encodeURIComponent(str)));
}

export function base64Decode(str) {
    return decodeURIComponent(escape(atob(str)));
}

// Reverse Cipher
export function reverseCipher(str) {
    return str.split('').reverse().join('');
}

// Caesar Cipher
export function caesarEncrypt(str, shift = 3) {
    return str.split('').map(char => {
        const code = char.charCodeAt(0);
        return String.fromCharCode(code + shift);
    }).join('');
}

export function caesarDecrypt(str, shift = 3) {
    return str.split('').map(char => {
        const code = char.charCodeAt(0);
        return String.fromCharCode(code - shift);
    }).join('');
}

// Custom-Mapping (einfaches Beispiel)
const mapping = {
    '@': 'α', '#': 'β', '$': 'δ', '%': 'ε', '&': 'ζ',
    '€': 'θ', '§': 'λ', '!': 'μ', '?': 'ν', '*': 'ξ',
    '+': 'π', '=': 'ρ', '/': 'σ', '\\': 'τ', '-': 'υ',
    ',': 'φ', '.': 'χ', ':': 'ψ', ';': 'ω'
};

const reverseMapping = Object.fromEntries(Object.entries(mapping).map(([k, v]) => [v, k]));

export function applyCustomMapping(str) {
    return str.split('').map(c => mapping[c] || c).join('');
}

export function reverseCustomMapping(str) {
    return str.split('').map(c => reverseMapping[c] || c).join('');
}

// Sicherheitscode-Verschlüsselung
export function applySecurityCode(str, code) {
    return str.split('').map((char, i) => {
        const shift = parseInt(code[i % code.length]) || 0;
        return String.fromCharCode(char.charCodeAt(0) + shift);
    }).join('');
}

export function reverseSecurityCode(str, code) {
    return str.split('').map((char, i) => {
        const shift = parseInt(code[i % code.length]) || 0;
        return String.fromCharCode(char.charCodeAt(0) - shift);
    }).join('');
}

// Dummy AES functions (für Demo-Zwecke; echte sollten crypto-API oder lib nutzen)
export function aesEncrypt(str) {
    return str.split('').reverse().join(''); // Platzhalter
}

export function aesDecrypt(str) {
    return str.split('').reverse().join(''); // Platzhalter
}

// === VERSCHLÜSSELUNG / ENTSCHLÜSSELUNGSKETTE ===
export function encryptFull(message, code) {
    // Sonderzeichen vorbereiten
    let result = applyCustomMapping(message);
    result = applySecurityCode(result, code);
    result = base64Encode(result);
    result = aesEncrypt(result);
    result = caesarEncrypt(result);
    result = reverseCipher(result);

    // Zweite Runde in anderer Reihenfolge
    result = base64Encode(result);
    result = applyCustomMapping(result);
    result = caesarEncrypt(result);
    result = aesEncrypt(result);
    result = applySecurityCode(result, code);

    return result;
}

export function decryptFull(encrypted, code) {
    // Rückwärts durch zweite Runde
    let result = reverseSecurityCode(encrypted, code);
    result = aesDecrypt(result);
    result = caesarDecrypt(result);
    result = reverseCustomMapping(result);
    result = base64Decode(result);

    // Rückwärts durch erste Runde
    result = reverseCipher(result);
    result = caesarDecrypt(result);
    result = aesDecrypt(result);
    result = base64Decode(result);
    result = reverseSecurityCode(result, code);
    result = reverseCustomMapping(result);

    return result;
}


// Kompakte AES-Funktion (eingebettet)


// AES-Verschlüsselung (simple XOR + Key-Derivation Beispiel)
function deriveKeyFromPass(passphrase, length = 32) {
    let hash = '';
    while (hash.length < length) {
        passphrase = btoa(passphrase).split('').reverse().join('');
        hash += passphrase;
    }
    return hash.substring(0, length);
}

function simpleAES_Encrypt(text, passphrase) {
    const key = deriveKeyFromPass(passphrase);
    let result = '';
    for (let i = 0; i < text.length; i++) {
        result += String.fromCharCode(text.charCodeAt(i) ^ key.charCodeAt(i % key.length));
    }
    return base64Encode(result);
}

function simpleAES_Decrypt(encoded, passphrase) {
    const key = deriveKeyFromPass(passphrase);
    const text = base64Decode(encoded);
    let result = '';
    for (let i = 0; i < text.length; i++) {
        result += String.fromCharCode(text.charCodeAt(i) ^ key.charCodeAt(i % key.length));
    }
    return result;
}

export { simpleAES_Encrypt, simpleAES_Decrypt };
