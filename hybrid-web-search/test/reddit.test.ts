import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { isRedditThreadUrl, buildRedditBody, formatThread, REDDIT_THREAD_SCHEMA } from '../src/search/reddit.ts';
import { crawlAll } from '../src/search/crawl.ts';

const ROWS = [
  { id: 't3_abc', author: 'op', score: '262', created_ts: '2026-03-17T08:45:10.209000+0000', permalink: '/r/rust/comments/abc/title/',
    title: 'Borrow checker', comment_count: '97', upvote_ratio: '0.82', subreddit: 'r/rust', post_type: 'text', link: 'https://www.reddit.com/r/rust/comments/abc/title/', post_body: 'Post body text' },
  { thingid: 't1_c1', author: 'alice', score: '329', depth: '0', created: '2026-03-17T08:50:50.802000+0000', permalink: '/r/rust/comments/abc/comment/c1/', comment_body: 'Top comment' },
  { thingid: 't1_c2', author: 'bob', score: '74', depth: '1', created: '2026-03-17T09:23:52.203000+0000', permalink: '/r/rust/comments/abc/comment/c2/', comment_body: 'Nested reply' },
  { thingid: 't1_c3', author: 'ghost', score: '1', depth: '0', comment_body: '' },
];

test('isRedditThreadUrl matches threads only', () => {
  assert.ok(isRedditThreadUrl('https://www.reddit.com/r/rust/comments/1rw12u6/rusts_borrow/'));
  assert.ok(isRedditThreadUrl('https://reddit.com/r/rust/comments/1rw12u6/'));
  assert.ok(isRedditThreadUrl('https://old.reddit.com/r/rust/comments/1rw12u6/x/'));
  assert.ok(!isRedditThreadUrl('https://www.reddit.com/r/rust/'));
  assert.ok(!isRedditThreadUrl('https://www.reddit.com/search/?q=x'));
  assert.ok(!isRedditThreadUrl('https://example.com/r/rust/comments/1/'));
});

test('buildRedditBody sends JsonCssExtractionStrategy with the thread schema, www host', () => {
  const b = buildRedditBody(['https://old.reddit.com/r/rust/comments/abc/x/']);
  assert.deepEqual(b.urls, ['https://www.reddit.com/r/rust/comments/abc/x/']);
  const s = b.crawler_config.params.extraction_strategy;
  assert.equal(s.type, 'JsonCssExtractionStrategy');
  assert.equal(s.params.schema, REDDIT_THREAD_SCHEMA);
  assert.equal(b.crawler_config.params.delay_before_return_html, 3, 'wait for comment hydration');
  assert.equal(REDDIT_THREAD_SCHEMA.baseSelector, 'shreddit-post, shreddit-comment');
});

