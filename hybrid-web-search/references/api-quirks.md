# API Quirks & Spec Mismatches

## Crawl4AI (crawl4ai.service.internal.novuscotia.com)

### Request body
- **Spec said**: `url` (string) — **Reality**: `urls` (string array)
- Extra fields (`word_count_threshold`, `only_text`, `bypass_cache`) accepted but optional

### Response shape
- **Spec said**: `{ success, result: { markdown, cleaned_html } }`
- **Reality**: `{ success, results: [{ markdown, cleaned_html, metadata }] }`
- `markdown` is a **dict** with `raw_markdown` key, NOT a plain string
- `metadata.title` available for page title
- Fall back to `cleaned_html` if `markdown` absent

### Pitfall
Always verify API shape before implementing. The spec was written against a v2-style interface; the actual service uses v3-style endpoints.

## Orama v3 (@orama/orama ^3.1.18)

### Key changes from v2
- API surface is compatible: `create`, `insert`, `search` with `properties`/`limit`
- New exports: `MODE_FULLTEXT_SEARCH`, `MODE_HYBRID_SEARCH`, `MODE_VECTOR_SEARCH` constants
- New function: `searchVector` for embedding-based retrieval
- Schema inference is stricter — always define schema explicitly

### Pitfall
The spec listed `^2.0.0` — v3 has breaking changes. Always verify package version before implementation.

## News Homepages & Chunking

### Problem
News homepages (NDTV, CBS News, etc.) are dominated by navigation, ads, and links. Chunking them on paragraph boundaries produces mostly navigation noise, not article content.

### Mitigation
- Search for specific article URLs, not news homepages
- Use more specific queries that surface individual articles
- Consider filtering out URLs that look like homepages (no article body content detected)
- The pipeline's `chunkText` function (min 80 chars filter) helps but doesn't fully solve this
