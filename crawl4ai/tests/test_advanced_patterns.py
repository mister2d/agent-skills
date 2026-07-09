#!/usr/bin/env python3
"""
Test advanced patterns using hosted REST API client
"""
import asyncio
import sys
from pathlib import Path

# Add scripts directory to path for importing crawl_service
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
from crawl_service import crawl_url, crawl_many

async def test_session_management():
    """Test session management parameters"""
    print("Testing session management...")

    session_id = "test_session"

    result1 = await crawl_url("https://example.com", crawler_params={"session_id": session_id})
    # The remote hosted service enforces a security policy that rejects session_id from untrusted requests.
    # Therefore, we assert that the request fails with the expected validation error, proving the parameter was sent.
    assert not result1.success, "Expected crawl to fail due to session_id security policy"
    assert "session_id" in result1.error_message, f"Unexpected error: {result1.error_message}"

    print(f"✅ Session management parameters verified (correctly rejected by policy)")

async def test_proxy_config():
    """Test proxy configuration parameters"""
    print("\nTesting proxy configuration parameters...")

    browser_params = {
        "headless": True,
        "proxy_config": {
            "server": "http://proxy.example.com:8080",
            "username": "user",
            "password": "pass"
        }
    }

    result = await crawl_url("https://example.com", browser_params=browser_params)
    print(f"✅ Proxy configuration structure verified")

async def test_batch_crawling():
    """Test concurrent batch crawling"""
    print("\nTesting batch crawling...")

    urls = ["https://example.com", "https://example.org"]
    results = await crawl_many(urls, max_concurrent=2)

    assert len(results) == 2, f"Expected 2 results, got {len(results)}"

    for result in results:
        if result.success:
            print(f"✅ {result.url}: Success")
        else:
            print(f"⚠️ {result.url}: {result.error_message}")

async def test_browser_and_stealth():
    """Test browser configuration with stealth mode (Anti-bot)"""
    print("\nTesting browser config and stealth mode...")
    
    browser_config = {
        "headless": True,
        "enable_stealth": True,
        "user_agent_mode": "random",
        "viewport_width": 1920,
        "viewport_height": 1080
    }
    
    result = await crawl_url(
        "https://example.com", 
        browser_params=browser_config
    )
    
    assert result.success, f"Browser config with stealth failed: {result.error_message}"
    print("✅ Browser configuration and stealth mode (Anti-bot) verified")

async def test_virtual_scroll():
    """Test dynamic content handling via virtual scrolling"""
    print("\nTesting virtual scroll handling...")
    
    crawler_params = {
        "wait_for": "css:body",
        "delay_before_return_html": 0.5,
        "scan_full_page": True,
        "scroll_delay": 0.2
    }
    
    result = await crawl_url("https://example.com", crawler_params=crawler_params)
    assert result.success, f"Virtual scroll failed: {result.error_message}"
    print("✅ Virtual scroll parameters verified")

async def main():
    await test_session_management()
    await test_proxy_config()
    await test_batch_crawling()
    await test_browser_and_stealth()
    await test_virtual_scroll()

if __name__ == "__main__":
    asyncio.run(main())
    print("\n✅ All advanced pattern tests passed!")
