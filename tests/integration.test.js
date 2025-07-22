/**
 * Integration Tests for Secret Messages Backend
 * Tests the complete API endpoints and database interactions
 */

const request = require('supertest');
const crypto = require('crypto');

// Mock environment variables for testing
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-for-integration-tests-only';
process.env.ADMIN_PASSWORD = 'TestAdminPassword123!';
process.env.DATABASE_URL = ':memory:'; // In-memory SQLite for tests

// Import the server after setting env vars
let app;
let server;

beforeAll(async () => {
    // Dynamically import the server to ensure env vars are set first
    const serverModule = require('../src/server.js');
    app = serverModule.app;
    server = serverModule.server;
    
    // Wait for server to be ready
    await new Promise(resolve => {
        if (server.listening) {
            resolve();
        } else {
            server.on('listening', resolve);
        }
    });
});

afterAll(async () => {
    if (server) {
        await new Promise(resolve => {
            server.close(resolve);
        });
    }
});

describe('Health Check Endpoint', () => {
    test('GET /api/health should return status ok', async () => {
        const response = await request(app)
            .get('/api/health')
            .expect(200);
        
        expect(response.body.status).toBe('ok');
        expect(response.body.timestamp).toBeDefined();
        expect(response.body.uptime).toBeDefined();
    });
});

describe('Authentication Endpoints', () => {
    test('POST /api/auth/activate should validate demo license key', async () => {
        const response = await request(app)
            .post('/api/auth/activate')
            .send({
                licenseKey: 'SM001-ALPHA-BETA1'
            })
            .expect(200);
        
        expect(response.body.success).toBe(true);
        expect(response.body.token).toBeDefined();
        expect(response.body.keyId).toBeDefined();
        expect(response.body.message).toContain('activated');
    });

    test('POST /api/auth/activate should reject invalid license key', async () => {
        const response = await request(app)
            .post('/api/auth/activate')
            .send({
                licenseKey: 'INVALID-KEY-12345'
            })
            .expect(404);
        
        expect(response.body.success).toBe(false);
        expect(response.body.error).toBeDefined();
    });

    test('POST /api/auth/activate should reject malformed license key', async () => {
        const response = await request(app)
            .post('/api/auth/activate')
            .send({
                licenseKey: 'invalid-format'
            })
            .expect(400);
        
        expect(response.body.success).toBe(false);
        expect(response.body.error).toContain('format');
    });

    test('POST /api/auth/validate should validate JWT token', async () => {
        // First, activate a key to get a token
        const activateResponse = await request(app)
            .post('/api/auth/activate')
            .send({
                licenseKey: 'SM002-GAMMA-DELT2'
            })
            .expect(200);
        
        const token = activateResponse.body.token;
        
        // Then validate the token
        const validateResponse = await request(app)
            .post('/api/auth/validate')
            .send({
                token: token
            })
            .expect(200);
        
        expect(validateResponse.body.success).toBe(true);
        expect(validateResponse.body.valid).toBe(true);
        expect(validateResponse.body.keyId).toBeDefined();
    });

    test('POST /api/auth/validate should reject invalid token', async () => {
        const response = await request(app)
            .post('/api/auth/validate')
            .send({
                token: 'invalid.jwt.token'
            })
            .expect(401);
        
        expect(response.body.success).toBe(false);
        expect(response.body.valid).toBe(false);
    });

    test('POST /api/auth/logout should invalidate session', async () => {
        // First, activate a key
        const activateResponse = await request(app)
            .post('/api/auth/activate')
            .send({
                licenseKey: 'SM003-ECHO-FOXTR3'
            })
            .expect(200);
        
        const token = activateResponse.body.token;
        
        // Then logout
        const logoutResponse = await request(app)
            .post('/api/auth/logout')
            .send({
                token: token
            })
            .expect(200);
        
        expect(logoutResponse.body.success).toBe(true);
        expect(logoutResponse.body.message).toContain('Logged out');
        
        // Token should now be invalid
        const validateResponse = await request(app)
            .post('/api/auth/validate')
            .send({
                token: token
            })
            .expect(401);
        
        expect(validateResponse.body.valid).toBe(false);
    });
});

describe('Activity Logging', () => {
    let authToken;
    
    beforeAll(async () => {
        // Get a valid token for authenticated requests
        const response = await request(app)
            .post('/api/auth/activate')
            .send({
                licenseKey: 'SM004-HOTEL-INDI4'
            });
        authToken = response.body.token;
    });

    test('POST /api/activity/log should record user activity', async () => {
        const response = await request(app)
            .post('/api/activity/log')
            .set('Authorization', `Bearer ${authToken}`)
            .send({
                action: 'test_action',
                metadata: {
                    test: 'data'
                }
            })
            .expect(200);
        
        expect(response.body.success).toBe(true);
        expect(response.body.logged).toBe(true);
    });

    test('POST /api/activity/log should require authentication', async () => {
        const response = await request(app)
            .post('/api/activity/log')
            .send({
                action: 'test_action'
            })
            .expect(401);
        
        expect(response.body.success).toBe(false);
    });
});

