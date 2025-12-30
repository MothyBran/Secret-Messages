from playwright.sync_api import sync_playwright, expect
import time

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(viewport={'width': 1280, 'height': 800})
        page = context.new_page()

        # 1. Open App
        page.goto("http://localhost:3000/app")

        # 2. Check Menu
        print("Clicking menu...")
        page.click("#menuToggle")
        time.sleep(1)
        cls = page.get_attribute("#sidebar", "class")
        if "active" in cls:
            print("Menu opened successfully.")
        else:
            print("Menu FAILED to open.")

        # Close Menu via Overlay to unblock
        page.click("#sidebarOverlay")
        time.sleep(1)

        # 3. Check Login
        print("Attempting login...")
        page.fill("#username", "test")
        page.fill("#accessCode", "12345")

        with page.expect_response("**/api/auth/login") as response_info:
            page.click("#loginBtn")

        response = response_info.value
        print(f"Login Response Status: {response.status}")

        # 4. Check Navigation to Registration
        page.reload()
        page.click("#showActivationLink")
        time.sleep(0.5)
        act_cls = page.get_attribute("#activationSection", "class")
        if "active" in act_cls:
             print("Navigation to Registration works.")
        else:
             print("Navigation to Registration FAILED.")

        browser.close()

if __name__ == "__main__":
    run()
