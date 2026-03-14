const fs = require('fs');

function fixFile(filename) {
    if (!fs.existsSync(filename)) return;
    let content = fs.readFileSync(filename, 'utf8');

    // Check if requireTorConnection is defined before it's used
    const functionDef = `
function requireTorConnection(req, res, next) {
    if (!req.isTor) {
        return res.status(403).json({ error: "Das Postfach ist aus Sicherheitsgründen nur über den Tor-Browser erreichbar." });
    }
    next();
}
`;
    // We inserted it after authenticateUser, let's just make sure it's declared globally or placed high enough.
    // In JS, function declarations are hoisted, but if we placed it inside another function or string poorly, it might fail.

    // Let's remove the old definition we inserted and put it safely near the top or as a const arrow function.
    content = content.replace(/function requireTorConnection\(req, res, next\) \{\s*if \(!req\.isTor\) \{\s*return res\.status\(403\)\.json\(\{ error: "Das Postfach ist aus Sicherheitsgründen nur über den Tor-Browser erreichbar\." \}\);\s*\}\s*next\(\);\s*\}/g, '');

    // Put it right after const app = express(); or somewhere safe
    content = content.replace(/const app = express\(\);/, match => match + '\n' + functionDef);

    fs.writeFileSync(filename, content);
    console.log("Fixed " + filename);
}

fixFile('server.js');
fixFile('server-enterprise.js');
