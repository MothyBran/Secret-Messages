const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// 1. Setup Mock Tor
const mockTorPath = path.join(__dirname, 'tor'); // Name it 'tor' so it's found
fs.writeFileSync(mockTorPath, `#!/bin/sh\necho "Tor version 9.9.9"`);
fs.chmodSync(mockTorPath, 0o755);

// 2. Add to PATH
const originalPath = process.env.PATH;
process.env.PATH = __dirname + path.delimiter + originalPath;

try {
    // 3. Import torManager
    // We need to flush cache to ensure it picks up the new PATH if it caches anything (it doesn't)
    delete require.cache[require.resolve('../utils/torManager')];
    const torManager = require('../utils/torManager');

    // 4. Run prepare
    console.log("--- Testing Tor detection in PATH ---");
    // Capture console output to verify "Tor found in PATH"
    const originalLog = console.log;
    let logOutput = "";
    console.log = (msg) => {
        logOutput += msg + "\n";
        originalLog(msg);
    };

    const result = torManager.prepare();

    console.log = originalLog; // Restore

    if (result === true) {
        if (logOutput.includes("Tor found in PATH")) {
             console.log("✅ Tor detection passed: Found in PATH and verified version.");
        } else {
             console.warn("⚠️ Tor detected but log message missing?");
        }
    } else {
        console.error("❌ Tor detection failed (not found)");
        process.exit(1);
    }

} catch (e) {
    console.error("❌ Test failed with error:", e);
    process.exit(1);
} finally {
    // Cleanup
    if (fs.existsSync(mockTorPath)) fs.unlinkSync(mockTorPath);
    process.env.PATH = originalPath;
}
