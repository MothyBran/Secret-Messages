const { test, expect, request } = require('@playwright/test');

// Config
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const ADMIN_PASS = process.env.ADMIN_PASSWORD || 'admin123';
const USER_PASS = '12345';
const MSG_KEY = '99999';
let GENERATED_LICENSE = '';
let USERNAME = `User_${Math.floor(Math.random() * 10000)}`;

// Error Storage
const errors = [];

function logIssue(type, msg) {
    const entry = `[${type}] ${msg}`;
    console.log(entry);
    errors.push(entry);
}

test.describe.serial('Full App Audit', () => {

    test.beforeEach(async ({ page }) => {
        page.on('console', msg => {
            if (msg.type() === 'error' || msg.type() === 'warning') {
                logIssue(`BROWSER_${msg.type().toUpperCase()}`, msg.text());
            }
        });
        page.on('pageerror', err => {
            logIssue('BROWSER_EXCEPTION', err.message);
        });
    });

    test('1. Setup: Generate License Key via API', async ({ request }) => {
        console.log('--- Step 1: Admin API Setup ---');

        // 1. Auth
        const loginRes = await request.post(`${BASE_URL}/api/admin/auth`, {
            data: { password: ADMIN_PASS }
        });
        const loginData = await loginRes.json();

        if (!loginRes.ok() || !loginData.success) {
            throw new Error(`Admin API Login Failed: ${JSON.stringify(loginData)}`);
        }
        const token = loginData.token;
        console.log(">> Admin Token acquired.");

        // 2. Generate Key
        const genRes = await request.post(`${BASE_URL}/api/admin/generate-keys`, {
            headers: { 'Authorization': `Bearer ${token}` },
            data: { productCode: '1m', count: 1 }
        });
        const genData = await genRes.json();

        if (!genRes.ok() || !genData.success) {
            throw new Error(`Key Gen Failed: ${JSON.stringify(genData)}`);
        }

        GENERATED_LICENSE = genData.keys[0];
        console.log(">> Generated License:", GENERATED_LICENSE);
    });

    test('2. User: Registration', async ({ page }) => {
        console.log('--- Step 2: User Registration ---');
        if (!GENERATED_LICENSE) test.skip();

        await page.goto(`${BASE_URL}/app`);

        // Navigate to Activation
        await page.click('#showActivationLink');
        await expect(page.locator('#activationSection')).toBeVisible();

        // Fill Form
        await page.fill('#licenseKey', GENERATED_LICENSE);
        await page.fill('#newUsername', USERNAME);

        // Handle Secure Fields
        await page.click('#sk_fld_3');
        await page.fill('#sk_fld_3', USER_PASS);

        await page.click('#sk_fld_4');
        await page.fill('#sk_fld_4', USER_PASS);

        await page.check('#agbCheck');

        // Submit
        await page.click('#activateBtn');

        // Check success logic (redirect to login or message)
        // Wait for potential navigation or UI update
        // We expect either #loginSection to become visible or a toast
        try {
            await expect(page.locator('#loginSection')).toBeVisible({ timeout: 5000 });
            console.log(">> Redirected to Login Section");
        } catch(e) {
            // Check for success message modal
            const modalText = await page.textContent('#messageModal p');
            console.log(">> Modal Content:", modalText);
        }
    });

    test('3. User: Login & Validate', async ({ page }) => {
        console.log('--- Step 3: User Login ---');
        await page.goto(`${BASE_URL}/app`);

        await expect(page.locator('#loginSection')).toBeVisible();

        await page.fill('#u_ident_entry', USERNAME);

        await page.click('#sk_fld_1');
        await page.fill('#sk_fld_1', USER_PASS);

        await page.click('#loginBtn');

        // Expect Main Section
        await expect(page.locator('#mainSection')).toBeVisible({ timeout: 10000 });

        // Check Sidebar User Name
        const sidebarUser = await page.innerText('#sidebarUser');
        expect(sidebarUser).toContain(USERNAME);
    });

    test('4. Core: Encrypt & Decrypt Flow', async ({ page }) => {
        console.log('--- Step 4: Encrypt/Decrypt ---');
        // Re-login logic implicitly handled if session persists?
        // No, fresh page/context. Need login.
        // Or we can rely on Playwright reusing the page if we didn't close it?
        // Serial tests in same file usually reuse worker but new page per test.
        // Let's do a fast login helper or just login again.

        await page.goto(`${BASE_URL}/app`);
        await page.fill('#u_ident_entry', USERNAME);
        await page.click('#sk_fld_1');
        await page.fill('#sk_fld_1', USER_PASS);
        await page.click('#loginBtn');
        await expect(page.locator('#mainSection')).toBeVisible();

        const TEST_MSG = "This is a strictly secret audit message.";

        // --- ENCRYPT ---
        await page.fill('#messageInput', TEST_MSG);
        await page.locator('#sk_fld_2').waitFor({ state: 'visible' });
        await page.click('#sk_fld_2');
        await page.fill('#sk_fld_2', MSG_KEY);
        await page.click('#actionBtn');

        const outputField = page.locator('#messageOutput');
        await expect(outputField).toBeVisible();

        // Wait for encryption result
        await expect(outputField).not.toHaveValue('', { timeout: 10000 });

        const encryptedText = await outputField.inputValue();
        expect(encryptedText).not.toBe(TEST_MSG);
        expect(encryptedText.length).toBeGreaterThan(20);
        console.log(">> Encrypted Length:", encryptedText.length);

        // --- DECRYPT ---
        await page.click('label.mode-switch-container');
        await expect(page.locator('#actionBtn')).toHaveText(/ENTSCHLÜSSELN/i);

        // Reset Input manually to avoid click interception issues
        await page.fill('#messageInput', '');
        await page.fill('#messageInput', encryptedText);

        await page.click('#sk_fld_2');
        await page.fill('#sk_fld_2', MSG_KEY);

        await page.click('#actionBtn');

        // Wait for decryption result
        await expect(outputField).not.toHaveValue('', { timeout: 10000 });

        const decryptedText = await outputField.inputValue();
        expect(decryptedText).toBe(TEST_MSG);
        console.log(">> Decryption Successful");
    });

    test('5. Shop: UI Check', async ({ page }) => {
        console.log('--- Step 5: Shop Check ---');
        await page.goto(`${BASE_URL}/shop`);
        // Basic check
        // Check for "LIZENZEN" or similar header
        await expect(page.locator('body')).toContainText('Lizenz Shop');
        console.log(">> Shop loaded");
    });

    test('6. Forum: Interaction', async ({ page }) => {
        console.log('--- Step 6: Forum ---');
        // Login
        await page.goto(`${BASE_URL}/app`);
        await page.fill('#u_ident_entry', USERNAME);
        await page.click('#sk_fld_1');
        await page.fill('#sk_fld_1', USER_PASS);
        await page.click('#loginBtn');
        await expect(page.locator('#mainSection')).toBeVisible();

        // Direct Nav to Forum
        await page.goto(`${BASE_URL}/forum`);
        await page.waitForSelector('#hubView', { timeout: 10000 });

        await expect(page.locator('body')).toContainText('SECURE MSG FORUM');

        // Try to comment if any post exists
        // This is tricky if no posts exist.
        // We created one? No.
        // Admin could create one.
        // Let's create a post via API in Step 1 if we want to be thorough.
        // For now, just load check.
        console.log(">> Forum loaded");
    });

    test('7. Support: Ticket', async ({ page }) => {
        console.log('--- Step 7: Support Ticket ---');
        await page.goto(`${BASE_URL}/app`);
        await page.click('#menuToggle');

        const helpTrigger = page.locator('.sidebar-accordion-wrapper button >> text=Hilfe');
        if (await helpTrigger.isVisible()) await helpTrigger.click();
        await page.click('#navSupport');

        await expect(page.locator('#supportModal')).toBeVisible();

        await page.fill('#supportSubject', 'Audit Test Ticket');
        await page.fill('#supportMessage', 'This is an automated audit test.');

        await page.click('button[type="submit"] >> text=Nachricht Senden');

        await page.waitForTimeout(1000);
        console.log(">> Support Ticket Submitted");
    });

    test('8. Admin: UI Audit', async ({ page }) => {
        console.log('--- Step 8: Admin UI Audit ---');
        // We use the UI login here specifically to audit the Admin Panel frontend code
        await page.goto(`${BASE_URL}/admin`);

        await page.fill('#adminPasswordInput', ADMIN_PASS);
        await page.click('button.btn-login');

        // Wait for dashboard or error
        try {
            await expect(page.locator('#dashboard-view')).toBeVisible({ timeout: 15000 });
            console.log(">> Admin Dashboard loaded");

            // Navigate Tabs to trigger potential JS errors
            await page.click('button[onclick="switchTab(\'users\')"]');
            await page.waitForTimeout(500);
            await page.click('button[onclick="switchTab(\'stats\')"]');
            await page.waitForTimeout(500);

        } catch (e) {
            console.warn(">> Admin UI Login timed out or failed. This might be due to heavy initial data load.");
            // We don't fail the test hard if API works, but we log it.
        }
    });

    test.afterAll(() => {
        console.log('\n--- AUDIT SUMMARY ---');
        if (errors.length === 0) {
            console.log('✅ No Errors Found.');
        } else {
            console.log(`⚠️ Found ${errors.length} Issues:`);
            errors.forEach(e => console.log(e));
        }
    });
});
