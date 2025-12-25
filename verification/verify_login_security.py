from playwright.sync_api import sync_playwright

def verify_login_security(page):
    # Navigate to /app where the login form resides
    page.goto("http://localhost:3000/app")

    # 1. Verify HTML attributes on username
    username_field = page.locator("#u_ident_entry")

    # Wait for the element to be visible
    try:
        username_field.wait_for(state="visible", timeout=5000)
    except:
        page.screenshot(path="verification/failed_to_find_username.png")
        raise

    assert username_field.is_visible(), "Username field not visible"
    assert username_field.get_attribute("autocomplete") == "off", "Username autocomplete should be off"
    assert username_field.get_attribute("spellcheck") == "false", "Username spellcheck should be false"

    # 2. Verify HTML attributes on access code
    password_field = page.locator("#u_key_secure")
    assert password_field.is_visible(), "Password field not visible"
    assert password_field.get_attribute("autocomplete") == "new-password", "Password autocomplete should be new-password"

    # 3. Simulate login and verify clearing
    username_field.fill("test_user")
    password_field.fill("12345")

    # Take screenshot of filled form before submit
    page.screenshot(path="verification/filled_form.png")

    # Submit form
    page.click("#loginBtn")

    # Wait a moment for the clearing logic (it happens async after fetch)
    page.wait_for_timeout(2000)

    # Check if fields are cleared (even if login failed)
    assert username_field.input_value() == "", "Username should be cleared after submit"
    assert password_field.input_value() == "", "Password should be cleared after submit"

    # Take screenshot of cleared form
    page.screenshot(path="verification/cleared_form.png")

if __name__ == "__main__":
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        try:
            verify_login_security(page)
            print("Verification successful!")
        except Exception as e:
            print(f"Verification failed: {e}")
        finally:
            browser.close()
