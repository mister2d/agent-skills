#!/usr/bin/env bash
# c4a.sh — shared helpers for the crawl4ai hosted-service scripts.
#
# Interpreter-free: bash + curl + jq only. No Python, no local SDK, no browser.
# All crawling is delegated to a hosted Crawl4AI REST service.
#
# Connection settings (env):
#   CRAWL4AI_URL / CRAWL4AI_API_URL  — service base URL
#                                      (default: https://crawl4ai.service.internal.novuscotia.com)
#   CRAWL4AI_AUTH_TOKEN              — Bearer token (default: dummy)
#
# Source this from the other scripts:  source "$(dirname "$0")/c4a.sh"

C4A_URL="${CRAWL4AI_URL:-${CRAWL4AI_API_URL:-https://crawl4ai.service.internal.novuscotia.com}}"
C4A_TOKEN="${CRAWL4AI_AUTH_TOKEN:-dummy}"

# c4a_auth — print the Bearer token to use. Tries to resolve a JWT from the raw
# token (matching the old crawl_service.py); falls back to the raw token if the
# /token endpoint is absent or fails. The raw token works on its own.
c4a_auth() {
  local tok="$C4A_TOKEN"
  if [ -n "$C4A_TOKEN" ]; then
    local resp jwt
    resp=$(curl -s -m 10 -X POST "$C4A_URL/token" \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer $C4A_TOKEN" \
      -d "{\"email\":\"agent@novuscotia.com\",\"api_token\":\"$C4A_TOKEN\"}" 2>/dev/null || true)
    jwt=$(printf '%s' "$resp" | jq -r '.access_token // empty' 2>/dev/null || true)
    [ -n "$jwt" ] && tok="$jwt"
  fi
  printf '%s' "$tok"
}

# c4a_md <url> [filter] [query] — single-page markdown via POST /md.
# Prints the markdown string to stdout. filter: raw|fit|bm25|llm (default fit).
c4a_md() {
  local url="$1" f="${2:-fit}" q="${3:-}"
  local tok payload
  tok=$(c4a_auth)
  payload=$(jq -n --arg url "$url" --arg f "$f" --arg q "$q" \
    '{url:$url, f:$f} + (if $q != "" then {q:$q} else {} end)')
  curl -s -m 120 -X POST "$C4A_URL/md" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $tok" \
    -d "$payload" | jq -r '.markdown // empty'
}

# c4a_crawl <urls-json-array> [crawler-config-json] — multi-URL crawl via POST /crawl.
# Prints the raw JSON response (top-level .results[]).
c4a_crawl() {
  local urls="$1" cfg="${2:-{\}}"
  local tok payload
  tok=$(c4a_auth)
  payload=$(jq -n --argjson urls "$urls" --argjson cfg "$cfg" \
    '{urls:$urls, crawler_config:$cfg}')
  curl -s -m 180 -X POST "$C4A_URL/crawl" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $tok" \
    -d "$payload"
}

# c4a_health — liveness check; prints the /health body.
c4a_health() {
  curl -s -m 15 -H "Authorization: Bearer $C4A_TOKEN" "$C4A_URL/health"
}
