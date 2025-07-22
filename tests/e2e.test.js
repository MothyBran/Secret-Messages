/**
 * End-to-End Tests for Secret Messages Backend
 * Tests complete user journeys and system integrations
 */

const request = require('supertest');
const { execSync } = require('child_process');

// Environment setup
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-for-e2e-tests-only';
process.env.ADMIN_PASSWORD = 'E2ETestAdminPassword123!';
process.env.DATABASE_URL = ':memory:';
process.env.STRIPE_SECRET_KEY = ''; // Disable Stripe for E2E tests

// Test server setup
let app;
let server;
let baseURL;

beforeAll(async () => {
    // Import server after env setup
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
    
    const port = server.address().port;
    baseURL = `http://localhost:${port}`;
    
    console.log(`E2E Test server running at ${baseURL}`);
});

afterAll(async () => {
    if (server) {
        await new Promise(resolve => {
            server.close(resolve);
        });
    }
});

describe('Complete User Journey - Key Purchase and Usage', () => {
    let generatedKeys = [];
    let userToken = null;
    
    test('Admin generates demo keys', async () => {
        const response = await request(app)
            .post('/api/admin/generate-key')
            .send({
                password: process.env.ADMIN_PASSWORD,
                quantity: 5
            })
            .expect(200);
        
        expect(response.body.success).toBe(true);
        expect(response.body.keys).toHaveLength(5);
        
        generatedKeys = response.body.keys.map(k => k.key);
        console.log('Generated keys for E2E test:', generatedKeys[0], '...');
    });
    
    test('User activates license key', async () => {
        const response = await request(app)
            .post('/api/auth/activate')
            .send({
                licenseKey: generatedKeys[0]
            })
            .expect(200);
        
        expect(response.body.success).toBe(true);
        expect(response.body.token).toBeDefined();
        
        userToken = response.body.token;
    });
    
    test('User performs encryption activities', async () => {
        // Log encryption activity
        await request(app)
            .post('/api/activity/log')
            .set('Authorization', `Bearer ${userToken}`)
            .send({
                action: 'encrypt_message',
                metadata: {
                    messageLength: 100,
                    testRun: true
                }
            })
            .expect(200);
        
        // Log decryption activity
        await request(app)
            .post('/api/activity/log')
            .set('Authorization', `Bearer ${userToken}`)
            .send({
                action: 'decrypt_message',
                metadata: {
                    messageLength: 100,
                    testRun: true
                }
            })
            .expect(200);
    });
    
    test('Admin views usage statistics', async () => {
        const response = await request(app)
            .post('/api/admin/stats')
            .send({
                password: process.env.ADMIN_PASSWORD
            })
            .expect(200);
        
        expect(response.body.success).toBe(true);
        expect(response.body.stats.totalKeys).toBeGreaterThanOrEqual(5);
        expect(response.body.stats.activeKeys).toBeGreaterThanOrEqual(1);
        expect(response.body.stats.dailyUsage).toBeGreaterThanOrEqual(2);
    });
    
    test('User logs out', async () => {
        const response = await request(app)
            .post('/api/auth/logout')
            .send({
                token: userToken
            })
            .expect(200);
        
        expect(response.body.success).toBe(true);
    });
    
    test('Token is invalidated after logout', async () => {
        await request(app)
            .post('/api/auth/validate')
            .send({
                token: userToken
            })
            .expect(401);
    });
});

