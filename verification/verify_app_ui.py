from playwright.sync_api import sync_playwright, expect

def test_app_ui(page):
    page.goto("http://localhost:3000/app")

    # Wait for status bar
    page.wait_for_selector("#app-mode-bar")

    # Verify CLOUD mode
    element = page.locator("#app-mode-label")
    expect(element).to_have_text("MODE: CLOUD")

    # Take screenshot
    page.screenshot(path="verification/app_ui.png")

if __name__ == "__main__":
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        try:
            test_app_ui(page)
        except Exception as e:
            print(e)
            page.screenshot(path="verification/error_app.png")
        finally:
            browser.close()
