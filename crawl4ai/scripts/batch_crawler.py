#!/usr/bin/env python3
"""
Crawl4AI batch/multi-URL crawler with concurrent processing using hosted service.
Usage: python batch_crawler.py urls.txt [--max-concurrent 5]
"""

import asyncio
import sys
import json
from pathlib import Path
from typing import List

# Add current directory to path for importing crawl_service
sys.path.insert(0, str(Path(__file__).resolve().parent))
from crawl_service import crawl_many

async def crawl_batch(urls: List[str], max_concurrent: int = 5):
    """Crawl multiple URLs efficiently using hosted service"""
    print(f"🚀 Starting batch crawl of {len(urls)} URLs (max {max_concurrent} concurrent)")

    crawler_params = {
        "cache_mode": "BYPASS",
        "remove_overlay_elements": True,
        "wait_for": "css:body",
        "page_timeout": 30000,
        "screenshot": False
    }

    browser_params = {
        "headless": True,
        "viewport_width": 1280,
        "viewport_height": 800
    }

    batch_results = await crawl_many(
        urls=urls,
        crawler_params=crawler_params,
        browser_params=browser_params,
        max_concurrent=max_concurrent
    )

    results = []
    failed = []

    for result in batch_results:
        if result.success:
            results.append({
                "url": result.url,
                "title": result.metadata.get("title", ""),
                "description": result.metadata.get("description", ""),
                "content_length": len(str(result.markdown)),
                "links_count": len(result.links.get("internal", [])) + len(result.links.get("external", [])),
                "images_count": len(result.media.get("images", [])),
            })
            print(f"✅ {result.url}")
        else:
            failed.append({
                "url": result.url,
                "error": result.error_message
            })
            print(f"❌ {result.url}: {result.error_message}")

    # Save results summary
    output = {
        "success_count": len(results),
        "failed_count": len(failed),
        "results": results,
        "failed": failed
    }

    with open("batch_results.json", "w") as f:
        json.dump(output, f, indent=2)

    # Save individual markdown files
    markdown_dir = Path("batch_markdown")
    markdown_dir.mkdir(exist_ok=True)

    for i, result in enumerate(batch_results):
        if result.success:
            safe_name = result.url.replace("https://", "").replace("http://", "")
            safe_name = "".join(c if c.isalnum() or c in "-_" else "_" for c in safe_name)[:100]

            file_path = markdown_dir / f"{i:03d}_{safe_name}.md"
            with open(file_path, "w") as f:
                f.write(f"# {result.metadata.get('title', result.url)}\n\n")
                f.write(f"URL: {result.url}\n\n")
                f.write(str(result.markdown))

    print(f"\n📊 Batch Crawl Complete:")
    print(f"   ✅ Success: {len(results)}")
    print(f"   ❌ Failed: {len(failed)}")
    print(f"   💾 Results saved to: batch_results.json")
    print(f"   📁 Markdown files saved to: {markdown_dir}/")

    return output

async def crawl_with_extraction(urls: List[str], schema_file: str = None):
    """Batch crawl with structured data extraction using hosted service"""
    schema = None
    if schema_file and Path(schema_file).exists():
        with open(schema_file) as f:
            schema = json.load(f)
        print(f"📋 Using extraction schema from: {schema_file}")
    else:
        schema = {
            "name": "content",
            "baseSelector": "body",
            "fields": [
                {"name": "headings", "selector": "h1, h2, h3", "type": "text", "all": True},
                {"name": "paragraphs", "selector": "p", "type": "text", "all": True},
                {"name": "links", "selector": "a[href]", "type": "attribute", "attribute": "href", "all": True}
            ]
        }

    crawler_params = {
        "extraction_strategy": {
            "type": "JsonCssExtractionStrategy",
            "params": {
                "schema": schema
            }
        },
        "cache_mode": "BYPASS"
    }

    results = await crawl_many(
        urls=urls,
        crawler_params=crawler_params,
        max_concurrent=5
    )

    extracted_data = []
    for result in results:
        if result.success and result.extracted_content:
            try:
                data = json.loads(result.extracted_content)
                extracted_data.append({
                    "url": result.url,
                    "data": data
                })
                print(f"✅ Extracted from: {result.url}")
            except json.JSONDecodeError:
                print(f"⚠️ Failed to parse JSON from: {result.url}")

    with open("batch_extracted.json", "w") as f:
        json.dump(extracted_data, f, indent=2)

    print(f"\n💾 Extracted data saved to: batch_extracted.json")
    return extracted_data

def load_urls(source: str) -> List[str]:
    if Path(source).exists():
        with open(source) as f:
            urls = [line.strip() for line in f if line.strip() and not line.startswith("#")]
    else:
        urls = [url.strip() for url in source.split(",") if url.strip()]
    return urls

async def main():
    if len(sys.argv) < 2:
        print("""
Crawl4AI Batch Crawler using hosted service

Usage:
    python batch_crawler.py urls.txt [--max-concurrent 5]
    python batch_crawler.py urls.txt --extract [schema.json]
    python batch_crawler.py "https://example.com,https://example.org"
""")
        sys.exit(1)

    source = sys.argv[1]
    urls = load_urls(source)

    if not urls:
        print("❌ No URLs found")
        sys.exit(1)

    print(f"📋 Loaded {len(urls)} URLs")

    max_concurrent = 5
    extract_mode = False
    schema_file = None

    for i, arg in enumerate(sys.argv[2:], 2):
        if arg == "--max-concurrent" and i + 1 < len(sys.argv):
            max_concurrent = int(sys.argv[i + 1])
        elif arg == "--extract":
            extract_mode = True
            if i + 1 < len(sys.argv) and not sys.argv[i + 1].startswith("--"):
                schema_file = sys.argv[i + 1]

    if extract_mode:
        await crawl_with_extraction(urls, schema_file)
    else:
        await crawl_batch(urls, max_concurrent)

if __name__ == "__main__":
    asyncio.run(main())