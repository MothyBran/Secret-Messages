{
  "name": "secret-messages-backend",
  "version": "1.0.0",
  "description": "Enterprise-grade encryption service with license key management",
  "main": "src/server.js",
  "scripts": {
    "start": "node src/server.js",
    "dev": "nodemon src/server.js",
    "test": "jest",
    "test:unit": "jest tests/unit.test.js",
    "test:integration": "jest tests/integration.test.js",
    "test:e2e": "jest tests/e2e.test.js",
    "test:load": "node tests/load.test.js",
    "test:coverage": "jest --coverage",
    "test:security": "npm audit && snyk test",
    "lint": "eslint src/ tests/",
    "lint:fix": "eslint src/ tests/ --fix",
    "format": "prettier --write src/ tests/",
    "format:check": "prettier --check src/ tests/",
    "build": "docker build -t secret-messages-backend .",
    "setup": "node scripts/setup.js",
    "generate-keys": "node scripts/generate-keys.js",
    "backup": "bash scripts/backup.sh",
    "deploy": "bash scripts/deploy.sh",
    "monitor": "node scripts/performance-monitor.js"
  },
  "keywords": [
    "encryption",
    "aes",
    "license-management",
    "payment-processing",
    "enterprise",
    "security"
  ],
  "author": "Secret Messages Team",
  "license": "MIT",
  "dependencies": {
    "express": "^4.18.2",
    "express-rate-limit": "^7.1.5",
    "helmet": "^7.1.0",
    "cors": "^2.8.5",
    "compression": "^1.7.4",
    "bcrypt": "^5.1.1",
    "jsonwebtoken": "^9.0.2",
    "joi": "^17.11.0",
    "sqlite3": "^5.1.6",
    "pg": "^8.11.3",
    "ioredis": "^5.3.2",
    "stripe": "^14.8.0",
    "nodemailer": "^6.9.7",
    "winston": "^3.11.0",
    "express-winston": "^4.2.0",
    "prom-client": "^15.0.0",
    "swagger-ui-express": "^5.0.0",
    "swagger-jsdoc": "^6.2.8",
    "dotenv": "^16.3.1",
    "crypto": "^1.0.1",
    "http-proxy-middleware": "^2.0.6"
  },
  "devDependencies": {
    "nodemon": "^3.0.2",
    "jest": "^29.7.0",
    "supertest": "^6.3.3",
    "eslint": "^8.54.0",
    "prettier": "^3.1.0",
    "autocannon": "^7.12.0",
    "snyk": "^1.1244.0",
    "@types/node": "^20.9.0"
  },
  "engines": {
    "node": ">=18.0.0",
    "npm": ">=8.0.0"
  },
  "repository": {
    "type": "git",
    "url": "https://github.com/yourusername/secret-messages-backend.git"
  },
  "bugs": {
    "url": "https://github.com/yourusername/secret-messages-backend/issues"
  },
  "homepage": "https://secretmessages.dev"
}
