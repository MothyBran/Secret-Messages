// tests/api.test.js - Comprehensive API Tests
const request = require('supertest');
const app = require('../server');
const sqlite3 = require('sqlite3').verbose();

describe('Secret Messages API Tests', () => {
    let server;
    let testDb;
    let authToken;
    let testKeyId;

    beforeAll(async () => {
        // Setup test database
        testDb = new sqlite3.Database(':memory:');
        
        // Initialize test tables
        await new Promise((resolve) => {
            testDb.serialize(() => {
                testDb.run(`CREATE TABLE license_keys (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    key_code TEXT UNIQUE NOT NULL,
                    key_hash TEXT NOT NULL,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    activated_at DATETIME NULL,
                    activated_ip TEXT NULL,
                    device_fingerprint TEXT NULL,
                    is_active BOOLEAN DEFAULT 0,
                    usage_count INTEGER DEFAULT 0,
                    max_usage INTEGER DEFAULT 1,
                    expires_at DATETIME NULL,
                    metadata TEXT NULL
                )`);
                
                testDb.run(`CREATE TABLE auth_sessions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    session_token TEXT UNIQUE NOT NULL,
                    key_id INTEGER NOT NULL,
                    ip_address TEXT NOT NULL,
                    device_fingerprint TEXT NOT NULL,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    last_activity DATETIME DEFAULT CURRENT_TIMESTAMP,
                    expires_at DATETIME NOT NULL,
                    is_active BOOLEAN DEFAULT 1,
                    FOREIGN KEY (key_id) REFERENCES license_keys (id)
                )`);
                
                resolve();
            });
        });
        
        server = app.listen(0);
    });

    afterAll(async () => {
        if (testDb) testDb.close();
        if (server) server.close();
    });

    describe('Health Check', () => {
        test('GET /api/health should return 200', async () => {
            const response = await request(server)
                .get('/api/health')
                .expect(200);
            
            expect(response.body.status).toBe('ok');
            expect(response.body.timestamp).toBeDefined();
        });
    });

    describe('Authentication', () => {
        test('POST /api/auth/activate with invalid key format should fail', async () => {
            const response = await request(server)
                .post('/api/auth/activate')
                .send({ licenseKey: 'INVALID' })
                .expect(400);
            
            expect(response.body.error).toContain('Invalid license key format');
        });

        test('POST /api/auth/activate with non-existent key should fail', async () => {
            const response = await request(server)
                .post('/api/auth/activate')
                .send({ licenseKey: 'AAAAA-BBBBB-CCCCC' })
                .expect(404);
            
            expect(response.body.error).toContain('License key not found');
        });

        test('Should generate and activate a valid key', async () => {
            // First generate a key (admin endpoint)
            const generateResponse = await request(server)
                .post('/api/admin/generate-key')
                .send({ 
                    password: process.env.ADMIN_PASSWORD || 'admin123',
                    quantity: 1 
                })
                .expect(200);

            expect(generateResponse.body.success).toBe(true);
            expect(generateResponse.body.keys).toHaveLength(1);
            
            const testKey = generateResponse.body.keys[0].key;
            testKeyId = generateResponse.body.keys[0].id;

            // Now activate the key
            const activateResponse = await request(server)
                .post('/api/auth/activate')
                .send({ licenseKey: testKey })
                .expect(200);

            expect(activateResponse.body.success).toBe(true);
            expect(activateResponse.body.token).toBeDefined();
            expect(activateResponse.body.keyId).toBe(testKeyId);
            
            authToken = activateResponse.body.token;
        });

        test('Should validate existing session', async () => {
            const response = await request(server)
                .post('/api/auth/validate')
                .send({ token: authToken })
                .expect(200);

            expect(response.body.success).toBe(true);
            expect(response.body.valid).toBe(true);
        });

        test('Should logout successfully', async () => {
            const response = await request(server)
                .post('/api/auth/logout')
                .send({ token: authToken })
                .expect(200);

            expect(response.body.success).toBe(true);
        });
    });

    describe('Admin Endpoints', () => {
        test('POST /api/admin/stats without password should fail', async () => {
            const response = await request(server)
                .post('/api/admin/stats')
                .send({})
                .expect(401);
            
            expect(response.body.error).toContain('Admin authentication failed');
        });

        test('POST /api/admin/stats with correct password should succeed', async () => {
            const response = await request(server)
                .post('/api/admin/stats')
                .send({ password: process.env.ADMIN_PASSWORD || 'admin123' })
                .expect(200);
            
            expect(response.body.success).toBe(true);
            expect(response.body.stats).toBeDefined();
            expect(response.body.stats.totalKeys).toBeGreaterThanOrEqual(0);
        });

        test('POST /api/admin/keys should list license keys', async () => {
            const response = await request(server)
                .post('/api/admin/keys')
                .send({ 
                    password: process.env.ADMIN_PASSWORD || 'admin123',
                    page: 1,
                    limit: 10
                })
                .expect(200);
            
            expect(response.body.success).toBe(true);
            expect(response.body.keys).toBeDefined();
            expect(response.body.pagination).toBeDefined();
        });
    });

    describe('Rate Limiting', () => {
        test('Should enforce rate limits on auth endpoints', async () => {
            const promises = [];
            
            // Send 10 rapid requests
            for (let i = 0; i < 10; i++) {
                promises.push(
                    request(server)
                        .post('/api/auth/activate')
                        .send({ licenseKey: 'AAAAA-BBBBB-CCCCC' })
                );
            }
            
            const responses = await Promise.all(promises);
            
            // At least one should be rate limited
            const rateLimited = responses.some(res => res.status === 429);
            expect(rateLimited).toBe(true);
        });
    });

    describe('Security Headers', () => {
        test('Should include security headers', async () => {
            const response = await request(server)
                .get('/api/health');
            
            expect(response.headers['x-content-type-options']).toBeDefined();
            expect(response.headers['x-frame-options']).toBeDefined();
            expect(response.headers['x-xss-protection']).toBeDefined();
        });
    });
});

