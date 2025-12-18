const fetch = require('node-fetch');

async function test() {
    try {
        // 1. Generate Key
        console.log("Generating key...");
        const genRes = await fetch('http://localhost:3000/api/admin/generate-keys', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-admin-password': 'admin123' },
            body: JSON.stringify({ productCode: '1m', count: 1 })
        });
        const genData = await genRes.json();
        console.log("Generate Res:", genRes.status, genData);

        if (!genData.success) return;

        const key = genData.keys[0];
        console.log("Key:", key);

        // 2. Activate Key
        console.log("Activating key...");
        const actRes = await fetch('http://localhost:3000/api/auth/activate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                licenseKey: key,
                username: 'TestUser_' + Date.now(),
                accessCode: '12345',
                deviceId: 'dev-test-123'
            })
        });
        const actData = await actRes.json();
        console.log("Activate Res:", actRes.status, actData);

    } catch (e) {
        console.error("Error:", e);
    }
}

test();
