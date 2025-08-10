// Sonderzeichen-Tabelle: Kompakter Binärcode (1–5, 7–8), Ѫ = Start, Ѭ = Ende
const specialCharToBinary = {
    '!': '81',  '?': '71',  '@': '11',  '#': '21',  '$': '31',
    '%': '41',  '^': '51',  '&': '27',  '*': '37',  '(': '47',
    ')': '57',  '-': '17',  '_': '87',  '+': '77',  '=': '67',
    '{': '28',  '}': '38',  '[': '48',  ']': '58',  ':': '18',
    ';': '88',  '"': '78',  "'": '68',  '<': '29',  '>': '39',
    ',': '49',  '.': '59',  '/': '19',  '\\': '89', '|': '79',
    '€': '26'
};

// Funktion zum Kodieren eines Textes mit Sonderzeichen
function encodeSpecialChars(text) {
    return text.replace(/[^a-zA-Z0-9\s]/g, char => {
        const code = specialCharToBinary[char];
        return code ? `Ѫ${code}Ѭ` : char;
    });
}

// Umgekehrte Tabelle für das Dekodieren
const binaryToSpecialChar = Object.fromEntries(
    Object.entries(specialCharToBinary).map(([char, code]) => [code, char])
);

// Funktion zum Dekodieren von kodierten Sonderzeichen
function decodeSpecialChars(text) {
    return text.replace(/Ѫ(\d{2})Ѭ/g, (_, code) => {
        return binaryToSpecialChar[code] || '?';
    });
}

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

// Caesar Cipher (zeichencodes, NICHT nur A–Z)
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

// Simple AES Ersatz (Pseudo-Verschlüsselung; XOR mit Key)
// (symmetrisch: gleiche Funktion für „enc“ und „dec“)
function simpleAES(text, key) {
    return text.split('').map((char, i) => {
        const k = key.charCodeAt(i % key.length);
        return String.fromCharCode(char.charCodeAt(0) ^ k);
    }).join('');
}

// Sicherheitscode-Transformation
function securityCodeTransform(text, code, forward = true) {
    return text.split('').map((c, i) => {
        const shift = parseInt(code[i % code.length] || '0', 10);
        return String.fromCharCode(c.charCodeAt(0) + (forward ? shift : -shift));
    }).join('');
}

/* ===========================================================
   5-Ziffern-Mechanik: Reihenfolge, Wiederholung, Parameter
   -----------------------------------------------------------
   - Positionsabhängige effektive Werte:
       w_p = (7*p + 3) % 10
       e_p = (digit_p * w_p) % 10
   - Reihenfolge:
       Start mit BASIS-Layern, seed-basierter Shuffle + e_p-Swaps
   - Wiederholung:
       repeat_p = 1 + (e_p % 3)  → 1..3
       zyklisch auf die geordnete Layerliste gelegt
   - Parameter:
       caesarShift = 1 + (Σ e_p * p) % 23
       xorPadLen   = 8 + (e1 ^ e5)   (nur für internen PRNG; hier optional)
   - Deterministisch nur aus code5 → Entschlüsselung besitzt denselben Plan,
     aber inverse Reihenfolge.
   =========================================================== */

// Normalisierung der 5 Ziffern
function normalizeDigits(code5) {
    const s = String(code5 || "").replace(/\D/g, "").slice(0, 5).padEnd(5, "0");
    return s.split("").map(ch => ch.charCodeAt(0) - 48); // 0..9
}