// tests/integration.test.js - Integration Tests
describe('Integration Tests', () => {
    test('Complete user flow: key generation -> activation -> usage -> logout', async () => {
        const server = app.listen(0);
        
        try {
            // 1. Generate key (admin)
            const generateResponse = await request(server)
                .post('/api/admin/generate-key')
                .send({ 
                    password: process.env.ADMIN_PASSWORD || 'admin123',
                    quantity: 1 
                });
            
            expect(generateResponse.status).toBe(200);
            const testKey = generateResponse.body.keys[0].key;
            
            // 2. Activate key
            const activateResponse = await request(server)
                .post('/api/auth/activate')
                .send({ licenseKey: testKey });
            
            expect(activateResponse.status).toBe(200);
            const token = activateResponse.body.token;
            
            // 3. Log activity
            const activityResponse = await request(server)
                .post('/api/activity/log')
                .set('Authorization', `Bearer ${token}`)
                .send({ 
                    action: 'test_activity',
                    metadata: { test: true }
                });
            
            expect(activityResponse.status).toBe(200);
            
            // 4. Validate session
            const validateResponse = await request(server)
                .post('/api/auth/validate')
                .send({ token });
            
            expect(validateResponse.status).toBe(200);
            expect(validateResponse.body.valid).toBe(true);
            
            // 5. Logout
            const logoutResponse = await request(server)
                .post('/api/auth/logout')
                .send({ token });
            
            expect(logoutResponse.status).toBe(200);
            
        } finally {
            server.close();
        }
    });
});

// tests/performance.test.js - Performance Tests
describe('Performance Tests', () => {
    test('Health endpoint should respond within 100ms', async () => {
        const server = app.listen(0);
        
        try {
            const start = Date.now();
            
            await request(server)
                .get('/api/health')
                .expect(200);
            
            const duration = Date.now() - start;
            expect(duration).toBeLessThan(100);
            
        } finally {
            server.close();
        }
    });

    test('Key activation should handle concurrent requests', async () => {
        const server = app.listen(0);
        
        try {
            // Generate multiple keys
            const generateResponse = await request(server)
                .post('/api/admin/generate-key')
                .send({ 
                    password: process.env.ADMIN_PASSWORD || 'admin123',
                    quantity: 5 
                });
            
            const keys = generateResponse.body.keys;
            
            // Activate all keys concurrently
            const promises = keys.map(keyObj => 
                request(server)
                    .post('/api/auth/activate')
                    .send({ licenseKey: keyObj.key })
            );
            
            const responses = await Promise.all(promises);
            
            // All should succeed
            responses.forEach(response => {
                expect(response.status).toBe(200);
                expect(response.body.success).toBe(true);
            });
            
        } finally {
            server.close();
        }
    });
});

// monitoring/prometheus.yml - Prometheus Configuration
/*
global:
  scrape_interval: 15s
  evaluation_interval: 15s

rule_files:
  - "alert_rules.yml"

scrape_configs:
  - job_name: 'secret-messages-app'
    static_configs:
      - targets: ['secret-messages-app:3000']
    metrics_path: /metrics
    scrape_interval: 30s

  - job_name: 'postgres'
    static_configs:
      - targets: ['postgres:5432']

  - job_name: 'redis'
    static_configs:
      - targets: ['redis:6379']

  - job_name: 'nginx'
    static_configs:
      - targets: ['nginx:80']

  - job_name: 'node-exporter'
    static_configs:
      - targets: ['node-exporter:9100']

alerting:
  alertmanagers:
    - static_configs:
        - targets:
          - alertmanager:9093
*/

