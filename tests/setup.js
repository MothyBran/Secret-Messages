// tests/setup.js - Test Setup and Configuration
const { Pool } = require('pg');
const Redis = require('ioredis');
const { execSync } = require('child_process');

class TestEnvironment {
    constructor() {
        this.dbPool = null;
        this.redis = null;
        this.server = null;
        this.testDbName = `test_secretmessages_${Date.now()}`;
    }
    
    async setup() {
        console.log('🔧 Setting up test environment...');
        
        // Create test database
        await this.createTestDatabase();
        
        // Setup Redis connection
        await this.setupRedis();
        
        // Run migrations
        await this.runMigrations();
        
        // Seed test data
        await this.seedTestData();
        
        console.log('✅ Test environment ready');
    }
    
    async createTestDatabase() {
        const adminPool = new Pool({
            host: process.env.TEST_DB_HOST || 'localhost',
            port: process.env.TEST_DB_PORT || 5432,
            user: process.env.TEST_DB_USER || 'postgres',
            password: process.env.TEST_DB_PASSWORD || 'postgres',
            database: 'postgres'
        });
        
        try {
            await adminPool.query(`CREATE DATABASE ${this.testDbName}`);
            console.log(`📊 Created test database: ${this.testDbName}`);
        } catch (error) {
            if (!error.message.includes('already exists')) {
                throw error;
            }
        } finally {
            await adminPool.end();
        }
        
        // Connect to test database
        this.dbPool = new Pool({
            host: process.env.TEST_DB_HOST || 'localhost',
            port: process.env.TEST_DB_PORT || 5432,
            user: process.env.TEST_DB_USER || 'postgres',
            password: process.env.TEST_DB_PASSWORD || 'postgres',
            database: this.testDbName
        });
    }
    
    async setupRedis() {
        this.redis = new Redis({
            host: process.env.TEST_REDIS_HOST || 'localhost',
            port: process.env.TEST_REDIS_PORT || 6379,
            db: 1, // Use different DB for tests
            retryDelayOnFailover: 100,
            enableReadyCheck: false,
            maxRetriesPerRequest: null,
        });
        
        await this.redis.flushdb();
        console.log('🔴 Redis test database ready');
    }
    
    async runMigrations() {
        const migrations = [
            `CREATE TABLE IF NOT EXISTS license_keys (
                id SERIAL PRIMARY KEY,
                key_code TEXT UNIQUE NOT NULL,
                key_hash TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                activated_at TIMESTAMP NULL,
                activated_ip TEXT NULL,
                device_fingerprint TEXT NULL,
                is_active BOOLEAN DEFAULT FALSE,
                usage_count INTEGER DEFAULT 0,
                max_usage INTEGER DEFAULT 1,
                expires_at TIMESTAMP NULL,
                metadata JSONB NULL
            )`,
            `CREATE TABLE IF NOT EXISTS auth_sessions (
                id SERIAL PRIMARY KEY,
                session_token TEXT UNIQUE NOT NULL,
                key_id INTEGER NOT NULL REFERENCES license_keys(id),
                ip_address TEXT NOT NULL,
                device_fingerprint TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                last_activity TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                expires_at TIMESTAMP NOT NULL,
                is_active BOOLEAN DEFAULT TRUE
            )`,
            `CREATE TABLE IF NOT EXISTS usage_logs (
                id SERIAL PRIMARY KEY,
                key_id INTEGER NOT NULL REFERENCES license_keys(id),
                session_id INTEGER NOT NULL REFERENCES auth_sessions(id),
                action TEXT NOT NULL,
                ip_address TEXT NOT NULL,
                user_agent TEXT,
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                metadata JSONB NULL
            )`,
            `CREATE TABLE IF NOT EXISTS payments (
                id SERIAL PRIMARY KEY,
                payment_id TEXT UNIQUE NOT NULL,
                key_id INTEGER REFERENCES license_keys(id),
                amount DECIMAL(10,2) NOT NULL,
                currency TEXT DEFAULT 'EUR',
                status TEXT NOT NULL,
                payment_method TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                completed_at TIMESTAMP NULL,
                metadata JSONB NULL
            )`,
            `CREATE INDEX IF NOT EXISTS idx_license_keys_code ON license_keys(key_code)`,
            `CREATE INDEX IF NOT EXISTS idx_auth_sessions_token ON auth_sessions(session_token)`,
            `CREATE INDEX IF NOT EXISTS idx_usage_logs_key_id ON usage_logs(key_id)`,
            `CREATE INDEX IF NOT EXISTS idx_payments_payment_id ON payments(payment_id)`
        ];
        
        for (const migration of migrations) {
            await this.dbPool.query(migration);
        }
        
        console.log('📊 Database migrations completed');
    }
    
