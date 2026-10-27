#!/usr/bin/env bash
# reddit_thread.sh — clean Reddit thread (post + comments + metadata) as bounded markdown.
#
# Usage: reddit_thread.sh <thread-url> [--no-expand] [--raw-json]
#   --no-expand  skip "N more replies" expansion (faster, ~25 comments instead of ~55)
#   --raw-json   print the extracted records as JSON instead of markdown
#
# Flow: POST /execute_js (expand replies; needs CRAWL4AI_EXECUTE_JS_ENABLED=true on the server)
#       -> POST /crawl with raw:<expanded html> + references/reddit_thread_schema.json
#       -> jq formats markdown. Falls back to a plain /crawl fetch if expansion is unavailable.
# Output is capped at C4A_MAX_CHARS (default 30000); the page HTML never reaches stdout.
# Reddit throttles bursts: space calls >= 20 s apart.
set -euo pipefail
source "$(dirname "$0")/c4a.sh"

url="${1:-}"; shift || true
expand=1; rawjson=0
for a in "$@"; do case "$a" in --no-expand) expand=0;; --raw-json) rawjson=1;; *) echo "unknown arg: $a" >&2; exit 2;; esac; done
printf '%s' "$url" | grep -qE '^https?://([a-z]+\.)?reddit\.com/r/[^/]+/comments/[a-z0-9]+' \
  || { echo "usage: $0 <reddit thread url> [--no-expand] [--raw-json]" >&2; exit 2; }
url=$(printf '%s' "$url" | sed -E 's#^(https?://)(old|new)\.reddit\.com#\1www.reddit.com#')

schema_file="$(dirname "$0")/../references/reddit_thread_schema.json"
tok=$(c4a_auth)
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT

# NB: execute_js only awaits a *returned* promise, hence the leading "return".
expand_js='return (async()=>{const s=ms=>new Promise(r=>setTimeout(r,ms));for(let i=0;i<6;i++){const b=[...document.querySelectorAll("button")].filter(x=>/\d+ more repl|more comment/i.test((x.innerText||"").trim()));if(!b.length)break;b.slice(0,15).forEach(x=>{try{x.click()}catch(e){}});await s(2200)}return document.querySelectorAll("shreddit-comment").length})()'

extracted=""
if [ "$expand" = 1 ]; then
  jq -n --arg u "$url" --arg js "$expand_js" '{url:$u, scripts:[$js]}' > "$tmp/ex_req.json"
  if curl -s -m 120 -X POST "$C4A_URL/execute_js" -H "Content-Type: application/json" -H "Authorization: Bearer $tok" \
       -d @"$tmp/ex_req.json" | jq -r '.html // empty' > "$tmp/page.html" && [ -s "$tmp/page.html" ]; then
    jq -n --rawfile h "$tmp/page.html" --slurpfile s "$schema_file" \
      '{urls:["raw:"+$h], crawler_config:{type:"CrawlerRunConfig", params:{extraction_strategy:{type:"JsonCssExtractionStrategy", params:{schema:$s[0]}}}}}' > "$tmp/raw_req.json"
    extracted=$(curl -s -m 120 -X POST "$C4A_URL/crawl" -H "Content-Type: application/json" -H "Authorization: Bearer $tok" \
       -d @"$tmp/raw_req.json" | jq -r '.results[0].extracted_content // empty')
  else
    echo "note: expansion unavailable (execute_js disabled?) — using plain fetch" >&2
  fi
fi
if [ -z "$extracted" ]; then
  jq -n --arg u "$url" --slurpfile s "$schema_file" \
    '{urls:[$u], crawler_config:{type:"CrawlerRunConfig", params:{delay_before_return_html:3, extraction_strategy:{type:"JsonCssExtractionStrategy", params:{schema:$s[0]}}}}}' > "$tmp/req.json"
  extracted=$(curl -s -m 120 -X POST "$C4A_URL/crawl" -H "Content-Type: application/json" -H "Authorization: Bearer $tok" \
     -d @"$tmp/req.json" | jq -r '.results[0].extracted_content // empty')
fi
[ -n "$extracted" ] || { echo "no content (blocked, throttled, or JS challenge) — retry in a few minutes" >&2; exit 1; }

if [ "$rawjson" = 1 ]; then printf '%s' "$extracted" | jq --argjson m "$C4A_CAP" "$C4A_JQ_CAP"' tojson | cap($m)' -r; exit 0; fi

printf '%s' "$extracted" | jq -r --argjson m "$C4A_CAP" "$C4A_JQ_CAP"'
  . as $rows
  | ([$rows[] | select((.id // "") | startswith("t3_"))] | .[0]) as $p
  | if $p == null then "No post record found (blocked or JS challenge)" else
    ([$rows[] | select((.thingid // "") != "" and ((.comment_body // "") | gsub("\\s+"; " ") | length) > 0)]) as $c
    | ("# " + $p.title + "\n"
       + ($p.subreddit // "") + " · u/" + ($p.author // "[deleted]") + " · " + ($p.score // "?") + " points · "
       + ($p.comment_count // "?") + " comments · " + (($p.created_ts // "")[0:10])
       + (if ($p.post_body // "") != "" then "\n\n" + $p.post_body else "" end)
       + "\n\n## Comments (showing " + ($c | length | tostring) + " of " + ($p.comment_count // "?") + ")\n\n"
       + ($c | map((([range(0; ((.depth // "0") | tonumber? // 0))] | map("  ") | join("")))
            + "- u/" + (.author // "[deleted]") + " (" + (.score // "?") + " pts): "
            + ((.comment_body) | gsub("\\s+"; " ") | ltrimstr(" "))) | join("\n\n")))
      | cap($m)
    end'
