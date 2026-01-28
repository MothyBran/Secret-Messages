const jwt = require('jsonwebtoken');
const secret = 'secret_fallback_key';
const token = jwt.sign({ id: 1, username: 'testuser', role: 'user' }, secret, { expiresIn: '24h' });
console.log(token);