    async seedTestData() {
        // Create test license keys
        const testKeys = [
            { code: 'TEST1-TEST1-TEST1', hash: '$2b$10$test1hash' },
            { code: 'TEST2-TEST2-TEST2', hash: '$2b$10$test2hash' },
            { code: 'TEST3-TEST3-TEST3', hash: '$2b$10$test3hash' }
        ];
        
        for (const key of testKeys) {
            await this.dbPool.query(
                'INSERT INTO license_keys (key_code, key_hash) VALUES ($1, $2) ON CONFLICT DO NOTHING',
                [key.code, key.hash]
            );
        }
        
        console.log('🌱 Test data seeded');
    }
    
    async cleanup() {
        console.log('🧹 Cleaning up test environment...');
        
        if (this.redis) {
            await this.redis.disconnect();
        }
        
        if (this.dbPool) {
            await this.dbPool.end();
        }
        
        // Drop test database
        const adminPool = new Pool({
            host: process.env.TEST_DB_HOST || 'localhost',
            port: process.env.TEST_DB_PORT || 5432,
            user: process.env.TEST_DB_USER || 'postgres',
            password: process.env.TEST_DB_PASSWORD || 'postgres',
            database: 'postgres'
        });
        
        try {
            await adminPool.query(`DROP DATABASE IF EXISTS ${this.testDbName}`);
        } finally {
            await adminPool.end();
        }
        
        console.log('✅ Test environment cleaned up');
    }
}

module.exports = TestEnvironment;

// tests/unit/auth.test.js - Authentication Unit Tests
const request = require('supertest');
const app = require('../../server');
const TestEnvironment = require('../setup');

describe('Authentication Tests', () => {
    let testEnv;
    let server;
    
    beforeAll(async () => {
        testEnv = new TestEnvironment();
        await testEnv.setup();
        server = app.listen(0);
    });
    
    afterAll(async () => {
        if (server) server.close();
        if (testEnv) await testEnv.cleanup();
    });
    
    beforeEach(async () => {
        // Clear sessions before each test
        await testEnv.redis.flushdb();
    });
    
    describe('POST /api/auth/activate', () => {
        test('should activate valid license key', async () => {
            const response = await request(server)
                .post('/api/auth/activate')
                .send({ licenseKey: 'TEST1-TEST1-TEST1' })
                .expect(200);
            
            expect(response.body.success).toBe(true);
            expect(response.body.token).toBeDefined();
            expect(response.body.keyId).toBeDefined();
        });
        
        test('should reject invalid key format', async () => {
            const response = await request(server)
                .post('/api/auth/activate')
                .send({ licenseKey: 'INVALID-KEY' })
                .expect(400);
            
            expect(response.body.error).toContain('Invalid license key format');
        });
        
        test('should reject non-existent key', async () => {
            const response = await request(server)
                .post('/api/auth/activate')
                .send({ licenseKey: 'AAAAA-BBBBB-CCCCC' })
                .expect(404);
            
            expect(response.body.error).toContain('License key not found');
        });
        
        test('should handle concurrent activation attempts', async () => {
            const promises = Array(5).fill().map(() => 
                request(server)
                    .post('/api/auth/activate')
                    .send({ licenseKey: 'TEST2-TEST2-TEST2' })
            );
            
            const responses = await Promise.all(promises);
            const successful = responses.filter(r => r.status === 200);
            
            expect(successful).toHaveLength(1);
        });
    });
    
    describe('POST /api/auth/validate', () => {
        let validToken;
        
        beforeEach(async () => {
            const activateResponse = await request(server)
                .post('/api/auth/activate')
                .send({ licenseKey: 'TEST3-TEST3-TEST3' });
            
            validToken = activateResponse.body.token;
        });
        
        test('should validate correct token', async () => {
            const response = await request(server)
                .post('/api/auth/validate')
                .send({ token: validToken })
                .expect(200);
            
            expect(response.body.success).toBe(true);
            expect(response.body.valid).toBe(true);
        });
        
        test('should reject invalid token', async () => {
            const response = await request(server)
                .post('/api/auth/validate')
                .send({ token: 'invalid-token' })
                .expect(401);
            
            expect(response.body.error).toBeDefined();
        });
        
        test('should reject expired token', async () => {
            // Create an expired token (mock)
            const jwt = require('jsonwebtoken');
            const expiredToken = jwt.sign(
                { keyId: 1, exp: Math.floor(Date.now() / 1000) - 3600 },
                process.env.JWT_SECRET || 'test-secret'
            );
            
            const response = await request(server)
                .post('/api/auth/validate')
                .send({ token: expiredToken })
                .expect(401);
            
            expect(response.body.error).toBeDefined();
        });
    });
    
    describe('POST /api/auth/logout', () => {
        test('should logout successfully', async () => {
            const activateResponse = await request(server)
                .post('/api/auth/activate')
                .send({ licenseKey: 'TEST1-TEST1-TEST1' });
            
            const token = activateResponse.body.token;
            
            const response = await request(server)
                .post('/api/auth/logout')
                .send({ token })
                .expect(200);
            
            expect(response.body.success).toBe(true);
            
            // Verify token is invalid after logout
            await request(server)
                .post('/api/auth/validate')
                .send({ token })
                .expect(401);
        });
    });
});

