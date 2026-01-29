from playwright.sync_api import sync_playwright
import time
import os

def run():
    if not os.path.exists("verification"):
        os.makedirs("verification")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)

        # Scenario 1: Guest
        context_guest = browser.new_context()
        page_guest = context_guest.new_page()
        page_guest.goto("http://localhost:8080/forum.html")

        # Open Sidebar
        page_guest.click("#sidebarToggle")
        time.sleep(1) # Animation

        # Screenshot Guest Sidebar
        page_guest.screenshot(path="verification/guest_sidebar.png")
        print("Guest sidebar screenshot taken.")

        # Check Logout Button (should be hidden)
        logout_btn = page_guest.locator("#logoutBtnSide")
        is_visible = logout_btn.is_visible()
        print(f"Guest: Logout button visible? {is_visible}")

        # Check Login Link in Modal (we need to trigger modal)
        # Click "Bookmark" on first post (if any) or just call showLoginModal()
        page_guest.evaluate("showLoginModal()")
        time.sleep(0.5)
        # Check link
        login_link = page_guest.locator("#authModal a.btn-comment")
        href = login_link.get_attribute("href")
        print(f"Guest: Login link href: {href}")
        page_guest.screenshot(path="verification/guest_modal.png")

        # Scenario 2: Logged In
        context_user = browser.new_context()
        # Set localStorage
        user_data = '{"name":"TestUser","sm_id":"123","badge":"Dev 👾"}'
        token_data = "header.eyJfaWQiOiIxMjMiLCJpYXQiOjE2MTYxNjE2MTZ9.signature" # Mock token structure

        # We need to set localStorage before loading page.
        # But we need to be on the domain.
        page_user = context_user.new_page()
        page_user.goto("http://localhost:8080/404.html") # Go to any page on same origin
        page_user.evaluate(f"""
            localStorage.setItem('sm_user', '{user_data}');
            localStorage.setItem('sm_token', '{token_data}');
            localStorage.setItem('sm_exp', '2025-12-31');
            // Mocking app.js behavior of populating sm_exp if needed,
            // but forum.html checks currentUser.expiresAt for display if available in object.
            // Let's add expiresAt to user object for better testing of license logic
            const u = JSON.parse('{user_data}');
            u.expiresAt = '2025-12-31';
            localStorage.setItem('sm_user', JSON.stringify(u));
        """)

        page_user.goto("http://localhost:8080/forum.html")

        # Open Sidebar
        page_user.click("#sidebarToggle")
        time.sleep(1)

        # Screenshot User Sidebar
        page_user.screenshot(path="verification/user_sidebar.png")
        print("User sidebar screenshot taken.")

        # Check Logout Button (should be visible)
        logout_btn_user = page_user.locator("#logoutBtnSide")
        is_visible_user = logout_btn_user.is_visible()
        print(f"User: Logout button visible? {is_visible_user}")

        # Check User Info
        user_el = page_user.locator("#sidebarUser")
        print(f"User: Sidebar User Text: {user_el.text_content()}")

        browser.close()

if __name__ == "__main__":
    run()