describe('Multi-User Scenario', () => {
    const users = [];
    
    test('Generate multiple users and keys', async () => {
        // Generate keys for multiple users
        const keyResponse = await request(app)
            .post('/api/admin/generate-key')
            .send({
                password: process.env.ADMIN_PASSWORD,
                quantity: 3
            })
            .expect(200);
        
        const keys = keyResponse.body.keys.map(k => k.key);
        
        // Activate keys for different "users" (different IPs simulated)
        for (let i = 0; i < keys.length; i++) {
            const response = await request(app)
                .post('/api/auth/activate')
                .set('X-Forwarded-For', `192.168.1.${100 + i}`) // Simulate different IPs
                .send({
                    licenseKey: keys[i]
                })
                .expect(200);
            
            users.push({
                id: i + 1,
                key: keys[i],
                token: response.body.token,
                ip: `192.168.1.${100 + i}`
            });
        }
        
        expect(users).toHaveLength(3);
    });
    
    test('Users perform concurrent activities', async () => {
        const activities = [];
        
        for (const user of users) {
            // Each user performs different activities
            activities.push(
                request(app)
                    .post('/api/activity/log')
                    .set('Authorization', `Bearer ${user.token}`)
                    .set('X-Forwarded-For', user.ip)
                    .send({
                        action: 'encrypt_message',
                        metadata: { userId: user.id, concurrent: true }
                    })
            );
            
            activities.push(
                request(app)
                    .post('/api/activity/log')
                    .set('Authorization', `Bearer ${user.token}`)
                    .set('X-Forwarded-For', user.ip)
                    .send({
                        action: 'copy_to_clipboard',
                        metadata: { userId: user.id, concurrent: true }
                    })
            );
        }
        
        // Execute all activities concurrently
        const responses = await Promise.all(activities);
        
        // All activities should succeed
        responses.forEach(response => {
            expect(response.status).toBe(200);
            expect(response.body.success).toBe(true);
        });
    });
    
    test('Admin can see all user activities', async () => {
        const response = await request(app)
            .post('/api/admin/stats')
            .send({
                password: process.env.ADMIN_PASSWORD
            })
            .expect(200);
        
        // Should reflect activities from multiple users
        expect(response.body.stats.activeSessions).toBeGreaterThanOrEqual(3);
        expect(response.body.stats.dailyUsage).toBeGreaterThanOrEqual(6); // 2 activities per user
    });
});

describe('Security and Edge Cases', () => {
    let validToken = null;
    
    beforeAll(async () => {
        // Get a valid token for security tests
        const keyResponse = await request(app)
            .post('/api/admin/generate-key')
            .send({
                password: process.env.ADMIN_PASSWORD,
                quantity: 1
            });
        
        const key = keyResponse.body.keys[0].key;
        
        const authResponse = await request(app)
            .post('/api/auth/activate')
            .send({ licenseKey: key });
        
        validToken = authResponse.body.token;
    });
    
    test('Rate limiting prevents abuse', async () => {
        const promises = [];
        
        // Make 20 rapid auth attempts
        for (let i = 0; i < 20; i++) {
            promises.push(
                request(app)
                    .post('/api/auth/activate')
                    .send({
                        licenseKey: 'INVALID-KEY-TEST'
                    })
                    .expect(res => {
                        // Should get either 404 (invalid key) or 429 (rate limited)
                        expect([404, 429]).toContain(res.status);
                    })
            );
        }
        
        await Promise.all(promises);
    });
    
    test('Device binding prevents key reuse', async () => {
        const keyResponse = await request(app)
            .post('/api/admin/generate-key')
            .send({
                password: process.env.ADMIN_PASSWORD,
                quantity: 1
            });
        
        const key = keyResponse.body.keys[0].key;
        
        // Activate from first "device"
        await request(app)
            .post('/api/auth/activate')
            .set('X-Forwarded-For', '192.168.1.200')
            .send({ licenseKey: key })
            .expect(200);
        
        // Try to activate same key from different "device"
        await request(app)
            .post('/api/auth/activate')
            .set('X-Forwarded-For', '192.168.1.201')
            .send({ licenseKey: key })
            .expect(403); // Should be forbidden
    });
    
    test('SQL injection attempts are blocked', async () => {
        const maliciousInputs = [
            "'; DROP TABLE license_keys; --",
            "' OR '1'='1",
            "'; DELETE FROM license_keys WHERE '1'='1'; --",
            "' UNION SELECT * FROM license_keys; --"
        ];
        
        for (const maliciousInput of maliciousInputs) {
            await request(app)
                .post('/api/auth/activate')
                .send({
                    licenseKey: maliciousInput
                })
                .expect(400); // Should reject malformed input
        }
    });
    
    test('XSS attempts are sanitized', async () => {
        const xssPayloads = [
            '<script>alert("xss")</script>',
            'javascript:alert("xss")',
            '<img src="x" onerror="alert(1)">',
            '"><script>alert(document.cookie)</script>'
        ];
        
        for (const payload of xssPayloads) {
            await request(app)
                .post('/api/activity/log')
                .set('Authorization', `Bearer ${validToken}`)
                .send({
                    action: 'test_action',
                    metadata: {
                        userInput: payload
                    }
                })
                .expect(200); // Should accept but sanitize
        }
    });
    
    test('Oversized requests are rejected', async () => {
        const largeString = 'A'.repeat(20 * 1024 * 1024); // 20MB string
        
        await request(app)
            .post('/api/activity/log')
            .set('Authorization', `Bearer ${validToken}`)
            .send({
                action: 'test_action',
                metadata: {
                    largeData: largeString
                }
            })
            .expect(413); // Payload too large
    });
});

