---
name: crawl4ai
description: Deep web crawling toolkit for known URLs or domains. Use for adaptive site crawling (intelligently follows links until confident it has enough information), schema-based structured extraction, and JS-heavy/authenticated pages. Complements hybrid-web-search — use that skill first to find the right entry URL, then use this skill to crawl the site deeply.
version: 0.9.0
service_version: "0.9.0"
last_updated: 2026-09-17
---

# Crawl4AI Agentic Skill (v0.9.0)

A production-ready skill for web crawling and data extraction using a **hosted
Crawl4AI REST service**. It is **interpreter-free**: the scripts are `bash` +
`curl` + `jq`. There is no local Python library, no `pip install`, no browser,
and no Docker container — every crawl is delegated to the hosted service, which
runs the headless browser and returns markdown/HTML/links/extracted content.

## Configuration & Environment

Configure the connection via environment variables (all optional — sensible
defaults are baked in):

- `CRAWL4AI_URL` (or `CRAWL4AI_API_URL`): the hosted service base URL.
  Default: `https://crawl4ai.service.internal.novuscotia.com`.
- `CRAWL4AI_AUTH_TOKEN`: Bearer token for the service. Default: `dummy`.

The scripts resolve a short-lived JWT from the raw token via `POST /token` and
fall back to the raw token if that endpoint is absent.

## Choosing an interface: gateway MCP tools vs. REST scripts

The hosted service can be reached two ways. Both hit the same instance (verified: gateway `md` and
`POST /md` return identical output). Pick by payload size, not preference:

| Task | Use | Why |
|---|---|---|
| Single page → markdown (raw / fit / bm25 / llm) | **Gateway `crawl4ai.md(url, f="bm25", q="...")`** (fallback: `scripts/basic_crawler.sh`) | Small, bounded response; no bash/jq/auth handling |
| Screenshot / PDF | Gateway `crawl4ai.screenshot` / `.pdf` | Binary-ish results the scripts don't cover |
| `/crawl` with link lists, schema extraction, multi-URL, adaptive | **REST scripts** (`scripts/*.sh`, `jq`-filtered) | Gateway `crawl4ai.crawl` / `.html` / `.execute_js` return the *full CrawlResult including raw HTML*, and the gateway echoes the entire raw response into the agent's context (measured: ~400K tokens for one Reddit thread). `jq` trims it before it reaches context |
| Anything run from TypeScript/another program (e.g. hybrid-web-search) | REST via `fetch` | MCP tools are only callable by the agent, not by a script |

Rules when you do call a gateway tool that returns large results:
- Process inside `executeToolCode` and `print` only a summary — **but the gateway still logs the raw response**, so
  only use `md` (small) unless the page is known to be small.
- Starlark has no `json` module: `extracted_content` is a JSON *string*; slice or `.count()` it, or use the REST
  scripts when you need to parse it.
- `crawl4ai.crawl(urls=[...], crawler_config={"type":"CrawlerRunConfig","params":{...}})` accepts the same
  `{type, params}` schema as REST (verified with `JsonCssExtractionStrategy`).

## Quick Start

```bash
# Liveness check
bash scripts/c4a.sh >/dev/null && curl -s -H "Authorization: Bearer ${CRAWL4AI_AUTH_TOKEN:-dummy}" "${CRAWL4AI_URL:-https://crawl4ai.service.internal.novuscotia.com}/health"

# Single-page markdown (fit-filtered by default)
bash scripts/basic_crawler.sh https://example.com

# Relevance-filtered single page (BM25 against a query)
bash scripts/basic_crawler.sh https://docs.example.com bm25 "async context managers"

# Concurrent multi-URL crawl (one URL per line)
bash scripts/batch_crawler.sh urls.txt

# Adaptive crawl — follow the most query-relevant links until coverage plateaus
bash scripts/adaptive_crawler.sh https://docs.example.com "async context managers" \
    --max-pages 30 --top-k 3 --output knowledge_base.jsonl

# Structured extraction (schema-based, LLM-free)
bash scripts/extraction_pipeline.sh --use-schema https://shop.com schema.json
```

## REST API (what the scripts call)

| Method & path | Body | Returns | Use |
| --- | --- | --- | --- |
| `GET /health` | — | `{"status":"ok",...}` | liveness |
| `POST /md` | `{"url", "f": raw\|fit\|bm25\|llm, "q"?}` | `{"markdown": "<string>", "success"}` | single page, content-filtered |
| `POST /crawl` | `{"urls":[...], "crawler_config":{...}, "browser_config":{...}?}` | `{"success", "results":[{markdown, html, links, media, metadata, extracted_content, ...}]}` | multi-URL crawl; note `results[]` is **not** in input order — match by `.url` |
| `POST /llm/job` | `{"url", "q", "schema"?, "provider"?}` | job handle (async) | LLM extraction / schema generation; poll `GET /llm/job/<task_id>` |
| `POST /token` | `{"email", "api_token"}` | `{"access_token"}` | resolve a JWT from the raw token |

