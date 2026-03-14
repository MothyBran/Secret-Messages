const fs = require('fs');
let appJs = fs.readFileSync('public/app.js', 'utf8');

const isTorContextLogic = `
    const isTorContext = window.location.hostname.endsWith('.onion');
    const navPost = document.getElementById('navPost');
    if (navPost) {
        if (!isTorContext && user) {
            navPost.style.display = 'none';
        }
    }
`;

// Insert after authElements.forEach...
appJs = appJs.replace(
    /authElements\.forEach\(el => el\.style\.display = user \? 'flex' : 'none'\);\n/g,
    match => match + isTorContextLogic
);

// Also intercept loadAndShowInbox
const loadAndShowInboxInterceptor = `
async function loadAndShowInbox() {
    const isTorContext = window.location.hostname.endsWith('.onion');
    if (!isTorContext) {
        if(window.showToast) window.showToast("Das Postfach ist aus Sicherheitsgründen nur über den Tor-Browser erreichbar.", "error");
        else alert("Das Postfach ist aus Sicherheitsgründen nur über den Tor-Browser erreichbar.");
        // Redirect to dashboard/index
        window.location.hash = ''; // Clear hash if any
        return;
    }
`;

appJs = appJs.replace(
    /async function loadAndShowInbox\(\) \{\n/g,
    loadAndShowInboxInterceptor
);

fs.writeFileSync('public/app.js', appJs);
console.log("Patched public/app.js successfully!");
