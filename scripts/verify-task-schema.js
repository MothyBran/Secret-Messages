const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');

async function verify() {
    console.log("🔍 Verifying Schema...");
    const db = new sqlite3.Database('./secret_messages.db');

    const run = (sql) => new Promise((resolve, reject) => {
        db.all(sql, [], (err, rows) => {
            if (err) reject(err); else resolve(rows);
        });
    });

    try {
        // Check license_keys for origin column
        const cols = await run("PRAGMA table_info(license_keys)");
        const originCol = cols.find(c => c.name === 'origin');

        if (originCol) {
            console.log("✅ Column 'origin' found in license_keys.");
            console.log(`   Type: ${originCol.type}, Default: ${originCol.dflt_value}`);
        } else {
            console.error("❌ Column 'origin' NOT found in license_keys.");
            process.exit(1);
        }

        // Check users for license_expiration (already existed but checking anyway)
        const userCols = await run("PRAGMA table_info(users)");
        const expCol = userCols.find(c => c.name === 'license_expiration');
        if (expCol) {
             console.log("✅ Column 'license_expiration' found in users.");
        } else {
             console.error("❌ Column 'license_expiration' NOT found in users.");
        }

    } catch (e) {
        console.error("Error during verification:", e);
        process.exit(1);
    } finally {
        db.close();
    }
}

verify();
