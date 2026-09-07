# Crawl4AI Hosted REST API

Confirmed endpoint shapes for the hosted Crawl4AI service (v0.9.0), verified
against `GET /openapi.json`. All requests take `Authorization: Bearer <token>`
and `Content-Type: application/json`. The scripts in `scripts/` wrap these.

## Connection

- **Base URL:** `CRAWL4AI_URL` / `CRAWL4AI_API_URL`
  (default `https://crawl4ai.service.internal.novuscotia.com`)
- **Auth:** `CRAWL4AI_AUTH_TOKEN` (default `dummy`). A JWT can be resolved from
  the raw token via `POST /token`; the raw token also works directly.

## Endpoints

### `GET /health`
Liveness. → `{"status":"ok","timestamp":...,"version":"0.9.0"}`

### `POST /md` — single-page markdown
Request (`MarkdownRequest`):
```json
{ "url": "https://…", "f": "fit", "q": "optional relevance query", "c": "0" }
```
- `f` (required-ish, default `fit`): `raw` | `fit` | `bm25` | `llm`
- `q`: query used by the `bm25` / `llm` filters
- `c`: cache-bust / revision counter (default `0`)

Response:
```json
{ "url": "…", "filter": "fit", "query": null, "cache": "0", "markdown": "<string>", "success": true }
```
Note: `markdown` is a **string** here (unlike `/crawl`, where it is an object).

### `POST /crawl` — multi-URL crawl
Request (`CrawlRequestWithHooks`):
```json
{
  "urls": ["https://…", "https://…"],
  "crawler_config": { "page_timeout": 45000, "remove_overlay_elements": true },
  "browser_config": { "headless": true, "user_agent": "…" },
  "hooks": null
}
```
- `urls` (required, 1–100)
- `crawler_config`: standard `CrawlerRunConfig` params (see
  `complete-sdk-reference.md`)
- `browser_config`: standard `BrowserConfig` params
- `crawler_configs`: optional per-URL config list (each may carry a `url_matcher`)

Response:
```json
{ "success": true, "results": [ { /* CrawlResult */ } ] }
```
Each `results[]` entry (key fields):
- `url`, `success`, `status_code`, `error_message`
- `markdown` — **object**: `{ "raw_markdown": "…", "fit_markdown": "…" }`
- `html`, `cleaned_html`, `fit_html`
- `links` — object: `{ "internal": [ {href, text, title, base_domain, …} ], "external": […] }`
- `media` — `{ "images": […], "videos": […] }`
- `metadata` — `{ "title", "description", … }`
- `extracted_content` — present when an `extraction_strategy` was used
- `screenshot`, `tables`, `pdf`, `network_requests`, `console_messages`, …

**Important:** `results[]` is **not** guaranteed to be in input order — match a
result to its URL via `.url`, not by index.

### `POST /llm/job` — async LLM extraction / schema generation
Request (`LlmJobPayload`):
```json
{ "url": "https://…", "q": "instruction or query", "schema": "…", "provider": "…", "temperature": 0.0, "cache": false }
```
- `url`, `q` required; `schema` optional (schema-based extraction)

Returns a job handle (async). Poll `GET /llm/job/<task_id>` for the result.

### `POST /token` — resolve a JWT
Request (`TokenRequest`): `{ "email": "agent@novuscotia.com", "api_token": "<raw>" }`
→ `{ "access_token": "…" }`

## Config shapes (validated against the official docs, v0.9.x)

`browser_config` and `crawler_config` accept the standard Crawl4AI config objects.
The full per-parameter detail lives in `complete-sdk-reference.md`; this is the
validated key/enum surface. **Validation:** endpoint shapes confirmed against the
service's `GET /openapi.json` (v0.9.0); config shapes confirmed against
`docs.crawl4ai.com` (v0.9.x) on 2026-09-07.

### `browser_config` — `BrowserConfig` (global browser settings)

| Key | Type / values |
| --- | --- |
| `browser_type` | `"chromium"` (default) \| `"firefox"` \| `"webkit"` |
| `headless` | bool (default `true`) |
| `browser_mode` | `"dedicated"` (default) \| `"builtin"` \| `"custom"` \| `"docker"` |
| `user_agent` | string |
| `viewport_width` / `viewport_height` | int (default 1080 / 600) |
| `viewport` | dict (overrides the width/height) |
| `device_scale_factor` | float (default 1.0) |
| `proxy_config` | string (e.g. `http://user:pass@host:8080`); `proxy` is deprecated |
| `cookies` / `headers` | object |
| `text_mode`, `override_navigator` | bool |
| `debugging_port` / `host` | int (9222) / string (`localhost`) |

