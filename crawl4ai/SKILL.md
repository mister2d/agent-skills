---
name: crawl4ai
description: Deep web crawling toolkit for known URLs or domains. Use for adaptive site crawling (intelligently follows links until confident it has enough information), schema-based structured extraction, and JS-heavy/authenticated pages. Complements hybrid-web-search — use that skill first to find the right entry URL, then use this skill to crawl the site deeply.
version: 0.9.0
crawl4ai_version: ">=0.9.0"
last_updated: 2025-01-19
---

# Crawl4AI Agentic Skill (v0.9.0)

A production-ready skill for web crawling and data extraction using a hosted Crawl4AI REST service. This skill completely replaces the local Python library dependency, provides ready-to-use scripts for common patterns, and optimized workflows for efficient data extraction.

## Configuration & Environment

This skill interfaces directly with a hosted Crawl4AI REST API instance. It does not run a local Python library, browser, or Docker container.

Configure connection settings via environment variables:
- `CRAWL4AI_URL` (or `CRAWL4AI_API_URL`): The URL of the hosted Crawl4AI service. Defaults to `https://crawl4ai.service.internal.novuscotia.com`.
- `CRAWL4AI_AUTH_TOKEN`: Optional Bearer token for authenticating against the hosted Crawl4AI service.


### Basic First Crawl
```python
import asyncio
from crawl4ai import AsyncWebCrawler

async def main():
    async with AsyncWebCrawler() as crawler:
        result = await crawler.arun("https://example.com")
        print(result.markdown[:500])  # First 500 chars

asyncio.run(main())
```

### Using Provided Scripts
```bash
# Simple markdown extraction
python scripts/basic_crawler.py https://example.com

# Batch processing
python scripts/batch_crawler.py urls.txt

# Data extraction
python scripts/extraction_pipeline.py --generate-schema https://shop.com "extract products"
```

## Core Crawling Fundamentals

### 1. Basic Crawling

Understanding the core components for any crawl:

```python
from crawl4ai import AsyncWebCrawler, BrowserConfig, CrawlerRunConfig

# Browser configuration (controls browser behavior)
browser_config = BrowserConfig(
    headless=True,  # Run without GUI
    viewport_width=1920,
    viewport_height=1080,
    user_agent="custom-agent"  # Optional custom user agent
)

# Crawler configuration (controls crawl behavior)
crawler_config = CrawlerRunConfig(
    page_timeout=30000,  # 30 seconds timeout
    screenshot=True,  # Take screenshot
    remove_overlay_elements=True  # Remove popups/overlays
)

# Execute crawl with arun()
async with AsyncWebCrawler(config=browser_config) as crawler:
    result = await crawler.arun(
        url="https://example.com",
        config=crawler_config
    )

    # CrawlResult contains everything
    print(f"Success: {result.success}")
    print(f"HTML length: {len(result.html)}")
    print(f"Markdown length: {len(result.markdown)}")
    print(f"Links found: {len(result.links)}")
```

### 2. Configuration Deep Dive

**BrowserConfig** - Controls the browser instance:
- `headless`: Run with/without GUI
- `viewport_width/height`: Browser dimensions
- `user_agent`: Custom user agent string
- `cookies`: Pre-set cookies
- `headers`: Custom HTTP headers

**CrawlerRunConfig** - Controls each crawl:
- `page_timeout`: Maximum page load/JS execution time (ms)
- `wait_for`: CSS selector or JS condition to wait for (optional)
- `cache_mode`: Control caching behavior
- `js_code`: Execute custom JavaScript
- `screenshot`: Capture page screenshot
- `session_id`: Persist session across crawls

### 3. Content Processing

Basic content operations available in every crawl:

```python
result = await crawler.arun(url)

# Access extracted content
markdown = result.markdown  # Clean markdown
html = result.html  # Raw HTML
text = result.cleaned_html  # Cleaned HTML

# Media and links
images = result.media["images"]
videos = result.media["videos"]
internal_links = result.links["internal"]
external_links = result.links["external"]

# Metadata
title = result.metadata["title"]
description = result.metadata["description"]
```

## Markdown Generation (Primary Use Case)

### 1. Basic Markdown Extraction

Crawl4AI excels at generating clean, well-formatted markdown:

```python
# Simple markdown extraction
async with AsyncWebCrawler() as crawler:
    result = await crawler.arun("https://docs.example.com")

    # High-quality markdown ready for LLMs
    with open("documentation.md", "w") as f:
        f.write(result.markdown)
```

