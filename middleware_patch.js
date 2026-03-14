const fs = require('fs');
let serverFile = fs.readFileSync('server.js', 'utf8');

const requireTorConnection = `
function requireTorConnection(req, res, next) {
    if (!req.isTor) {
        return res.status(403).json({ error: "Das Postfach ist aus Sicherheitsgründen nur über den Tor-Browser erreichbar." });
    }
    next();
}
`;

// Insert after authenticateUser
serverFile = serverFile.replace(
    /async function authenticateUser\(req, res, next\) \{[\s\S]*?\}\n/m,
    match => match + requireTorConnection
);

// Apply to routes
serverFile = serverFile.replace(
    /app\.post\('\/api\/messages\/send', authenticateUser, async \(req, res\) => \{/g,
    "app.post('/api/messages/send', authenticateUser, requireTorConnection, async (req, res) => {"
);

serverFile = serverFile.replace(
    /app\.get\('\/api\/messages', authenticateUser, async \(req, res\) => \{/g,
    "app.get('/api/messages', authenticateUser, requireTorConnection, async (req, res) => {"
);

serverFile = serverFile.replace(
    /app\.patch\('\/api\/messages\/:id\/read', authenticateUser, async \(req, res\) => \{/g,
    "app.patch('/api/messages/:id/read', authenticateUser, requireTorConnection, async (req, res) => {"
);

serverFile = serverFile.replace(
    /app\.delete\('\/api\/messages\/:id', authenticateUser, async \(req, res\) => \{/g,
    "app.delete('/api/messages/:id', authenticateUser, requireTorConnection, async (req, res) => {"
);

fs.writeFileSync('server.js', serverFile);
console.log("Patched server.js successfully!");
