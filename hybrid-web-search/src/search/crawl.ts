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

// Below this size a BM25-filtered fit_markdown is treated as "filter found almost nothing"
// (e.g. index pages like news.ycombinator.com yield ~1 char) and raw_markdown is used instead,
// so the pipeline's own chunk ranking can still work on the full page.
const MIN_FIT_CHARS = 200;

/**
 * Crawl4AI >= 0.9.0 request body. The legacy flat fields ({ query, extract, concurrent })
 * are silently ignored by the server, so BM25 filtering must be requested via
 * crawler_config.markdown_generator.content_filter.
 */
export function buildCrawlBody(urls: string[], query: string) {
  return {
    urls,
    crawler_config: {
      type: 'CrawlerRunConfig',
      params: {
        markdown_generator: {
          type: 'DefaultMarkdownGenerator',
          params: {
            content_filter: { type: 'BM25ContentFilter', params: { user_query: query } },
          },
        },
      },
    },
  };
}

/** Choose the best text from one /crawl result entry. */
export function pickMarkdown(r: any): string {
  const m = r?.markdown;
  if (typeof m === 'string') return m || r?.cleaned_html || '';
  const fit: string = m?.fit_markdown ?? '';
  if (fit.length >= MIN_FIT_CHARS) return fit;
  return m?.raw_markdown || fit || r?.cleaned_html || '';
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
      body: JSON.stringify(buildCrawlBody(urls, query)),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    // The service returns HTTP 500 when *every* URL in the request fails (e.g. all blocked).
    if (!resp.ok) {
      if (process.env.CRAWL_DEBUG) console.error(`[crawl] HTTP ${resp.status} for ${urls.join(', ')}`);
      return [];
    }

    const data = await resp.json();
    if (!data.success || !data.results) return [];

    return data.results
      .filter((r: any) => {
        // Per-URL failures arrive as success:false (+ status_code/error_message) inside a 200 batch.
        if (r.success === false && process.env.CRAWL_DEBUG) {
          console.error(`[crawl] ${r.url}: ${r.status_code ?? ''} ${r.error_message ?? ''}`);
        }
        return r.success !== false;
      })
      .map((r: any) => ({
        url: r.url,
        title: r.metadata?.title ?? r.url,
        markdown: pickMarkdown(r),
      }))
      .filter((r: CrawlResult) => r.markdown.length > 0);
  } catch {
    clearTimeout(timeout);
    return [];
  }
}
