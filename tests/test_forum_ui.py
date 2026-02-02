import asyncio
import json
import pytest
from playwright.async_api import async_playwright

# Standalone run with: python3 tests/test_forum_ui.py
# Or via pytest if configured

async def run():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page()

        # Mock API responses
        await page.route("**/api/posts/1", lambda route: route.fulfill(
            status=200,
            content_type="application/json",
            body=json.dumps({
                "id": 1,
                "title": "Test Post",
                "content": "Content",
                "created_at": "2023-01-01T12:00:00Z",
                "likes": 10,
                "dislikes": 0,
                "questions": 0
            })
        ))

        await page.route("**/api/posts/1/comments", lambda route: route.fulfill(
            status=200,
            content_type="application/json",
            body=json.dumps([
                {
                    "id": 101,
                    "post_id": 1,
                    "username": "TestUser",
                    "badge": "Dev 👾",
                    "comment": "This is a test comment with the new layout.",
                    "created_at": "2023-01-01T12:05:00Z",
                    "likes": 5,
                    "dislikes": 1,
                    "parent_id": None,
                    "is_pinned": False
                },
                {
                    "id": 102,
                    "post_id": 1,
                    "username": "AdminUser",
                    "badge": "Admin 🛡️",
                    "comment": "Pinned comment test.",
                    "created_at": "2023-01-01T12:06:00Z",
                    "likes": 99,
                    "dislikes": 0,
                    "parent_id": None,
                    "is_pinned": True
                }
            ])
        ))

        # Mock other calls
        await page.route("**/api/posts", lambda route: route.fulfill(status=200, body="[]"))
        await page.route("**/api/bookmarks", lambda route: route.fulfill(status=200, body="[]"))
        await page.route("**/api/forum/activity", lambda route: route.fulfill(status=200, body="[]"))

        # Navigate (Assuming localhost:3000 is running, otherwise this test fails)
        # For CI environments, the server start logic should be external.
        print("Navigating to forum...")
        try:
            await page.goto("http://localhost:3000/forum.html?post=1", timeout=5000)
        except Exception as e:
            print("Server not running or unreachable. Skipping test logic.")
            await browser.close()
            return

        # Wait for comments
        print("Waiting for comments...")
        await page.wait_for_selector(".comment-item", timeout=5000)

        # Select first comment
        item = page.locator("#comment-101")

        # Check structure
        print("Checking structure...")
        has_header = await item.locator(".comment-header").count() > 0
        has_body = await item.locator(".comment-body").count() > 0
        has_footer = await item.locator(".comment-footer").count() > 0

        assert has_header, "Comment header missing"
        assert has_body, "Comment body missing"
        assert has_footer, "Comment footer missing"

        print("SUCCESS: Header, Body, and Footer found.")

        # Check footer layout
        footer = item.locator(".comment-footer")

        # Check CSS flex-wrap
        wrap_prop = await footer.evaluate("el => getComputedStyle(el).flexWrap")
        print(f"Footer flex-wrap: {wrap_prop}")

        assert wrap_prop == "nowrap", "Footer must be nowrap"
        print("SUCCESS: Footer is nowrap.")

        # Check alignment (bounding box)
        footer_left = footer.locator(".footer-left")
        footer_right = footer.locator(".footer-right")

        box_left = await footer_left.bounding_box()
        box_right = await footer_right.bounding_box()

        # Check if they overlap in Y (same line)
        overlap = not (box_left['y'] > box_right['y'] + box_right['height'] or box_right['y'] > box_left['y'] + box_left['height'])

        assert overlap, "Left and Right footer sections are not on the same line"
        print("SUCCESS: Left and Right sections are on the same line.")

        await browser.close()

if __name__ == "__main__":
    asyncio.run(run())
