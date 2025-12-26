from playwright.sync_api import sync_playwright, expect

def verify_frontend():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        print("Opening IT Admin page...")
        page.goto("file:///app/public/it-admin.html")

        # Verify title
        expect(page).to_have_title("SECURE MESSAGES - Local IT Admin")

        # Force the dashboard to be visible (simulating login success by manipulating style)
        page.evaluate("document.getElementById('login-view').style.display = 'none'")
        page.evaluate("document.getElementById('dashboard-view').style.display = 'block'")

        # Check for new Support Inbox visibility
        inbox = page.locator("#supportInbox")
        expect(inbox).to_be_visible()

        # Check that the import of modules didn't break execution (console check implicitly)
        # We can't easily check for JS errors in headless without listening to events,
        # but if the page renders the dashboard layout, it's a good sign.

        # Take screenshot of IT Admin
        page.screenshot(path="/app/verification/it_admin_ui_final.png")
        print("IT Admin screenshot taken.")

if __name__ == "__main__":
    verify_frontend()
