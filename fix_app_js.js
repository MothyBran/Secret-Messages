const fs = require('fs');
let appJs = fs.readFileSync('public/app.js', 'utf8');

// The problematic code blocks we inserted look like this:
const block1 = `
    const isTorContext = window.location.hostname.endsWith('.onion');
    const navPost = document.getElementById('navPost');
    if (navPost) {
        if (!isTorContext && user) {
            navPost.style.display = 'none';
        }
    }
`;

const block2 = `
    const isTorContext = window.location.hostname.endsWith('.onion');
    const secureMsgWrapper = document.getElementById('secureMsgWrapper');
    if (secureMsgWrapper) {
        secureMsgWrapper.style.display = (isTorContext && user) ? 'block' : 'none';
    }
`;

// Let's replace the whole section starting from authElements.forEach to guestElements.forEach
// with a clean implementation.

appJs = appJs.replace(
    /authElements\.forEach\(el => el\.style\.display = user \? 'flex' : 'none'\);\n[\s\S]*?guestElements\.forEach\(el => el\.style\.display = user \? 'none' : 'flex'\);/g,
    `authElements.forEach(el => el.style.display = user ? 'flex' : 'none');

    // TOR RESTRICTIONS
    const _isTorContext = window.location.hostname.endsWith('.onion');
    const navPost = document.getElementById('navPost');
    if (navPost) {
        if (!_isTorContext && user) {
            navPost.style.display = 'none';
        }
    }
    const secureMsgWrapper = document.getElementById('secureMsgWrapper');
    if (secureMsgWrapper) {
        secureMsgWrapper.style.display = (_isTorContext && user) ? 'block' : 'none';
    }

    guestElements.forEach(el => el.style.display = user ? 'none' : 'flex');`
);

// We also need to fix handleMainAction where we used `isTorContext` directly without declaring it.
appJs = appJs.replace(
    /if \(secureMsgCheck && secureMsgCheck\.checked && isTorContext && rIds\.length > 0\) \{/g,
    `const _isTorContextAction = window.location.hostname.endsWith('.onion');
            if (secureMsgCheck && secureMsgCheck.checked && _isTorContextAction && rIds.length > 0) {`
);

fs.writeFileSync('public/app.js', appJs);
console.log("Fixed public/app.js scopes and logic");
