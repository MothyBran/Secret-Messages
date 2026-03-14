const fs = require('fs');
let appJs = fs.readFileSync('public/app.js', 'utf8');

const isTorContextLogic = `
    const isTorContext = window.location.hostname.endsWith('.onion');
    const secureMsgWrapper = document.getElementById('secureMsgWrapper');
    if (secureMsgWrapper) {
        secureMsgWrapper.style.display = (isTorContext && user) ? 'block' : 'none';
    }
`;

// Insert after the previous isTorContextLogic we added
appJs = appJs.replace(
    /if \(!isTorContext && user\) \{\s*navPost\.style\.display = 'none';\s*\}\s*\}/g,
    match => match + isTorContextLogic
);


const handleMainActionPatch = `
            // WIZARD: Show Result
            enterResultState(res, 'text');

            // NEW LOGIC: SECURE-MSG
            const secureMsgCheck = document.getElementById('secureMsgCheck');
            const btnSendSecureMsg = document.getElementById('btnSendSecureMsg');
            if (secureMsgCheck && secureMsgCheck.checked && isTorContext && rIds.length > 0) {
                // Determine recipients (exclude current user if they are the only one, or just send to all selected)
                const sendRecipients = rIds.filter(id => id !== currentUser.name);
                if (sendRecipients.length > 0) {
                    btnSendSecureMsg.style.display = 'block';
                    btnSendSecureMsg.onclick = async () => {
                        const originalBtnText = btnSendSecureMsg.textContent;
                        btnSendSecureMsg.textContent = 'WIRD GESENDET...';
                        btnSendSecureMsg.disabled = true;
                        try {
                            const sendRes = await fetch(API_BASE + '/messages/send', {
                                method: 'POST',
                                headers: {
                                    'Content-Type': 'application/json',
                                    'Authorization': 'Bearer ' + authToken
                                },
                                body: JSON.stringify({
                                    recipientUsername: sendRecipients,
                                    subject: 'Secure Message',
                                    body: res
                                })
                            });
                            const sendData = await sendRes.json();
                            if (sendData.success) {
                                if(window.showToast) window.showToast('Nachricht erfolgreich über SECURE-MSG gesendet!', 'success');
                                else alert('Nachricht erfolgreich gesendet!');
                                btnSendSecureMsg.style.display = 'none';
                                document.getElementById('btnNewMessage').click(); // Optional: clear form
                            } else {
                                if(window.showToast) window.showToast('Fehler beim Senden: ' + (sendData.error || 'Unbekannter Fehler'), 'error');
                                else alert('Fehler beim Senden: ' + sendData.error);
                            }
                        } catch (err) {
                            if(window.showToast) window.showToast('Netzwerkfehler beim Senden.', 'error');
                            else alert('Netzwerkfehler beim Senden.');
                        } finally {
                            btnSendSecureMsg.textContent = originalBtnText;
                            btnSendSecureMsg.disabled = false;
                        }
                    };
                } else {
                    if(window.showToast) window.showToast('Bitte geben Sie mindestens einen Empfänger (außer sich selbst) an, um die Nachricht zu senden.', 'warning');
                }
            } else if (btnSendSecureMsg) {
                btnSendSecureMsg.style.display = 'none';
            }
`;

appJs = appJs.replace(
    /\/\/ WIZARD: Show Result\s*enterResultState\(res, 'text'\);/g,
    handleMainActionPatch
);

// We also need to hide the send button when the form is cleared/reset
const resetWizardPatch = `
function resetWizard() {
    const btnSendSecureMsg = document.getElementById('btnSendSecureMsg');
    if (btnSendSecureMsg) btnSendSecureMsg.style.display = 'none';
`;
appJs = appJs.replace(
    /function resetWizard\(\) \{/g,
    resetWizardPatch
);

fs.writeFileSync('public/app.js', appJs);
console.log("Patched public/app.js for Main Tool Integration successfully!");
