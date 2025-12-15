
from playwright.sync_api import sync_playwright, expect
import os

def run(playwright):
    browser = playwright.chromium.launch(headless=True)
    context = browser.new_context()
    page = context.new_page()

    # Navigate to landing page
    # Assuming the server is running on port 8080 (which I will ensure)
    page.goto("http://localhost:8080/landing.html")

    # 1. Verify Images
    print("Verifying Images...")
    hero_img = page.locator(".hero-image")
    expect(hero_img).to_have_attribute("src", "hero-secure-vault.jpg")
    expect(hero_img).to_have_class(compile(r"floating-anim"))

    sec_img = page.locator(".feature-image")
    expect(sec_img).to_have_attribute("src", "encryption-layers.jpg")

    # Check background image on Use Cases section via CSS computation
    use_cases = page.locator(".use-cases")
    # This is harder to verify with simple locators, checking class presence is good enough + visual check later
    expect(use_cases).to_have_class(compile(r"reveal"))

    # 2. Verify Scroll Reveal
    print("Verifying Scroll Reveal...")
    # Scroll down to trigger observer
    page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
    page.wait_for_timeout(1000) # Wait for animation class

    # Check if elements have 'active' class
    reveals = page.locator(".reveal.active")
    expect(reveals.first).to_be_visible()

    # 3. Verify Modals
    print("Verifying Modals...")
    # Open Imprint
    page.get_by_text("Impressum", exact=True).first.click() # might be multiple links
    modal = page.locator("#imprintModal")
    expect(modal).to_have_class(compile(r"active"))
    expect(modal).to_contain_text("Angaben gemäß § 5 TMG")

    # Close Imprint
    modal.locator(".modal-close").click()
    expect(modal).not_to_have_class(compile(r"active"))

    # Open Privacy
    page.get_by_text("Datenschutz", exact=True).first.click()
    modal_priv = page.locator("#privacyModal")
    expect(modal_priv).to_have_class(compile(r"active"))
    expect(modal_priv).to_contain_text("Zero Knowledge Prinzip")

    # Close Privacy
    modal_priv.locator(".modal-close").click()
    expect(modal_priv).not_to_have_class(compile(r"active"))

    # 4. Verify Content
    print("Verifying Content...")
    expect(page.locator("body")).to_contain_text("Ab 1,99€ Loslegen")
    expect(page.locator("body")).to_contain_text("Diebstahlschutz inklusive")
    expect(page.locator("body")).to_contain_text("So funktioniert der Zugang")

    # 5. Verify Hero Button Link
    hero_btn = page.locator("a.btn-primary", has_text="Ab 1,99€ Loslegen")
    expect(hero_btn).to_have_attribute("href", "store.html")

    page.screenshot(path="verification/landing_final.png")
    print("Verification complete. Screenshot saved.")

    browser.close()

from re import compile
if __name__ == "__main__":
    with sync_playwright() as playwright:
        run(playwright)
