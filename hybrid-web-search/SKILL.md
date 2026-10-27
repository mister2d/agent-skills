---
name: hybrid-web-search
description: Fast multi-source web research pipeline (SearXNG → BM25 ranking → Crawl4AI → chunk ranking). Use for broad research questions that require searching across the open web. For deep crawling of a specific known domain or site, use the crawl4ai skill after this one surfaces the right entry URL.
---

# Hybrid Web Search Pipeline

## Overview
TypeScript pipeline combining SearXNG (search), Crawl4AI (extraction), and Orama v3 (BM25 ranking) into a context-budget-aware search tool. Output is always bounded — never returns full pages.

## Run
Run from this skill's directory (wherever this `SKILL.md` lives in your agent's
skills directory — the skill is not tied to any particular harness):
```bash
cd <path/to/this/skill/directory>
npx tsx run.mjs "<your search query>"
```
Requires Node 18+ (native `fetch`). Dependencies install with `npm install`.

## Configuration (environment variables)
All optional — the defaults below are baked in:

- `SEARXNG_URL` — SearXNG service base URL. Default: `https://searxng.service.internal.novuscotia.com`
- `CRAWL4AI_URL` (or `CRAWL4AI_API_URL`) — Crawl4AI service base URL. Default: `https://crawl4ai.service.internal.novuscotia.com`
- `CRAWL4AI_AUTH_TOKEN` — Bearer token for Crawl4AI. Default: `dummy`

## Service Endpoints
- **SearXNG**: `${SEARXNG_URL:-https://searxng.service.internal.novuscotia.com}`
- **Crawl4AI**: `${CRAWL4AI_URL:-https://crawl4ai.service.internal.novuscotia.com}/crawl`

## Architecture
1. **SearXNG** fetches results from Google/Bing/DuckDuckGo
2. **Orama** ranks snippets via BM25
3. If top score >= threshold (0.5): crawl top 3 URLs with Crawl4AI
4. **Chunk** crawled pages on paragraph boundaries (~512 tokens)
5. **Orama** ranks chunks via BM25
6. Return top 5 items (either snippets or chunks)

## Config (defaults)
- `maxCrawlUrls`: 3
- `maxOutputChunks`: 5
- `chunkTokenTarget`: 512
- `crawlScoreThreshold`: 0.5
- `searxngResultCount`: 10
- `timeoutMs`: 8000

## Ad-Hoc Web Page Crawling (Crawl4AI Direct)
The Crawl4AI service can also be used standalone to crawl specific URLs without going through the hybrid search pipeline. Use this when the user asks to crawl a specific website or page.

### Interface choice
For a **single** URL when you only need relevant text, prefer the gateway tool `crawl4ai.md(url=..., f="bm25", q="<query>")` (same service, small bounded response, no auth/bash needed). Use the REST call below for multiple URLs, extraction, or when running outside the agent. Do **not** use gateway `crawl4ai.crawl`/`.html`/`.execute_js`/`.screenshot` for large pages: the gateway echoes the full raw response (HTML/base64) into context. See `crawl4ai` skill → *Choosing an interface*.

### How to use
1. Collect the list of URLs to crawl (from user input, search results, or other sources)
2. Send a POST request to `https://crawl4ai.service.internal.novuscotia.com/crawl` with:
   ```json
   {
     "urls": ["https://example.com/page1", "https://example.com/page2"],
     "crawler_config": {
       "type": "CrawlerRunConfig",
       "params": {
         "markdown_generator": {
           "type": "DefaultMarkdownGenerator",
           "params": {
             "content_filter": { "type": "BM25ContentFilter", "params": { "user_query": "your search query here" } }
           }
         }
       }
     }
   }
   ```
