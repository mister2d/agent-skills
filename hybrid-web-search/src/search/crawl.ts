const CRAWL4AI_BASE = process.env.CRAWL4AI_URL ?? process.env.CRAWL4AI_API_URL ?? 'https://crawl4ai.service.internal.novuscotia.com';
const CRAWL4AI_TOKEN = process.env.CRAWL4AI_AUTH_TOKEN ?? 'dummy';

import { isRedditThreadUrl, buildRedditBody, threadFromResult, fetchExpandedThread } from './reddit.js';

export interface CrawlResult {
  url: string;
  title: string;
  markdown: string;
}

// Resolve a Bearer token: try the service's /token endpoint with the raw token,
// fall back to the raw token itself (mirrors c4a.sh in the crawl4ai skill).
// The result (including the fallback) is cached for 10 min: one /token round trip per
// process instead of one per crawlAll call.
const TOKEN_TTL_MS = 10 * 60 * 1000;
let tokenCache: { value: string; expires: number } | null = null;
export function resetAuthCache(): void { tokenCache = null; }

async function resolveAuthToken(timeoutMs: number): Promise<string> {
  if (tokenCache && tokenCache.expires > Date.now()) return tokenCache.value;
  let value = CRAWL4AI_TOKEN;
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
      if (data.access_token) value = data.access_token;
    }
  } catch {
    // /token endpoint absent or unreachable — raw token still works.
  }
  tokenCache = { value, expires: Date.now() + TOKEN_TTL_MS };
  return value;
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

async function postCrawl(body: unknown, token: string, timeoutMs: number, label: string): Promise<any[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(`${CRAWL4AI_BASE}/crawl`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    // The service returns HTTP 500 when *every* URL in the request fails (e.g. all blocked).
    if (!resp.ok) {
      if (process.env.CRAWL_DEBUG) console.error(`[crawl] HTTP ${resp.status} for ${label}`);
      return [];
    }
    const data = await resp.json();
    if (!data.success || !data.results) return [];
    return data.results.filter((r: any) => {
      // Per-URL failures arrive as success:false (+ status_code/error_message) inside a 200 batch.
      if (r.success === false && process.env.CRAWL_DEBUG) {
        console.error(`[crawl] ${r.url}: ${r.status_code ?? ''} ${r.error_message ?? ''}`);
      }
      return r.success !== false;
    });
  } catch {
    clearTimeout(timeout);
    return [];
  }
}

// CRAWL4AI_REDDIT_EXPAND=true: expand "N more replies" via /execute_js first (25 -> ~55 comments on a
// 97-comment thread, ~7-9 s per thread, so also gives Reddit its own longer timeout). Requires
// CRAWL4AI_EXECUTE_JS_ENABLED=true on the server; falls back to plain extraction if unavailable.
const REDDIT_EXPAND = () => process.env.CRAWL4AI_REDDIT_EXPAND === 'true';
const REDDIT_EXPAND_TIMEOUT_MS = 30000;

async function crawlRedditThreads(urls: string[], token: string, timeoutMs: number): Promise<any[]> {
  if (!REDDIT_EXPAND()) return postCrawl(buildRedditBody(urls), token, timeoutMs, urls.join(', '));
  const expanded = await Promise.all(
    urls.map((u) => fetchExpandedThread(CRAWL4AI_BASE, token, u, Math.max(timeoutMs, REDDIT_EXPAND_TIMEOUT_MS)))
  );
  const missed = urls.filter((_, i) => !expanded[i]);
  const plain = missed.length ? await postCrawl(buildRedditBody(missed), token, timeoutMs, missed.join(', ')) : [];
  return [...expanded.filter((e): e is NonNullable<typeof e> => e !== null), ...plain];
}

export async function crawlAll(
  urls: string[],
  query: string,
  timeoutMs: number
): Promise<CrawlResult[]> {
  if (urls.length === 0) return [];

  const token = await resolveAuthToken(10000);
  const redditUrls = urls.filter(isRedditThreadUrl);
  const otherUrls = urls.filter((u) => !isRedditThreadUrl(u));

  const [other, reddit] = await Promise.all([
    otherUrls.length
      ? postCrawl(buildCrawlBody(otherUrls, query), token, timeoutMs, otherUrls.join(', '))
      : Promise.resolve([]),
    // Reddit threads: structured extraction (clean post + comments) instead of 45K chars of noise.
    // A thread that yields no post record (JS challenge/blocked) is dropped, not sent as noise.
    redditUrls.length ? crawlRedditThreads(redditUrls, token, timeoutMs) : Promise.resolve([]),
  ]);

  const out: CrawlResult[] = other
    .map((r: any) => ({ url: r.url, title: r.metadata?.title ?? r.url, markdown: pickMarkdown(r) }))
    .filter((r: CrawlResult) => r.markdown.length > 0);

  for (const r of reddit) {
    const t = threadFromResult(r);
    if (t) out.push({ url: r.url, title: t.title, markdown: t.markdown });
  }
  return out;
}
