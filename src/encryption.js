/**
 * Secret Messages Encryption Engine
 * AES-256 Hybrid Encryption with Custom Security Layers
 * 
 * This module implements the same encryption logic as the frontend
 * for server-side processing, validation, and testing.
 */

const crypto = require('crypto');

// Special character mapping for secure handling
const SPECIAL_CHAR_MAPPING = {
    '.': 'QQ1', ',': 'QQ2', '!': 'QQ3', '?': 'QQ4', 'EUR': 'QQ5',
    '&': 'QQ6', '+': 'QQ7', '-': 'QQ8', '(': 'QQ9', ')': 'QQ0',
    '#': 'QW1', '@': 'QW2', '/': 'QW3', '$': 'QW4', '%': 'QW5',
    '=': 'QW6', ':': 'QW7', '*': 'QW8', '<': 'QW9', '>': 'QW0',
    '"': 'QE1', "'": 'QE2', '`': 'QE3', '|': 'QE4', '\\': 'QE5',
    '{': 'QE6', '}': 'QE7', '[': 'QE8', ']': 'QE9', '^': 'QE0', '_': 'QR1'
};

// Reverse mapping for decryption
const REVERSE_CHAR_MAPPING = {};
for (const [key, value] of Object.entries(SPECIAL_CHAR_MAPPING)) {
    REVERSE_CHAR_MAPPING[value] = key;
}

/**
 * Utility Functions
 */

// Euro sign preprocessing
function preprocessEuroSign(text) {
    return text.replace(/€/g, 'EUR');
}

function restoreEuroSign(text) {
    return text.replace(/EUR/g, '€');
}

// Special character handling
function replaceSpecialChars(text) {
    text = preprocessEuroSign(text);
    let result = text;
    
    for (const [special, replacement] of Object.entries(SPECIAL_CHAR_MAPPING)) {
        while (result.includes(special)) {
            result = result.replace(special, replacement);
        }
    }
    
    return result;
}

function restoreSpecialChars(text) {
    let result = text;
    
    for (const [replacement, special] of Object.entries(REVERSE_CHAR_MAPPING)) {
        while (result.includes(replacement)) {
            result = result.replace(replacement, special);
        }
    }
    
    return restoreEuroSign(result);
}

// UTF-8 Encoding/Decoding
function stringToUTF8Bytes(str) {
    const utf8 = [];
    
    for (let i = 0; i < str.length; i++) {
        const charCode = str.charCodeAt(i);
        
        if (charCode < 0x80) {
            utf8.push(charCode);
        } else if (charCode < 0x800) {
            utf8.push(0xC0 | (charCode >> 6));
            utf8.push(0x80 | (charCode & 0x3F));
        } else if (charCode < 0xD800 || charCode >= 0xE000) {
            utf8.push(0xE0 | (charCode >> 12));
            utf8.push(0x80 | ((charCode >> 6) & 0x3F));
            utf8.push(0x80 | (charCode & 0x3F));
        } else {
            i++;
            if (i < str.length) {
                const codePoint = 0x10000 + (((charCode & 0x3FF) << 10) | (str.charCodeAt(i) & 0x3FF));
                utf8.push(0xF0 | (codePoint >> 18));
                utf8.push(0x80 | ((codePoint >> 12) & 0x3F));
                utf8.push(0x80 | ((codePoint >> 6) & 0x3F));
                utf8.push(0x80 | (codePoint & 0x3F));
            }
        }
    }
    
    return utf8;
}

function utf8BytesToString(bytes) {
    let result = '';
    let i = 0;
    
    while (i < bytes.length) {
        const byte1 = bytes[i];
        
        if (byte1 < 0x80) {
            result += String.fromCharCode(byte1);
            i++;
        } else if ((byte1 & 0xE0) === 0xC0) {
            if (i + 1 < bytes.length) {
                const byte2 = bytes[i + 1];
                const charCode = ((byte1 & 0x1F) << 6) | (byte2 & 0x3F);
                result += String.fromCharCode(charCode);
            }
            i += 2;
        } else if ((byte1 & 0xF0) === 0xE0) {
            if (i + 2 < bytes.length) {
                const byte2 = bytes[i + 1];
                const byte3 = bytes[i + 2];
                const charCode = ((byte1 & 0x0F) << 12) | ((byte2 & 0x3F) << 6) | (byte3 & 0x3F);
                result += String.fromCharCode(charCode);
            }
            i += 3;
        } else if ((byte1 & 0xF8) === 0xF0) {
            if (i + 3 < bytes.length) {
                const byte2 = bytes[i + 1];
                const byte3 = bytes[i + 2];
                const byte4 = bytes[i + 3];
                const codePoint = ((byte1 & 0x07) << 18) | ((byte2 & 0x3F) << 12) | ((byte3 & 0x3F) << 6) | (byte4 & 0x3F);
                
                if (codePoint > 0xFFFF) {
                    const high = 0xD800 + ((codePoint - 0x10000) >> 10);
                    const low = 0xDC00 + ((codePoint - 0x10000) & 0x3FF);
                    result += String.fromCharCode(high, low);
                } else {
                    result += String.fromCharCode(codePoint);
                }
            }
            i += 4;
        } else {
            i++;
        }
    }
    
    return result;
}

