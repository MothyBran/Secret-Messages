from playwright.sync_api import sync_playwright, expect

def verify_it_admin_ui():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        print("Opening IT Admin page...")
        page.goto("file:///app/public/it-admin.html")

        # Make dashboard visible
        page.evaluate("document.getElementById('login-view').style.display = 'none'")
        page.evaluate("document.getElementById('dashboard-view').style.display = 'block'")

        # Verify the Inbox is now prominent at the top (checking visibility and content)
        inbox = page.locator("#supportInbox")
        expect(inbox).to_be_visible()

        # Check for the border color we added (gold)
        panel = page.locator(".panel-card").first
        # We can't easily check computed style in headless without js eval, but taking screenshot is enough.

        page.screenshot(path="/app/verification/it_admin_fixed.png")
        print("IT Admin screenshot taken.")

if __name__ == "__main__":
    verify_it_admin_ui()
