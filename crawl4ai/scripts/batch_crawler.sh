#!/usr/bin/env bash
# batch_crawler.sh — concurrent multi-URL markdown extraction from the hosted service.
#
# Usage: batch_crawler.sh <urls-file>
#   urls-file: one URL per line; blank lines and # comments are skipped.
#
# Prints one JSON object per line (JSONL): {url, success, markdown}.
set -euo pipefail
source "$(dirname "$0")/c4a.sh"

[ $# -ge 1 ] || { echo "usage: $0 <urls-file>" >&2; exit 2; }
urls_file="$1"
[ -f "$urls_file" ] || { echo "no such file: $urls_file" >&2; exit 2; }

# Build the JSON array of URLs (drop blank lines and # comments).
urls_json=$(grep -vE '^[[:space:]]*(#|$)' "$urls_file" | jq -R . | jq -s .)
[ "$(printf '%s' "$urls_json" | jq 'length')" -ge 1 ] || { echo "no URLs in $urls_file" >&2; exit 2; }

c4a_crawl "$urls_json" | jq -c '.results[] | {url, success, markdown: (.markdown.raw_markdown // .markdown // "")}'