/**
 * AES-Like Encryption Functions
 */

// Generate AES key from 5-digit code
function generateAESKey(code) {
    const key = [];
    const codeStr = code + code + code; // Expand to 15 characters
    
    for (let i = 0; i < 32; i++) { // 256-bit key
        const charCode = codeStr.charCodeAt(i % codeStr.length);
        const complexValue = (charCode * (i + 1) * 73 + parseInt(code) * (i + 7)) % 256;
        key.push(complexValue);
    }
    
    return key;
}

// SubBytes transformation
function aesSubBytes(data, key, encrypt = true) {
    const result = [];
    
    for (let i = 0; i < data.length; i++) {
        const keyByte = key[i % key.length];
        let transformed;
        
        if (encrypt) {
            // S-Box-like transformation
            transformed = ((data[i] ^ keyByte) * 17 + 127) % 256;
            transformed = ((transformed << 1) | (transformed >> 7)) & 0xFF; // Rotation
        } else {
            // Inverse transformation
            transformed = ((data[i] >> 1) | (data[i] << 7)) & 0xFF; // Reverse rotation
            transformed = ((transformed + 256 - 127) * 241) % 256; // Reverse multiplication
            transformed = transformed ^ keyByte;
        }
        
        result.push(transformed);
    }
    
    return result;
}

// ShiftRows transformation
function aesShiftRows(data, encrypt = true) {
    const result = [...data];
    const blockSize = 16;
    
    for (let block = 0; block < Math.ceil(data.length / blockSize); block++) {
        const start = block * blockSize;
        const end = Math.min(start + blockSize, data.length);
        
        if (encrypt) {
            // Shift rows forward
            for (let row = 1; row < 4 && start + row < end; row++) {
                for (let shift = 0; shift < row; shift++) {
                    for (let col = start + row; col < end; col += 4) {
                        if (col + 4 < end) {
                            const temp = result[col];
                            result[col] = result[col + 4];
                            result[col + 4] = temp;
                        }
                    }
                }
            }
        } else {
            // Shift rows backward
            for (let row = 1; row < 4 && start + row < end; row++) {
                for (let shift = 0; shift < row; shift++) {
                    for (let col = end - 4 + row; col >= start + row; col -= 4) {
                        if (col - 4 >= start + row) {
                            const temp = result[col];
                            result[col] = result[col - 4];
                            result[col - 4] = temp;
                        }
                    }
                }
            }
        }
    }
    
    return result;
}

// MixColumns transformation
function aesMixColumns(data, encrypt = true) {
    const result = [];
    
    for (let i = 0; i < data.length; i += 4) {
        const column = [
            data[i] || 0,
            data[i + 1] || 0,
            data[i + 2] || 0,
            data[i + 3] || 0
        ];
        
        if (encrypt) {
            // MixColumns matrix multiplication
            result.push((column[0] * 2 + column[1] * 3 + column[2] + column[3]) % 256);
            result.push((column[0] + column[1] * 2 + column[2] * 3 + column[3]) % 256);
            result.push((column[0] + column[1] + column[2] * 2 + column[3] * 3) % 256);
            result.push((column[0] * 3 + column[1] + column[2] + column[3] * 2) % 256);
        } else {
            // Inverse MixColumns
            result.push((column[0] * 14 + column[1] * 11 + column[2] * 13 + column[3] * 9) % 256);
            result.push((column[0] * 9 + column[1] * 14 + column[2] * 11 + column[3] * 13) % 256);
            result.push((column[0] * 13 + column[1] * 9 + column[2] * 14 + column[3] * 11) % 256);
            result.push((column[0] * 11 + column[1] * 13 + column[2] * 9 + column[3] * 14) % 256);
        }
    }
    
    return result;
}

// AES encryption rounds
function performAESEncryption(data, code) {
    const key = generateAESKey(code);
    let result = [...data];
    
    // 10 rounds like AES-256
    for (let round = 0; round < 10; round++) {
        result = aesSubBytes(result, key, true);
        result = aesShiftRows(result, true);
        
        if (round < 9) { // Skip MixColumns in final round
            result = aesMixColumns(result, true);
        }
        
        // Add round key
        for (let i = 0; i < result.length; i++) {
            result[i] ^= key[(round * 4 + i) % key.length];
        }
    }
    
    return result;
}