// xorshift32 PRNG für deterministisches Shuffling
function xorshift32(seed) {
    let s = seed >>> 0;
    return () => {
        s ^= s << 13; s >>>= 0;
        s ^= s >>> 17; s >>>= 0;
        s ^= s << 5;  s >>>= 0;
        return s >>> 0;
    };
}
function shuffleInPlace(arr, rng) {
    for (let i = arr.length - 1; i > 0; i--) {
        const r = rng() / 0xFFFFFFFF;
        const j = Math.floor(r * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
}

// Seed aus den fünf Ziffern (positionssensitiv)
function deriveSeedFromDigits(d) {
    // z.B. polynomiale Mischung
    const s =
        (d[0] + 1) * 1315423911 ^
        (d[1] + 3) * 2654435761 ^
        (d[2] + 5) * 2246822519 ^
        (d[3] + 7) * 3266489917 ^
        (d[4] + 9) * 366834001;
    return (s >>> 0);
}

// effektive Ziffern e_p
function effectiveDigits(d) {
    const e = [];
    for (let p = 1; p <= 5; p++) {
        const w = (7 * p + 3) % 10;
        e.push((d[p - 1] * w) % 10);
    }
    return e; // [e1..e5]
}

// Basis-Layernamen (müssen zu den Implementierungen unten passen)
const BASE_LAYERS = ["SPECIAL","MAP","SCODE","B64","XAES","CAESAR","REVERSE"];

// alle verfügbaren Layer mit enc/dec (kontextabhängig)
const LAYERS = {
    SPECIAL: {
        enc: (s) => encodeSpecialChars(s),
        dec: (s) => decodeSpecialChars(s)
    },
    MAP: {
        enc: (s) => customMapEncode(s),
        dec: (s) => customMapDecode(s)
    },
    SCODE: {
        enc: (s, ctx) => securityCodeTransform(s, ctx.code, true),
        dec: (s, ctx) => securityCodeTransform(s, ctx.code, false)
    },
    B64: {
        enc: (s) => base64Encode(s),
        dec: (s) => base64Decode(s)
    },
    XAES: {
        enc: (s, ctx) => simpleAES(s, ctx.code),
        dec: (s, ctx) => simpleAES(s, ctx.code) // symmetrisch
    },
    CAESAR: {
        enc: (s, ctx) => caesarEncrypt(s, ctx.caesarShift),
        dec: (s, ctx) => caesarDecrypt(s, ctx.caesarShift)
    },
    REVERSE: {
        enc: (s) => reverseText(s),
        dec: (s) => reverseText(s)
    }
};

// baut Reihenfolge + Wiederholung + Parameter aus dem Code
function buildScheduleFromCode(code5) {
    const digits = normalizeDigits(code5);   // [d1..d5]
    const e = effectiveDigits(digits);       // [e1..e5]
    const seed = deriveSeedFromDigits(digits);
    const rng = xorshift32(seed);

    // 1) Grundreihenfolge shufflen
    const order = BASE_LAYERS.slice();
    shuffleInPlace(order, rng);

    // 2) Positionsabhängige Swaps: i = p-1, j = (i + e_p) % len
    for (let p = 1; p <= 5; p++) {
        const i = (p - 1) % order.length;
        const j = (i + e[p - 1]) % order.length;
        [order[i], order[j]] = [order[j], order[i]];
    }

    // 3) Wiederholung pro Position (1..3) zyklisch auf die finale Reihenfolge
    const repeats = e.map(v => 1 + (v % 3));

    // 4) Finale Sequenz aufbauen
    const sequence = [];
    for (let i = 0; i < order.length; i++) {
        const times = repeats[i % repeats.length];
        for (let t = 0; t < times; t++) sequence.push(order[i]);
    }

    // 5) Parameter ableiten (positionsabhängig)
    const caesarShift = 1 + (e.reduce((acc, val, idx) => acc + val * (idx + 1), 0) % 23);

    return {
        sequence,                      // z.B. ["MAP","B64","CAESAR","MAP",...]
        params: { caesarShift },       // schlüssel/parameter für kontext
    };
}

// invertierte Sequenz für Entschlüsselung
function invertSequence(seq) {
    return seq.slice().reverse();
}

/* ===========================================================
   Öffentliche Hauptfunktionen
   - encryptFull: führt enc-Layer in „sequence“-Reihenfolge aus
   - decryptFull: führt dec-Layer in invertierter Reihenfolge aus
   Der Code selbst wird als Kontext (ctx) für die Parameter genutzt.
   =========================================================== */

function runPipelineEnc(plain, code, schedule) {
    const ctx = { code, caesarShift: schedule.params.caesarShift };
    let s = String(plain);
    for (const layerName of schedule.sequence) {
        const layer = LAYERS[layerName];
        s = layer.enc(s, ctx);
    }
    return s;
}

function runPipelineDec(cipher, code, schedule) {
    const ctx = { code, caesarShift: schedule.params.caesarShift };
    let s = String(cipher);
    const inv = invertSequence(schedule.sequence);
    for (const layerName of inv) {
        const layer = LAYERS[layerName];
        s = layer.dec(s, ctx);
    }
    return s;
}

// Haupt-API (kompatible Exporte)
function encryptFull(message, code) {
    const schedule = buildScheduleFromCode(code);
    // Optional: äußere Hülle, um Format gleich zu halten (Base64-Wrapper)
    const body = runPipelineEnc(message, code, schedule);
    // Wir speichern NICHT die Sequenz (kein Leak). Nur Ergebnis zurück.
    // Wer mag, kann noch ein „B64 der gesamten Ausgabe“ nutzen:
    return base64Encode(body);
}

function decryptFull(encrypted, code) {
    try {
        const schedule = buildScheduleFromCode(code);
        const inner = base64Decode(encrypted);
        const out = runPipelineDec(inner, code, schedule);
        return out;
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
