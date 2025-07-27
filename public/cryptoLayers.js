
// cryptoLayers.js – vollständig mit kompakter Sonderzeichenverschlüsselung

// Kompakte Sonderzeichen-Codierung mit Start=9, Ende=6
const specialCharMap = {
    '@': '11', '#': '12', '$': '13', '%': '14', '&': '15',
    '€': '21', '§': '22', '!': '23', '?': '24', '*': '25',
    '+': '31', '=': '32', '/': '33', '\\': '34', '-': '35',
    ',': '41', '.': '42', ':': '43', ';': '44'
};

const reverseSpecialCharMap = Object.fromEntries(
    Object.entries(specialCharMap).map(([k, v]) => [`9${v}6`, k])
);

// Sonderzeichen verschlüsseln
function encodeSpecialChars(text) {
    return text.replace(/[@#$%&€§!?*+=/\\,.:;-]/g, match => `9${specialCharMap[match]}6`);
}

// Sonderzeichen entschlüsseln
function decodeSpecialChars(text) {
    return text.replace(/9\d{2}6/g, code => reverseSpecialCharMap[code] || code);
}

// Caesar Cipher
function caesarEncrypt(text, shift = 3) {
    return [...text].map(char => String.fromCharCode(char.charCodeAt(0) + shift)).join('');
}
function caesarDecrypt(text, shift = 3) {
    return [...text].map(char => String.fromCharCode(char.charCodeAt(0) - shift)).join('');
}

// Custom Mapping (vereinfachtes Beispiel)
const simpleMap = { 'A': '∆', 'B': 'Ψ', 'C': 'Σ' }; // Beispiel
const reverseSimpleMap = Object.fromEntries(Object.entries(simpleMap).map(([k,v])=>[v,k]));
function customMapEncode(text) {
    return [...text].map(c => simpleMap[c] || c).join('');
}
function customMapDecode(text) {
    return [...text].map(c => reverseSimpleMap[c] || c).join('');
}

// Kompakte AES-ähnliche Dummy-Verschlüsselung (für Demonstration)
function simpleAES(text, key) {
    let result = '';
    for (let i = 0; i < text.length; i++) {
        result += String.fromCharCode(text.charCodeAt(i) ^ key.charCodeAt(i % key.length));
    }
    return result;
}

// Reverse Cipher
function reverseText(text) {
    return text.split('').reverse().join('');
}

// Sicherheitscode-Multiplikation
function securityCodeTransform(text, code, encrypt = true) {
    if (!/^[0-9]{5}$/.test(code)) return text;
    return [...text].map((char, i) => {
        const factor = parseInt(code[i % 5]);
        return encrypt
            ? String.fromCharCode(char.charCodeAt(0) * factor)
            : String.fromCharCode(Math.floor(char.charCodeAt(0) / factor));
    }).join('');
}

// Base64 mit Unicode-Unterstützung
function base64Encode(str) {
    return btoa(unescape(encodeURIComponent(str)));
}
function base64Decode(str) {
    return decodeURIComponent(escape(atob(str)));
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

// Exports für App.js
export {
    encryptFull,
    decryptFull,
    base64Encode,
    base64Decode
};
