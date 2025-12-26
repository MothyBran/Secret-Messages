from playwright.sync_api import sync_playwright, expect
import time

def verify_admin_licenses():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        print("Opening Admin Page...")
        page.goto("file:///app/public/admin.html")

        # Bypass Login
        page.evaluate("document.getElementById('login-view').style.display = 'none'")
        page.evaluate("document.getElementById('dashboard-view').style.display = 'block'")

        # Force tab active class manually
        page.evaluate("document.getElementById('tab-licenses').classList.add('active')")

        # Verify Structure
        expect(page.get_by_text("A: Einzelne Lizenzen")).to_be_visible()
        expect(page.get_by_text("B: Standard Bundles")).to_be_visible()
        expect(page.get_by_text("C: Enterprise Lizenzen")).to_be_visible()

        # Check Global Refresh Button
        expect(page.locator("#refreshAllLicensesBtn")).to_be_visible()

        # Take Screenshot
        page.screenshot(path="/app/verification/admin_licenses_restructure.png")
        print("Screenshot taken.")

if __name__ == "__main__":
    verify_admin_licenses()