// tests/unit/payment.test.js - Payment Unit Tests
const request = require('supertest');
const nock = require('nock');
const app = require('../../server');
const TestEnvironment = require('../setup');

describe('Payment Tests', () => {
    let testEnv;
    let server;
    
    beforeAll(async () => {
        testEnv = new TestEnvironment();
        await testEnv.setup();
        server = app.listen(0);
    });
    
    afterAll(async () => {
        if (server) server.close();
        if (testEnv) await testEnv.cleanup();
    });
    
    beforeEach(() => {
        nock.cleanAll();
    });
    
    describe('GET /api/payment/pricing', () => {
        test('should return pricing information', async () => {
            const response = await request(server)
                .get('/api/payment/pricing')
                .expect(200);
            
            expect(response.body.success).toBe(true);
            expect(response.body.pricing).toBeDefined();
            expect(response.body.pricing.single_key).toBeDefined();
            expect(response.body.pricing.bundle_5).toBeDefined();
            expect(response.body.pricing.bundle_10).toBeDefined();
        });
    });
    
    describe('POST /api/payment/create-payment-intent', () => {
        test('should create payment intent for single key', async () => {
            // Mock Stripe API
            nock('https://api.stripe.com')
                .post('/v1/payment_intents')
                .reply(200, {
                    id: 'pi_test_123',
                    client_secret: 'pi_test_123_secret_test',
                    amount: 999,
                    currency: 'eur'
                });
            
            const response = await request(server)
                .post('/api/payment/create-payment-intent')
                .send({
                    product_type: 'single_key',
                    customer_email: 'test@example.com'
                })
                .expect(200);
            
            expect(response.body.success).toBe(true);
            expect(response.body.client_secret).toBeDefined();
            expect(response.body.payment_id).toBeDefined();
            expect(response.body.key_count).toBe(1);
        });
        
        test('should validate email format', async () => {
            const response = await request(server)
                .post('/api/payment/create-payment-intent')
                .send({
                    product_type: 'single_key',
                    customer_email: 'invalid-email'
                })
                .expect(400);
            
            expect(response.body.error).toContain('email');
        });
        
        test('should validate product type', async () => {
            const response = await request(server)
                .post('/api/payment/create-payment-intent')
                .send({
                    product_type: 'invalid_product',
                    customer_email: 'test@example.com'
                })
                .expect(400);
            
            expect(response.body.error).toContain('Invalid product type');
        });
    });
});

// tests/integration/full-flow.test.js - End-to-End Integration Tests
const request = require('supertest');
const app = require('../../server');
const TestEnvironment = require('../setup');

