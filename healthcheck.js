#!/usr/bin/env node
/**
 * Health Check Script for Secret Messages Backend
 * Used by Docker containers and monitoring systems
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

// Configuration
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || 'localhost';
const TIMEOUT = 5000; // 5 seconds

// Health check function
function performHealthCheck() {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: HOST,
            port: PORT,
            path: '/api/health',
            method: 'GET',
            timeout: TIMEOUT,
            headers: {
                'User-Agent': 'HealthCheck/1.0',
                'Accept': 'application/json'
            }
        };

        const req = http.request(options, (res) => {
            let data = '';

            res.on('data', (chunk) => {
                data += chunk;
            });

            res.on('end', () => {
                if (res.statusCode === 200) {
                    try {
                        const response = JSON.parse(data);
                        if (response.status === 'ok') {
                            resolve({
                                success: true,
                                status: 'healthy',
                                statusCode: res.statusCode,
                                response: response,
                                timestamp: new Date().toISOString()
                            });
                        } else {
                            reject({
                                success: false,
                                status: 'unhealthy',
                                statusCode: res.statusCode,
                                error: 'Invalid health response',
                                response: response
                            });
                        }
                    } catch (parseError) {
                        reject({
                            success: false,
                            status: 'unhealthy',
                            statusCode: res.statusCode,
                            error: 'Failed to parse health response',
                            data: data
                        });
                    }
                } else {
                    reject({
                        success: false,
                        status: 'unhealthy',
                        statusCode: res.statusCode,
                        error: `HTTP ${res.statusCode}`,
                        data: data
                    });
                }
            });
        });

        req.on('error', (error) => {
            reject({
                success: false,
                status: 'unreachable',
                error: error.message,
                code: error.code
            });
        });

        req.on('timeout', () => {
            req.destroy();
            reject({
                success: false,
                status: 'timeout',
                error: `Health check timed out after ${TIMEOUT}ms`
            });
        });

        req.end();
    });
}

// Additional system checks
function checkSystemHealth() {
    const checks = {
        timestamp: new Date().toISOString(),
        pid: process.pid,
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        version: process.version,
        platform: process.platform
    };

    // Check log directory
    try {
        const logDir = path.join(process.cwd(), 'logs');
        if (fs.existsSync(logDir)) {
            checks.logsWritable = fs.constants.W_OK;
        } else {
            checks.logsWritable = false;
        }
    } catch (error) {
        checks.logsWritable = false;
        checks.logError = error.message;
    }

    // Check disk space (simplified)
    try {
        const stats = fs.statSync(process.cwd());
        checks.diskAccessible = true;
    } catch (error) {
        checks.diskAccessible = false;
        checks.diskError = error.message;
    }

    return checks;
}

// Main execution
async function main() {
    try {
        console.log('🏥 Starting health check...');
        
        const healthResult = await performHealthCheck();
        const systemHealth = checkSystemHealth();
        
        const result = {
            ...healthResult,
            system: systemHealth
        };
        
        if (process.env.VERBOSE === 'true') {
            console.log('✅ Health check passed:');
            console.log(JSON.stringify(result, null, 2));
        } else {
            console.log('✅ Health check passed');
        }
        
        process.exit(0);
        
    } catch (error) {
        const systemHealth = checkSystemHealth();
        
        const result = {
            ...error,
            system: systemHealth
        };
        
        console.error('❌ Health check failed:');
        console.error(JSON.stringify(result, null, 2));
        
        process.exit(1);
    }
}

// Handle CLI arguments
if (process.argv.includes('--verbose')) {
    process.env.VERBOSE = 'true';
}

if (process.argv.includes('--system-only')) {
    // Only check system health, not HTTP endpoint
    const systemHealth = checkSystemHealth();
    console.log('🖥️ System Health:');
    console.log(JSON.stringify(systemHealth, null, 2));
    process.exit(0);
}

// Run health check if this file is executed directly
if (require.main === module) {
    main();
}

module.exports = {
    performHealthCheck,
    checkSystemHealth
};