3. Parse the response: `{ success, results: [{ url, markdown: { fit_markdown, raw_markdown }, cleaned_html, metadata: { title } }] }`
4. Prefer content in priority order: `fit_markdown` → `raw_markdown` → `cleaned_html`
   - `fit_markdown` is BM25-filtered to the query (only populated when the `BM25ContentFilter` above is sent); it's shorter and more relevant. It can be empty/near-empty on index pages (Hacker News, Reddit) — fall back to `raw_markdown` when it is under ~200 chars (the pipeline's `pickMarkdown` does this)
   - `raw_markdown` is the full page converted to markdown
   - `cleaned_html` is a fallback when markdown generation fails

### Config options
- `crawler_config.params.markdown_generator.params.content_filter.params.user_query`: the query for server-side BM25 filtering (produces `fit_markdown`)
- **Do not send** the legacy flat fields `query`, `extract`, `concurrent` — Crawl4AI 0.9.0 silently ignores them, so no filtering happens and responses are ~6x larger
- Several URLs in one request are crawled in parallel by the server
- Response: a URL that fails inside a batch comes back as `success:false` with `status_code`/`error_message` (e.g. `401 Blocked by anti-bot protection: DataDome captcha`); if **every** URL fails the service returns HTTP 500 with no detail

### 0.9.0 trust boundary (API callers)
The service rejects these config fields from API requests ("not permitted ... from an untrusted request"): `magic`, `simulate_user`, `override_navigator`, `js_code`, `fallback_fetch_function`, `proxy_config`. Accepted and verified: `enable_stealth`, `user_agent_mode`, `text_mode` (browser_config), `wait_until`, `page_timeout`. `enable_stealth` + random UA did **not** unblock Reuters/NYT/Stack Overflow in testing.

### Pitfalls for ad-hoc crawling
- **Rate limits**: Don't exceed 10 URLs per request. Batch larger lists.
- **Reuters returns 401**: Reuters aggressively blocks crawler requests with HTTP 401. This is not intermittent — Reuters consistently returns 401 from Crawl4AI. Always have an alternative source ready (e.g., AP, BBC, or cross-reference via JustSecurity.org early-edition digests).
- **CNN returns massive navigation noise**: CNN articles return 50K–65K chars of markdown, but the majority is navigation, ad feedback forms, and site structure. Content paragraphs are buried among thousands of lines of UI noise. Always filter for substantial paragraphs (>100 chars, not starting with navigation patterns).
- **Homepages are noisy**: Crawling a homepage (e.g., cnn.com/world) returns navigation, ads, and scripts — not article content. Prefer specific article URLs.
- **JavaScript-heavy sites**: CNN, Reuters, and BBC render content via JavaScript. The Crawl4AI service may return minimal content. Try multiple times or use alternative sources.
- **Paywalls**: Some sites (NYT, WSJ) block crawlers entirely. Note paywall limitations to the user.
- **Fallback strategy**: When primary sources (Reuters/CNN) block, cross-reference with JustSecurity.org early-edition digests, AP News, or BBC for curated multi-source summaries.

## API
- `hybridSearch(query, config)` → `HybridSearchResult`
- Each item is either `RankedSnippet` (crawled: false) or `RankedChunk` (crawled: true)
- Always includes `stats` for observability
- Direct Crawl4AI: POST to crawl endpoint with `{ urls: [...], extract: "markdown" }`

## Crawl4AI Response Format
- Expects `urls` (array) in request body; optionally `query` for BM25 content filtering
- Returns `{ success, results: [...] }` array
- `markdown` is a dict with `fit_markdown` (BM25-filtered, when query provided) and `raw_markdown` keys
- Priority: `fit_markdown` → `raw_markdown` → `cleaned_html`

## Orama v3 Notes
- `create`, `insert`, `search` with `properties`/`limit`
- `MODE_FULLTEXT_SEARCH`, `MODE_HYBRID_SEARCH`, `MODE_VECTOR_SEARCH` constants available for future embedding layer
- `searchVector` function available for future use

