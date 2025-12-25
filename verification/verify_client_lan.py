from playwright.sync_api import sync_playwright, expect

def test_client_lan(page):
    page.goto("http://localhost:3000/app")

    # Wait for status bar
    page.wait_for_selector("#app-mode-bar")

    # Verify CLOUD mode
    expect(page.locator("#app-mode-label")).to_have_text("MODE: CLOUD")

    # Mock LAN mode via localStorage
    page.evaluate("localStorage.setItem('sm_app_mode', 'hub')")
    page.reload()

    # Verify LAN-SERVER mode
    page.wait_for_selector("#app-mode-bar")
    expect(page.locator("#app-mode-label")).to_contain_text("MODE: LAN-SERVER")

    # Verify Input Field for HUB IP
    expect(page.locator("#lan_config")).to_be_visible()

    # Take screenshot
    page.screenshot(path="verification/client_lan.png")

if __name__ == "__main__":
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        try:
            test_client_lan(page)
        except Exception as e:
            print(e)
            page.screenshot(path="verification/error_client.png")
        finally:
            browser.close()
