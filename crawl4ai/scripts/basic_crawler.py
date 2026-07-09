#!/usr/bin/env python3
"""
Basic Crawl4AI crawler template using hosted service.
Usage: python basic_crawler.py <url>
"""

import asyncio
import sys
import base64
from pathlib import Path

# Add current directory to path for importing crawl_service
sys.path.insert(0, str(Path(__file__).resolve().parent))
from crawl_service import crawl_url

async def crawl_basic(url: str):
    """Basic crawling with markdown output via hosted service"""
    print(f"Crawling {url} via hosted service...")

    browser_params = {
        "headless": True,
        "viewport_width": 1920,
        "viewport_height": 1080
    }

    crawler_params = {
        "cache_mode": "BYPASS",
        "remove_overlay_elements": True,
        "wait_for_images": True,
        "screenshot": True
    }

    result = await crawl_url(url, crawler_params=crawler_params, browser_params=browser_params)

    if result.success:
        print(f"✅ Crawled: {result.url}")
        print(f"   Title: {result.metadata.get('title', 'N/A')}")
        print(f"   Links found: {len(result.links.get('internal', []))} internal, {len(result.links.get('external', []))} external")
        print(f"   Media found: {len(result.media.get('images', []))} images, {len(result.media.get('videos', []))} videos")
        print(f"   Content length: {len(str(result.markdown))} chars")

        # Save markdown
        with open("output.md", "w") as f:
            f.write(str(result.markdown))
        print("📄 Saved to output.md")

        # Save screenshot if available
        if result.screenshot:
            if isinstance(result.screenshot, str):
                screenshot_data = base64.b64decode(result.screenshot)
            else:
                screenshot_data = result.screenshot
            with open("screenshot.png", "wb") as f:
                f.write(screenshot_data)
            print("📸 Saved screenshot.png")
    else:
        print(f"❌ Failed: {result.error_message}")

    return result

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python basic_crawler.py <url>")
        sys.exit(1)

    url = sys.argv[1]
    asyncio.run(crawl_basic(url))