const CRAWL4AI_BASE = 'https://crawl4ai.service.internal.novuscotia.com';

export interface CrawlResult {
  url: string;
  title: string;
  markdown: string;
}

export async function crawlAll(
  urls: string[],
  query: string,
  timeoutMs: number
): Promise<CrawlResult[]> {
  if (urls.length === 0) return [];

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const resp = await fetch(`${CRAWL4AI_BASE}/crawl`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
