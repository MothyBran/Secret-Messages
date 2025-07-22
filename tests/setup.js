/**
 * Test Setup Configuration
 * Runs before each test suite
 */

// Set test environment variables
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-for-testing-only-never-use-in-production';
process.env.ADMIN_PASSWORD = 'TestAdminPassword123!';
process.env.DATABASE_URL = ':memory:'; // In-memory SQLite for tests
process.env.LOG_LEVEL = 'error'; // Reduce logging noise during tests

// Increase timeout for async operations
jest.setTimeout(30000);

// Mock console methods to reduce noise during tests
const originalConsoleLog = console.log;
const originalConsoleError = console.error;
const originalConsoleWarn = console.warn;

beforeAll(() => {
  // Mock console.log unless VERBOSE_TESTS is set
  if (!process.env.VERBOSE_TESTS) {
    console.log = jest.fn();
    console.warn = jest.fn();
  }
});

afterAll(() => {
  // Restore original console methods
  console.log = originalConsoleLog;
  console.error = originalConsoleError;
  console.warn = originalConsoleWarn;
});

// Global test utilities
global.testUtils = {
  // Generate a random test license key
  generateTestLicenseKey: () => {
    const crypto = require('crypto');
    const parts = [];
    for (let i = 0; i < 3; i++) {
      const part = crypto.randomBytes(3).toString('hex').toUpperCase().substring(0, 5);
      parts.push(part);
    }
    return parts.join('-');
  },
  
  // Generate test user data
  generateTestUser: () => ({
    email: `test${Date.now()}@example.com`,
    licenseKey: global.testUtils.generateTestLicenseKey()
  }),
  
  // Wait for a specified time
  wait: (ms) => new Promise(resolve => setTimeout(resolve, ms)),
  
  // Mock IP address for tests
  getTestIP: () => '127.0.0.1',
  
  // Generate test metadata
  generateTestMetadata: () => ({
    userAgent: 'Jest Test Suite',
    timestamp: new Date().toISOString(),
    testId: Date.now()
  })
};

// Mock external services
jest.mock('stripe', () => {
  return jest.fn().mockImplementation(() => ({
    paymentIntents: {
      create: jest.fn().mockResolvedValue({
        id: 'pi_test_payment_intent',
        client_secret: 'pi_test_client_secret',
        status: 'requires_payment_method',
        amount: 999,
        currency: 'eur'
      }),
      retrieve: jest.fn().mockResolvedValue({
        id: 'pi_test_payment_intent',
        status: 'succeeded',
        amount: 999,
        currency: 'eur'
      })
    },
    webhooks: {
      constructEvent: jest.fn().mockReturnValue({
        type: 'payment_intent.succeeded',
        data: {
          object: {
            id: 'pi_test_payment_intent',
            status: 'succeeded',
            amount: 999,
            metadata: {
              product_type: 'single_key',
              key_count: 1
            }
          }
        }
      })
    }
  }));
});

// Mock nodemailer for email tests
jest.mock('nodemailer', () => ({
  createTransport: jest.fn().mockReturnValue({
    sendMail: jest.fn().mockResolvedValue({
      messageId: 'test-message-id',
      accepted: ['test@example.com'],
      rejected: []
    })
  })
}));

// Mock Redis for session tests
jest.mock('ioredis', () => {
  const mockRedis = {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
    exists: jest.fn(),
    expire: jest.fn(),
    incr: jest.fn(),
    ttl: jest.fn(),
    ping: jest.fn().mockResolvedValue('PONG'),
    quit: jest.fn()
  };
  
  return jest.fn(() => mockRedis);
});

// Database cleanup function
global.cleanupDatabase = async () => {
  // This would clean up test database
  // Implementation depends on database type used
  console.log('Cleaning up test database...');
};

// Error handling for uncaught exceptions in tests
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});

// Global teardown
afterEach(async () => {
  // Clean up any test data after each test
  jest.clearAllMocks();
});

beforeEach(() => {
  // Reset mocks before each test
  jest.clearAllMocks();
});
