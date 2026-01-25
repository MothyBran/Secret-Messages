import os
import time
import subprocess
from playwright.sync_api import sync_playwright, expect

def test_verify_encrypt_icons(page):
    page.goto("http://localhost:8000/index.html")
    page.wait_for_selector("#modeSwitch", state="attached")

    # Manually show mainSection
    page.evaluate("""
        document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
        document.getElementById('mainSection').classList.add('active');
        document.getElementById('headerSwitchWrapper').style.display = 'inline-block';
    """)
    expect(page.locator("#mainSection")).to_be_visible()

    # Ensure Encrypt mode (default)
    # If checked, uncheck it
    if page.is_checked("#modeSwitch"):
         page.click(".mode-switch-container")

    expect(page.locator("#modeTitle")).to_have_text("VERSCHLÜSSELUNG")

    # 1. Verify icons visible initially (Paperclip)
    icons = page.locator(".input-icons-wrapper")
    expect(icons).to_be_visible()

    # Check that it contains paperclip
    expect(page.locator("#attachmentBtn")).to_be_visible()
    page.screenshot(path="verification/1_encrypt_empty.png")

    # 2. Enter Text
    page.fill("#messageInput", "A")

    # 3. Verify Icons HIDDEN
    expect(icons).not_to_be_visible()
    page.screenshot(path="verification/2_encrypt_text_hidden.png")

    # 4. Clear Text
    page.fill("#messageInput", "")

    # 5. Verify Icons VISIBLE
    expect(icons).to_be_visible()
    page.screenshot(path="verification/3_encrypt_cleared.png")

if __name__ == "__main__":
    server_process = subprocess.Popen(["python3", "-m", "http.server", "8000", "--directory", "public"])
    try:
        time.sleep(2)
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            page = browser.new_page()
            try:
                test_verify_encrypt_icons(page)
                print("Verification successful!")
            except Exception as e:
                print(f"Verification failed: {e}")
                page.screenshot(path="verification/failure.png")
                raise e
            finally:
                browser.close()
    finally:
        server_process.terminate()
