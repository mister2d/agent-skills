# Eval Bugfixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the 5 bugs identified in `eval.md` — a broken import, a faulty null guard, dead code with a disconnected config knob, N-request crawling instead of batch, and an inert SearXNG parameter.

**Architecture:** Pure refactoring across 4 source files. No new files, no new dependencies. `chunk.ts` gets deleted (its logic already lives in `rank.ts` — we wire in the real function). No test framework exists, so verification is manual `npx tsx` dry-import checks.

**Tech Stack:** TypeScript, `@orama/orama`, `tsx`

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src/search/rank.ts` | Modify | Fix imports, use `chunkText` from `chunk.ts`, accept `chunkTokenTarget` param |
| `src/search/crawl.ts` | Modify | Fix markdown null guard, replace `crawlAll` with single batch request, remove `crawlUrl` |
| `src/search/chunk.ts` | Keep (no changes) | Already correct — gets re-integrated via import in `rank.ts` |
| `src/search/searxng.ts` | Modify | Remove the inert `results` param |
| `src/search/pipeline.ts` | Modify | Pass `chunkTokenTarget` to `buildChunkIndex` |

---

### Task 1: Fix `rank.ts` imports

**Files:**
- Modify: `src/search/rank.ts:1-2`

- [ ] **Step 1: Replace the import block**

Change the top of `rank.ts` from:

```ts
import { create, insert, search } from '@orama/orama';
import type { SearxngResult, RankedSnippet, RankedChunk, CrawlResult } from './types.js';
```

To:

```ts
import { create, insert, search } from '@orama/orama';
import type { SearxngResult } from './types.js';
import type { CrawlResult } from './crawl.js';
```

This fixes the build error (`CrawlResult` is defined in `crawl.ts`, not `types.ts`) and removes the unused `RankedSnippet` and `RankedChunk` imports.

- [ ] **Step 2: Verify the import resolves**

Run: `npx tsx -e "import './src/search/rank.js'"`
Expected: exits 0, no errors.

- [ ] **Step 3: Commit**

```bash
git add src/search/rank.ts
git commit -m "fix: import CrawlResult from crawl.ts, remove dead imports in rank.ts"
```

---

### Task 2: Fix `crawl.ts` markdown null guard and batch crawling

**Files:**
- Modify: `src/search/crawl.ts` (full rewrite)

- [ ] **Step 1: Fix the markdown guard in `crawlUrl`**

In `crawlUrl`, replace lines 37-44:

```ts
    const markdown = result.markdown ?? result.cleaned_html ?? '';
    if (!markdown) return null;

    return {
      url,
      title: result.metadata?.title ?? url,
      markdown: typeof result.markdown === 'string' ? result.markdown : (result.markdown?.raw_markdown ?? ''),
    };
```

With:

```ts
    const rawMarkdown = result.markdown?.raw_markdown ?? result.cleaned_html ?? '';
    if (!rawMarkdown) return null;

    return {
      url,
      title: result.metadata?.title ?? url,
      markdown: rawMarkdown,
    };
```

This fixes two problems: the null guard now checks the actual string content (not the truthy wrapper object), and the dead `typeof` branch is gone.

- [ ] **Step 2: Replace `crawlAll` with a single batch request and remove `crawlUrl`**

Replace the entire file with:

```ts
const CRAWL4AI_BASE = 'https://crawl4ai.service.internal.novuscotia.com';

export interface CrawlResult {
  url: string;
  title: string;
  markdown: string;
}

export async function crawlAll(
  urls: string[],
  timeoutMs: number
): Promise<CrawlResult[]> {
  if (urls.length === 0) return [];

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const resp = await fetch(`${CRAWL4AI_BASE}/crawl`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ urls, extract: 'markdown', concurrent: urls.length }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!resp.ok) return [];

    const data = await resp.json();
    if (!data.success || !data.results) return [];

    return data.results
      .map((r: any) => ({
        url: r.url,
        title: r.metadata?.title ?? r.url,
        markdown: r.markdown?.raw_markdown ?? r.cleaned_html ?? '',
      }))
      .filter((r: CrawlResult) => r.markdown.length > 0);
  } catch {
    clearTimeout(timeout);
    return [];
  }
}
```

`crawlUrl` is removed — it was only called by the old `crawlAll`. The new `crawlAll` sends one batch request matching the Crawl4AI API documented in SKILL.md. The markdown extraction in the `.map()` uses the fixed guard logic from Step 1 (extract `raw_markdown` directly, fallback to `cleaned_html`, filter empties).

- [ ] **Step 3: Verify the module loads**

Run: `npx tsx -e "import './src/search/crawl.js'"`
Expected: exits 0, no errors.

- [ ] **Step 4: Commit**

```bash
git add src/search/crawl.ts
git commit -m "fix: batch crawlAll into single request, fix markdown null guard"
```

---

### Task 3: Wire `chunkText` into `rank.ts` and connect `chunkTokenTarget`

**Files:**
- Modify: `src/search/rank.ts:1-3` (add import)
- Modify: `src/search/rank.ts:35-86` (`buildChunkIndex` function)
- Modify: `src/search/pipeline.ts:110` (pass config param)

- [ ] **Step 1: Add `chunkText` import to `rank.ts`**

Add after the existing imports at the top of `rank.ts`:

```ts
import { chunkText } from './chunk.js';
```

- [ ] **Step 2: Add `chunkTokenTarget` parameter to `buildChunkIndex` and use `chunkText`**

Replace the `buildChunkIndex` function (lines 35-86) with:

```ts
export async function buildChunkIndex(
  crawled: CrawlResult[],
  query: string,
  chunkTokenTarget: number
) {
  const db = await create({
    schema: {
      id: 'string',
      url: 'string',
      title: 'string',
      chunk: 'string',
      chunkIndex: 'number',
    },
  });

  for (let i = 0; i < crawled.length; i++) {
    const page = crawled[i];
    const pageChunks = chunkText(page.markdown, chunkTokenTarget);

    for (let j = 0; j < pageChunks.length; j++) {
      await insert(db, {
        id: `${i}-${j}`,
        url: page.url,
        title: page.title,
        chunk: pageChunks[j],
        chunkIndex: j,
      });
    }
  }

  const hits = await search(db, {
    term: query,
    properties: ['title', 'chunk'],
    limit: 50,
  });

  return hits;
}
```

This removes the inline paragraph-splitting logic and the hardcoded `512 * 4`, replacing them with a call to `chunkText` (which already has the `>80 char` filter built in).

- [ ] **Step 3: Pass `chunkTokenTarget` from `pipeline.ts`**

In `pipeline.ts`, add `chunkTokenTarget` to the destructure on line 17:

```ts
  const {
    maxCrawlUrls,
    maxOutputChunks,
    searxngResultCount,
    crawlScoreThreshold,
    chunkTokenTarget,
    timeoutMs,
  } = config;
