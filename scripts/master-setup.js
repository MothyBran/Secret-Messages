const { execSync } = require('child_process');
const path = require('path');

/**
 * MASTER SETUP ORCHESTRATOR
 * Executes the setup steps in order: Install -> Database -> Assets -> Test
 */

function runCommand(scriptName) {
    const scriptPath = path.join(__dirname, scriptName);
    console.log(`\n▶️  Running: ${scriptName}`);
    try {
        // We run these as child processes to ensure clean environment and error handling
        execSync(`node "${scriptPath}"`, { stdio: 'inherit' });
    } catch (e) {
        console.error(`\n❌ Failed to execute ${scriptName}`);
        if (scriptName === 'ensure-db-schema.js') {
            console.error("   ⚠️ This might be due to a missing 'sqlite3' module.");
            console.error("   ⚠️ Try running 'npm install sqlite3 --save' to fix this.");
        }
        process.exit(1);
    }
}

async function masterSetup() {
    console.log("🚀 Starting Master Setup for Stealth-Core Ecosystem...\n");

    // 1. Database
    runCommand('ensure-db-schema.js');

    // 2. Assets
    runCommand('prepare-assets.js');

    // 3. Smoke Test
    runCommand('smoke-test.js');

    console.log("\n🏁 Master Setup Completed Successfully!");
    console.log("   You can now start the application with 'npm start'");
}

masterSetup();
