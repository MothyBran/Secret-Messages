from playwright.sync_api import sync_playwright
import time

def verify_tor_ui():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context()
        page = context.new_page()

        print("Navigating to app...")
        # 1. Load Page (Guest Mode)
        page.goto("http://localhost:3000/app")
        page.wait_for_load_state("networkidle")

        # Verify Icon is HIDDEN for guest
        onion_icon = page.locator("#footerOnionIcon")
        if onion_icon.is_visible():
            print("❌ Error: Onion icon visible for guest!")
        else:
            print("✅ Onion icon hidden for guest.")

        # 2. Simulate Login
        print("Simulating login...")
        page.evaluate("localStorage.setItem('sm_token', 'mock_token')")
        page.evaluate("localStorage.setItem('sm_user', JSON.stringify({name: 'TestUser', sm_id: 123, badge: 'User'}))")

        # Mock API calls
        page.route("**/api/auth/validate", lambda route: route.fulfill(json={"valid": True, "username": "TestUser", "expiresAt": "lifetime"}))
        page.route("**/api/config", lambda route: route.fulfill(json={"mode": "CLOUD", "onionAddress": "testv3onionaddress.onion"}))
        page.route("**/api/messages", lambda route: route.fulfill(json=[]))
        page.route("**/api/checkAccess?*", lambda route: route.fulfill(json={"status": "active"}))

        page.reload()
        # Wait for updateSidebarInfo to run (it runs after validate)
        time.sleep(2)

        # 3. Verify Icon VISIBLE for user
        if onion_icon.is_visible():
            print("✅ Onion icon visible for user.")
        else:
            print("❌ Error: Onion icon NOT visible for user! (Check updateSidebarInfo logic)")

        # 4. Click Icon -> Verify Modal
        print("Clicking icon...")
        onion_icon.click()
        time.sleep(1)
        modal = page.locator("#torAccessModal")
        if modal.is_visible():
            print("✅ Tor Modal opened.")
            addr_disp = page.locator("#onionAddressDisplay")
            text = addr_disp.inner_text()
            if "testv3onionaddress.onion" in text:
                print("✅ Modal shows correct address.")
            else:
                print(f"❌ Modal text mismatch: {text}")
        else:
            print("❌ Tor Modal did not open.")

        page.screenshot(path="/home/jules/verification/tor_ui_verification.png")
        print("📸 Screenshot saved.")

        browser.close()

if __name__ == "__main__":
    verify_tor_ui()