test('formatThread renders post metadata, body and indented comments', () => {
  const md = formatThread(ROWS)!;
  assert.match(md, /^# Borrow checker/m);
  assert.match(md, /r\/rust/);
  assert.match(md, /u\/op/);
  assert.match(md, /262/);
  assert.match(md, /97 comments/);
  assert.match(md, /Post body text/);
  assert.match(md, /u\/alice.*329/);
  assert.match(md, /^ {2}.*u\/bob/m, 'depth-1 reply is indented');
  assert.match(md, /Showing 2 of 97 comments/);
  assert.ok(!md.includes('ghost'), 'empty comments skipped');
});

test('formatThread returns null when no post row (challenge page / blocked)', () => {
  assert.equal(formatThread([]), null);
  assert.equal(formatThread([ROWS[1]]), null);
});

const realFetch = globalThis.fetch;
let calls: any[] = [];
beforeEach(() => { calls = []; });
afterEach(() => { globalThis.fetch = realFetch; });

test('crawlAll routes reddit threads through extraction and other URLs through BM25', async () => {
  globalThis.fetch = (async (url: any, init: any) => {
    if (String(url).endsWith('/token')) return new Response('{}', { status: 404 });
    const body = JSON.parse(init.body); calls.push(body);
    const isReddit = body.crawler_config.params.extraction_strategy;
    const results = body.urls.map((u: string) => isReddit
      ? { url: u, success: true, extracted_content: JSON.stringify(ROWS), markdown: { raw_markdown: 'noisy' } }
      : { url: u, success: true, metadata: { title: 'Doc' }, markdown: { fit_markdown: 'd'.repeat(300), raw_markdown: 'r' } });
    return new Response(JSON.stringify({ success: true, results }), { status: 200 });
  }) as typeof fetch;
  const out = await crawlAll(['https://docs.example/a', 'https://www.reddit.com/r/rust/comments/abc/t/'], 'q', 5000);
  assert.equal(calls.length, 2);
  assert.equal(out.length, 2);
  const reddit = out.find(o => o.url.includes('reddit'))!;
  assert.match(reddit.markdown, /# Borrow checker/);
  assert.equal(reddit.title, 'Borrow checker');
  assert.equal(out.find(o => o.url.includes('docs'))!.title, 'Doc');
});

test('reddit thread with no extractable post is dropped (no noisy fallback)', async () => {
  globalThis.fetch = (async (url: any) => {
    if (String(url).endsWith('/token')) return new Response('{}', { status: 404 });
    return new Response(JSON.stringify({ success: true, results: [{ url: 'https://www.reddit.com/r/rust/comments/abc/t/', success: true, extracted_content: '[]', markdown: { raw_markdown: 'js challenge' } }] }), { status: 200 });
  }) as typeof fetch;
  assert.deepEqual(await crawlAll(['https://www.reddit.com/r/rust/comments/abc/t/'], 'q', 5000), []);
});

import { REDDIT_EXPAND_SCRIPT, buildRedditRawBody, fetchExpandedThread } from '../src/search/reddit.ts';

test('expand script returns its promise (execute_js does not await un-returned async IIFEs)', () => {
  assert.match(REDDIT_EXPAND_SCRIPT, /^return \(async\s*\(\)\s*=>/);
  assert.match(REDDIT_EXPAND_SCRIPT, /more repl/i);
});

test('buildRedditRawBody re-extracts expanded html via raw: with the same schema', () => {
  const b = buildRedditRawBody('<html>x</html>');
  assert.deepEqual(b.urls, ['raw:<html>x</html>']);
  assert.equal(b.crawler_config.params.extraction_strategy.params.schema, REDDIT_THREAD_SCHEMA);
});

test('fetchExpandedThread: execute_js then raw: extraction; null when endpoint disabled (403)', async () => {
  const seen: string[] = [];
  globalThis.fetch = (async (url: any, init: any) => {
    const u = String(url); seen.push(u.replace(/^https?:\/\/[^/]+/, ''));
    if (u.endsWith('/execute_js')) return new Response(JSON.stringify({ html: '<html>expanded</html>' }), { status: 200 });
    const body = JSON.parse(init.body);
    assert.ok(body.urls[0].startsWith('raw:'));
    return new Response(JSON.stringify({ success: true, results: [{ url: 'raw:', success: true, extracted_content: JSON.stringify(ROWS) }] }), { status: 200 });
  }) as typeof fetch;
  const r = await fetchExpandedThread('https://svc', 'tok', 'https://old.reddit.com/r/rust/comments/abc/t/', 5000);
  assert.deepEqual(seen, ['/execute_js', '/crawl']);
  assert.equal(r?.url, 'https://www.reddit.com/r/rust/comments/abc/t/');
  assert.match(r!.extracted_content, /Borrow checker/);

  globalThis.fetch = (async () => new Response('{"detail":"execute_js endpoint is disabled"}', { status: 403 })) as typeof fetch;
  assert.equal(await fetchExpandedThread('https://svc', 'tok', 'https://www.reddit.com/r/rust/comments/abc/t/', 5000), null);
});

test('formatThread caps output and says so', () => {
  const many = [ROWS[0], ...Array.from({ length: 400 }, (_, i) => ({ thingid: 't1_' + i, author: 'u' + i, score: String(400 - i), depth: '0', comment_body: 'word '.repeat(40) }))];
  const md = formatThread(many, { maxChars: 3000 })!;
  assert.ok(md.length <= 3300, `len ${md.length}`);
  assert.match(md, /truncated/i);
  assert.match(md, /Showing \d+ of 97 comments/);
});

test('CRAWL4AI_REDDIT_EXPAND=true routes through execute_js; falls back to plain extraction on 403', async () => {
  process.env.CRAWL4AI_REDDIT_EXPAND = 'true';
  try {
    const paths: string[] = [];
    globalThis.fetch = (async (url: any) => {
      const p = String(url).replace(/^https?:\/\/[^/]+/, ''); paths.push(p);
      if (p === '/token') return new Response('{}', { status: 404 });
      if (p === '/execute_js') return new Response('{"detail":"disabled"}', { status: 403 });
      return new Response(JSON.stringify({ success: true, results: [{ url: 'https://www.reddit.com/r/rust/comments/abc/t/', success: true, extracted_content: JSON.stringify(ROWS) }] }), { status: 200 });
    }) as typeof fetch;
    const out = await crawlAll(['https://www.reddit.com/r/rust/comments/abc/t/'], 'q', 5000);
    assert.ok(paths.includes('/execute_js'));
    assert.equal(out.length, 1, 'fell back to plain /crawl extraction');
  } finally { delete process.env.CRAWL4AI_REDDIT_EXPAND; }
});

import { chunkText } from '../src/search/chunk.ts';
test('formatted threads chunk to ~target size (comments are separate paragraphs)', () => {
  const many = [ROWS[0], ...Array.from({ length: 60 }, (_, i) => ({ thingid: 't1_' + i, author: 'u' + i, score: '5', depth: String(i % 3), comment_body: 'word '.repeat(60) }))];
  const md = formatThread(many)!;
  const chunks = chunkText(md, 512);
  const biggest = Math.max(...chunks.map((c: any) => (typeof c === 'string' ? c : c.text ?? c.content).length));
  assert.ok(biggest < 4000, `largest chunk ${biggest} chars (512 tokens ≈ 2000 chars)`);
});