```

And update the `buildChunkIndex` call on line 110:

```ts
  const chunkHits = await buildChunkIndex(crawled, query, chunkTokenTarget);
```

- [ ] **Step 4: Verify the pipeline module loads**

Run: `npx tsx -e "import './src/search/pipeline.js'"`
Expected: exits 0, no errors.

- [ ] **Step 5: Commit**

```bash
git add src/search/rank.ts src/search/pipeline.ts
git commit -m "fix: use chunkText from chunk.ts, wire chunkTokenTarget through pipeline"
```

---

### Task 4: Remove inert `results` param from `searxng.ts`

**Files:**
- Modify: `src/search/searxng.ts:10-16`

- [ ] **Step 1: Remove the `results` parameter and the unused `resultCount` function argument**

In `searxng.ts`, change the function signature and params block from:

```ts
export async function fetchSearxngResults(
  query: string,
  resultCount: number,
  timeoutMs: number
): Promise<SearxngResult[]> {
  const params = new URLSearchParams({
    q: query,
    format: 'json',
    categories: 'general',
    engines: 'google,bing,duckduckgo',
    results: String(resultCount),
  });
```

To:

```ts
export async function fetchSearxngResults(
  query: string,
  timeoutMs: number
): Promise<SearxngResult[]> {
  const params = new URLSearchParams({
    q: query,
    format: 'json',
    categories: 'general',
    engines: 'google,bing,duckduckgo',
  });
```

The `resultCount` parameter is removed from the function signature because SearXNG does not support per-request result count control.

- [ ] **Step 2: Update the call site in `pipeline.ts`**

In `pipeline.ts`, change the `fetchSearxngResults` call (lines 26-30) from:

```ts
  const searxngResults = await fetchSearxngResults(
    query,
    searxngResultCount,
    timeoutMs
  );
```

To:

```ts
  const searxngResults = await fetchSearxngResults(query, timeoutMs);
```

And remove `searxngResultCount` from the destructure block (it's no longer used).

- [ ] **Step 3: Remove `searxngResultCount` from config**

In `config.ts`, remove `searxngResultCount` from the `SearchConfig` interface and `DEFAULT_CONFIG`:

Interface — remove:
```ts
  // SearXNG result count to fetch before ranking
  searxngResultCount: number;   // default: 10
```

Default — remove:
```ts
  searxngResultCount: 10,
```

- [ ] **Step 4: Update `HybridSearchResult` stats in `pipeline.ts`**

In `pipeline.ts`, the `stats.searxngResultCount` field currently reports `searxngResults.length` (the actual count returned). This is still useful observability — rename the stat to clarify it's the actual count, not a requested count. No change needed since it already uses `searxngResults.length`, which is the real count from the SearXNG response.

- [ ] **Step 5: Verify**

Run: `npx tsx -e "import './src/search/pipeline.js'"`
Expected: exits 0, no errors.

- [ ] **Step 6: Commit**

```bash
git add src/search/searxng.ts src/search/pipeline.ts src/search/config.ts
git commit -m "fix: remove inert searxngResultCount param (SearXNG ignores it)"
```

---

### Task 5: Final verification

- [ ] **Step 1: Full dry-import of the public API**

Run: `npx tsx -e "import { hybridSearch, DEFAULT_CONFIG } from './src/index.js'; console.log('OK', DEFAULT_CONFIG)"`
Expected: prints config object without `searxngResultCount`, exits 0.

- [ ] **Step 2: Verify no unused exports remain**

Run: `grep -rn "chunkText\|crawlUrl\|searxngResultCount" src/ --include='*.ts'`
Expected:
- `chunkText` appears in `chunk.ts` (definition) and `rank.ts` (import + usage) — 3 hits
- `crawlUrl` appears nowhere — 0 hits
- `searxngResultCount` appears nowhere — 0 hits

- [ ] **Step 3: Final commit (if any stragglers)**

Only if prior steps surfaced something missed.
