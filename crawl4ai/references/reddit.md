# Reddit threads via Crawl4AI

Tested against the hosted Crawl4AI 0.9.0 service (Oct 2026). New Reddit (shreddit) thread pages render fine,
but `raw_markdown` is ~45K chars of navigation/telemetry. The data is in custom-element **attributes**
(`<shreddit-post post-title score comment-count ...>`, `<shreddit-comment author score depth ...>`), so use
schema extraction instead of markdown.

## Standalone (no code)
```bash
# simplest: bounded markdown, with reply expansion
bash scripts/reddit_thread.sh "https://www.reddit.com/r/rust/comments/1rw12u6/<slug>/"

# or the raw schema route (JSON records)
C4A_CRAWLER_PARAMS='{"delay_before_return_html":3}' \
  bash scripts/extraction_pipeline.sh --use-schema \
  "https://www.reddit.com/r/rust/comments/1rw12u6/<slug>/" references/reddit_thread_schema.json
```
Output: JSON array — first record is the post (`title, author, score, comment_count, upvote_ratio, subreddit,
created_ts, post_body`), then one record per comment (`thingid, author, score, depth, created, permalink,
comment_body`). `delay_before_return_html: 3` is needed because comments hydrate late (without it ~1 in 3 fetches returned only 9 of 25).

`hybrid-web-search` does this automatically for `reddit.com/r/*/comments/*` URLs (`src/search/reddit.ts`) and renders
the records as markdown.

## Getting more than the first ~25 comments (measured on a 97-comment thread)
| Option | Server change | Comments | Time |
|---|---|---|---|
| default + `delay_before_return_html: 3` | none | 25 | ~5 s |
| + `scan_full_page: true, scroll_delay: 0.8, max_scroll_steps: 15` | none | 34 (40 steps: same 34) | ~17 s |
| **`/execute_js` clicks every "N more replies", then re-extract** | `CRAWL4AI_EXECUTE_JS_ENABLED=true` | **55** (46 of 103 on another) | ~7-9 s browser + ~1.4 s extract (~16 s end-to-end in the TS pipeline) |

The remaining ~40 are collapsed deeper chains/"continue this thread" links and deleted/removed comments counted in
`comment_count`; not reachable by "more replies" clicks.

How the expansion works (`scripts/reddit_thread.sh`, `src/search/reddit.ts`): `POST /execute_js` with a script that
clicks every `button` matching `/\d+ more repl|more comment/i` (up to 6 rounds, 2.2 s apart), take `.html`, then
`POST /crawl` with `urls:["raw:<html>"]` + the thread schema. The `return (async()=>…)()` form is required — see
`rest-api.md` → `/execute_js`.

`hybrid-web-search`: set `CRAWL4AI_REDDIT_EXPAND=true` to use this path (falls back to plain extraction on 403/timeout).
Off by default because it takes ~16 s per thread versus ~5 s.

## Limits (measured)
- Without expansion only the **server-rendered** comments are present (~25 of e.g. 97). `js_code` over `/crawl` is
  rejected by the 0.9.0 trust boundary; use `/execute_js` (see above).
- **Listing/search pages** (`/r/x/`, `/top/`, `/search/`) only server-render ~3 posts and sometimes a JS-challenge page —
  find threads with SearXNG (`site:reddit.com ...`) and extract the thread URLs.
- `old.reddit.com` redirects anonymous crawlers to a login wall — rewrite to `www.reddit.com`.
- `.json` endpoints return 403/500 (blocked), as does `oauth.reddit.com`.
- **Throttling:** ~40 requests in a short burst made the instance's IP get HTTP 500 for ~6 minutes (other sites unaffected).
  Space Reddit fetches (≥20 s apart worked 6/6). The expand path costs two requests per thread (browser fetch +
  local `raw:` re-extraction, which does not touch reddit.com).