### 2. Fit Markdown (Content Filtering)

Use content filters to get only relevant content:

```python
from crawl4ai.content_filter_strategy import PruningContentFilter, BM25ContentFilter
from crawl4ai.markdown_generation_strategy import DefaultMarkdownGenerator

# Option 1: Pruning filter (removes low-quality content)
pruning_filter = PruningContentFilter(threshold=0.4, threshold_type="fixed")

# Option 2: BM25 filter (relevance-based filtering)
bm25_filter = BM25ContentFilter(user_query="machine learning tutorials", bm25_threshold=1.0)

md_generator = DefaultMarkdownGenerator(content_filter=bm25_filter)

config = CrawlerRunConfig(markdown_generator=md_generator)

result = await crawler.arun(url, config=config)
# Access filtered content
print(result.markdown.fit_markdown)  # Filtered markdown
print(result.markdown.raw_markdown)  # Original markdown
```

### 3. Markdown Customization

Control markdown generation with options:

```python
config = CrawlerRunConfig(
    # Exclude elements from markdown
    excluded_tags=["nav", "footer", "aside"],

    # Focus on specific CSS selector
    css_selector=".main-content",

    # Clean up formatting
    remove_forms=True,
    remove_overlay_elements=True,

    # Control link handling
    exclude_external_links=True,
    exclude_internal_links=False
)

# Custom markdown generation
from crawl4ai.markdown_generation_strategy import DefaultMarkdownGenerator

generator = DefaultMarkdownGenerator(
    options={
        "ignore_links": False,
        "ignore_images": False,
        "image_alt_text": True
    }
)
```

## Data Extraction

### 1. Schema-Based Extraction (Most Efficient)

For repetitive patterns, generate schema once and reuse:

```bash
# Step 1: Generate schema with LLM (one-time)
python scripts/extraction_pipeline.py --generate-schema https://shop.com "extract products"

# Step 2: Use schema for fast extraction (no LLM)
python scripts/extraction_pipeline.py --use-schema https://shop.com generated_schema.json
```

### 2. Manual CSS/JSON Extraction

When you know the structure:

```python
schema = {
    "name": "articles",
    "baseSelector": "article.post",
    "fields": [
        {"name": "title", "selector": "h2", "type": "text"},
        {"name": "date", "selector": ".date", "type": "text"},
        {"name": "content", "selector": ".content", "type": "text"}
    ]
}

extraction_strategy = JsonCssExtractionStrategy(schema=schema)
config = CrawlerRunConfig(extraction_strategy=extraction_strategy)
```

### 3. LLM-Based Extraction

For complex or irregular content:

```python
extraction_strategy = LLMExtractionStrategy(
    provider="openai/gpt-4o-mini",
    instruction="Extract key financial metrics and quarterly trends"
)
```

## Advanced Patterns & Troubleshooting

For advanced crawling configurations, session management, dynamic content, proxy configurations, and troubleshooting, please see [the Advanced Patterns & Troubleshooting Guide](references/advanced-patterns.md).

## Resources

### scripts/
- **crawl_service.py** - Production-ready REST API client helper for Crawl4AI.
- **adaptive_crawler.py** - Adaptive crawling with intelligent stopping (start URL + query → comprehensive coverage)
- **extraction_pipeline.py** - Three extraction approaches with schema generation
- **basic_crawler.py** - Simple markdown extraction with screenshots
- **batch_crawler.py** - Multi-URL concurrent processing

### references/
- [complete-sdk-reference.md](references/complete-sdk-reference.md) - Complete SDK documentation
- [advanced-patterns.md](references/advanced-patterns.md) - Advanced use cases, troubleshooting, and dynamic content handling

## Skill Routing: hybrid-web-search ↔ crawl4ai

**Use hybrid-web-search instead of this skill when:**
- The user wants to search the open web without a specific target site in mind
- The task is a quick factual lookup — hybrid-web-search's bounded output is better
- You don't have a starting URL

**Complementary two-step pattern:**
1. `hybrid-web-search` identifies the canonical entry URL (e.g., the docs landing page for a library)
2. Hand that URL to adaptive crawling here for deep, comprehensive coverage:
   ```bash
   python scripts/adaptive_crawler.py <url_from_search> "<query>" --output kb.jsonl
   ```

**Confidence score guide** (for `--confidence` arg):
- `0.5` — basic coverage, fast; good for broad overviews
- `0.7` — default; good for most research tasks
- `0.85+` — comprehensive; use for knowledge base creation or exhaustive research

