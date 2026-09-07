#!/usr/bin/env bash
# adaptive_crawler.sh — crawl a start URL, follow the most query-relevant links,
# and stop when coverage plateaus or max-pages is hit. Interpreter-free.
#
# Usage: adaptive_crawler.sh <start-url> "<query>" [options]
#   --max-pages N    stop after N pages total (default 15)
#   --top-k K        follow up to K links per round (default 3)
#   --min-score S    stop when the best candidate scores below S (default 1)
#   --output FILE    write the knowledge base as JSONL instead of stdout
#
# Relevance = number of distinct query keywords present in a link's text+title+href.
# Only same-host links are followed; nav chrome (text < 4 chars) is skipped.
#
# Output: one JSON object per crawled page — {url, relevance, markdown}.
set -euo pipefail
source "$(dirname "$0")/c4a.sh"

[ $# -ge 2 ] || { echo "usage: $0 <start-url> \"<query>\" [--max-pages N] [--top-k K] [--min-score S] [--output FILE]" >&2; exit 2; }
start_url="$1"; query="$2"
shift 2
max_pages=15; top_k=3; min_score=1; output=""

while [ $# -gt 0 ]; do
  case "$1" in
    --max-pages) max_pages="$2"; shift 2;;
    --top-k)     top_k="$2";     shift 2;;
    --min-score) min_score="$2"; shift 2;;
    --output)    output="$2";    shift 2;;
    *) echo "unknown arg: $1" >&2; exit 2;;
  esac
done

# Query keywords (lowercased, alnum, len>=3) as a JSON array.
keywords_json=$(printf '%s' "$query" | tr 'A-Z' 'a-z' | grep -oE '[a-z0-9]{3,}' | sort -u | jq -R . | jq -s .)
host_start=$(printf '%s' "$start_url" | sed -E 's#https?://##; s#/.*##')

kb_file="$(mktemp)"; trap 'rm -f "$kb_file"' EXIT

crawl_batch() { c4a_crawl "$1" '{"page_timeout":45000,"remove_overlay_elements":true}'; }
# get_md <crawl-response> <url> -> markdown for that url (results are NOT in input order).
get_md() { printf '%s' "$1" | jq -r --arg u "$2" '[.results[] | select(.url==$u)] | .[0].markdown.raw_markdown // .[0].markdown // ""'; }
# record <url> <score> <markdown>
record() { jq -n --arg url "$1" --argjson score "$2" --arg md "$3" '{url:$url, relevance:$score, markdown:$md}' >> "$kb_file"; }

declare -A visited

# Round 0: the start URL.
resp=$(crawl_batch "$(jq -n --arg u "$start_url" '[$u]')")
record "$start_url" 100 "$(get_md "$resp" "$start_url")"
visited["$start_url"]=1
pages=1
frontier_links=$(printf '%s' "$resp" | jq -c '.results[0].links.internal // []')

while [ "$pages" -lt "$max_pages" ]; do
  remaining=$((max_pages - pages))
  # Score + rank the frontier's links in one jq pass; keep the top-K, capped by
  # the remaining page budget so max-pages is a hard cap (not a soft one).
  picks=$(
    printf '%s' "$frontier_links" | jq -c \
      --argjson kws "$keywords_json" --arg host "$host_start" \
      --argjson min "$min_score" --argjson topk "$top_k" --argjson rem "$remaining" '
      [ .[]
        | ( ((.text // "") + " " + (.title // "") + " " + .href) | ascii_downcase ) as $hay
        | { href: .href,
            text: (.text // ""),
            score: ([ $kws[] | select($hay | contains(.)) ] | length) }
        | select( (.href | contains($host)) and (.score >= $min) and ((.text | length) >= 4) )
      ]
      | sort_by(-.score)
      | .[0:(if $topk < $rem then $topk else $rem end)]
    '
  )
  [ "$(printf '%s' "$picks" | jq 'length')" -ge 1 ] || break
  [ "$(printf '%s' "$picks" | jq '.[0].score')" -ge "$min_score" ] || break

  next_urls=$(printf '%s' "$picks" | jq -c '[.[].href]')
  resp=$(crawl_batch "$next_urls")
  last_links="[]"
  while IFS= read -r p; do
    u=$(printf '%s' "$p" | jq -r .href)
    s=$(printf '%s' "$p" | jq -r .score)
    [ -n "${visited[$u]:-}" ] && continue
    record "$u" "$s" "$(get_md "$resp" "$u")"
    visited["$u"]=1
    pages=$((pages+1))
    last_links=$(printf '%s' "$resp" | jq -c --arg u "$u" '[.results[] | select(.url==$u)] | .[0].links.internal // []')
  done < <(printf '%s' "$picks" | jq -c '.[]')
  frontier_links="$last_links"
  [ "$pages" -ge "$max_pages" ] && break
done

if [ -n "$output" ]; then
  cp "$kb_file" "$output"
  echo "wrote $pages pages to $output"
else
  cat "$kb_file"
fi
