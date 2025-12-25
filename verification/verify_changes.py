from playwright.sync_api import sync_playwright, expect

def verify_frontend():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)

        # 1. Verify Admin Mail Service Fix
        context = browser.new_context()
        page = context.new_page()
        try:
            print("Verifying Admin Mail Service...")
            page.goto("http://localhost:3000/admin")

            # Login
            page.fill("#adminPasswordInput", "admin123")
            page.click("button.btn-login")

            # Wait for dashboard
            expect(page.locator("#dashboard-view")).to_be_visible(timeout=5000)

            # Go to Mail tab
            page.click("button[onclick=\"switchTab('mail')\"]")

            # Go to Compose
            page.click("#btnMailCompose")

            # Check for msgExpiry input
            expiry_input = page.locator("#msgExpiry")
            expect(expiry_input).to_be_visible()
            print("SUCCESS: msgExpiry input found in Admin Panel.")

            page.screenshot(path="verification/admin_mail_fix.png")

        except Exception as e:
            print(f"FAILED Admin verification: {e}")
            page.screenshot(path="verification/admin_fail.png")

        # 2. Verify Contact Backup Modal & Landing Page
        context2 = browser.new_context()
        page2 = context2.new_page()
        try:
            print("Verifying Contact Backup Modal...")
            page2.goto("http://localhost:3000/app")

            # We can't easily see sidebar without login, but we can verify Modal existence in DOM
            # Trigger modal via JS console since buttons are hidden or require auth
            page2.evaluate("document.getElementById('backupModal').classList.add('active')")

            expect(page2.locator("#backupModal")).to_be_visible()
            expect(page2.locator("#backupCode")).to_be_visible()
            print("SUCCESS: Backup Modal found.")

            page2.screenshot(path="verification/backup_modal.png")

            # Verify Landing Page Animations (Static check for elements)
            print("Verifying Landing Page Elements...")
            page2.goto("http://localhost:3000/")
            page2.mouse.wheel(0, 1000) # Scroll down
            page2.wait_for_timeout(1000)

            # Check for step cards and connector
            expect(page2.locator(".step-card").first).to_be_visible()
            expect(page2.locator(".connector")).to_be_visible()
            print("SUCCESS: Landing Page elements found.")

            page2.screenshot(path="verification/landing_page.png")

        except Exception as e:
            print(f"FAILED Frontend verification: {e}")
            page2.screenshot(path="verification/frontend_fail.png")

        browser.close()

if __name__ == "__main__":
    verify_frontend()