## Pitfalls
- **News homepages don't chunk well** — they're navigation-heavy. Search for specific articles, not homepage URLs.
- **Direct URL searches can return irrelevant social media results** — searching for a specific article URL (e.g., from a VideoCardz news slug) may return Facebook, YouTube, or other social pages instead of the target. Use site-scoped queries (`site:videocardz.com`) or search by article title instead.
- **Crawl4AI request uses `urls` (array), not `url` (singular)** — see `references/api-quirks.md`
- **Crawl4AI `markdown` is a dict with `raw_markdown` key** — not a plain string
- **Always verify API shapes before implementing** — specs may be wrong
- **Reddit JSON API requires correct endpoint format** — use `/r/{subreddit}/top/.json?limit=N` not `/r/{subreddit}/top.json?t=day&limit=N`. The latter returns HTML error pages due to network security blocks. Always include `User-Agent: DailyDigestBot/1.0` header.
- **Reddit API blocks unauthenticated requests** — network security returns HTML error pages. The working endpoint is `https://www.reddit.com/r/{subreddit}/top/.json?limit={N}` which returns JSON directly.
- **Hacker News top stories endpoint** — fetch IDs from `https://hacker-news.firebaseio.com/v0/topstories.json`, then fetch individual items via `https://hacker-news.firebaseio.com/v0/item/{ID}.json`.
- **Health/medical topic searches require multi-stage refinement** — initial broad queries (e.g., "hantavirus USA 2026") often return European results or cruise ship outbreaks. Strategy: (1) start with `site:cdc.gov` or `site:who.int` to anchor to authoritative sources, (2) add specific disease names (e.g., "Andes virus" vs generic "hantavirus"), (3) specify geographic focus and time range. Avoid single-site queries that return zero results; combine `site:` with broader terms instead.
- **Reddit threads are handled natively**: URLs matching `reddit.com/r/*/comments/*` are fetched through Crawl4AI schema extraction and rendered as clean markdown (post, score, up to ~25 server-rendered comments, indented by depth). Set `CRAWL4AI_REDDIT_EXPAND=true` to also expand "N more replies" (≈55 instead of 25 comments, ~16 s/thread; needs `CRAWL4AI_EXECUTE_JS_ENABLED=true` on the server). Output is capped at 60K chars. Listing/search pages are not supported (find threads via SearXNG). Details and limits: `crawl4ai/references/reddit.md`. Reddit throttles bursts — see that doc.
- **Reddit blocks direct HTTP requests with HTTP 403** — even with a User-Agent header, a direct request to `https://www.reddit.com/...` returns 403. The workaround: use Crawl4AI to crawl Reddit pages instead of hitting the API directly. If you need Reddit JSON data, use the hybrid-web-search pipeline (which goes through SearXNG) or crawl the page via Crawl4AI and extract text from the rendered HTML.

## Skill Handoff: When to Escalate to crawl4ai

Use the crawl4ai skill (not this pipeline) when:
- The user wants **comprehensive coverage of a specific site or domain** (e.g., "read everything in the docs about X")
- The task requires **structured data extraction** from a known page pattern (prices, changelogs, listings)
- The source requires **JavaScript login or session management** beyond what the service handles
- The top-ranked result is a documentation site and the user needs more than the top 5 chunks

**Recommended two-step pattern:**
1. Run `hybrid-web-search` to identify the canonical entry URL for the topic
2. Hand that URL + query to the crawl4ai skill's adaptive crawler (run from the crawl4ai skill dir): `bash scripts/adaptive_crawler.sh <url> "<query>" --output kb.jsonl`

## References
- `references/api-quirks.md` — Crawl4AI and Orama v3 API quirks, spec-vs-reality mismatches, news chunking notes
- `references/health-medical-search.md` — Health/medical topic search strategy, authoritative sources, and pitfalls for CDC/WHO/AP News queries
- `references/news-site-crawling.md` — Crawling characteristics for major news sites (Reuters, CNN, JustSecurity.org), URL patterns, and content extraction tips
