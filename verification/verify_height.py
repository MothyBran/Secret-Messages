
from playwright.sync_api import sync_playwright
import time

def verify_ui_changes():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        # Explicitly set viewport size context immediately
        context = browser.new_context(viewport={'width': 1920, 'height': 1080})
        page = context.new_page()

        # Navigate to the local server
        page.goto("http://localhost:8080/public/index.html")

        # Manually switch to main section to bypass login logic
        page.evaluate("""
            document.getElementById('loginSection').classList.remove('active');
            document.getElementById('mainSection').classList.add('active');
        """)

        # Wait for the wizard container to be visible
        page.wait_for_selector(".wizard-container", state="visible")

        # Inject long text to ensure content is sufficient to trigger scrolling
        long_text = "This is a test message. " * 500
        page.fill("#messageInput", long_text)

        time.sleep(1)

        # --- DEBUGGING HEIGHTS ---
        print("--- Debugging Heights ---")

        def get_computed(selector, prop):
            return page.evaluate(f"window.getComputedStyle(document.querySelector('{selector}')).{prop}")

        height = get_computed("#messageInput", "height")
        overflow = get_computed("#messageInput", "overflowY")

        print(f"#messageInput Height: {height}")
        print(f"#messageInput OverflowY: {overflow}")

        # Verify action button visibility (Above the Fold)
        # We check if the action button's bottom position is less than the viewport height
        action_btn_rect = page.evaluate("document.getElementById('actionBtn').getBoundingClientRect()")
        viewport_height = page.viewport_size['height']

        # Note: actionBtn might be hidden initially, so we need to check if we can make it visible or if the layout space allows it.
        # But 'messageInput' height is the key.

        # Take screenshot
        page.screenshot(path="verification/ui_height_debug.png", full_page=True)

        browser.close()

if __name__ == "__main__":
    verify_ui_changes()