`crawler_config` / `browser_config` accept the standard Crawl4AI config params
(`page_timeout`, `wait_for`, `js_code`, `screenshot`, `session_id`,
`extraction_strategy`, `markdown_generator`, `headless`, `user_agent`, ...). **0.9.0 trust boundary:** the
hosted service rejects `magic`, `simulate_user`, `override_navigator`, `js_code`,
`fallback_fetch_function` and `proxy_config` from API callers ("not permitted ... from an
untrusted request"); `enable_stealth`, `user_agent_mode`, `text_mode`, `wait_until` and
`page_timeout` are accepted. A URL that fails in a batch is reported as `success:false` with
`status_code`/`error_message`; when every URL fails `/crawl` returns a bare HTTP 500. See
[references/rest-api.md](references/rest-api.md) for the confirmed endpoint
shapes and [references/complete-sdk-reference.md](references/complete-sdk-reference.md)
for the full config-parameter reference.

## Markdown Generation (primary use case)

`POST /md` takes a `f` (filter) and optional `q` (query):

- `f=raw` — full markdown, no filtering
- `f=fit` — pruned to high-signal content (default)
- `f=bm25` / `f=llm` — relevance-filtered against `q`

```bash
bash scripts/basic_crawler.sh https://docs.example.com bm25 "machine learning tutorials"
```

## Data Extraction

Schema-based structured extraction — generate a CSS schema once, then reuse it
indefinitely without LLM calls:

```bash
# Step 1: generate a schema (one-time LLM job)
bash scripts/extraction_pipeline.sh --generate-schema https://shop.com "extract products"

# Step 2: fast extraction using the schema (no LLM)
bash scripts/extraction_pipeline.sh --use-schema https://shop.com generated_schema.json
```

`schema.json` is a `JsonCssExtractionStrategy` schema:

```json
{
  "name": "articles",
  "baseSelector": "article.post",
  "fields": [
    {"name": "title", "selector": "h2", "type": "text"},
    {"name": "date", "selector": ".date", "type": "text"}
  ]
}
```

## Advanced Patterns & Troubleshooting

For advanced crawling configurations, session management, dynamic content, proxy
configurations, and troubleshooting, see
[references/advanced-patterns.md](references/advanced-patterns.md).

## Resources

### scripts/ (bash + curl + jq — no interpreter required)
- **c4a.sh** — shared helpers: base URL/token, JWT resolution, `c4a_md` / `c4a_crawl` / `c4a_health`
- **basic_crawler.sh** — single-URL markdown extraction (`POST /md`)
- **batch_crawler.sh** — concurrent multi-URL processing (`POST /crawl`)
- **adaptive_crawler.sh** — adaptive crawling with relevance-ranked link following and automatic stopping
- **extraction_pipeline.sh** — schema-based + LLM extraction (`POST /crawl`, `POST /llm/job`)

### references/
- [rest-api.md](references/rest-api.md) — confirmed hosted REST endpoint shapes
- [reddit.md](references/reddit.md) — clean Reddit thread (post + comments + metadata) extraction with `reddit_thread_schema.json`
- [complete-sdk-reference.md](references/complete-sdk-reference.md) — full config-parameter reference (maps to `crawler_config` / `browser_config` JSON)
- [advanced-patterns.md](references/advanced-patterns.md) — advanced use cases, troubleshooting, dynamic content

## Skill Routing: hybrid-web-search ↔ crawl4ai

**Use hybrid-web-search instead of this skill when:**
- The user wants to search the open web without a specific target site in mind
- The task is a quick factual lookup — hybrid-web-search's bounded output is better
- You don't have a starting URL

**Complementary two-step pattern:**
1. `hybrid-web-search` identifies the canonical entry URL (e.g., the docs landing page for a library)
2. Hand that URL to adaptive crawling here for deep, comprehensive coverage:
   ```bash
   bash scripts/adaptive_crawler.sh <url_from_search> "<query>" --output kb.jsonl
   ```

**Stopping controls** (adaptive_crawler.sh):
- `--max-pages N` — hard cap on pages crawled (default 15)
- `--top-k K` — links followed per round (default 3)
- `--min-score S` — stop when the best candidate's keyword-overlap score drops below S (default 1)
