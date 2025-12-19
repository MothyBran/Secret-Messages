from playwright.sync_api import sync_playwright, expect
import time

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(viewport={'width': 1280, 'height': 800})
        page = context.new_page()

        # 1. Open App
        page.goto("http://localhost:3000/app")

        # 2. Open Support Modal
        page.click("#menuToggle")
        time.sleep(0.5)
        page.click("#navSupport")
        time.sleep(0.5)

        # 3. Fill Form
        page.fill("#supportUsername", "ResponseTest")
        page.fill("#supportSubject", "Response Check")
        page.fill("#supportEmail", "response@test.com")
        page.fill("#supportMessage", "Checking if loading state resolves.")

        # 4. Submit
        page.click("#supportForm button[type='submit']")

        # 5. Check if disabled immediately
        if not page.is_disabled("#supportMessage"):
            print("Error: Field not disabled on submit")

        # 6. Wait for response (Error expected due to missing credentials, but response must come)
        # The alert will appear. We want to verify the form unlocks.
        time.sleep(5)

        # 7. Check if enabled again
        if page.is_enabled("#supportMessage"):
            print("Verified: Form unlocked after server response.")
        else:
            print("Error: Form still locked!")

        page.screenshot(path="/home/jules/verification/support_response_handled.png")

        browser.close()

if __name__ == "__main__":
    run()