// monitoring/alert_rules.yml - Alerting Rules
/*
groups:
  - name: secret-messages-alerts
    rules:
      - alert: HighErrorRate
        expr: rate(http_requests_total{status=~"5.."}[5m]) > 0.1
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "High error rate detected"
          description: "Error rate is {{ $value }} errors per second"

      - alert: DatabaseDown
        expr: up{job="postgres"} == 0
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "Database is down"
          description: "PostgreSQL database is not responding"

      - alert: HighMemoryUsage
        expr: (node_memory_MemTotal_bytes - node_memory_MemAvailable_bytes) / node_memory_MemTotal_bytes > 0.8
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "High memory usage"
          description: "Memory usage is above 80%"

      - alert: DiskSpaceLow
        expr: (node_filesystem_avail_bytes / node_filesystem_size_bytes) < 0.1
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "Low disk space"
          description: "Disk space is below 10%"

      - alert: TooManyFailedLogins
        expr: increase(failed_login_attempts_total[5m]) > 10
        for: 1m
        labels:
          severity: warning
        annotations:
          summary: "Too many failed login attempts"
          description: "{{ $value }} failed login attempts in the last 5 minutes"
*/

// scripts/load-test.js - Load Testing Script
const autocannon = require('autocannon');

async function runLoadTest() {
    console.log('🚀 Starting load test for Secret Messages API...');
    
    const instance = autocannon({
        url: 'http://localhost:3000',
        connections: 10,
        pipelining: 1,
        duration: 30,
        requests: [
            {
                method: 'GET',
                path: '/api/health'
            },
            {
                method: 'POST',
                path: '/api/auth/validate',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ token: 'invalid-token' })
            }
        ]
    });

    instance.on('done', (result) => {
        console.log('📊 Load test results:');
        console.log(`Requests per second: ${result.requests.average}`);
        console.log(`Latency: ${result.latency.average}ms average`);
        console.log(`Errors: ${result.errors}`);
        console.log(`Timeouts: ${result.timeouts}`);
        
        if (result.requests.average < 100) {
            console.log('⚠️  Performance below expected threshold');
            process.exit(1);
        } else {
            console.log('✅ Performance test passed');
            process.exit(0);
        }
    });

    process.once('SIGINT', () => {
        instance.stop();
    });
}

if (require.main === module) {
    runLoadTest();
}

module.exports = { runLoadTest };

// scripts/security-scan.js - Security Scanning Script
const { exec } = require('child_process');
const fs = require('fs');

async function securityScan() {
    console.log('🔒 Running security scans...');
    
    // 1. npm audit
    console.log('📋 Running npm audit...');
    exec('npm audit --audit-level moderate', (error, stdout, stderr) => {
        if (error) {
            console.log('⚠️  npm audit found vulnerabilities:');
            console.log(stdout);
        } else {
            console.log('✅ npm audit passed');
        }
    });
    
    // 2. Check for hardcoded secrets
    console.log('🔍 Scanning for hardcoded secrets...');
    const sensitiveFiles = ['server.js', 'payment.js', '.env'];
    const patterns = [
        /password\s*=\s*["'][^"']*["']/gi,
        /secret\s*=\s*["'][^"']*["']/gi,
        /key\s*=\s*["'][^"']*["']/gi,
        /token\s*=\s*["'][^"']*["']/gi
    ];
    
    let foundIssues = false;
    sensitiveFiles.forEach(file => {
        if (fs.existsSync(file)) {
            const content = fs.readFileSync(file, 'utf8');
            patterns.forEach(pattern => {
                const matches = content.match(pattern);
                if (matches) {
                    console.log(`⚠️  Potential hardcoded secret in ${file}:`, matches[0]);
                    foundIssues = true;
                }
            });
        }
    });
    
    if (!foundIssues) {
        console.log('✅ No hardcoded secrets found');
    }
    
    // 3. Check file permissions
    console.log('🔐 Checking file permissions...');
    const criticalFiles = ['.env', 'secret_messages.db'];
    criticalFiles.forEach(file => {
        if (fs.existsSync(file)) {
            const stats = fs.statSync(file);
            const mode = (stats.mode & parseInt('777', 8)).toString(8);
            if (mode !== '600' && mode !== '644') {
                console.log(`⚠️  File ${file} has overly permissive permissions: ${mode}`);
            } else {
                console.log(`✅ File ${file} permissions OK: ${mode}`);
            }
        }
    });
    
    console.log('🔒 Security scan completed');
}

if (require.main === module) {
    securityScan();
}

module.exports = { securityScan };
