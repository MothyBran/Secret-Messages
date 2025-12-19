from playwright.sync_api import sync_playwright, expect
import time

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(viewport={'width': 1280, 'height': 1200})
        page = context.new_page()

        # 1. Open App
        page.goto("http://localhost:3000/app")

        # 2. Open Sidebar & Support Modal
        page.wait_for_selector("#menuToggle")
        page.click("#menuToggle")
        time.sleep(0.5)
        page.click("#navSupport")
        time.sleep(0.5)

        # 3. Privacy Modal Z-Index Check
        page.click("#supportForm a[onclick*='privacyModal']")
        time.sleep(0.5)
        page.screenshot(path="/home/jules/verification/privacy_overlay.png")
        print("Screenshot: privacy_overlay.png")
        page.click("#privacyModal button")
        time.sleep(0.5)

        # 4. Fill & Submit (Lock Check)
        page.fill("#supportUsername", "LockTest")
        page.fill("#supportSubject", "Locking")
        page.fill("#supportEmail", "lock@test.com")
        page.fill("#supportMessage", "Testing UI Lock.")

        page.click("#supportForm button[type='submit']")
        page.screenshot(path="/home/jules/verification/support_locked.png")
        print("Screenshot: support_locked.png")

        # 5. Wait for Error (Unlock Check)
        time.sleep(5)
        page.screenshot(path="/home/jules/verification/support_error_unlocked.png")
        print("Screenshot: support_error_unlocked.png")

        browser.close()

if __name__ == "__main__":
    run()
