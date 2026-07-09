import type { SearxngResult } from './types.js';

const SEARXNG_BASE = 'https://searxng.service.internal.novuscotia.com';

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

  const url = `${SEARXNG_BASE}/search?${params}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const resp = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (!resp.ok) {
      throw new Error(`SearXNG HTTP ${resp.status}: ${resp.statusText}`);
    }

    const data = await resp.json();
    const rawResults = data.results as Array<Record<string, unknown>>;

    // Filter: must have content with at least 20 characters
    const results: SearxngResult[] = [];
    for (const r of rawResults) {
      const content = (r.content as string) ?? '';
      if (content.length >= 20) {
        results.push({
          url: r.url as string,
          title: r.title as string,
          content,
          score: r.score as number | undefined,
          engine: r.engine as string,
        });
      }
    }

    return results;
  } catch (err: unknown) {
    clearTimeout(timeout);
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`SearXNG unavailable: ${reason}`);
  }
}