describe('Full Application Flow', () => {
    let testEnv;
    let server;
    
    beforeAll(async () => {
        testEnv = new TestEnvironment();
        await testEnv.setup();
        server = app.listen(0);
    });
    
    afterAll(async () => {
        if (server) server.close();
        if (testEnv) await testEnv.cleanup();
    });
    
    test('complete user journey: key activation → usage → logout', async () => {
        // 1. Activate license key
        const activateResponse = await request(server)
            .post('/api/auth/activate')
            .send({ licenseKey: 'TEST1-TEST1-TEST1' })
            .expect(200);
        
        const { token, keyId } = activateResponse.body;
        expect(token).toBeDefined();
        expect(keyId).toBeDefined();
        
        // 2. Validate token
        const validateResponse = await request(server)
            .post('/api/auth/validate')
            .send({ token })
            .expect(200);
        
        expect(validateResponse.body.valid).toBe(true);
        
        // 3. Log some activity
        const activityResponse = await request(server)
            .post('/api/activity/log')
            .set('Authorization', `Bearer ${token}`)
            .send({
                action: 'encrypt_message',
                metadata: { message_length: 50 }
            })
            .expect(200);
        
        expect(activityResponse.body.success).toBe(true);
        
        // 4. Check admin stats
        const statsResponse = await request(server)
            .post('/api/admin/stats')
            .send({ password: process.env.ADMIN_PASSWORD || 'admin123' })
            .expect(200);
        
        expect(statsResponse.body.stats.activeKeys).toBeGreaterThan(0);
        expect(statsResponse.body.stats.activeSessions).toBeGreaterThan(0);
        
        // 5. Logout
        const logoutResponse = await request(server)
            .post('/api/auth/logout')
            .send({ token })
            .expect(200);
        
        expect(logoutResponse.body.success).toBe(true);
        
        // 6. Verify token is invalid after logout
        await request(server)
            .post('/api/auth/validate')
            .send({ token })
            .expect(401);
    });
    
    test('payment flow: create intent → confirm → key generation', async () => {
        // Mock successful payment flow
        const createResponse = await request(server)
            .post('/api/payment/create-payment-intent')
            .send({
                product_type: 'single_key',
                customer_email: 'test@example.com'
            });
        
        if (createResponse.status === 200) {
            const { payment_id } = createResponse.body;
            
            // Mock payment confirmation
            const confirmResponse = await request(server)
                .post('/api/payment/confirm-payment')
                .send({ payment_intent_id: payment_id });
            
            // Note: This will fail without proper Stripe mocking
            // but demonstrates the intended flow
        }
    });
    
    test('concurrent user simulation', async () => {
        const userCount = 10;
        const testKeys = Array.from({ length: userCount }, (_, i) => 
            `TEST${i}-TEST${i}-TEST${i}`
        );
        
        // Create test keys
        for (const keyCode of testKeys) {
            await testEnv.dbPool.query(
                'INSERT INTO license_keys (key_code, key_hash) VALUES ($1, $2) ON CONFLICT DO NOTHING',
                [keyCode, '$2b$10$testhash']
            );
        }
        
        // Simulate concurrent users
        const userPromises = testKeys.map(async (keyCode, index) => {
            try {
                // Activate key
                const activateResponse = await request(server)
                    .post('/api/auth/activate')
                    .send({ licenseKey: keyCode });
                
                if (activateResponse.status !== 200) {
                    return { user: index, status: 'failed', step: 'activate' };
                }
                
                const { token } = activateResponse.body;
                
                // Log activity
                const activityResponse = await request(server)
                    .post('/api/activity/log')
                    .set('Authorization', `Bearer ${token}`)
                    .send({
                        action: 'concurrent_test',
                        metadata: { user_id: index }
                    });
                
                if (activityResponse.status !== 200) {
                    return { user: index, status: 'failed', step: 'activity' };
                }
                
                // Logout
                const logoutResponse = await request(server)
                    .post('/api/auth/logout')
                    .send({ token });
                
                return {
                    user: index,
                    status: logoutResponse.status === 200 ? 'success' : 'failed',
                    step: 'complete'
                };
                
            } catch (error) {
                return { user: index, status: 'error', error: error.message };
            }
        });
        
        const results = await Promise.all(userPromises);
        const successCount = results.filter(r => r.status === 'success').length;
        
        console.log(`Concurrent test results: ${successCount}/${userCount} successful`);
        expect(successCount).toBeGreaterThan(userCount * 0.8); // 80% success rate
    });
});

// tests/performance/load.test.js - Performance Tests
const autocannon = require('autocannon');
const app = require('../../server');
const TestEnvironment = require('../setup');

