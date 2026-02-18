from playwright.sync_api import sync_playwright
import time

def verify_ui():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        # Navigate to app
        page.goto("http://localhost:3000/app")

        # 1. Open Compose Modal
        page.evaluate("document.getElementById('composeModal').classList.add('active')")

        # 2. Open Contact Sidebar (Simulate "Select" mode)
        page.evaluate("""
            const sidebar = document.getElementById('contactSidebar');
            sidebar.classList.add('active');
            sidebar.classList.add('sidebar-on-top');
            document.getElementById('sidebarOverlay').classList.add('active', 'high-z');
        """)

        # Wait a bit for transitions
        time.sleep(1)

        # 3. Take Screenshot
        page.screenshot(path="verification/z_index_check.png")

        # 4. Check Z-Index
        compose_z = page.evaluate("window.getComputedStyle(document.getElementById('composeModal')).zIndex")
        sidebar_z = page.evaluate("window.getComputedStyle(document.getElementById('contactSidebar')).zIndex")
        overlay_z = page.evaluate("window.getComputedStyle(document.getElementById('sidebarOverlay')).zIndex")

        print(f"Compose Modal Z: {compose_z}")
        print(f"Contact Sidebar Z: {sidebar_z}")
        print(f"Overlay Z: {overlay_z}")

        if int(sidebar_z) > int(compose_z):
            print("SUCCESS: Sidebar is above Compose Modal")
        else:
            print("FAILURE: Sidebar is NOT above Compose Modal")

        browser.close()

if __name__ == "__main__":
    verify_ui()
