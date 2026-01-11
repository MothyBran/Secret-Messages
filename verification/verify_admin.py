from playwright.sync_api import sync_playwright, expect

def run(playwright):
    browser = playwright.chromium.launch(headless=True)
    context = browser.new_context(viewport={'width': 1280, 'height': 800})
    page = context.new_page()

    # 1. Login
    print("Navigating to Admin...")
    page.goto("http://localhost:3000/admin")

    # Check if login required
    if page.is_visible("#adminLoginForm"):
        print("Logging in...")
        page.fill("#adminPasswordInput", "admin123")
        page.click("button[type='submit']")
        page.wait_for_selector("#dashboard-view", state="visible")
        print("Login Successful.")

    # 2. Verify Licenses Tab (Origin Column)
    print("Checking Licenses Tab...")
    page.click("button[onclick=\"switchTab('licenses')\"]")
    page.wait_for_timeout(1000) # Wait for animation/render
    page.screenshot(path="verification/admin_licenses.png")
    print("Screenshot licenses taken.")

    # 3. Verify Users Tab & Modal
    print("Checking Users Tab...")
    page.click("button[onclick=\"switchTab('users')\"]")
    page.wait_for_timeout(1000)

    # Find a user row (assuming seed data exists, otherwise empty)
    # Ensure there is at least one user for testing modal
    # We can inject one via API or rely on existing.
    # If table is empty, we can't test modal click.
    # Let's check table content.
    rows = page.locator("#usersTableBody tr")
    if rows.count() > 0:
        print("Clicking first user...")
        rows.first.locator("td:nth-child(2)").click() # Name column is clickable
        page.wait_for_selector("#userProfileModal", state="visible")
        page.wait_for_timeout(500)
        page.screenshot(path="verification/admin_user_modal.png")
        print("Screenshot modal taken.")
    else:
        print("No users found to click.")
        page.screenshot(path="verification/admin_users_empty.png")

    browser.close()

with sync_playwright() as playwright:
    run(playwright)
