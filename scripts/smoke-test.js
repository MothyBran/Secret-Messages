const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

/**
 * SMOKE TEST / INTEGRITY CHECK
 * Static analysis of critical files and modules to ensure the system can start.
 * Does NOT start the server to avoid port conflicts.
 */

async function runSmokeTest() {
    console.log("🔍 Running System Integrity Check (Smoke Test)...");
    const rootDir = path.join(__dirname, '..');
    let errors = [];

    // 1. Critical Files Existence
    const criticalFiles = [
        'server.js',
        'server-enterprise.js',
        'package.json',
        'public/index.html',
        'public/app.js',
        'public/assets/js/chart.js' // Should be there after prepare-assets
    ];

    console.log("   Checking critical files...");
    criticalFiles.forEach(file => {
        if (!fs.existsSync(path.join(rootDir, file))) {
            errors.push(`Missing file: ${file}`);
        }
    });

    // 2. Syntax Check (Node -c)
    // Prevents "SyntaxError" on startup
    const scriptFiles = [
        'server.js',
        'server-enterprise.js',
        'public/app.js'
    ];

    console.log("   Verifying syntax...");
    scriptFiles.forEach(file => {
        try {
            // Using node -c (check syntax)
            execSync(`node -c "${path.join(rootDir, file)}"`, { stdio: 'ignore' });
        } catch (e) {
            errors.push(`Syntax Error in ${file}`);
        }
    });

    // 3. Module Resolution Check (Static)
    // We check if we can resolve main entry points without executing them
    try {
        require.resolve('../server.js');
        require.resolve('../server-enterprise.js');
    } catch (e) {
        errors.push(`Module resolution failed: ${e.message}`);
    }

    if (errors.length > 0) {
        console.error("❌ Smoke Test FAILED with the following errors:");
        errors.forEach(e => console.error(`   - ${e}`));
        process.exit(1);
    } else {
        console.log("✅ Smoke Test Passed. System integrity looks good.");
    }
}

if (require.main === module) {
    runSmokeTest();
}

module.exports = runSmokeTest;