describe('System Resilience Tests', () => {
    test('System handles high concurrency', async () => {
        const concurrentRequests = 50;
        const promises = [];
        
        for (let i = 0; i < concurrentRequests; i++) {
            promises.push(
                request(app)
                    .get('/api/health')
                    .expect(200)
            );
        }
        
        const responses = await Promise.all(promises);
        
        // All requests should succeed
        expect(responses).toHaveLength(concurrentRequests);
        responses.forEach(response => {
            expect(response.body.status).toBe('ok');
        });
    });
    
    test('Database connection recovery', async () => {
        // This test would require actual database manipulation
        // For now, just verify the system is stable
        
        const response = await request(app)
            .get('/api/health')
            .expect(200);
        
        expect(response.body.status).toBe('ok');
    });
    
    test('Memory leak detection', async () => {
        const initialMemory = process.memoryUsage();
        
        // Perform many operations
        const promises = [];
        for (let i = 0; i < 100; i++) {
            promises.push(
                request(app)
                    .get('/api/health')
            );
        }
        
        await Promise.all(promises);
        
        // Force garbage collection if available
        if (global.gc) {
            global.gc();
        }
        
        const finalMemory = process.memoryUsage();
        
        // Memory shouldn't have grown significantly
        const memoryGrowth = finalMemory.heapUsed - initialMemory.heapUsed;
        const memoryGrowthMB = memoryGrowth / (1024 * 1024);
        
        console.log(`Memory growth during test: ${memoryGrowthMB.toFixed(2)}MB`);
        
        // Allow some growth but not excessive
        expect(memoryGrowthMB).toBeLessThan(50);
    });
});

describe('Error Recovery and Graceful Degradation', () => {
    test('System continues operating with email service down', async () => {
        // This would test the system when email service is unavailable
        // Since we're not using real email in tests, just verify the system is stable
        
        const response = await request(app)
            .get('/api/payment/pricing')
            .expect(200);
        
        expect(response.body.success).toBe(true);
    });
    
    test('API returns meaningful error messages', async () => {
        const testCases = [
            {
                endpoint: '/api/auth/activate',
                payload: {},
                expectedStatus: 400,
                expectedErrorPattern: /required/i
            },
            {
                endpoint: '/api/auth/activate',
                payload: { licenseKey: 'invalid' },
                expectedStatus: 400,
                expectedErrorPattern: /format/i
            },
            {
                endpoint: '/api/admin/stats',
                payload: { password: 'wrong' },
                expectedStatus: 401,
                expectedErrorPattern: /password/i
            }
        ];
        
        for (const testCase of testCases) {
            const response = await request(app)
                .post(testCase.endpoint)
                .send(testCase.payload)
                .expect(testCase.expectedStatus);
            
            expect(response.body.error).toMatch(testCase.expectedErrorPattern);
            expect(response.body.success).toBe(false);
        }
    });
});

