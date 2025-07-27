// Sonderzeichen-Tabelle: Kompakter Binärcode (1–5, 7–8), 9 = Start, 6 = Ende
const specialCharToBinary = {
    '!': '9816', '?': '9716', '@': '9116', '#': '9216', '$': '9316',
    '%': '9416', '^': '9516', '&': '9217', '*': '9317', '(': '9417',
    ')': '9517', '-': '9117', '_': '9817', '+': '9717', '=': '9617',
    '{': '9218', '}': '9318', '[': '9418', ']': '9518', ':': '9118',
    ';': '9818', '"': '9718', "'": '9618', '<': '9219', '>': '9319',
    ',': '9419', '.': '9519', '/': '9119', '\\': '9819', '|': '9719',
    '€': '9216'
};

const binaryToSpecialChar = Object.fromEntries(
    Object.entries(specialCharToBinary).map(([k, v]) => [v, k])
);

// Custom-Mapping: A-Z → Griechisch, 0–9 → Kyrillisch
const charMap = {
    A: 'Α', B: 'Β', C: 'Γ', D: 'Δ', E: 'Ε', F: 'Ζ', G: 'Η', H: 'Θ', I: 'Ι',
    J: 'Κ', K: 'Λ', L: 'Μ', M: 'Ν', N: 'Ξ', O: 'Ο', P: 'Π', Q: 'Ρ', R: 'Σ',
    S: 'Τ', T: 'Υ', U: 'Φ', V: 'Χ', W: 'Ψ', X: 'Ω', Y: 'α', Z: 'β',
    0: 'Д', 1: 'Я', 2: 'Й', 3: 'Ц', 4: 'Щ', 5: 'Ъ', 6: 'Ы', 7: 'Э', 8: 'Ю', 9: 'Ж'
};

const reverseCharMap = Object.fromEntries(
    Object.entries(charMap).map(([k, v]) => [v, k])
);

// Sonderzeichen-Kodierung
function encodeSpecialChars(text) {
    return text.split('').map(ch => {
        if (specialCharToBinary[ch]) return specialCharToBinary[ch];
        return ch;
    }).join('');
}

function decodeSpecialChars(text) {
    return text.replace(/9[1-5|7-8][1-9]6/g, match => binaryToSpecialChar[match] || match);
}

// Custom-Mapping
function customMapEncode(text) {
    return text.split('').map(c => charMap[c] || c).join('');
}

function customMapDecode(text) {
    return text.split('').map(c => reverseCharMap[c] || c).join('');
}

// Base64
function base64Encode(str) {
    return btoa(unescape(encodeURIComponent(str)));
}
function base64Decode(str) {
    return decodeURIComponent(escape(atob(str)));
}

// Caesar Cipher
function caesarEncrypt(str, shift = 3) {
    return str.split('').map(c => String.fromCharCode(c.charCodeAt(0) + shift)).join('');
}
function caesarDecrypt(str, shift = 3) {
    return str.split('').map(c => String.fromCharCode(c.charCodeAt(0) - shift)).join('');
}

// Reverse
function reverseText(str) {
    return str.split('').reverse().join('');
}

// Simple AES Ersatz (Pseudo-Verschlüsselung)
function simpleAES(text, key) {
    return text.split('').map((char, i) => {
        const k = key.charCodeAt(i % key.length);
        return String.fromCharCode(char.charCodeAt(0) ^ k);
    }).join('');
}

// Sicherheitscode-Transformation
function securityCodeTransform(text, code, forward = true) {
    return text.split('').map((c, i) => {
        const shift = parseInt(code[i % code.length] || '0');
        return String.fromCharCode(c.charCodeAt(0) + (forward ? shift : -shift));
    }).join('');
}

// Hauptfunktionen
function encryptFull(message, code) {
    let step1 = encodeSpecialChars(message);
    let step2 = customMapEncode(step1);
    let step3 = securityCodeTransform(step2, code, true);
    let step4 = base64Encode(step3);
    let step5 = simpleAES(step4, code);
    let step6 = caesarEncrypt(step5);
    let step7 = reverseText(step6);
    let step8 = caesarEncrypt(step7);
    let step9 = simpleAES(step8, code);
    let step10 = base64Encode(securityCodeTransform(step9, code, true));
    return step10;
}

function decryptFull(encrypted, code) {
    try {
        let step1 = securityCodeTransform(base64Decode(encrypted), code, false);
        let step2 = simpleAES(step1, code);
        let step3 = caesarDecrypt(step2);
        let step4 = reverseText(step3);
        let step5 = caesarDecrypt(step4);
        let step6 = simpleAES(step5, code);
        let step7 = base64Decode(step6);
        let step8 = securityCodeTransform(step7, code, false);
        let step9 = customMapDecode(step8);
        let step10 = decodeSpecialChars(step9);
        return step10;
    } catch (e) {
        return '[Fehler beim Entschlüsseln]';
    }
}

// Export für Browser (falls notwendig)
export {
    encryptFull,
    decryptFull,
    base64Encode,
    base64Decode
};
