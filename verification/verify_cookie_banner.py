from playwright.sync_api import sync_playwright, expect

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        # Navigate to Landing Page (Localhost)
        page.goto("http://localhost:3000/landing.html")

        # Check Banner Visible
        banner = page.locator("#cookieBanner")
        expect(banner).to_be_visible()

        # Check Buttons
        btn_settings = page.locator("#cookieBtnSettings")
        btn_essential = page.locator("#cookieAcceptEssential")
        btn_accept_all = page.locator("#cookieAcceptAll")

        expect(btn_settings).to_be_visible()
        expect(btn_essential).to_be_visible()
        expect(btn_accept_all).to_be_visible()

        # Take Screenshot 1: Banner Open
        page.screenshot(path="verification/1_cookie_banner_open.png")

        # Open Settings
        btn_settings.click()

        # Check Modal
        modal = page.locator("#cookieSettingsModal")
        expect(modal).to_have_class("modal active")

        # Take Screenshot 2: Settings Modal
        page.screenshot(path="verification/2_cookie_settings_modal.png")

        print("Verification complete. Screenshots saved.")
        browser.close()

if __name__ == "__main__":
    run()
