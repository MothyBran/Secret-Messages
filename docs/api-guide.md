# 🔐 Secret Messages API Guide

Comprehensive documentation for the Secret Messages Backend API.

## 📋 Table of Contents

- [Overview](#overview)
- [Authentication](#authentication)
- [Rate Limiting](#rate-limiting)
- [API Endpoints](#api-endpoints)
- [Error Handling](#error-handling)
- [Examples](#examples)
- [SDKs & Libraries](#sdks--libraries)

---

## 🌟 Overview

The Secret Messages API provides enterprise-grade encryption services with license key management, payment processing, and activity tracking.

### Base URL
```
Production: https://api.secretmessages.dev
Staging:    https://staging-api.secretmessages.dev
Local:      http://localhost:3000
```

### API Version
Current version: **v1.0**

### Content Type
All requests must include:
```
Content-Type: application/json
```

---

## 🔒 Authentication

### License Key Activation

Before using the API, you must activate a license key:

```bash
curl -X POST https://api.secretmessages.dev/api/auth/activate \
  -H "Content-Type: application/json" \
  -d '{
    "licenseKey": "SM001-ALPHA-BETA1"
  }'
```

**Response:**
```json
{
  "success": true,
  "message": "License key activated successfully",
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "keyId": 123
}
```

### Using the Token

Include the JWT token in subsequent requests:

```bash
curl -X POST https://api.secretmessages.dev/api/activity/log \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "action": "encrypt_message",
    "metadata": {"messageLength": 100}
  }'
```

### Token Validation

Check if your token is still valid:

```bash
curl -X POST https://api.secretmessages.dev/api/auth/validate \
  -H "Content-Type: application/json" \
  -d '{
    "token": "YOUR_JWT_TOKEN"
  }'
```

---

## ⚡ Rate Limiting

The API implements rate limiting to prevent abuse:

| Endpoint Type | Limit | Window |
|---------------|--------|--------|
| General API | 100 requests | 15 minutes |
| Authentication | 5 requests | 15 minutes |
| Admin | 10 requests | 15 minutes |

### Rate Limit Headers

All responses include rate limit information:

```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1640995200
```

### Rate Limit Exceeded

When limits are exceeded, you'll receive:

```json
{
  "error": "Too many requests, please try again later"
}
```
**HTTP Status:** `429 Too Many Requests`

---

## 🛠️ API Endpoints

### Health Check

#### `GET /api/health`

Check the system health and status.

**Request:**
```bash
curl https://api.secretmessages.dev/api/health
```

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2024-01-01T12:00:00.000Z",
  "version": "1.0.0",
  "uptime": 86400,
  "environment": "production"
}
```

---

### Authentication Endpoints

#### `POST /api/auth/activate`

Activate a license key and receive an authentication token.

**Request Body:**
```json
{
  "licenseKey": "SM001-ALPHA-BETA1"
}
```

**Validation:**
- `licenseKey`: Required string matching pattern `^[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}$`

**Success Response:**
```json
{
  "success": true,
  "message": "License key activated successfully",
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "keyId": 123
}
```

**Error Responses:**
```json
// Invalid format (400)
{
  "success": false,
  "error": "Invalid license key format"
}

// Key not found (404)
{
  "success": false,
  "error": "License key not found"
}

// Already bound to different device (403)
{
  "success": false,
  "error": "License key is bound to another device"
}
```

#### `POST /api/auth/validate`

Validate an existing JWT token.

**Request Body:**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**Success Response:**
```json
{
  "success": true,
  "valid": true,
  "keyId": 123
}
```

**Error Response:**
```json
{
  "success": false,
  "valid": false,
  "error": "Invalid or expired token"
}
```

#### `POST /api/auth/logout`

Invalidate a JWT token.

**Request Body:**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**Response:**
```json
{
  "success": true,
  "message": "Logged out successfully"
}
```

---

### Activity Logging

#### `POST /api/activity/log`

Log user activity for analytics and monitoring.

**Headers:**
```
Authorization: Bearer YOUR_JWT_TOKEN
```

**Request Body:**
```json
{
  "action": "encrypt_message",
  "metadata": {
    "messageLength": 100,
    "codeLength": 5,
    "timestamp": "2024-01-01T12:00:00.000Z"
  }
}
```

**Response:**
```json
{
  "success": true,
  "logged": true
}
```

**Common Actions:**
- `encrypt_message`
- `decrypt_message`
- `copy_to_clipboard`
- `clear_all`
- `mode_switch`
- `app_accessed`
- `login_success`

---

### Admin Endpoints

All admin endpoints require the admin password in the request body.

#### `POST /api/admin/stats`

Get system statistics and usage metrics.

**Request Body:**
```json
{
  "password": "your-admin-password"
}
```

**Response:**
```json
{
  "success": true,
  "stats": {
    "totalKeys": 1500,
    "activeKeys": 847,
    "activeSessions": 23,
    "dailyUsage": 1250
  }
}
```

#### `POST /api/admin/generate-key`

Generate new license keys.

**Request Body:**
```json
{
  "password": "your-admin-password",
  "quantity": 10,
  "expiresIn": 365
}
```

**Parameters:**
- `quantity`: Number of keys (1-100)
- `expiresIn`: Expiry in days (optional)

**Response:**
```json
{
  "success": true,
  "keys": [
    {
      "id": 1001,
      "key": "SM001-ABC12-DEF34",
      "expires_at": "2025-01-01T00:00:00.000Z"
    }
  ],
  "generated": 10
}
```

#### `POST /api/admin/keys`

List license keys with pagination.

**Request Body:**
```json
{
  "password": "your-admin-password",
  "page": 1,
  "limit": 50
}
```

**Response:**
```json
{
  "success": true,
  "keys": [
    {
      "id": 1,
      "key_code": "SM001-ALPHA-BETA1",
      "created_at": "2024-01-01T00:00:00.000Z",
      "activated_at": "2024-01-01T12:00:00.000Z",
      "activated_ip": "192.168.1.100",
      "is_active": true,
      "usage_count": 15,
      "expires_at": null
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 50,
    "total": 1500,
    "pages": 30
  }
}
```

---

### Payment Endpoints

#### `GET /api/payment/pricing`

Get current pricing information.

**Response:**
```json
{
  "success": true,
  "pricing": {
    "single_key": {
      "price": 999,
      "currency": "eur",
      "name": "Single License Key",
      "description": "One license key for personal use",
      "price_formatted": "€9.99"
    },
    "bundle_5": {
      "price": 3999,
      "currency": "eur",
      "name": "5-Key Bundle",
      "description": "Five license keys with 20% discount",
      "price_formatted": "€39.99"
    },
    "bundle_10": {
      "price": 6999,
      "currency": "eur",
      "name": "10-Key Bundle",
      "description": "Ten license keys with 30% discount",
      "price_formatted": "€69.99"
    }
  }
}
```

#### `POST /api/payment/create-payment-intent`

Create a Stripe payment intent for purchasing keys.

**Request Body:**
```json
{
  "product_type": "bundle_5",
  "customer_email": "customer@example.com",
  "quantity": 1
}
```

**Response:**
```json
{
  "success": true,
  "client_secret": "pi_1234567890_secret_abcdef",
  "payment_id": "pi_1234567890",
  "amount": 3999,
  "currency": "eur",
  "key_count": 5
}
```

#### `POST /api/payment/confirm-payment`

Confirm payment and generate license keys.

**Request Body:**
```json
{
  "payment_intent_id": "pi_1234567890"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Payment confirmed and keys generated",
  "key_count": 5,
  "keys": [
    "SM001-ABC12-DEF34",
    "SM002-GHI56-JKL78"
  ],
  "email_sent": true
}
```

---

## ❌ Error Handling

### HTTP Status Codes

| Code | Meaning | Usage |
|------|---------|--------|
| 200 | OK | Successful request |
| 400 | Bad Request | Invalid input data |
| 401 | Unauthorized | Invalid or missing authentication |
| 403 | Forbidden | Access denied |
| 404 | Not Found | Resource not found |
| 429 | Too Many Requests | Rate limit exceeded |
| 500 | Internal Server Error | Server error |

### Error Response Format

All errors follow a consistent format:

```json
{
  "success": false,
  "error": "Error description",
  "code": "ERROR_CODE",
  "details": {
    "field": "Additional error information"
  }
}
```

### Common Errors

#### Authentication Errors

```json
// Invalid license key format
{
  "success": false,
  "error": "Invalid license key format"
}

// License key not found
{
  "success": false,
  "error": "License key not found"
}

// Device binding violation
{
  "success": false,
  "error": "License key is bound to another device"
}

// Expired token
{
  "success": false,
  "error": "Invalid or expired token"
}
```

#### Validation Errors

```json
// Missing required field
{
  "success": false,
  "error": "License key is required"
}

// Invalid format
{
  "success": false,
  "error": "Code must be exactly 5 digits"
}
```

#### Admin Errors

```json
// Wrong admin password
{
  "success": false,
  "error": "Invalid admin password"
}

// Exceeded limits
{
  "success": false,
  "error": "Maximum 100 keys per request"
}
```

---

## 💡 Examples

### Complete User Journey

```bash
#!/bin/bash

# 1. Activate license key
TOKEN=$(curl -s -X POST https://api.secretmessages.dev/api/auth/activate \
  -H "Content-Type: application/json" \
  -d '{"licenseKey": "SM001-ALPHA-BETA1"}' | \
  jq -r '.token')

echo "Token: $TOKEN"

# 2. Log encryption activity
curl -X POST https://api.secretmessages.dev/api/activity/log \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "action": "encrypt_message",
    "metadata": {
      "messageLength": 150,
      "codeLength": 5,
      "timestamp": "'$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)'"
    }
  }'

# 3. Validate token
curl -X POST https://api.secretmessages.dev/api/auth/validate \
  -H "Content-Type: application/json" \
  -d "{\"token\": \"$TOKEN\"}"

# 4. Logout
curl -X POST https://api.secretmessages.dev/api/auth/logout \
  -H "Content-Type: application/json" \
  -d "{\"token\": \"$TOKEN\"}"
```

### Admin Key Management

```bash
#!/bin/bash

ADMIN_PASSWORD="your-admin-password"

# Generate 10 new keys
curl -X POST https://api.secretmessages.dev/api/admin/generate-key \
  -H "Content-Type: application/json" \
  -d "{
    \"password\": \"$ADMIN_PASSWORD\",
    \"quantity\": 10,
    \"expiresIn\": 365
  }"

# Get system statistics
curl -X POST https://api.secretmessages.dev/api/admin/stats \
  -H "Content-Type: application/json" \
  -d "{\"password\": \"$ADMIN_PASSWORD\"}"

# List keys with pagination
curl -X POST https://api.secretmessages.dev/api/admin/keys \
  -H "Content-Type: application/json" \
  -d "{
    \"password\": \"$ADMIN_PASSWORD\",
    \"page\": 1,
    \"limit\": 20
  }"
```

### JavaScript Integration

```javascript
class SecretMessagesAPI {
  constructor(baseURL = 'https://api.secretmessages.dev') {
    this.baseURL = baseURL;
    this.token = null;
  }

  async activateKey(licenseKey) {
    const response = await fetch(`${this.baseURL}/api/auth/activate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ licenseKey })
    });

    const data = await response.json();
    
    if (data.success) {
      this.token = data.token;
    }
    
    return data;
  }

  async logActivity(action, metadata = {}) {
    if (!this.token) {
      throw new Error('Not authenticated');
    }

    const response = await fetch(`${this.baseURL}/api/activity/log`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.token}`
      },
      body: JSON.stringify({ action, metadata })
    });

    return response.json();
  }

  async getPricing() {
    const response = await fetch(`${this.baseURL}/api/payment/pricing`);
    return response.json();
  }
}

// Usage
const api = new SecretMessagesAPI();

try {
  const result = await api.activateKey('SM001-ALPHA-BETA1');
  console.log('Activation result:', result);

  await api.logActivity('encrypt_message', { 
    messageLength: 100 
  });

  const pricing = await api.getPricing();
  console.log('Pricing:', pricing);
} catch (error) {
  console.error('API Error:', error);
}
```

### Python Integration

```python
import requests
import json

class SecretMessagesAPI:
    def __init__(self, base_url='https://api.secretmessages.dev'):
        self.base_url = base_url
        self.token = None
        self.session = requests.Session()
        self.session.headers.update({
            'Content-Type': 'application/json'
        })

    def activate_key(self, license_key):
        """Activate a license key"""
        response = self.session.post(
            f'{self.base_url}/api/auth/activate',
            json={'licenseKey': license_key}
        )
        
        data = response.json()
        
        if data.get('success'):
            self.token = data['token']
            self.session.headers.update({
                'Authorization': f'Bearer {self.token}'
            })
        
        return data

    def log_activity(self, action, metadata=None):
        """Log user activity"""
        if not self.token:
            raise ValueError('Not authenticated')
        
        payload = {'action': action}
        if metadata:
            payload['metadata'] = metadata
        
        response = self.session.post(
            f'{self.base_url}/api/activity/log',
            json=payload
        )
        
        return response.json()

    def get_pricing(self):
        """Get pricing information"""
        response = self.session.get(f'{self.base_url}/api/payment/pricing')
        return response.json()

# Usage
api = SecretMessagesAPI()

try:
    # Activate license key
    result = api.activate_key('SM001-ALPHA-BETA1')
    print('Activation result:', result)

    # Log activity
    api.log_activity('encrypt_message', {'messageLength': 100})

    # Get pricing
    pricing = api.get_pricing()
    print('Pricing:', pricing)

except Exception as error:
    print('API Error:', error)
```

---

## 📚 SDKs & Libraries

### Official SDKs

| Language | Repository | Installation |
|----------|------------|--------------|
| JavaScript | `secret-messages-js` | `npm install secret-messages-api` |
| Python | `secret-messages-python` | `pip install secret-messages-api` |
| PHP | `secret-messages-php` | `composer require secret-messages/api` |
| Go | `secret-messages-go` | `go get github.com/secret-messages/api-go` |

### Community Libraries

- **Ruby**: `gem install secret_messages`
- **Java**: Maven dependency available
- **C#**: NuGet package available

---

## 🔗 Additional Resources

- [OpenAPI Specification](./openapi.yaml)
- [Postman Collection](https://postman.com/secret-messages)
- [GraphQL Playground](https://api.secretmessages.dev/graphql)
- [Status Page](https://status.secretmessages.dev)
- [Developer Forum](https://forum.secretmessages.dev)

---

## 🆘 Support

### Community Support
- **GitHub**: [Issues & Discussions](https://github.com/secret-messages/backend/issues)
- **Discord**: [Developer Community](https://discord.gg/secretmessages)
- **Stack Overflow**: Tag with `secret-messages`

### Enterprise Support
- **Email**: [enterprise@secretmessages.dev](mailto:enterprise@secretmessages.dev)
- **Slack**: Direct channel access
- **Phone**: 24/7 support hotline

### Documentation Updates
This documentation is updated regularly. Last updated: **January 2024**

---

**🔐 Secret Messages API - Secure by Design, Simple by Choice**
