from playwright.sync_api import sync_playwright
import time

def verify_shop_offline():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        # 1. Turn Shop OFF via Admin
        page.goto("http://localhost:3000/admin")
        page.fill("#adminPasswordInput", "admin123")
        page.click("button.btn-login")
        page.click("button.nav-tab:has-text('Wartung')")

        # Check current status
        status_text = page.locator("#shopStateText").text_content()
        print(f"Current Admin Status: {status_text}")

        # If it's AKTIV, toggle it.
        if "AKTIV" in status_text:
            # Click the wrapper label instead of input
            page.click("label.toggle-switch:has(#shopToggle)")
            time.sleep(2) # Wait for fetch
            print("Toggled shop to OFF")

        # 2. Check Shop Page
        page.goto("http://localhost:3000/shop")
        page.wait_for_selector("#shopOfflineBanner")

        # Check visibility
        is_banner_visible = page.is_visible("#shopOfflineBanner")
        is_content_hidden = not page.is_visible(".license-grid") # Should be hidden

        print(f"Banner Visible: {is_banner_visible}")
        print(f"Content Hidden: {is_content_hidden}")

        page.screenshot(path="/home/jules/verification/shop_offline.png")

        browser.close()

if __name__ == "__main__":
    verify_shop_offline()
