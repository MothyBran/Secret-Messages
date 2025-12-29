from playwright.sync_api import sync_playwright

def run(playwright):
    browser = playwright.chromium.launch(headless=True)
    page = browser.new_page()

    # Log console messages
    page.on("console", lambda msg: print(f"PAGE LOG: {msg.text}"))
    page.on("pageerror", lambda err: print(f"PAGE ERROR: {err}"))

    print("Navigating to IT Admin Sandbox...")
    try:
        page.goto("http://localhost:3000/test/enterprise-admin?dev=true")

        # Wait for the dashboard tab content
        page.wait_for_selector("#tab-dashboard", state="visible")

        # Verify Hub Status
        print("Verifying Hub Status...")
        page.click("#btnStartHub")
        page.wait_for_selector("#hubStatusBadge.online")

        # Verify Quota Display
        print("Verifying Quota Display...")
        page.wait_for_selector("#quotaDisplay")

        # Verify User Management
        print("Verifying User Management...")
        page.click("text=User Management")
        page.wait_for_selector("#userSlotList table")

        # Click "Add User"
        page.click("#btnAddUser")
        page.wait_for_selector("#userModal.active")

        # Fill Form
        page.fill("#editUserName", "NewUser_99")
        page.fill("#editUserDept", "Testing")

        # Save
        page.click("#btnSaveUser")

        # Verify Key Generation (Mock)
        page.wait_for_selector("#keyDisplayArea", state="visible")

        # Take Screenshot 1: User Modal with Key
        page.screenshot(path="verification/screenshot_admin_key_gen.png")
        print("Screenshot 1 taken.")

        page.click("#btnCancelUserModal")

        # Verify Enterprise User View
        print("Navigating to Enterprise User Sandbox...")
        page.goto("http://localhost:3000/test/enterprise-user?dev=true")
        page.wait_for_selector("#app-mode-bar")

        # Verify Contacts
        page.click("#contactsBtn")
        page.wait_for_selector("#contactSidebar.active")

        # Take Screenshot 2: User Contact List
        page.screenshot(path="verification/screenshot_user_contacts.png")
        print("Screenshot 2 taken.")

    except Exception as e:
        print(f"Error: {e}")
        page.screenshot(path="verification/error.png")
    finally:
        browser.close()

with sync_playwright() as playwright:
    run(playwright)
