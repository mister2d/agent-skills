#!/usr/bin/env bash
# basic_crawler.sh — single-URL markdown extraction from the hosted service.
#
# Usage: basic_crawler.sh <url> [filter] [query]
#   filter: raw | fit | bm25 | llm   (default: fit)
#   query:  relevance query for the bm25/llm filters
#
# Prints the page markdown to stdout.
set -euo pipefail
source "$(dirname "$0")/c4a.sh"

[ $# -ge 1 ] || { echo "usage: $0 <url> [filter] [query]" >&2; exit 2; }
c4a_md "$1" "${2:-fit}" "${3:-}"
