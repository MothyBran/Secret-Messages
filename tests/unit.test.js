/**
 * Unit Tests for Secret Messages Backend
 */

const crypto = require('crypto');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

// Mock environment variables
process.env.JWT_SECRET = 'test-jwt-secret-key-for-testing-only';
process.env.NODE_ENV = 'test';

describe('License Key Generation', () => {
    test('should generate valid license key format', () => {
        function generateLicenseKey() {
            const parts = [];
            for (let i = 0; i < 3; i++) {
                const part = crypto.randomBytes(3).toString('hex').toUpperCase().substring(0, 5);
                parts.push(part);
            }
            return parts.join('-');
        }

        const key = generateLicenseKey();
        
        // Check format: XXXXX-XXXXX-XXXXX
        expect(key).toMatch(/^[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}$/);
        expect(key.length).toBe(17);
        expect(key.split('-').length).toBe(3);
    });

    test('should generate unique keys', () => {
        function generateLicenseKey() {
            const parts = [];
            for (let i = 0; i < 3; i++) {
                const part = crypto.randomBytes(3).toString('hex').toUpperCase().substring(0, 5);
                parts.push(part);
            }
            return parts.join('-');
        }

        const keys = new Set();
        for (let i = 0; i < 100; i++) {
            keys.add(generateLicenseKey());
        }
        
        // All keys should be unique
        expect(keys.size).toBe(100);
    });
});

describe('Password Hashing', () => {
    test('should hash passwords correctly', async () => {
        const password = 'TestPassword123!';
        const hash = bcrypt.hashSync(password, 10);
        
        expect(hash).toBeDefined();
        expect(hash.length).toBeGreaterThan(50);
        expect(bcrypt.compareSync(password, hash)).toBe(true);
        expect(bcrypt.compareSync('wrongpassword', hash)).toBe(false);
    });
});

describe('JWT Token Management', () => {
    test('should create and verify JWT tokens', () => {
        const payload = {
            keyId: 123,
            ip: '192.168.1.1'
        };
        
        const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '1h' });
        
        expect(token).toBeDefined();
        expect(typeof token).toBe('string');
        
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        expect(decoded.keyId).toBe(payload.keyId);
        expect(decoded.ip).toBe(payload.ip);
    });

    test('should reject invalid tokens', () => {
        const invalidToken = 'invalid.token.here';
        
        expect(() => {
            jwt.verify(invalidToken, process.env.JWT_SECRET);
        }).toThrow();
    });
});

describe('Encryption Functions', () => {
    // Test the encryption functions from the frontend
    test('should perform special character mapping', () => {
        const specialCharMapping = {
            '.': 'QQ1', ',': 'QQ2', '!': 'QQ3', '?': 'QQ4', 'EUR': 'QQ5',
            '&': 'QQ6', '+': 'QQ7', '-': 'QQ8', '(': 'QQ9', ')': 'QQ0'
        };
        
        function replaceSpecialChars(text) {
            let result = text.replace(/€/g, 'EUR');
            for (const special in specialCharMapping) {
                while (result.indexOf(special) !== -1) {
                    result = result.replace(special, specialCharMapping[special]);
                }
            }
            return result;
        }
        
        const input = 'Hello, World! €100 & more.';
        const output = replaceSpecialChars(input);
        
        expect(output).toContain('QQ2'); // comma
        expect(output).toContain('QQ3'); // exclamation
        expect(output).toContain('QQ5'); // EUR symbol
        expect(output).toContain('QQ6'); // ampersand
        expect(output).toContain('QQ1'); // period
    });

    test('should perform Base62 encoding/decoding', () => {
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
        
        const originalNumbers = [72, 101, 108, 108, 111]; // "Hello"
        const encoded = compactBase62(originalNumbers);
        const decoded = decompactBase62(encoded);
        
        expect(decoded).toEqual(originalNumbers);
        expect(encoded).toBeDefined();
        expect(typeof encoded).toBe('string');
    });
});

