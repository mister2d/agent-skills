#!/usr/bin/env python3
"""
Test markdown generation using hosted REST API client
"""
import asyncio
import sys
from pathlib import Path

# Add scripts directory to path for importing crawl_service
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
from crawl_service import crawl_url

async def test_basic_markdown():
    """Test basic markdown extraction"""
    print("Testing basic markdown extraction...")

    result = await crawl_url("https://example.com")
    assert result.success, f"Crawl failed: {result.error_message}"

    markdown_str = str(result.markdown)
    assert len(markdown_str) > 0, "Markdown is empty"
    print(f"✅ Basic markdown length: {len(markdown_str)}")

async def test_fit_markdown_with_filters():
    """Test Fit Markdown with content filters"""
    print("\nTesting Fit Markdown with filters...")

    # Test BM25 filter
    crawler_params = {
        "markdown_generator": {
            "type": "DefaultMarkdownGenerator",
            "params": {
                "content_filter": {
                    "type": "BM25ContentFilter",
                    "params": {
                        "user_query": "example domain",
                        "bm25_threshold": 1.0
                    }
                }
            }
        }
    }

    result = await crawl_url("https://example.com", crawler_params=crawler_params)
    assert result.success, f"Crawl failed: {result.error_message}"

    # Access both raw and fit markdown
    assert hasattr(result.markdown, 'raw_markdown'), "Missing raw_markdown attribute"
    assert hasattr(result.markdown, 'fit_markdown'), "Missing fit_markdown attribute"

    print(f"✅ Raw markdown length: {len(result.markdown.raw_markdown)}")
    print(f"✅ Fit markdown length: {len(result.markdown.fit_markdown or '')}")

async def test_pruning_filter():
    """Test Pruning filter"""
    print("\nTesting Pruning filter...")

    crawler_params = {
        "markdown_generator": {
            "type": "DefaultMarkdownGenerator",
            "params": {
                "content_filter": {
                    "type": "PruningContentFilter",
                    "params": {
                        "threshold": 0.4,
                        "threshold_type": "fixed"
                    }
                }
            }
        }
    }

    result = await crawl_url("https://example.com", crawler_params=crawler_params)

    assert result.success, f"Crawl failed: {result.error_message}"
    print(f"✅ Pruning filter works")

async def test_markdown_options():
    """Test markdown generator options"""
    print("\nTesting markdown generator options...")

    crawler_params = {
        "markdown_generator": {
            "type": "DefaultMarkdownGenerator",
            "params": {
                "options": {
                    "ignore_links": False,
                    "ignore_images": False,
                    "image_alt_text": True
                }
            }
        }
    }

    result = await crawl_url("https://example.com", crawler_params=crawler_params)

    assert result.success, f"Crawl failed: {result.error_message}"
    print(f"✅ Markdown options work")

async def main():
    await test_basic_markdown()
    await test_fit_markdown_with_filters()
    await test_pruning_filter()
    await test_markdown_options()

if __name__ == "__main__":
    asyncio.run(main())
    print("\n✅ All markdown generation tests passed!")
