from playwright.sync_api import sync_playwright

def run(playwright):
    browser = playwright.chromium.launch(headless=True)
    page = browser.new_page()
    page.goto("http://localhost:8080/index.html")

    # Wait for app to initialize
    page.wait_for_timeout(1000)

    # Force show Postfach link and Sidebar
    page.evaluate("""
        document.getElementById('navPost').style.display = 'flex';
        document.getElementById('sidebar').classList.add('active');
        document.getElementById('sidebarOverlay').classList.add('active');
    """)

    # Click Postfach
    page.click("#navPost")

    # Wait for Inbox Sidebar to slide in
    page.wait_for_selector("#inboxSidebar.active")
    page.wait_for_timeout(500) # Wait for transition

    # Screenshot
    page.screenshot(path="verification/inbox_sidebar.png")
    browser.close()

with sync_playwright() as playwright:
    run(playwright)
