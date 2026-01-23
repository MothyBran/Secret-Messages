
from playwright.sync_api import sync_playwright

def verify_landing(page):
    page.goto("http://localhost:8080/landing.html")
    page.wait_for_timeout(1000)

    # Mobile
    page.set_viewport_size({"width": 375, "height": 800})
    page.wait_for_timeout(500)
    page.screenshot(path="verification/landing_mobile.png")

if __name__ == "__main__":
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        try:
            verify_landing(page)
        except Exception as e:
            print(f"Error: {e}")
        finally:
            browser.close()
