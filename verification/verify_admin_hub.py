from playwright.sync_api import sync_playwright, expect

def test_admin_enterprise(page):
    # Login as Admin
    page.goto("http://localhost:3000/admin")

    # Check if login required
    if page.is_visible("#login-view"):
        page.fill("#adminPasswordInput", "admin123")
        page.click("button.btn-login")

    # Wait for dashboard
    page.wait_for_selector("#dashboard-view")

    # Navigate to Enterprise tab
    page.click("button:has-text('Enterprise')")

    # Verify Hub UI
    expect(page.get_by_text("Local LAN Hub")).to_be_visible()
    expect(page.get_by_text("Master Key List Export")).to_be_visible()

    # Test Hub Start
    page.click("#btnStartHub")
    expect(page.get_by_text("Status: Running")).to_be_visible()

    # Take screenshot
    page.screenshot(path="verification/admin_enterprise.png")

if __name__ == "__main__":
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        try:
            test_admin_enterprise(page)
        except Exception as e:
            print(e)
            page.screenshot(path="verification/error.png")
        finally:
            browser.close()
