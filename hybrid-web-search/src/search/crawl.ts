const CRAWL4AI_BASE = process.env.CRAWL4AI_URL ?? process.env.CRAWL4AI_API_URL ?? 'https://crawl4ai.service.internal.novuscotia.com';
const CRAWL4AI_TOKEN = process.env.CRAWL4AI_AUTH_TOKEN ?? 'dummy';

export interface CrawlResult {
  url: string;
  title: string;
  markdown: string;
}

// Resolve a Bearer token: try the service's /token endpoint with the raw token,
// fall back to the raw token itself (mirrors c4a.sh in the crawl4ai skill).
async function resolveAuthToken(timeoutMs: number): Promise<string> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const resp = await fetch(`${CRAWL4AI_BASE}/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${CRAWL4AI_TOKEN}`,
      },
      body: JSON.stringify({ email: 'agent@example.com', api_token: CRAWL4AI_TOKEN }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (resp.ok) {
      const data = await resp.json();
      if (data.access_token) return data.access_token;
    }
  } catch {
    // /token endpoint absent or unreachable — raw token still works.
  }
  return CRAWL4AI_TOKEN;
}

export async function crawlAll(
  urls: string[],
  query: string,
  timeoutMs: number
): Promise<CrawlResult[]> {
  if (urls.length === 0) return [];

  const token = await resolveAuthToken(10000);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const resp = await fetch(`${CRAWL4AI_BASE}/crawl`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      // Pass query so the service can apply BM25 content filtering (fit_markdown)
      body: JSON.stringify({ urls, query, extract: 'markdown', concurrent: urls.length }),
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
        // Prefer BM25-filtered fit_markdown when available (requires query param);
        // fall back to raw_markdown, then cleaned_html
        markdown:
          r.markdown?.fit_markdown ||
          r.markdown?.raw_markdown ||
          r.cleaned_html ||
          '',
      }))
      .filter((r: CrawlResult) => r.markdown.length > 0);
  } catch {
    clearTimeout(timeout);
    return [];
  }
}
