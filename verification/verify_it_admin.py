from playwright.sync_api import sync_playwright, expect

def test_it_admin(page):
    page.goto("http://localhost:3000/it-admin.html")

    # Check Login
    expect(page.get_by_text("LOCAL IT ADMIN")).to_be_visible()

    # Login (Uses same backend mock auth for now)
    page.fill("#itPasswordInput", "admin123")
    page.click("button.btn-login")

    # Wait for dashboard
    page.wait_for_selector("#dashboard-view")

    # Check Elements
    expect(page.get_by_text("Local LAN Hub")).to_be_visible()
    expect(page.get_by_text("Master Key Export")).to_be_visible()

    # Start Hub
    page.click("#btnStartHub")
    expect(page.get_by_text("Running on ws://")).to_be_visible()

    # Take screenshot
    page.screenshot(path="verification/it_admin_dashboard.png")

if __name__ == "__main__":
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        try:
            test_it_admin(page)
        except Exception as e:
            print(e)
            page.screenshot(path="verification/error_it.png")
        finally:
            browser.close()
