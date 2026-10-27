# Reddit threads via Crawl4AI

Tested against the hosted Crawl4AI 0.9.0 service (Oct 2026). New Reddit (shreddit) thread pages render fine,
but `raw_markdown` is ~45K chars of navigation/telemetry. The data is in custom-element **attributes**
(`<shreddit-post post-title score comment-count ...>`, `<shreddit-comment author score depth ...>`), so use
schema extraction instead of markdown.

## Standalone (no code)
```bash
C4A_CRAWLER_PARAMS='{"delay_before_return_html":3}' \
  bash scripts/extraction_pipeline.sh --use-schema \
  "https://www.reddit.com/r/rust/comments/1rw12u6/<slug>/" references/reddit_thread_schema.json
```
Output: JSON array — first record is the post (`title, author, score, comment_count, upvote_ratio, subreddit,
created_ts, post_body`), then one record per comment (`thingid, author, score, depth, created, permalink,
comment_body`). `delay_before_return_html: 3` is needed because comments hydrate late (without it ~1 in 3 fetches returned only 9 of 25).

`hybrid-web-search` does this automatically for `reddit.com/r/*/comments/*` URLs (`src/search/reddit.ts`) and renders
the records as markdown.

## Getting more than the first ~25 comments (measured)
| Option | Server change | Result on a 97-comment thread |
|---|---|---|
| default + `delay_before_return_html: 3` | none | 25 comments, ~5 s |
| add `scan_full_page: true, scroll_delay: 0.8, max_scroll_steps: 15` | none | 34 comments, ~17 s (plateaus: 40 steps gave the same 34) |
| click "more replies" via `/execute_js` | `CRAWL4AI_EXECUTE_JS_ENABLED=true` (server.py:98) | **not validated yet** — see below |

`scan_full_page` is too slow for the hybrid pipeline's 8 s crawl timeout, so the pipeline uses the 3 s delay only;
use `scan_full_page` for standalone extraction when depth matters.

`/execute_js` takes only `{url, scripts}` and returns the post-JS CrawlResult (HTML), with no extraction strategy; the
`/crawl` endpoint will never accept `js_code` from network callers (always untrusted, even with the admin token).
So the flow would be: expand comments with `/execute_js`, then run the schema over the returned HTML.

## Limits (measured)
- Only the **server-rendered** comments are present (~25 of e.g. 97). "Load more" needs scroll/click JS: `js_code` is
  rejected by the 0.9.0 trust boundary and the gateway's `execute_js` returns 403 until the server sets
  `CRAWL4AI_EXECUTE_JS_ENABLED=true`.
- **Listing/search pages** (`/r/x/`, `/top/`, `/search/`) only server-render ~3 posts and sometimes a JS-challenge page —
  find threads with SearXNG (`site:reddit.com ...`) and extract the thread URLs.
- `old.reddit.com` redirects anonymous crawlers to a login wall — rewrite to `www.reddit.com`.
- `.json` endpoints return 403/500 (blocked), as does `oauth.reddit.com`.
- **Throttling:** ~40 requests in a short burst made the instance's IP get HTTP 500 for ~6 minutes (other sites unaffected).
  Space Reddit fetches (≥20 s apart worked 6/6).
