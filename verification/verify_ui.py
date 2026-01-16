from playwright.sync_api import sync_playwright, expect

def verify_frontend():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        # Navigate to the app (running on localhost:3000)
        page.goto("http://localhost:3000/")

        # Take a screenshot of the landing page
        page.screenshot(path="verification/landing_page.png")

        # Navigate to /app (requires no auth for guest UI check)
        page.goto("http://localhost:3000/app")

        # Click "Konto übertragen" (Import)
        # Note: In mobile view or sidebar, this might be hidden or require menu toggle.
        # Let's try to open the sidebar if needed.
        if page.locator("#menuToggle").is_visible():
            page.locator("#menuToggle").click()
            page.wait_for_timeout(500) # Wait for animation

        page.locator("#navTransferImport").click()

        # Verify QR Scanner Modal is open
        expect(page.locator("#qrScannerModal")).to_have_class("modal active")

        # Verify "Code manuell eingeben" button exists and is visible
        manual_btn = page.locator("#btnOpenManualTransfer")
        expect(manual_btn).to_be_visible()

        # Click it
        manual_btn.click()

        # Verify Manual Transfer Modal opens
        expect(page.locator("#manualTransferModal")).to_have_class("modal active")

        # Take screenshot of Manual Transfer Modal
        page.screenshot(path="verification/manual_transfer_modal.png")

        browser.close()

if __name__ == "__main__":
    verify_frontend()
