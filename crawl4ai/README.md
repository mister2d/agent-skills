# Crawl4AI Agentic Skill (v0.9.0)

A Python skill for deep, targeted web crawling. Interfaces exclusively with a hosted Crawl4AI instance over HTTP/HTTPS, completely eliminating local library dependencies. It includes ready-to-run scripts, a comprehensive configuration reference, and routing guidance for when to use this skill versus the hybrid-web-search pipeline.

## When to Use This vs. hybrid-web-search

| Situation | Use |
|---|---|
| Need to search the open web, no target URL known | hybrid-web-search |
| Quick factual lookup, bounded output preferred | hybrid-web-search |
| Have a specific site/domain to crawl comprehensively | **this skill** |
| Need structured data from a known page pattern | **this skill** |
| Source requires JS login or session persistence | **this skill** |
| Topic research where hybrid-web-search found the entry URL | **this skill** (adaptive crawl) |

**Recommended two-step pattern** for deep research:
1. `hybrid-web-search` finds the canonical entry URL for the topic
2. Pass it here for comprehensive coverage:
   ```bash
   python scripts/adaptive_crawler.py <url> "<query>" --output kb.jsonl
   ```

## Requirements & Configuration

No local Python library installation is needed. The skill communicates with the central service via REST API.

**Environment Variables:**
- `CRAWL4AI_URL`: The URL of the hosted service (default: `http://localhost:8000`)
- `CRAWL4AI_AUTH_TOKEN`: Optional Bearer token for authentication. Use this parameter if the endpoint requires authorization.

## Scripts

### Adaptive Crawling (recommended for research)

Starts at one URL, intelligently follows links, and stops automatically when it has gathered sufficient information about the query.

```bash
python scripts/adaptive_crawler.py https://docs.example.com "async context managers"
python scripts/adaptive_crawler.py https://docs.example.com "async context managers" \
    --max-pages 30 \
    --confidence 0.8 \
    --output knowledge_base.jsonl
```

### Basic Crawling

Single-URL markdown extraction:

```bash
python scripts/basic_crawler.py https://example.com
```

### Batch Crawling

Concurrent multi-URL processing from a file:

```bash
python scripts/batch_crawler.py urls.txt
```

### Extraction Pipeline

Schema-based structured extraction — generate a CSS schema once with an LLM, then reuse it indefinitely without LLM calls:

```bash
# Step 1: generate schema (one-time LLM call)
python scripts/extraction_pipeline.py --generate-schema https://shop.com "extract products"

# Step 2: fast extraction using the schema (no LLM)
python scripts/extraction_pipeline.py --use-schema https://shop.com generated_schema.json
```

## Core Capabilities (REST API)

All scripts utilize `scripts/crawl_service.py` to communicate with the hosted API. The API expects standard JSON structures rather than Python objects.

### Content Filtering (fit_markdown)

Apply filters like `BM25ContentFilter` by passing structured JSON parameters in `crawler_config`:

```python
crawler_params = {
    "markdown_generator": {
        "type": "DefaultMarkdownGenerator",
        "params": {
            "content_filter": {
                "type": "BM25ContentFilter",
                "params": {
                    "user_query": "machine learning tutorials"
                }
            }
        }
    }
}
result = await crawl_url(url, crawler_params=crawler_params)
```

### Schema-Based Structured Extraction

Highly efficient JSON/CSS extraction for repetitive page patterns:

```python
crawler_params = {
    "extraction_strategy": {
        "type": "JsonCssExtractionStrategy",
        "params": {
            "schema": {
                "name": "articles",
                "baseSelector": "article.post",
                "fields": [
                    {"name": "title", "selector": "h2", "type": "text"},
                    {"name": "date", "selector": ".date", "type": "text"}
                ]
            }
        }
    }
}
```

### Session Management & Dynamic Content

You can manage sessions and execute custom JS by passing the relevant flags (Note: restricted endpoints may reject session persistence due to security policies).

```python
crawler_params = {
    "wait_for": "css:.ajax-content",
    "js_code": "window.scrollTo(0, document.body.scrollHeight);",
    "page_timeout": 60000,
    "session_id": "my_persistent_session"
}
```

## References

- `references/complete-sdk-reference.md` — Full SDK documentation (23K words)
- `references/advanced-patterns.md` — Advanced configurations and usage patterns
- `tests/` — Test scripts validating basic crawling, markdown generation, data extraction, and advanced features against the integration environment.
