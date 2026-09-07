# Crawl4AI Agentic Skill (v0.9.0)

An **interpreter-free** skill for deep, targeted web crawling. It interfaces
exclusively with a hosted Crawl4AI instance over HTTP/HTTPS — no local Python
library, no `pip install`, no browser, no Docker. The scripts are `bash` +
`curl` + `jq`; the hosted service runs the headless browser and returns
markdown/HTML/links/extracted content.

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
   bash scripts/adaptive_crawler.sh <url> "<query>" --output kb.jsonl
   ```

## Requirements & Configuration

No local installation of any kind is needed. The skill talks to the hosted
service via REST.

**Environment Variables (all optional):**
- `CRAWL4AI_URL` (or `CRAWL4AI_API_URL`): the hosted service URL
  (default: `https://crawl4ai.service.internal.novuscotia.com`)
- `CRAWL4AI_AUTH_TOKEN`: Bearer token for authentication
  (default: `dummy`)

The scripts resolve a JWT from the raw token via `POST /token` and fall back to
the raw token if that endpoint is absent.

## Scripts

All scripts are `bash` + `curl` + `jq` and share `scripts/c4a.sh`.

### Adaptive Crawling (recommended for research)

Starts at one URL, follows the most query-relevant links, and stops when
coverage plateaus or `--max-pages` is hit.

```bash
bash scripts/adaptive_crawler.sh https://docs.example.com "async context managers"
bash scripts/adaptive_crawler.sh https://docs.example.com "async context managers" \
    --max-pages 30 --top-k 3 --min-score 1 --output knowledge_base.jsonl
```

### Basic Crawling

Single-URL markdown extraction (`POST /md`):

```bash
bash scripts/basic_crawler.sh https://example.com
bash scripts/basic_crawler.sh https://docs.example.com bm25 "machine learning"
```

### Batch Crawling

Concurrent multi-URL processing from a file (`POST /crawl`):

```bash
bash scripts/batch_crawler.sh urls.txt
```

### Extraction Pipeline

Schema-based structured extraction — generate a CSS schema once, then reuse it
indefinitely without LLM calls:

```bash
# Step 1: generate a schema (one-time LLM job)
bash scripts/extraction_pipeline.sh --generate-schema https://shop.com "extract products"

# Step 2: fast extraction using the schema (no LLM)
bash scripts/extraction_pipeline.sh --use-schema https://shop.com generated_schema.json
```

## REST API (what the scripts call)

| Method & path | Body | Returns |
| --- | --- | --- |
| `GET /health` | — | `{"status":"ok",...}` |
| `POST /md` | `{"url", "f": raw\|fit\|bm25\|llm, "q"?}` | `{"markdown": "<string>", "success"}` |
| `POST /crawl` | `{"urls":[...], "crawler_config":{...}, "browser_config":{...}?}` | `{"success", "results":[{markdown, html, links, media, metadata, extracted_content, ...}]}` |
| `POST /llm/job` | `{"url", "q", "schema"?, "provider"?}` | job handle (async); poll `GET /llm/job/<task_id>` |
| `POST /token` | `{"email", "api_token"}` | `{"access_token"}` |

`crawler_config` / `browser_config` accept the standard Crawl4AI config params
(`page_timeout`, `wait_for`, `js_code`, `screenshot`, `session_id`,
`extraction_strategy`, `markdown_generator`, `headless`, `user_agent`, ...).
See [references/rest-api.md](references/rest-api.md) for the confirmed endpoint
shapes and [references/complete-sdk-reference.md](references/complete-sdk-reference.md)
for the full config-parameter reference.

### Content filtering (fit / bm25 / llm)

Pass the filter via `POST /md`'s `f` (and `q` for relevance filters), or via
`crawler_config.markdown_generator` in `POST /crawl`:

```bash
# single page, BM25-filtered
bash scripts/basic_crawler.sh https://docs.example.com bm25 "machine learning tutorials"
```

### Session management & dynamic content

Pass the relevant flags in `crawler_config` (note: restricted endpoints may
reject session persistence due to security policies):

```json
{ "wait_for": "css:.ajax-content", "js_code": "window.scrollTo(0, document.body.scrollHeight);", "page_timeout": 60000, "session_id": "my_persistent_session" }
```

## References

- `references/rest-api.md` — confirmed hosted REST endpoint shapes
- `references/complete-sdk-reference.md` — full config-parameter reference
- `references/advanced-patterns.md` — advanced configurations and usage patterns
