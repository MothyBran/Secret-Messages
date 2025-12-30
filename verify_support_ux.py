from playwright.sync_api import sync_playwright, expect
import time

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(viewport={'width': 1280, 'height': 800})
        page = context.new_page()

        # 1. Open App
        page.goto("http://localhost:3000/app")

        # 2. Open Sidebar & Support Modal
        page.click("#menuToggle")
        time.sleep(0.5)
        page.click("#navSupport")
        time.sleep(0.5)

        # 3. Check Privacy Modal Z-Index / Visibility
        # Click the link inside the support form
        print("Opening Privacy Modal from Support Modal...")
        page.click("#supportForm a[onclick*='privacyModal']")
        time.sleep(0.5)

        # Check if Privacy Modal is visible and on top
        # We can check z-index directly
        z_index = page.eval_on_selector("#privacyModal", "el => getComputedStyle(el).zIndex")
        print(f"Privacy Modal Z-Index: {z_index}")
        if int(z_index) > 1000:
            print("Z-Index check passed.")
        else:
            print("Z-Index check FAILED.")

        # Close Privacy
        page.click("#privacyModal button")
        time.sleep(0.5)

        # 4. Fill Form & Submit -> Check Lock
        page.fill("#supportUsername", "LockTest")
        page.fill("#supportSubject", "Locking")
        page.fill("#supportEmail", "lock@test.com")
        page.fill("#supportMessage", "Testing UI Lock.")

        print("Submitting form...")
        page.click("#supportForm button[type='submit']")

        # Immediately check if input is disabled
        is_disabled = page.is_disabled("#supportMessage")
        if is_disabled:
            print("UI Locking verified: Input is disabled.")
        else:
            print("UI Locking FAILED: Input is enabled.")

        # Wait for error (since no creds) and verify unlock
        time.sleep(5) # Wait for timeout/error
        # Dismiss alert if any (Playwright dismisses by default, but we need to check state after)

        is_enabled_now = page.is_enabled("#supportMessage")
        if is_enabled_now:
             print("UI Unlocking verified: Input is enabled again.")
        else:
             print("UI Unlocking FAILED: Input is still disabled.")

        browser.close()

if __name__ == "__main__":
    run()
