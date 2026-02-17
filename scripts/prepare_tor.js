const torManager = require('../utils/torManager');

try {
    torManager.prepare();
    console.log("✅ Tor configuration prepared.");
} catch (e) {
    console.error("❌ Failed to prepare Tor configuration:", e);
    process.exit(1);
}
