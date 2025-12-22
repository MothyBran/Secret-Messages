
import os
import time
import re
from playwright.sync_api import sync_playwright, expect

def run(playwright):
    browser = playwright.chromium.launch(headless=True)
    context = browser.new_context(viewport={'width': 1280, 'height': 800})
    page = context.new_page()

    # Define selectors
    URL = "http://localhost:3000"

    print("--- STEP 0: GENERATE KEY AS ADMIN ---")
    page.goto(URL + "/admin")
    if page.locator("#adminPasswordInput").is_visible():
        page.fill("#adminPasswordInput", "admin123")
        page.click("#adminLoginForm button")

    expect(page.locator("#dashboard-view")).to_be_visible()

    # Generate Key
    page.evaluate("switchTab('licenses')") # Use JS to switch safely
    page.select_option("#genDuration", "1m")
    page.fill("#genCount", "1")
    page.click("#generateBtn")
    # Wait for key
    page.wait_for_selector("#newKeysArea")
    key_text = page.locator("#newKeysArea").inner_text()
    license_key = key_text.strip().split('\n')[0]
    print(f"Generated Key: {license_key}")

    print("--- STEP 1: ACTIVATE USER ---")
    page.goto(URL + "/app?action=activate")

    # Wait for section to be active
    expect(page.locator("#activationSection")).to_have_class(re.compile(r"active"))

    page.fill("#licenseKey", license_key)
    page.fill("#newUsername", "TestUserSupport")
    page.fill("#newAccessCode", "12345")
    page.fill("#newAccessCodeRepeat", "12345")
    page.check("#agbCheck")
    page.click("#activateBtn")
    # Wait for success toast or redirection
    page.wait_for_timeout(2000)

    print("--- STEP 2: LOGIN USER ---")
    page.goto(URL + "/app")
    page.fill("#username", "TestUserSupport")
    page.fill("#accessCode", "12345")
    page.click("#loginForm button")
    expect(page.locator("#mainSection")).to_be_visible()

    print("--- STEP 3: SEND SUPPORT TICKET ---")
    # Open Menu
    page.click("#menuToggle")
    page.wait_for_timeout(500)
    page.click("#navSupport")

    page.fill("#supportSubject", "Problem with Login")
    page.fill("#supportMessage", "I cannot login sometimes.")
    page.click("#supportForm button[type='submit']")
    # Wait for success toast
    page.wait_for_selector("text=Danke! Ihre Nachricht wurde gesendet")

    print("--- STEP 4: CHECK INBOX (OPEN) ---")
    # Open Menu again (it closes on click usually)
    page.click("#menuToggle")
    page.wait_for_timeout(500)
    page.click("#navPost")

    # Wait for message to appear
    page.wait_for_selector(".msg-card")

    # Check Badge
    expect(page.locator(".msg-status-badge").first).to_have_text("OFFEN")
    # Check class
    expect(page.locator(".msg-status-badge").first).to_have_class(re.compile(r"msg-status-open"))

    # Check that Delete Button is HIDDEN for this OPEN ticket
    # Find the ticket card
    open_ticket = page.locator(".msg-card").filter(has=page.locator(".msg-status-badge")).first
    delete_btn_open = open_ticket.locator("button", has_text="Löschen")
    expect(delete_btn_open).not_to_be_visible()

    page.screenshot(path="verification/1_user_inbox_open.png")
    print("Screenshot 1: User Inbox Open Ticket (Delete Hidden)")

    print("--- STEP 5: ADMIN OPEN TICKET ---")
    page.goto(URL + "/admin")
    if page.locator("#adminPasswordInput").is_visible():
        page.fill("#adminPasswordInput", "admin123")
        page.click("#adminLoginForm button")

    page.evaluate("switchTab('mail')")
    # Find ticket
    page.click("div.mail-item:first-child")
    page.wait_for_timeout(1000)

    print("--- STEP 6: USER CHECK INBOX (IN PROGRESS) ---")
    # Open new page for user to keep admin session?
    user_page = context.new_page()
    user_page.goto(URL + "/app")

    # Check if login needed
    if user_page.locator("#loginForm").is_visible():
        user_page.fill("#username", "TestUserSupport")
        user_page.fill("#accessCode", "12345")
        user_page.click("#loginForm button")
        expect(user_page.locator("#mainSection")).to_be_visible()

    # If already logged in, #mainSection should be visible (or switch to it)
    if not user_page.locator("#mainSection").is_visible():
        # Try to navigate or wait?
        # Maybe wait a bit for session check
        user_page.wait_for_timeout(1000)

    user_page.click("#menuToggle")
    user_page.click("#navPost")
    user_page.wait_for_selector(".msg-card")

    expect(user_page.locator(".msg-status-badge").first).to_have_text("IN BEARBEITUNG")
    expect(user_page.locator(".msg-status-badge").first).to_have_class(re.compile(r"msg-status-progress"))

    # Check Delete Button is still HIDDEN
    progress_ticket = user_page.locator(".msg-card").filter(has=user_page.locator(".msg-status-badge")).first
    delete_btn_progress = progress_ticket.locator("button", has_text="Löschen")
    expect(delete_btn_progress).not_to_be_visible()

    user_page.screenshot(path="verification/2_user_inbox_progress.png")
    print("Screenshot 2: User Inbox In Progress")

    # Close user page to focus on admin
    user_page.close()

    print("--- STEP 7: ADMIN REPLY ---")
    # Back to admin page (it was left open)
    # Send Reply
    page.fill("#ticketReplyBody", "This is the solution.")
    page.click("button:has-text('Senden & Schließen')")
    page.wait_for_timeout(1000)

    print("--- STEP 8: USER CHECK INBOX (COMPLETED) ---")
    user_page = context.new_page()
    user_page.goto(URL + "/app")

    if user_page.locator("#loginForm").is_visible():
        user_page.fill("#username", "TestUserSupport")
        user_page.fill("#accessCode", "12345")
        user_page.click("#loginForm button")

    user_page.wait_for_timeout(1000)

    user_page.click("#menuToggle")
    user_page.click("#navPost")
    user_page.wait_for_selector(".msg-card")

    # Check Original Ticket Badge
    ticket_msg = user_page.locator(".msg-card").filter(has=user_page.locator(".msg-status-badge")).first
    expect(ticket_msg.locator(".msg-status-badge")).to_have_text("ABGESCHLOSSEN")
    expect(ticket_msg.locator(".msg-status-badge")).to_have_class(re.compile(r"msg-status-closed"))

    # Check Reply Message Subject
    reply_msg = user_page.locator(".msg-card").first
    expect(reply_msg.locator(".msg-subject")).to_contain_text("RE: Problem with Login - Ticket: #TIC-")

    # Check Delete Button on Original Ticket (Should be VISIBLE now)
    delete_btn = ticket_msg.locator("button", has_text="Löschen")
    expect(delete_btn).to_be_visible()

    user_page.screenshot(path="verification/3_user_inbox_completed.png")
    print("Screenshot 3: User Inbox Completed")

    browser.close()

if __name__ == "__main__":
    with sync_playwright() as playwright:
        run(playwright)