### `crawler_config` — `CrawlerRunConfig` (per-crawl)

**Content processing:** `word_count_threshold` (int, ~200), `css_selector`,
`target_elements` (list), `excluded_tags` (list), `excluded_selector`, `only_text`
(bool), `prettiify` (bool), `keep_data_attributes` (bool), `keep_attrs` (list),
`extraction_strategy`, `chunking_strategy`, `markdown_generator`.

**Caching & session:** `cache_mode` (`CacheMode`), `session_id` (string),
`shared_data` (object). (Deprecated bools `bypass_cache` / `disable_cache` /
`no_cache_read` / `no_cache_write` map onto `cache_mode`.)

**Navigation & timing:** `wait_until` (`"domcontentloaded"` default, or
`"networkidle"`), `page_timeout` (ms, default 60000), `wait_for`
(`"css:selector"` or `"js:() => bool"`), `wait_for_timeout` (ms),
`wait_for_images` (bool), `delay_before_return_html` (s), `check_robots_txt`
(bool), `mean_delay` / `max_range` (floats), `semaphore_count` (int, default 5).

**Page interaction:** `js_code` (string or list), `js_code_before_wait`,
`c4a_script`, `js_only` (bool), `ignore_body_visibility` (bool),
`scan_full_page` (bool), `scroll_delay` (float), `max_scroll_steps` (int),
`process_iframes` (bool), `flatten_shadow_dom` (bool).

**Media handling:** `screenshot` (bool), `screenshot_wait_for` (float),
`screenshot_height_threshold` (int), `force_viewport_screenshot` (bool), `pdf`
(bool), `capture_mhtml` (bool), `exclude_external_images` / `exclude_all_images`
(bool), `table_score_threshold` (int), `table_extraction`.

### `CacheMode` enum
`ENABLED` (default) · `BYPASS` · `DISABLED` · `WRITE_ONLY` · `READ_ONLY` ·
`FORCE_FRESH`

### Strategy / generator / filter types
- **Extraction strategies** (`extraction_strategy`): `JsonCssExtractionStrategy`,
  `JsonXPathExtractionStrategy`, `LLMExtractionStrategy`,
  `CosineSimilarityExtractionStrategy`, `SemanticClusterExtractionStrategy`
- **Markdown generators** (`markdown_generator`): `DefaultMarkdownGenerator`
  (carries a `content_filter`), `MarkdownGenerator`
- **Content filters** (`content_filter`): `PruningContentFilter`,
  `BM25ContentFilter` (takes `user_query`), `LLMContentFilter`
- **`LLMConfig`** (provider, api_key, model, temperature, …) is passed to
  `LLMExtractionStrategy`, `LLMContentFilter`, `*.generate_schema`, and
  `AdaptiveConfig`.

When a strategy/generator is sent over REST, use the `{"type": "<Name>",
"params": {...}}` envelope (the service deserializes by `type`).

### `CrawlResult` fields (the `results[]` shape)
`url`, `success`, `status_code`, `error_message`, `redirected_url`, `html`,
`cleaned_html`, `fit_html`, `markdown` (**object**: `raw_markdown`,
`fit_markdown`), `extracted_content` (present when an extraction strategy ran),
`screenshot`, `pdf`, `mhtml`, `media` (`{images, videos}`), `links`
(`{internal, external}`), `metadata` (`{title, description, …}`), `tables`,
`network_requests`, `console_messages`, `crawl_stats`, `session_id`,
`ssl_certificate`, `response_headers`.

## Other endpoints (available, not wrapped by the scripts)

`GET /ask` (query: `context_type`, `query`, `score_ratio`, `max_results`),
`POST /html`, `POST /screenshot`, `POST /pdf`, `POST /execute_js`,
`POST /crawl/stream`, `POST /crawl/job` (+ `GET /crawl/job/<task_id>`),
`GET /mcp/schema`, `GET /config/dump`, `GET /metrics`, and a `/monitor/*`
family (browsers, requests, logs, stats).

## Discovering the API

`GET /openapi.json` returns the full OpenAPI 3.1 spec — use it to confirm a
request/response shape before relying on it.