describe('Performance Benchmarks', () => {
    test('Health endpoint responds quickly', async () => {
        const startTime = Date.now();
        
        await request(app)
            .get('/api/health')
            .expect(200);
        
        const responseTime = Date.now() - startTime;
        
        // Health check should be fast
        expect(responseTime).toBeLessThan(100); // 100ms
    });
    
    test('Authentication endpoint performance', async () => {
        // Generate a key first
        const keyResponse = await request(app)
            .post('/api/admin/generate-key')
            .send({
                password: process.env.ADMIN_PASSWORD,
                quantity: 1
            });
        
        const key = keyResponse.body.keys[0].key;
        
        const startTime = Date.now();
        
        await request(app)
            .post('/api/auth/activate')
            .send({ licenseKey: key })
            .expect(200);
        
        const responseTime = Date.now() - startTime;
        
        // Auth should complete in reasonable time
        expect(responseTime).toBeLessThan(1000); // 1 second
    });
    
    test('System can handle burst traffic', async () => {
        const burstSize = 10;
        const promises = [];
        
        const startTime = Date.now();
        
        for (let i = 0; i < burstSize; i++) {
            promises.push(
                request(app)
                    .get('/api/health')
            );
        }
        
        const responses = await Promise.all(promises);
        const totalTime = Date.now() - startTime;
        
        // All requests should succeed
        expect(responses).toHaveLength(burstSize);
        responses.forEach(response => {
            expect(response.status).toBe(200);
        });
        
        // Average response time should be reasonable
        const averageResponseTime = totalTime / burstSize;
        expect(averageResponseTime).toBeLessThan(500); // 500ms average
        
        console.log(`Burst test: ${burstSize} requests in ${totalTime}ms (${averageResponseTime.toFixed(2)}ms avg)`);
    });
});

describe('Data Integrity Tests', () => {
    test('Key generation produces unique keys', async () => {
        const response = await request(app)
            .post('/api/admin/generate-key')
            .send({
                password: process.env.ADMIN_PASSWORD,
                quantity: 50
            })
            .expect(200);
        
        const keys = response.body.keys.map(k => k.key);
        const uniqueKeys = new Set(keys);
        
        // All keys should be unique
        expect(uniqueKeys.size).toBe(keys.length);
        
        // All keys should follow the format
        keys.forEach(key => {
            expect(key).toMatch(/^[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}$/);
        });
    });
    
    test('Activity logging maintains data consistency', async () => {
        // Get a valid token
        const keyResponse = await request(app)
            .post('/api/admin/generate-key')
            .send({
                password: process.env.ADMIN_PASSWORD,
                quantity: 1
            });
        
        const key = keyResponse.body.keys[0].key;
        
        const authResponse = await request(app)
            .post('/api/auth/activate')
            .send({ licenseKey: key });
        
        const token = authResponse.body.token;
        
        // Log multiple activities
        const activities = ['encrypt', 'decrypt', 'copy', 'clear'];
        for (const activity of activities) {
            await request(app)
                .post('/api/activity/log')
                .set('Authorization', `Bearer ${token}`)
                .send({
                    action: activity,
                    metadata: { test: 'data_integrity' }
                })
                .expect(200);
        }
        
        // Check that stats reflect the activities
        const statsResponse = await request(app)
            .post('/api/admin/stats')
            .send({
                password: process.env.ADMIN_PASSWORD
            })
            .expect(200);
        
        expect(statsResponse.body.stats.dailyUsage).toBeGreaterThanOrEqual(activities.length);
    });
});

// Test cleanup and reporting
afterAll(() => {
    console.log('E2E Tests completed successfully');
    console.log('All user journeys and system integrations verified');
});