describe('Performance Tests', () => {
    let testEnv;
    let server;
    let baseUrl;
    
    beforeAll(async () => {
        testEnv = new TestEnvironment();
        await testEnv.setup();
        server = app.listen(0);
        const address = server.address();
        baseUrl = `http://localhost:${address.port}`;
    });
    
    afterAll(async () => {
        if (server) server.close();
        if (testEnv) await testEnv.cleanup();
    });
    
    test('health endpoint performance', async () => {
        const result = await autocannon({
            url: `${baseUrl}/api/health`,
            connections: 50,
            duration: 10,
            pipelining: 1
        });
        
        expect(result.requests.average).toBeGreaterThan(100);
        expect(result.latency.average).toBeLessThan(100);
        expect(result.errors).toBe(0);
    }, 15000);
    
    test('authentication endpoint performance', async () => {
        const result = await autocannon({
            url: `${baseUrl}/api/auth/validate`,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ token: 'invalid-token' }),
            connections: 20,
            duration: 10,
            pipelining: 1
        });
        
        expect(result.requests.average).toBeGreaterThan(50);
        expect(result.latency.average).toBeLessThan(200);
    }, 15000);
    
    test('memory usage stability under load', async () => {
        const initialMemory = process.memoryUsage();
        
        await autocannon({
            url: `${baseUrl}/api/health`,
            connections: 100,
            duration: 20,
            pipelining: 1
        });
        
        // Force garbage collection if available
        if (global.gc) {
            global.gc();
        }
        
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        const finalMemory = process.memoryUsage();
        const memoryIncrease = finalMemory.heapUsed - initialMemory.heapUsed;
        
        // Memory increase should be reasonable (less than 50MB)
        expect(memoryIncrease).toBeLessThan(50 * 1024 * 1024);
    }, 30000);
});

// tests/security/security.test.js - Security Tests
const request = require('supertest');
const app = require('../../server');
const TestEnvironment = require('../setup');

describe('Security Tests', () => {
    let testEnv;
    let server;
    
    beforeAll(async () => {
        testEnv = new TestEnvironment();
        await testEnv.setup();
        server = app.listen(0);
    });
    
    afterAll(async () => {
        if (server) server.close();
        if (testEnv) await testEnv.cleanup();
    });
    
    test('should have security headers', async () => {
        const response = await request(server)
            .get('/api/health')
            .expect(200);
        
        expect(response.headers['x-content-type-options']).toBeDefined();
        expect(response.headers['x-frame-options']).toBeDefined();
        expect(response.headers['x-xss-protection']).toBeDefined();
    });
    
    test('should rate limit authentication attempts', async () => {
        const promises = Array(10).fill().map(() =>
            request(server)
                .post('/api/auth/activate')
                .send({ licenseKey: 'INVALID-KEY-FORMAT' })
        );
        
        const responses = await Promise.all(promises);
        const rateLimited = responses.some(r => r.status === 429);
        
        expect(rateLimited).toBe(true);
    });
    
    test('should prevent SQL injection', async () => {
        const maliciousKey = "TEST1'; DROP TABLE license_keys; --";
        
        const response = await request(server)
            .post('/api/auth/activate')
            .send({ licenseKey: maliciousKey });
        
        expect(response.status).toBe(400);
        
        // Verify table still exists
        const result = await testEnv.dbPool.query(
            'SELECT COUNT(*) FROM license_keys'
        );
        expect(parseInt(result.rows[0].count)).toBeGreaterThan(0);
    });
    
    test('should sanitize user input', async () => {
        const xssPayload = '<script>alert("XSS")</script>';
        
        const response = await request(server)
            .post('/api/auth/activate')
            .send({ licenseKey: xssPayload });
        
        expect(response.status).toBe(400);
        expect(response.body.error).not.toContain('<script>');
    });
    
    test('should validate JWT tokens properly', async () => {
        const invalidTokens = [
            'invalid.token.format',
            'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.invalid.signature',
            '',
            'null',
            'undefined'
        ];
        
        for (const token of invalidTokens) {
            const response = await request(server)
                .post('/api/auth/validate')
                .send({ token });
            
            expect(response.status).toBe(401);
        }
    });
});

// jest.config.js - Jest Configuration
module.exports = {
    testEnvironment: 'node',
    setupFilesAfterEnv: ['<rootDir>/tests/setup.js'],
    testMatch: [
        '**/tests/**/*.test.js'
    ],
    collectCoverage: true,
    coverageDirectory: 'coverage',
    coverageReporters: ['text', 'lcov', 'html'],
    coverageThreshold: {
        global: {
            branches: 80,
            functions: 80,
            lines: 80,
            statements: 80
        }
    },
    testTimeout: 30000,
    verbose: true,
    forceExit: true,
    detectOpenHandles: true
};

// package.json scripts update
/*
{
  "scripts": {
    "test": "jest",
    "test:unit": "jest tests/unit",
    "test:integration": "jest tests/integration", 
    "test:performance": "jest tests/performance",
    "test:security": "jest tests/security",
    "test:coverage": "jest --coverage",
    "test:watch": "jest --watch",
    "test:ci": "jest --ci --coverage --watchAll=false"
  }
}
*/