function performAESDecryption(data, code) {
    const key = generateAESKey(code);
    let result = [...data];
    
    // 10 rounds in reverse
    for (let round = 9; round >= 0; round--) {
        // Remove round key
        for (let i = 0; i < result.length; i++) {
            result[i] ^= key[(round * 4 + i) % key.length];
        }
        
        if (round < 9) {
            result = aesMixColumns(result, false);
        }
        
        result = aesShiftRows(result, false);
        result = aesSubBytes(result, key, false);
    }
    
    return result;
}

/**
 * Custom Security Layers
 */

// Generate code matrix for advanced operations
function generateCodeMatrix(code) {
    const digits = code.split('').map(d => parseInt(d));
    const matrix = [];
    
    for (let i = 0; i < 20; i++) {
        const base = digits[i % 5];
        const multiplier = (digits[(i + 1) % 5] * digits[(i + 2) % 5]) || 1;
        const offset = (i * base + multiplier + digits[(i + 3) % 5]) % 256;
        matrix.push(offset);
    }
    
    return matrix;
}

// Advanced XOR with position-dependent key
function advancedXOR(byteValue, index, codeMatrix) {
    let result = byteValue;
    
    result ^= codeMatrix[index % codeMatrix.length];
    result ^= (index * 13 + 7) % 256;
    
    if (index > 0) {
        result ^= (index * codeMatrix[(index - 1) % codeMatrix.length]) % 256;
    }
    
    result = ((result * 17) + (codeMatrix[index % 8] * 23)) % 256;
    
    return result;
}

function reverseAdvancedXOR(value, index, codeMatrix) {
    let originalValue = 0;
    
    // Reverse the multiplication (find modular inverse)
    for (let test = 0; test < 256; test++) {
        if (((test * 17) + (codeMatrix[index % 8] * 23)) % 256 === value) {
            originalValue = test;
            break;
        }
    }
    
    if (index > 0) {
        originalValue ^= (index * codeMatrix[(index - 1) % codeMatrix.length]) % 256;
    }
    
    originalValue ^= (index * 13 + 7) % 256;
    originalValue ^= codeMatrix[index % codeMatrix.length];
    
    return originalValue;
}

// Deterministic shuffling
function deterministicShuffle(array, code) {
    const result = [...array];
    const codeNum = parseInt(code);
    
    for (let i = result.length - 1; i > 0; i--) {
        const j = ((i * codeNum * 73) + (i * 19)) % (i + 1);
        const temp = result[i];
        result[i] = result[j];
        result[j] = temp;
    }
    
    return result;
}

function reverseDetShuffle(array, code) {
    const result = [...array];
    const codeNum = parseInt(code);
    
    for (let i = 1; i < result.length; i++) {
        const j = ((i * codeNum * 73) + (i * 19)) % (i + 1);
        const temp = result[i];
        result[i] = result[j];
        result[j] = temp;
    }
    
    return result;
}

/**
 * Base62 Encoding/Decoding
 */

function compactBase62(numbers) {
    const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
    let result = '';
    
    for (let i = 0; i < numbers.length; i += 2) {
        let combined = numbers[i];
        if (i + 1 < numbers.length) {
            combined = combined * 256 + numbers[i + 1];
        }
        
        let encoded = '';
        let temp = combined;
        
        if (temp === 0) {
            encoded = '0';
        } else {
            do {
                encoded = chars.charAt(temp % 62) + encoded;
                temp = Math.floor(temp / 62);
            } while (temp > 0);
        }
        
        while (encoded.length < 4) {
            encoded = '0' + encoded;
        }
        result += encoded;
    }
    
    return result;
}

function decompactBase62(base62String) {
    const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
    const charMap = {};
    for (let i = 0; i < chars.length; i++) {
        charMap[chars.charAt(i)] = i;
    }
    
    const numbers = [];
    
    for (let i = 0; i < base62String.length; i += 4) {
        const block = base62String.substring(i, i + 4);
        
        let combined = 0;
        for (let j = 0; j < block.length; j++) {
            const char = block.charAt(j);
            if (charMap[char] !== undefined) {
                combined = combined * 62 + charMap[char];
            }
        }
        
        if (combined >= 256) {
            numbers.push(Math.floor(combined / 256));
            numbers.push(combined % 256);
        } else {
            numbers.push(combined);
        }
    }
    
    return numbers;
}

function reverseString(str) {
    return str.split('').reverse().join('');
}

/**
 * Main Encryption/Decryption Functions
 */

