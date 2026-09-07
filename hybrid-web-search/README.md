# hybrid-web-search

A bounded, two-stage web research pipeline. Searches the open web via SearXNG, ranks results with BM25, crawls the most relevant pages via Crawl4AI, chunks and re-ranks the content, and returns a fixed number of the most relevant passages — never a full page dump.

## Architecture

```
Query
  └─► SearXNG (Google / Bing / DuckDuckGo)
        └─► Orama BM25 — rank snippets
              ├─ score < threshold → return top snippets (fast path)
              └─ score ≥ threshold → crawl top 3 URLs via Crawl4AI
                    └─► chunk pages (~512 tokens) → Orama BM25 → return top 5 chunks
```

The two BM25 stages are complementary, not redundant:
- **Stage 1 (snippet ranking)** decides *which pages* are worth crawling
- **Stage 2 (chunk ranking)** selects *which passages* within those pages answer the query

Crawl4AI's server-side BM25 content filter (`fit_markdown`) is also applied during crawl, stripping navigation noise before the chunks reach stage 2.

## Requirements

Two internal services must be reachable:

| Service | Default endpoint |
|---|---|
| SearXNG | `https://searxng.service.internal.novuscotia.com` |
| Crawl4AI | `https://crawl4ai.service.internal.novuscotia.com/crawl` |

Node.js and `tsx` are the only runtime dependencies (`npm install`).

## Usage

```bash
npm install
npx tsx run.mjs "<your search query>"
```

The pipeline is also importable as a TypeScript module:

```typescript
import { hybridSearch } from './src/search/pipeline.js';

const result = await hybridSearch('async context managers python', {
  maxCrawlUrls: 3,       // URLs to crawl after snippet ranking
  maxOutputChunks: 5,    // Max passages returned
  crawlScoreThreshold: 0.5,  // Minimum snippet score to trigger crawl
  chunkTokenTarget: 512, // Target chunk size in tokens
  timeoutMs: 8000,       // Per-request timeout
});
```

Each item in `result.items` is either a `RankedSnippet` (`crawled: false`) or a `RankedChunk` (`crawled: true`). `result.stats` always includes counts for observability.

## Direct Crawl4AI Access

The Crawl4AI service can be called directly (bypassing the search pipeline) when you already have specific URLs:

```http
POST https://crawl4ai.service.internal.novuscotia.com/crawl
Content-Type: application/json

{
  "urls": ["https://example.com/page1"],
  "query": "your query",
  "extract": "markdown",
  "concurrent": 3
}
```

Response shape: `{ success, results: [{ url, markdown: { fit_markdown, raw_markdown }, cleaned_html, metadata: { title } }] }`

Content priority: `fit_markdown` (BM25-filtered, returned when `query` is provided) → `raw_markdown` → `cleaned_html`.

## Known Site Behaviours

| Site | Behaviour |
|---|---|
| Reuters | Returns HTTP 401 — use AP News or BBC as alternative |
| CNN | Returns 50–65K chars of markdown dominated by navigation noise; filter for paragraphs > 100 chars |
| News homepages | Navigation-heavy; prefer specific article URLs |
| Reddit | Blocks direct HTTP requests; crawl via Crawl4AI or use hybrid-search through SearXNG |
| NYT / WSJ | Paywalled; crawler receives no article content |

## When to Use This vs. crawl4ai

Use **hybrid-web-search** when:
- You need to search across the open web without a known target URL
- A quick, bounded answer is sufficient (top 5 passages)
- You want multi-source aggregation (Google + Bing + DuckDuckGo simultaneously)

Escalate to the **crawl4ai** skill when:
- You have a specific site or domain to crawl comprehensively
- The task requires structured data extraction (prices, changelogs, listings)
- The source requires JavaScript login or session persistence

**Recommended two-step pattern:**

1. Run hybrid-web-search to identify the canonical entry URL
2. Pass that URL to the crawl4ai skill's adaptive crawler for deep coverage (run from the crawl4ai skill directory):
   ```bash
   bash scripts/adaptive_crawler.sh <url> "<query>" --output kb.jsonl
   ```

## References

- `references/api-quirks.md` — Crawl4AI v3 and Orama v3 API quirks and spec mismatches
- `references/health-medical-search.md` — Multi-stage search strategy for health/medical queries
- `references/news-site-crawling.md` — Per-site crawl characteristics and URL patterns
- `src/search/` — Pipeline source: `pipeline.ts`, `crawl.ts`, `rank.ts`, `chunk.ts`, `searxng.ts`
