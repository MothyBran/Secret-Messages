
// === Kompakte Verschlüsselungsschicht mit Sonderzeichen-Support ===

// Sonderzeichen-Binärmapping (kompakt: nur Ziffern 1–5, 7–9; 9=Start, 6=Ende)
const binarySpecialCharMap = {
    '!': '91', '@': '92', '#': '93', '$': '94', '%': '95',
    '&': '97', '*': '98', '(': '99', ')': '71', '-': '72',
    '+': '73', '=': '74', '?': '75', ':': '77', ';': '78',
    ',': '79', '.': '81', '/': '82', '\': '83', '€': '84',
    '§': '85', '"': '87', ''': '88'
};

const reverseBinarySpecialCharMap = {};
for (const [char, code] of Object.entries(binarySpecialCharMap)) {
    reverseBinarySpecialCharMap[code] = char;
}

function convertSpecialCharsToBinary(text) {
    return text.split('').map(char => {
        if (binarySpecialCharMap[char]) {
            return '9' + binarySpecialCharMap[char] + '6';
        }
        return char;
    }).join('');
}

function convertBinaryToSpecialChars(text) {
    return text.replace(/9(\d{2})6/g, (match, code) => {
        return reverseBinarySpecialCharMap[code] || match;
    });
}

// Custom-Mapping (einfaches Beispiel)
const mapping = {
    '@': 'α', '#': 'β', '$': 'δ', '%': 'ε', '&': 'ζ',
    '€': 'θ', '§': 'λ', '!': 'μ', '?': 'ν', '*': 'ξ',
    '+': 'π', '=': 'ρ', '/': 'σ', '\': 'τ', '-': 'υ',
    ',': 'φ', '.': 'χ', ':': 'ψ', ';': 'ω'
};
const reverseMapping = Object.fromEntries(Object.entries(mapping).map(([k, v]) => [v, k]));

function customMapEncode(text) {
    return text.split('').map(c => mapping[c] || c).join('');
}
function customMapDecode(text) {
    return text.split('').map(c => reverseMapping[c] || c).join('');
}

// Kompakte Base64-Alternative (UTF-8 sicher)
function base64Encode(text) {
    return btoa(unescape(encodeURIComponent(text)));
}
function base64Decode(text) {
    return decodeURIComponent(escape(atob(text)));
}

// Einfache Caesar-Verschiebung
function caesarEncrypt(text, shift = 3) {
    return text.split('').map(c => String.fromCharCode(c.charCodeAt(0) + shift)).join('');
}
function caesarDecrypt(text, shift = 3) {
    return text.split('').map(c => String.fromCharCode(c.charCodeAt(0) - shift)).join('');
}

// Text umdrehen
function reverseText(text) {
    return text.split('').reverse().join('');
}

// Sicherheitscode-Verschiebung
function securityCodeTransform(text, code, forward = true) {
    const digits = code.split('').map(Number);
    return text.split('').map((c, i) => {
        const shift = digits[i % digits.length];
        return String.fromCharCode(c.charCodeAt(0) + (forward ? shift : -shift));
    }).join('');
}

// Kompakte AES-Alternative (Pseudo-AES)
function simpleAES(text, key) {
    let result = '', klen = key.length;
    for (let i = 0; i < text.length; i++) {
        const c = text.charCodeAt(i);
        const k = key.charCodeAt(i % klen);
        result += String.fromCharCode((c ^ k) + 1);
    }
    return result;
}
function simpleAESDecrypt(text, key) {
    let result = '', klen = key.length;
    for (let i = 0; i < text.length; i++) {
        const c = text.charCodeAt(i);
        const k = key.charCodeAt(i % klen);
        result += String.fromCharCode((c - 1) ^ k);
    }
    return result;
}

// Hauptfunktionen
function encryptFull(message, code) {
    let step0 = convertSpecialCharsToBinary(message);
    let step1 = customMapEncode(step0);
    let step2 = securityCodeTransform(step1, code, true);
    let step3 = base64Encode(step2);
    let step4 = simpleAES(step3, code);
    let step5 = caesarEncrypt(step4);
    let step6 = reverseText(step5);
    let step7 = caesarEncrypt(step6);
    let step8 = simpleAES(step7, code);
    let step9 = base64Encode(securityCodeTransform(step8, code, true));
    return step9;
}

function decryptFull(encrypted, code) {
    try {
        let step1 = securityCodeTransform(base64Decode(encrypted), code, false);
        let step2 = simpleAESDecrypt(step1, code);
        let step3 = caesarDecrypt(step2);
        let step4 = reverseText(step3);
        let step5 = caesarDecrypt(step4);
        let step6 = simpleAESDecrypt(step5, code);
        let step7 = base64Decode(step6);
        let step8 = securityCodeTransform(step7, code, false);
        let step9 = customMapDecode(step8);
        let step10 = convertBinaryToSpecialChars(step9);
        return step10;
    } catch (e) {
        return '[Fehler beim Entschlüsseln]';
    }
}

// Export (für ES6-Module)
export {
    encryptFull,
    decryptFull,
    base64Encode,
    base64Decode
};
