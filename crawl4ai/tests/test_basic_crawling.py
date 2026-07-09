#!/usr/bin/env python3
"""
Test basic crawling setup using hosted REST API client
"""
import asyncio
import sys
from pathlib import Path

# Add scripts directory to path for importing crawl_service
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
from crawl_service import crawl_url

async def test_basic_crawl():
    print("Testing basic crawl setup...")

    browser_params = {
        "headless": True,
        "viewport_width": 1920,
        "viewport_height": 1080,
        "user_agent": "custom-agent"
    }

    crawler_params = {
        "page_timeout": 30000,
        "screenshot": True,
        "remove_overlay_elements": True
    }

    result = await crawl_url(
        url="https://example.com",
        crawler_params=crawler_params,
        browser_params=browser_params
    )

    # Verify result attributes
    assert result.success, f"Crawl failed: {result.error_message}"
    assert hasattr(result, 'html'), "Missing html attribute"
    assert hasattr(result, 'markdown'), "Missing markdown attribute"
    assert hasattr(result, 'links'), "Missing links attribute"

    # Test markdown as string
    markdown_str = str(result.markdown)
    assert len(markdown_str) > 0, "Markdown is empty"

    print(f"✅ Success: {result.success}")
    print(f"✅ HTML length: {len(result.html)}")
    print(f"✅ Markdown length: {len(markdown_str)}")
    print(f"✅ Links found: {len(result.links)}")

if __name__ == "__main__":
    asyncio.run(test_basic_crawl())
    print("\n✅ All basic crawling tests passed!")
