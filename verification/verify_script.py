
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

        # Inject long text
        long_text = "This is a test message. " * 500
        page.fill("#messageInput", long_text)

        time.sleep(1)

        # --- DEBUGGING PARENT WIDTHS ---
        print("--- Debugging Widths ---")

        # Function to get computed style property
        def get_computed(selector, prop):
            return page.evaluate(f"window.getComputedStyle(document.querySelector('{selector}')).{prop}")

        # Function to get client rect width
        def get_width(selector):
            return page.evaluate(f"document.querySelector('{selector}').getBoundingClientRect().width")

        elements = [".app-main-wrapper", "#mainSection", ".wizard-container", "#messageInput"]

        for el in elements:
            try:
                w = get_width(el)
                mw = get_computed(el, "maxWidth")
                disp = get_computed(el, "display")
                print(f"{el}: Width={w}px, MaxWidth={mw}, Display={disp}")
            except Exception as e:
                print(f"{el}: Not found or error: {e}")

        # Check scrollbar
        sb = get_computed(".wizard-container", "scrollbarWidth")
        print(f"Scrollbar Width Style: {sb}")

        # Take screenshot
        page.screenshot(path="verification/ui_debug.png", full_page=True)

        browser.close()

if __name__ == "__main__":
    verify_ui_changes()
