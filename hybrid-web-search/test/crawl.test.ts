import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { crawlAll, buildCrawlBody, pickMarkdown } from '../src/search/crawl.ts';

const realFetch = globalThis.fetch;
let calls: { url: string; body: any }[] = [];
function mockFetch(crawlResponse: { status?: number; json: any }) {
  globalThis.fetch = (async (url: any, init: any) => {
    const u = String(url);
    if (u.endsWith('/token')) return new Response('{}', { status: 404 });
    calls.push({ url: u, body: JSON.parse(init.body) });
    return new Response(JSON.stringify(crawlResponse.json), { status: crawlResponse.status ?? 200 });
  }) as typeof fetch;
}
beforeEach(() => { calls = []; });
afterEach(() => { globalThis.fetch = realFetch; });

test('request body carries the query as a BM25 content filter (0.9.0 schema)', () => {
  const b = buildCrawlBody(['https://a.example/'], 'borrow checker');
  assert.deepEqual(b.urls, ['https://a.example/']);
  const f = b.crawler_config.params.markdown_generator.params.content_filter;
  assert.equal(f.type, 'BM25ContentFilter');
  assert.equal(f.params.user_query, 'borrow checker');
  assert.equal('extract' in b, false, 'legacy flat fields must be gone');
  assert.equal('query' in b, false);
});

test('pickMarkdown prefers substantial fit_markdown', () => {
  const fit = 'x'.repeat(500);
  assert.equal(pickMarkdown({ markdown: { fit_markdown: fit, raw_markdown: 'raw'.repeat(300) } }), fit);
});

test('pickMarkdown falls back to raw_markdown when BM25 filter strips (almost) everything', () => {
  const raw = 'raw content '.repeat(50);
  assert.equal(pickMarkdown({ markdown: { fit_markdown: '1', raw_markdown: raw } }), raw);
  assert.equal(pickMarkdown({ markdown: { fit_markdown: '', raw_markdown: raw } }), raw);
});

test('pickMarkdown handles string markdown and cleaned_html fallback', () => {
  assert.equal(pickMarkdown({ markdown: 'plain' }), 'plain');
  assert.equal(pickMarkdown({ markdown: {}, cleaned_html: '<p>x</p>' }), '<p>x</p>');
  assert.equal(pickMarkdown({}), '');
});

test('crawlAll skips per-URL failures but keeps successes', async () => {
  mockFetch({ json: { success: true, results: [
    { url: 'https://ok/', success: true, metadata: { title: 'OK' }, markdown: { fit_markdown: 'y'.repeat(400), raw_markdown: 'z' } },
    { url: 'https://blocked/', success: false, status_code: 401, error_message: 'Blocked by anti-bot protection', markdown: { raw_markdown: '' } },
  ] } });
  const out = await crawlAll(['https://ok/', 'https://blocked/'], 'q', 5000);
  assert.equal(out.length, 1);
  assert.equal(out[0].title, 'OK');
  assert.equal(calls[0].body.crawler_config.params.markdown_generator.params.content_filter.params.user_query, 'q');
});

test('crawlAll returns [] on HTTP 500 (all URLs failed)', async () => {
  mockFetch({ status: 500, json: { error: 'Internal server error' } });
  assert.deepEqual(await crawlAll(['https://x/'], 'q', 5000), []);
});

test('crawlAll returns [] for empty input without calling the service', async () => {
  mockFetch({ json: {} });
  assert.deepEqual(await crawlAll([], 'q', 5000), []);
  assert.equal(calls.length, 0);
});
