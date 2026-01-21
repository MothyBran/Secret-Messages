from playwright.sync_api import sync_playwright, expect
import os

def verify_ui_polish():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context()
        page = context.new_page()

        filepath = "file:///app/public/index.html"
        print(f"Navigating to: {filepath}")

        page.goto(filepath)

        # Force show mainSection
        page.evaluate("""() => {
            document.querySelectorAll('.section').forEach(el => el.classList.remove('active'));
            document.getElementById('mainSection').classList.add('active');
        }""")

        # 1. Check Scrollbar CSS
        container = page.locator('.wizard-container')
        expect(container).to_be_visible()

        # Get computed style
        # In headless, scrollbarWidth might report 0 depending on emulation,
        # but we specifically want to check if the CSS property is applied.
        # However, checking 'scrollbar-width' (Firefox) or pseudo-element (Webkit) is tricky via getComputedStyle directly
        # because pseudo-elements aren't directly accessible.
        # We can check if the rule exists in stylesheets, or just visually via screenshot.
        # But 'scrollbar-width: none' should be computable in Firefox context, or ignored in Chrome.
        # Chrome uses ::-webkit-scrollbar.

        # We will try to get the 'scrollbar-width' property.
        # Note: Chrome supports 'scrollbar-width: none' in newer versions? Not fully everywhere yet.
        # But we added both.

        style_check = page.evaluate("""() => {
            const el = document.querySelector('.wizard-container');
            const style = window.getComputedStyle(el);
            return {
                scrollbarWidth: style.scrollbarWidth,
                overflowY: style.overflowY
            };
        }""")
        print(f"Computed Style: {style_check}")

        # 2. Add content to force overflow for Screenshot
        page.evaluate("""() => {
            const container = document.querySelector('.wizard-container');
            if(container) {
                // Create a tall element
                const spacer = document.createElement('div');
                spacer.style.height = '2000px';
                spacer.style.background = 'linear-gradient(to bottom, red, blue)';
                spacer.innerText = 'FORCED SCROLL CONTENT';
                container.appendChild(spacer);
            }
        }""")

        page.screenshot(path="/home/jules/verification/ui_polish.png")
        print("Screenshot taken at /home/jules/verification/ui_polish.png")

        browser.close()

if __name__ == "__main__":
    verify_ui_polish()
