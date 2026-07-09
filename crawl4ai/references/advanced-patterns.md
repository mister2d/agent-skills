# Advanced Crawl4AI Patterns & Troubleshooting

Detailed technical reference and examples for advanced use cases, troubleshooting, and example code repositories.

## Advanced Patterns

### 1. Deep Crawling

Discover and crawl links from a page:

```python
# Basic link discovery
from crawl_service import crawl_url

async def deep_crawl(url):
    result = await crawl_url(url)
    if not result.success:
        return

    # Extract and process discovered links
    internal_links = result.links.get("internal", [])
    external_links = result.links.get("external", [])

    # Crawl discovered internal links
    for link in internal_links:
        if "/blog/" in link and "/tag/" not in link:  # Filter links
            sub_result = await crawl_url(link)
            # Process sub-page
```

### 2. Batch & Multi-URL Processing

Efficiently crawl multiple URLs concurrently using the crawl helper:

```python
from crawl_service import crawl_many

urls = ["https://site1.com", "https://site2.com", "https://site3.com"]

async def run_batch():
    results = await crawl_many(
        urls=urls,
        crawler_params={"cache_mode": "BYPASS"},
        max_concurrent=5
    )
    for result in results:
        if result.success:
            print(f"✅ {result.url}: {len(result.markdown)} chars")
```

### 3. Session & Authentication

To handle login-required content or session reuse on the remote service:

```python
from crawl_service import crawl_url

# Establish session and login
login_params = {
    "session_id": "user_session",
    "js_code": """
    document.querySelector('#username').value = 'myuser';
    document.querySelector('#password').value = 'mypass';
    document.querySelector('#submit').click();
    """,
    "wait_for": "css:.dashboard"
}

await crawl_url("https://site.com/login", crawler_params=login_params)

# Subsequent crawls - reuse session
config = {"session_id": "user_session"}
await crawl_url("https://site.com/protected-content", crawler_params=config)
```

### 4. Dynamic Content Handling & Virtual Scrolling

For JavaScript-heavy sites with lazy-loaded content, use native virtual scroll parameters instead of arbitrary JS:

```python
from crawl_service import crawl_url

config = {
    "wait_for": "css:body",
    "scan_full_page": True,
    "scroll_delay": 0.2,
    "delay_before_return_html": 0.5,
    "page_timeout": 60000
}
await crawl_url("https://site.com/dynamic", crawler_params=config)
```

---

## Troubleshooting

### JavaScript not loading:
```python
# Wait for specific element and increase timeout
config = {
    "wait_for": "css:.dynamic-content",
    "page_timeout": 60000
}
```

### Bot detection issues (Anti-Bot / Stealth):
Configure browser parameters using stealth mode and randomized user agents:
```python
browser_params = {
    "headless": True,
    "enable_stealth": True,
    "user_agent_mode": "random",
    "viewport_width": 1920,
    "viewport_height": 1080
}
```

### Content extraction problems:
Check elements, sizes, and structure returned:
```python
result = await crawl_url(url)
print(f"HTML length: {len(result.html)}")
print(f"Markdown length: {len(result.markdown)}")
print(f"Links found: {len(result.links)}")
```
