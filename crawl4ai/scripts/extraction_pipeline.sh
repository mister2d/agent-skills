#!/usr/bin/env bash
# extraction_pipeline.sh — structured extraction via the hosted service.
#
# Two modes:
#
#   --use-schema <url> <schema.json>
#     Fast, LLM-free extraction. Runs POST /crawl with a JsonCssExtractionStrategy
#     and prints the extracted content.
#
#   --generate-schema <url> "<instruction>"
#     One-time LLM call to produce a CSS schema. Submits POST /llm/job (async)
#     and prints the job handle; poll GET /llm/job/<task_id> for the result.
#
# schema.json shape (JsonCssExtractionStrategy):
#   { "name": "articles", "baseSelector": "article.post",
#     "fields": [ {"name":"title","selector":"h2","type":"text"} ] }
set -euo pipefail
source "$(dirname "$0")/c4a.sh"

mode="${1:-}"; shift || true
tok=$(c4a_auth)

case "$mode" in
  --use-schema)
    url="${1:-}"; schema_file="${2:-}"
    [ -n "$url" ] && [ -n "$schema_file" ] || { echo "usage: $0 --use-schema <url> <schema.json>" >&2; exit 2; }
    [ -f "$schema_file" ] || { echo "no such file: $schema_file" >&2; exit 2; }
    schema=$(cat "$schema_file")
    payload=$(jq -n --arg u "$url" --argjson s "$schema" \
      '{urls:[$u], crawler_config:{extraction_strategy:{type:"JsonCssExtractionStrategy", params:{schema:$s}}}}')
    curl -s -m 180 -X POST "$C4A_URL/crawl" \
      -H "Content-Type: application/json" -H "Authorization: Bearer $tok" \
      -d "$payload" | jq '.results[0].extracted_content // .results[0]'
    ;;
  --generate-schema)
    url="${1:-}"; instr="${2:-}"
    [ -n "$url" ] && [ -n "$instr" ] || { echo "usage: $0 --generate-schema <url> \"<instruction>\"" >&2; exit 2; }
    # Async LLM job: {url, q, schema?}. Prints the job handle; poll /llm/job/<task_id>.
    curl -s -m 60 -X POST "$C4A_URL/llm/job" \
      -H "Content-Type: application/json" -H "Authorization: Bearer $tok" \
      -d "$(jq -n --arg u "$url" --arg i "$instr" '{url:$u, q:("Generate a JsonCssExtractionStrategy schema to: " + $i)}')"
    echo
    echo "# poll the returned task id:  curl -s -H \"Authorization: Bearer $tok\" \"$C4A_URL/llm/job/<task_id>\"" >&2
    ;;
  *)
    echo "usage: $0 --use-schema <url> <schema.json> | --generate-schema <url> \"<instruction>\"" >&2; exit 2;;
esac