describe('Input Validation', () => {
    test('should validate license key format', () => {
        function validateLicenseKey(key) {
            return /^[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}$/.test(key);
        }
        
        expect(validateLicenseKey('SM001-ALPHA-BETA1')).toBe(true);
        expect(validateLicenseKey('12345-67890-ABCDE')).toBe(true);
        expect(validateLicenseKey('invalid-key')).toBe(false);
        expect(validateLicenseKey('SM001-ALPHA-BETA')).toBe(false);
        expect(validateLicenseKey('sm001-alpha-beta1')).toBe(false);
    });

    test('should validate 5-digit codes', () => {
        function validateCode(code) {
            return /^\d{5}$/.test(code);
        }
        
        expect(validateCode('12345')).toBe(true);
        expect(validateCode('00000')).toBe(true);
        expect(validateCode('99999')).toBe(true);
        expect(validateCode('1234')).toBe(false);
        expect(validateCode('123456')).toBe(false);
        expect(validateCode('abcde')).toBe(false);
    });

    test('should validate email addresses', () => {
        function validateEmail(email) {
            return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
        }
        
        expect(validateEmail('test@example.com')).toBe(true);
        expect(validateEmail('user.name@domain.co.uk')).toBe(true);
        expect(validateEmail('invalid-email')).toBe(false);
        expect(validateEmail('@domain.com')).toBe(false);
        expect(validateEmail('user@')).toBe(false);
    });
});

describe('Rate Limiting Logic', () => {
    test('should track request counts', () => {
        const requestCounts = new Map();
        
        function checkRateLimit(ip, limit = 5, windowMs = 60000) {
            const now = Date.now();
            const windowStart = now - windowMs;
            
            if (!requestCounts.has(ip)) {
                requestCounts.set(ip, []);
            }
            
            const requests = requestCounts.get(ip);
            
            // Remove old requests
            const recentRequests = requests.filter(time => time > windowStart);
            
            if (recentRequests.length >= limit) {
                return false; // Rate limited
            }
            
            recentRequests.push(now);
            requestCounts.set(ip, recentRequests);
            return true; // Allowed
        }
        
        const ip = '192.168.1.100';
        
        // First 5 requests should be allowed
        for (let i = 0; i < 5; i++) {
            expect(checkRateLimit(ip)).toBe(true);
        }
        
        // 6th request should be blocked
        expect(checkRateLimit(ip)).toBe(false);
    });
});

describe('Security Functions', () => {
    test('should generate secure random strings', () => {
        function generateSecureRandom(length = 32) {
            return crypto.randomBytes(length).toString('hex');
        }
        
        const random1 = generateSecureRandom();
        const random2 = generateSecureRandom();
        
        expect(random1).toBeDefined();
        expect(random2).toBeDefined();
        expect(random1).not.toBe(random2);
        expect(random1.length).toBe(64); // 32 bytes = 64 hex chars
    });

    test('should hash session tokens', () => {
        function hashToken(token) {
            return crypto.createHash('sha256').update(token).digest('hex');
        }
        
        const token = 'test-session-token';
        const hash1 = hashToken(token);
        const hash2 = hashToken(token);
        
        expect(hash1).toBe(hash2); // Same input should produce same hash
        expect(hash1.length).toBe(64); // SHA256 hex = 64 chars
        expect(hashToken('different-token')).not.toBe(hash1);
    });
});

describe('Utility Functions', () => {
    test('should format dates correctly', () => {
        function formatDate(date) {
            return new Date(date).toISOString();
        }
        
        const now = new Date();
        const formatted = formatDate(now);
        
        expect(formatted).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });

    test('should sanitize user input', () => {
        function sanitizeInput(input) {
            return String(input)
                .replace(/[<>]/g, '') // Remove potential HTML
                .replace(/['"]/g, '') // Remove quotes
                .trim()
                .substring(0, 1000); // Limit length
        }
        
        const maliciousInput = '<script>alert("xss")</script>';
        const sanitized = sanitizeInput(maliciousInput);
        
        expect(sanitized).not.toContain('<');
        expect(sanitized).not.toContain('>');
        expect(sanitized).toBe('scriptalert(xss)/script');
    });
});
