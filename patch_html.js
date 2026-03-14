const fs = require('fs');
let html = fs.readFileSync('public/index.html', 'utf8');

const checkboxHtml = `
                    <div id="secureMsgWrapper" style="display:none; margin-top: 15px; background: rgba(0, 191, 255, 0.1); border: 1px solid var(--accent-blue); padding: 10px; border-radius: 8px;">
                        <label style="display: flex; align-items: center; cursor: pointer; color: #fff; font-size: 0.9rem;">
                            <input type="checkbox" id="secureMsgCheck" style="margin-right: 10px; transform: scale(1.2); accent-color: var(--accent-blue);">
                            Nachricht direkt über SECURE-MSG senden
                        </label>
                    </div>
`;

html = html.replace(
    /<\/div>\s*<!-- Step 3: Action Button -->/m,
    match => checkboxHtml + match
);

const sendBtnHtml = `
                    <button id="btnSendSecureMsg" class="btn btn-primary" style="display: none; width: 100%; margin-top: 15px; background-color: var(--accent-blue); color: #000; font-weight: bold; border: none;">
                        📤 SENDEN
                    </button>
`;

html = html.replace(
    /🗑️ MASKE LEEREN\s*<\/button>\s*<\/div>/m,
    match => match.replace('</div>', '') + sendBtnHtml + '\n                </div>'
);

fs.writeFileSync('public/index.html', html);
console.log("Patched public/index.html successfully!");