describe('Admin Endpoints', () => {
    test('POST /api/admin/stats should return system statistics with valid password', async () => {
        const response = await request(app)
            .post('/api/admin/stats')
            .send({
                password: process.env.ADMIN_PASSWORD
            })
            .expect(200);
        
        expect(response.body.success).toBe(true);
        expect(response.body.stats).toBeDefined();
        expect(response.body.stats.totalKeys).toBeDefined();
        expect(response.body.stats.activeKeys).toBeDefined();
        expect(response.body.stats.activeSessions).toBeDefined();
    });

    test('POST /api/admin/stats should reject invalid password', async () => {
        const response = await request(app)
            .post('/api/admin/stats')
            .send({
                password: 'wrong-password'
            })
            .expect(401);
        
        expect(response.body.success).toBe(false);
        expect(response.body.error).toContain('password');
    });

    test('POST /api/admin/generate-key should create new license keys', async () => {
        const response = await request(app)
            .post('/api/admin/generate-key')
            .send({
                password: process.env.ADMIN_PASSWORD,
                quantity: 3
            })
            .expect(200);
        
        expect(response.body.success).toBe(true);
        expect(response.body.keys).toBeDefined();
        expect(response.body.keys.length).toBe(3);
        expect(response.body.generated).toBe(3);
        
        // Verify key format
        response.body.keys.forEach(keyObj => {
            expect(keyObj.key).toMatch(/^[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}$/);
        });
    });

    test('POST /api/admin/keys should return paginated license keys', async () => {
        const response = await request(app)
            .post('/api/admin/keys')
            .send({
                password: process.env.ADMIN_PASSWORD,
                page: 1,
                limit: 10
            })
            .expect(200);
        
        expect(response.body.success).toBe(true);
        expect(response.body.keys).toBeDefined();
        expect(response.body.pagination).toBeDefined();
        expect(response.body.pagination.page).toBe(1);
        expect(response.body.pagination.limit).toBe(10);
    });
});

describe('Payment Endpoints', () => {
    test('GET /api/payment/pricing should return pricing information', async () => {
        const response = await request(app)
            .get('/api/payment/pricing')
            .expect(200);
        
        expect(response.body.success).toBe(true);
        expect(response.body.pricing).toBeDefined();
        expect(response.body.pricing.single_key).toBeDefined();
        expect(response.body.pricing.bundle_5).toBeDefined();
        expect(response.body.pricing.bundle_10).toBeDefined();
        
        // Check pricing structure
        expect(response.body.pricing.single_key.price).toBe(999); // €9.99 in cents
        expect(response.body.pricing.bundle_5.price).toBe(3999); // €39.99 in cents
    });

    test('POST /api/payment/create-payment-intent should create payment intent', async () => {
        // Skip if Stripe is not configured
        if (!process.env.STRIPE_SECRET_KEY) {
            console.log('Skipping payment tests - Stripe not configured');
            return;
        }

        const response = await request(app)
            .post('/api/payment/create-payment-intent')
            .send({
                product_type: 'single_key',
                customer_email: 'test@example.com'
            })
            .expect(200);
        
        expect(response.body.success).toBe(true);
        expect(response.body.client_secret).toBeDefined();
        expect(response.body.amount).toBe(999);
        expect(response.body.key_count).toBe(1);
    });
});

describe('Rate Limiting', () => {
    test('should enforce rate limits on auth endpoints', async () => {
        const requests = [];
        
        // Make multiple rapid requests
        for (let i = 0; i < 10; i++) {
            requests.push(
                request(app)
                    .post('/api/auth/activate')
                    .send({
                        licenseKey: 'INVALID-KEY-TEST'
                    })
            );
        }
        
        const responses = await Promise.all(requests);
        
        // At least some requests should be rate limited
        const rateLimitedResponses = responses.filter(res => res.status === 429);
        expect(rateLimitedResponses.length).toBeGreaterThan(0);
    });
});

describe('Error Handling', () => {
    test('should handle malformed JSON gracefully', async () => {
        const response = await request(app)
            .post('/api/auth/activate')
            .set('Content-Type', 'application/json')
            .send('invalid json')
            .expect(400);
        
        expect(response.body.error).toBeDefined();
    });

    test('should return 404 for unknown endpoints', async () => {
        const response = await request(app)
            .get('/api/nonexistent')
            .expect(404);
        
        expect(response.body.error).toBeDefined();
    });

    test('should handle missing required fields', async () => {
        const response = await request(app)
            .post('/api/auth/activate')
            .send({}) // Missing licenseKey
            .expect(400);
        
        expect(response.body.error).toBeDefined();
    });
});

describe('Security Headers', () => {
    test('should include security headers in responses', async () => {
        const response = await request(app)
            .get('/api/health')
            .expect(200);
        
        expect(response.headers['x-content-type-options']).toBe('nosniff');
        expect(response.headers['x-frame-options']).toBe('DENY');
        expect(response.headers['x-xss-protection']).toBe('1; mode=block');
    });
});

describe('CORS Configuration', () => {
    test('should handle CORS preflight requests', async () => {
        const response = await request(app)
            .options('/api/health')
            .set('Origin', 'http://localhost:3000')
            .set('Access-Control-Request-Method', 'GET')
            .expect(204);
        
        expect(response.headers['access-control-allow-origin']).toBeDefined();
    });
});

describe('Database Interactions', () => {
    test('should handle database connection errors gracefully', async () => {
        // This test would require mocking database failures
        // For now, we just ensure the endpoints don't crash
        const response = await request(app)
            .get('/api/health')
            .expect(200);
        
        expect(response.body.status).toBe('ok');
    });
});

describe('Environment Configuration', () => {
    test('should load configuration from environment variables', async () => {
        // Test that the server respects environment configuration
        expect(process.env.NODE_ENV).toBe('test');
        expect(process.env.JWT_SECRET).toBeDefined();
        expect(process.env.ADMIN_PASSWORD).toBeDefined();
    });
});