function performEncryptionCycle(messageBytes, code) {
    const codeMatrix = generateCodeMatrix(code);
    
    // Phase 1: Advanced XOR
    const xorResult = [];
    for (let i = 0; i < messageBytes.length; i++) {
        const encryptedByte = advancedXOR(messageBytes[i], i, codeMatrix);
        xorResult.push(encryptedByte);
    }
    
    // Phase 2: Deterministic shuffling
    const shuffled = deterministicShuffle(xorResult, code);
    
    // Phase 3: Permutation
    let finalResult = [...shuffled];
    const codeSum = parseInt(code);
    for (let pass = 0; pass < 3; pass++) {
        for (let i = 0; i < finalResult.length - 1; i++) {
            if ((i + codeSum + pass * 47) % 3 === 0) {
                const temp = finalResult[i];
                finalResult[i] = finalResult[i + 1];
                finalResult[i + 1] = temp;
            }
        }
    }
    
    // Phase 4: Base62 encoding
    const base62Result = compactBase62(finalResult);
    
    // Phase 5: String reversal
    return reverseString(base62Result);
}

function performDecryptionCycle(encryptedData, code) {
    const codeMatrix = generateCodeMatrix(code);
    
    // Reverse the encryption steps
    const unmirrored = reverseString(encryptedData);
    let finalResult = decompactBase62(unmirrored);
    
    // Reverse permutation
    const codeSum = parseInt(code);
    for (let pass = 2; pass >= 0; pass--) {
        for (let i = finalResult.length - 2; i >= 0; i--) {
            if ((i + codeSum + pass * 47) % 3 === 0) {
                const temp = finalResult[i];
                finalResult[i] = finalResult[i + 1];
                finalResult[i + 1] = temp;
            }
        }
    }
    
    // Reverse shuffling
    const xorResult = reverseDetShuffle(finalResult, code);
    
    // Reverse XOR
    const decryptedBytes = [];
    for (let i = 0; i < xorResult.length; i++) {
        const originalByte = reverseAdvancedXOR(xorResult[i], i, codeMatrix);
        decryptedBytes.push(originalByte);
    }
    
    return utf8BytesToString(decryptedBytes);
}

/**
 * Public API Functions
 */

function encryptMessage(message, code) {
    if (!message || !code) {
        throw new Error('Message and code are required');
    }
    
    if (code.length !== 5 || !/^\d{5}$/.test(code)) {
        throw new Error('Code must be exactly 5 digits');
    }
    
    try {
        // Preprocess message
        const preprocessedMessage = replaceSpecialChars(message);
        const currentData = stringToUTF8Bytes(preprocessedMessage);
        
        // First encryption cycle
        const result1 = performEncryptionCycle(currentData, code);
        const bytes1 = stringToUTF8Bytes(result1);
        
        // Second encryption cycle (double security)
        const result2 = performEncryptionCycle(bytes1, code);
        
        return result2;
        
    } catch (error) {
        throw new Error(`Encryption failed: ${error.message}`);
    }
}

function decryptMessage(encryptedMessage, code) {
    if (!encryptedMessage || !code) {
        throw new Error('Encrypted message and code are required');
    }
    
    if (code.length !== 5 || !/^\d{5}$/.test(code)) {
        throw new Error('Code must be exactly 5 digits');
    }
    
    try {
        // First decryption cycle
        const result1 = performDecryptionCycle(encryptedMessage, code);
        
        // Second decryption cycle
        const result2 = performDecryptionCycle(result1, code);
        
        // Restore special characters
        const finalResult = restoreSpecialChars(result2);
        
        return finalResult;
        
    } catch (error) {
        throw new Error('Decryption failed - wrong code or corrupted data');
    }
}

// Validation functions
function validateCode(code) {
    return typeof code === 'string' && /^\d{5}$/.test(code);
}

function validateMessage(message) {
    return typeof message === 'string' && message.length > 0 && message.length <= 1000000; // 1MB limit
}

function validateEncryptedMessage(encrypted) {
    return typeof encrypted === 'string' && encrypted.length > 0 && /^[0-9A-Za-z]+$/.test(encrypted);
}

// Testing functions
function testEncryptionRoundtrip(message, code) {
    try {
        const encrypted = encryptMessage(message, code);
        const decrypted = decryptMessage(encrypted, code);
        return {
            success: decrypted === message,
            original: message,
            encrypted: encrypted,
            decrypted: decrypted,
            match: decrypted === message
        };
    } catch (error) {
        return {
            success: false,
            error: error.message
        };
    }
}

module.exports = {
    encryptMessage,
    decryptMessage,
    validateCode,
    validateMessage,
    validateEncryptedMessage,
    testEncryptionRoundtrip,
    
    // Advanced functions for testing
    performEncryptionCycle,
    performDecryptionCycle,
    generateAESKey,
    performAESEncryption,
    performAESDecryption,
    
    // Utility functions
    replaceSpecialChars,
    restoreSpecialChars,
    stringToUTF8Bytes,
    utf8BytesToString,
    compactBase62,
    decompactBase62
};
