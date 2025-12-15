
from playwright.sync_api import sync_playwright, expect
import re
import os

def run(playwright):
    browser = playwright.chromium.launch(headless=True)
    context = browser.new_context()
    page = context.new_page()

    # --- Test 1: Cookie Banner on Landing Page ---
    print("Testing Landing Page Cookie Banner...")
    # Navigate to landing.html (assuming server running at public/)
    page.goto("http://localhost:8080/landing.html")

    # Check banner visible
    banner = page.locator("#cookieBanner")
    expect(banner).to_be_visible()

    # Check text
    expect(banner).to_contain_text("Wir nutzen Cookies")
    expect(banner).to_contain_text("Nur Essenzielle")

    # Screenshot Landing with Banner
    page.screenshot(path="verification/landing_cookie_banner.png")
    print("Screenshot saved: verification/landing_cookie_banner.png")

    # Click "Alles Akzeptieren"
    page.locator("#cookieAcceptAll").click()

    # Banner should disappear
    expect(banner).not_to_be_visible()

    # Reload page -> Banner should remain hidden (localStorage check)
    page.reload()
    expect(banner).not_to_be_visible()
    print("Cookie Banner logic verified.")

    # --- Test 2: Logo Navigation Logic on App (index.html) ---
    print("Testing App Logo Navigation...")

    # A. Not Logged In -> Logo Redirects to Landing
    # Clear storage to ensure logged out
    context.clear_cookies()
    page.evaluate("localStorage.clear()")

    page.goto("http://localhost:8080/index.html")

    # Ensure we are on login section
    expect(page.locator("#loginSection")).to_have_class(re.compile(r"active"))

    # Click Logo
    page.locator(".app-logo").click()

    # Should navigate to landing.html
    expect(page).to_have_url(re.compile(r".*landing.html"))
    print("Logo redirect (logged out) verified.")

    # B. Logged In -> Logo Does Nothing
    # Go back to index
    page.goto("http://localhost:8080/index.html")

    # Mock API response for session validation FIRST
    page.route("**/api/auth/validate", lambda route: route.fulfill(
        status=200,
        body='{"valid": true, "username": "TestUser", "expiresAt": "lifetime"}',
        headers={"Content-Type": "application/json"}
    ))

    # Mock Login State in localStorage
    page.evaluate("""
        localStorage.setItem('sm_token', 'mock_token');
        localStorage.setItem('sm_user', 'TestUser');
    """)

    # Reload to trigger checkExistingSession()
    page.reload()

    # Wait for main section to become active (implies logged in state)
    expect(page.locator("#mainSection")).to_have_class(re.compile(r"active"))

    # Click Logo
    page.locator(".app-logo").click()

    # Should STAY on index.html (mainSection)
    expect(page).to_have_url(re.compile(r".*index.html"))
    expect(page.locator("#mainSection")).to_have_class(re.compile(r"active"))
    print("Logo no-action (logged in) verified.")

    browser.close()

if __name__ == "__main__":
    with sync_playwright() as playwright:
        run(playwright)
