from playwright.sync_api import sync_playwright, expect
import time

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        # 1. Admin Verification
        context_admin = browser.new_context()
        page_admin = context_admin.new_page()

        # Login to Admin
        page_admin.goto("http://localhost:3000/admin")
        page_admin.fill("#adminPasswordInput", "admin123")
        page_admin.click(".btn-login")

        # Navigate to Mail Service
        page_admin.click("button:has-text('Mail Service')")
        time.sleep(1)

        # Verify Inbox Layout
        page_admin.screenshot(path="verification/admin_mail_inbox.png")
        print("Admin Inbox Screenshot taken.")

        # 2. User Verification (Mock)
        # Since we can't easily register a user in this script without complex flow,
        # we will rely on unit tests for the user flow or check if we can inspect the DOM for badges
        # But we can verify the Admin UI rendering at least.

        browser.close()

if __name__ == "__main__":
    run()
