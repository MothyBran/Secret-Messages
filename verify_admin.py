from playwright.sync_api import sync_playwright

def verify_admin_tabs():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        # Navigate to Admin
        page.goto("http://localhost:3000/admin")

        # Login
        page.fill("#adminPasswordInput", "admin123")
        page.click("button.btn-login")

        # Verify Dashboard Tab Active
        page.wait_for_selector("#tab-dashboard.active")

        # Take Screenshot 1: Dashboard
        page.screenshot(path="/home/jules/verification/admin_dashboard.png")
        print("Dashboard screenshot taken.")

        # Switch to Licenses Tab
        page.click("button.nav-tab:has-text('Lizenzen')")
        page.wait_for_selector("#tab-licenses.active")

        # Verify New Bundle Section
        page.wait_for_selector("h2.section-title:has-text('B: Bundle / Sell-Tool')")

        # Take Screenshot 2: Licenses
        page.screenshot(path="/home/jules/verification/admin_licenses.png")
        print("Licenses screenshot taken.")

        # Switch to Maintenance Tab
        page.click("button.nav-tab:has-text('Wartung')")
        page.wait_for_selector("#tab-maintenance.active")

        # Verify Shop Toggle
        page.wait_for_selector("h3:has-text('Shop Status')")

        # Take Screenshot 3: Maintenance
        page.screenshot(path="/home/jules/verification/admin_maintenance.png")
        print("Maintenance screenshot taken.")

        browser.close()

if __name__ == "__main__":
    verify_admin_tabs()
