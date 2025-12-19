from playwright.sync_api import sync_playwright

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        # Listen for console logs
        page.on("console", lambda msg: print(f"CONSOLE: {msg.text}"))
        page.on("pageerror", lambda exc: print(f"PAGE ERROR: {exc}"))

        try:
            page.goto("http://localhost:3000/app")
            page.wait_for_load_state("networkidle")
        except Exception as e:
            print(f"Navigation failed: {e}")

        browser.close()

if __name__ == "__main__":
    run()
