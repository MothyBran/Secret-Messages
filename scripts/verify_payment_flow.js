const { initializeDatabase, dbQuery } = require('./database/db');

async function runTest() {
    try {
        console.log("🛠️ Initializing DB...");
        await initializeDatabase();

        const sessionId = "cs_test_mock_123456";
        const meta = { is_renewal: "true", product_type: "1m" };
        const finalMeta = JSON.stringify(meta);

        // 1. Simulate Early Insert (pending, no completed_at)
        console.log("🧪 Simulating Early Insert...");
        await dbQuery(
            `INSERT INTO payments (payment_id, amount, currency, status, payment_method, completed_at, metadata)
             VALUES ($1, $2, 'eur', 'pending', 'stripe', $3, $4)`,
            [sessionId, 199, null, finalMeta]
        );

        // Verify Step 1
        const res1 = await dbQuery("SELECT status, completed_at FROM payments WHERE payment_id = $1", [sessionId]);
        const row1 = res1.rows[0];
        console.log("   -> Status:", row1.status);
        console.log("   -> Completed At:", row1.completed_at);

        if (row1.status !== 'pending' || row1.completed_at !== null) {
            throw new Error("❌ Early Insert Verification Failed");
        }
        console.log("✅ Early Insert Correct.");

        // 2. Simulate Webhook Update (completed, now)
        console.log("🧪 Simulating Webhook Update...");
        const now = new Date().toISOString();
        const updateMeta = JSON.stringify({ ...meta, generated_keys: ["KEY-123"] });

        await dbQuery(
            "UPDATE payments SET metadata = $1, status = 'completed', completed_at = $2 WHERE payment_id = $3",
            [updateMeta, now, sessionId]
        );

        // Verify Step 2
        const res2 = await dbQuery("SELECT status, completed_at, metadata FROM payments WHERE payment_id = $1", [sessionId]);
        const row2 = res2.rows[0];
        console.log("   -> Status:", row2.status);
        console.log("   -> Completed At:", row2.completed_at);
        console.log("   -> Metadata:", row2.metadata);

        if (row2.status !== 'completed' || !row2.completed_at || !row2.metadata.includes("KEY-123")) {
            throw new Error("❌ Webhook Update Verification Failed");
        }
        console.log("✅ Webhook Update Correct.");

        // Cleanup
        await dbQuery("DELETE FROM payments WHERE payment_id = $1", [sessionId]);
        console.log("🧹 Cleanup Done.");

    } catch (e) {
        console.error("🚨 TEST FAILED:", e);
        process.exit(1);
    }
}

runTest();
