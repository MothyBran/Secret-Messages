from playwright.sync_api import sync_playwright, expect

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        page.goto("http://localhost:3000/app")

        # Open Sidebar
        page.click("#menuToggle")

        # Wait for animation
        page.wait_for_timeout(500)

        # Open Support Modal
        page.click("#navSupport")

        # Wait for modal
        page.wait_for_selector("#supportModal.active")

        # Verify Placeholder and Hint
        email_input = page.locator("#supportEmail")
        expect(email_input).to_have_attribute("placeholder", "E-Mail (optional bei ID-Angabe)")

        hint = page.locator("#supportEmail + div")
        expect(hint).to_contain_text("Hinweis: Wenn Sie Ihre ID angeben")

        # Screenshot
        page.screenshot(path="verification/support_modal.png")
        browser.close()

if __name__ == "__main__":
    run()
