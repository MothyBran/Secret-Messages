from playwright.sync_api import sync_playwright, expect
import time

def verify_ui_polish():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context()
        page = context.new_page()

        url = "http://localhost:8000/index.html"
        print(f"Navigating to: {url}")

        try:
            page.goto(url)
        except Exception as e:
            print(f"Failed to load page: {e}")
            return

        # Force show mainSection
        page.evaluate("""() => {
            document.querySelectorAll('.section').forEach(el => el.classList.remove('active'));
            document.getElementById('mainSection').classList.add('active');
        }""")

        # 1. Check Scrollbar CSS
        container = page.locator('.wizard-container')
        expect(container).to_be_visible()

        # We need to wait for CSS to load effectively?
        # Playwright waits for load event, should be fine.

        # Check if stylesheet loaded
        css_loaded = page.evaluate("""() => {
            return Array.from(document.styleSheets).some(s => s.href && s.href.includes('ui.css'));
        }""")
        print(f"UI CSS Loaded: {css_loaded}")

        # Get computed style
        # In Chromium, scrollbar-width might not be supported standardly yet, or it might be.
        # But we also added ::-webkit-scrollbar { display: none }.
        # We can't easily check pseudo-element styles via getComputedStyle.
        # But we can check if the element has the class and if the stylesheet has the rule.

        # Check rule existence
        rule_exists = page.evaluate("""() => {
            let found = false;
            for (let sheet of document.styleSheets) {
                try {
                    for (let rule of sheet.cssRules) {
                        if (rule.selectorText === '.wizard-container::-webkit-scrollbar' && rule.style.display === 'none') {
                            found = true;
                        }
                        if (rule.selectorText === '.wizard-container' && rule.style.scrollbarWidth === 'none') {
                            found = true;
                        }
                    }
                } catch(e) {}
            }
            return found;
        }""")
        print(f"Scrollbar hiding rule found in CSSOM: {rule_exists}")

        # 2. Add content to force overflow for Screenshot
        page.evaluate("""() => {
            const container = document.querySelector('.wizard-container');
            if(container) {
                // Create a tall element
                const spacer = document.createElement('div');
                spacer.style.height = '2000px';
                spacer.style.background = 'linear-gradient(to bottom, #111, #333)';
                spacer.innerText = 'FORCED SCROLL CONTENT';
                spacer.style.color = '#fff';
                spacer.style.padding = '20px';
                container.appendChild(spacer);
            }
        }""")

        page.screenshot(path="/home/jules/verification/ui_polish_server.png")
        print("Screenshot taken at /home/jules/verification/ui_polish_server.png")

        browser.close()

if __name__ == "__main__":
    verify_ui_polish()
