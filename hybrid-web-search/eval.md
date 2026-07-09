**Cloud dependency verdict: clean.** All three external calls resolve to your `*.service.internal.novuscotia.com` endpoints. The `@orama/orama` package is fully in-process with no network calls. No plugins that touch cloud APIs (`plugin-secure-proxy`, `plugin-analytics`) are used. This is a genuinely airgapped pipeline.

---

**Bugs**

**1. `CrawlResult` imported from the wrong module in `rank.ts`**

```ts
import type { SearxngResult, RankedSnippet, RankedChunk, CrawlResult } from './types.js';
```

`CrawlResult` is defined in `crawl.ts`, not `types.ts`. This will fail at compile time. Fix:

```ts
import type { CrawlResult } from './crawl.js';
import type { SearxngResult } from './types.js';
```

`RankedSnippet` and `RankedChunk` are also imported but never used in `rank.ts` — dead imports.

---

**2. `crawl.ts` markdown extraction has a faulty guard and a dead branch**

Per your own SKILL.md: `markdown` is always a dict with a `raw_markdown` key, never a plain string. The current code:

```ts
const markdown = result.markdown ?? result.cleaned_html ?? '';
if (!markdown) return null;   // passes even when raw_markdown is empty, because the object is truthy

return {
  markdown: typeof result.markdown === 'string'   // always false — dead branch
    ? result.markdown
    : (result.markdown?.raw_markdown ?? ''),
};
```

The guard `if (!markdown)` will never reject an empty `raw_markdown` because `result.markdown` (the object) is truthy. Fix:

```ts
const rawMarkdown = result.markdown?.raw_markdown ?? result.cleaned_html ?? '';
if (!rawMarkdown) return null;

return {
  url,
  title: result.metadata?.title ?? url,
  markdown: rawMarkdown,
};
```

---

**3. `chunk.ts` is dead code**

`chunkText` is defined in `chunk.ts` but never imported or called anywhere. `rank.ts` reimplements the same paragraph-splitting logic inline — and hardcodes `512 * 4` instead of using `config.chunkTokenTarget`. Fix: use `chunkText` in `buildChunkIndex` and pass the token target through:

```ts
// rank.ts
import { chunkText } from './chunk.js';

export async function buildChunkIndex(
  crawled: CrawlResult[],
  query: string,
  chunkTokenTarget: number   // add param
) {
  ...
  const pageChunks = chunkText(page.markdown, chunkTokenTarget);
  ...
}
```

Then in `pipeline.ts`:
```ts
const chunkHits = await buildChunkIndex(crawled, query, config.chunkTokenTarget);
```

Right now `config.chunkTokenTarget` is wired up in `SearchConfig` and `DEFAULT_CONFIG` but has zero effect on runtime behavior.

---

**4. `crawlAll` sends N individual requests instead of one batch**

The Crawl4AI service accepts an array of URLs in a single request. `crawlAll` instead fires one request per URL in parallel. This is N round trips vs 1. Given the SKILL.md's documented batch API:

```ts
export async function crawlAll(urls: string[], timeoutMs: number): Promise<CrawlResult[]> {
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

With this change `crawlUrl` becomes unnecessary and can be removed.

---

**5. `searxng.ts` — `results` is not a valid SearXNG query parameter**

SearXNG controls results-per-page via instance configuration (`num_results`), not a per-request `results` param. The `results: String(resultCount)` entry in the URLSearchParams will be silently ignored. If you want to control result count per-query, you either need to configure the instance or use `pageno` with a known page size. Not a runtime crash, but `searxngResultCount` has no effect as written.

---

**Summary table**

| Issue | Severity | File |
|---|---|---|
| `CrawlResult` wrong import | Build error | `rank.ts` |
| Markdown guard always passes | Runtime bug (empty results) | `crawl.ts` |
| `chunk.ts` unused, logic duplicated with hardcoded constant | Logic bug + dead code | `rank.ts`, `chunk.ts` |
| `crawlAll` sends N requests instead of 1 batch | Performance | `crawl.ts` |
| `results` param not a valid SearXNG parameter | Config silently ignored | `searxng.ts` |
| `RankedSnippet`, `RankedChunk` unused imports | Lint/cleanliness | `rank.ts` |
