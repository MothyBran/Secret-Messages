from playwright.sync_api import sync_playwright

def verify_changes():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        # 1. Verify Landing Page "How it Works" section
        print("Verifying Landing Page...")
        page.goto("http://localhost:3001/")
        page.wait_for_selector(".step-card")
        page.screenshot(path="verification/landing_steps.png")
        print("Landing page screenshot taken.")

        # 2. Verify Admin Login 2FA Field
        print("Verifying Admin Login...")
        page.goto("http://localhost:3001/admin")

        # wait for DOM ready
        page.wait_for_selector("text=ADMIN CORE")

        # By default input is hidden.
        # But wait_for_selector waits for Visible by default if no state arg? No, defaults to 'attached'.
        # However, line 20 says `page.wait_for_selector("#admin2faInput")`. The error says locator resolved to hidden element.
        # This implies it found it, but then maybe I'm calling click next which fails?
        # Actually, the error says Timeout exceeded waiting for locator("#admin2faInput") to be visible.
        # Ah, wait_for_selector defaults to state='visible' in python playwright? No, docs say 'visible' is default state.
        # So I need to use state='attached' first if I want to confirm existence before clicking toggle.

        # Click the toggle
        page.click("text=+ 2FA Code")

        # NOW wait for it to be visible
        page.wait_for_selector("#admin2faInput", state="visible")

        page.screenshot(path="verification/admin_login.png")
        print("Admin login screenshot taken.")

        browser.close()

if __name__ == "__main__":
    verify_changes()
