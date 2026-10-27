/**
 * Reddit thread extraction for Crawl4AI.
 *
 * Crawl4AI renders new-Reddit (shreddit) thread pages fine, but the markdown is ~45K chars of
 * navigation/telemetry noise. The thread data lives in <shreddit-post>/<shreddit-comment> custom
 * element *attributes*, so a JsonCssExtractionStrategy schema returns clean records instead.
 *
 * Limits (Crawl4AI 0.9.0 defaults): only the server-rendered comments are present (~25 top-level
 * threads of a larger tree); "load more" needs js_code/execute_js, which the API rejects unless the
 * server enables it. Subreddit listing/search pages only render ~3 posts and are not handled here.
 */

export const REDDIT_THREAD_RE = /^https?:\/\/(?:www\.|old\.|new\.)?reddit\.com\/r\/[^/]+\/comments\/[a-z0-9]+/i;

export function isRedditThreadUrl(url: string): boolean {
  return REDDIT_THREAD_RE.test(url);
}

/** old.reddit.com redirects anonymous crawlers to a login wall; the shreddit page does not. */
export function normalizeRedditUrl(url: string): string {
  return url.replace(/^(https?:\/\/)(?:old|new)\.reddit\.com/i, '$1www.reddit.com');
}

const attr = (name: string, attribute: string) => ({ name, type: 'attribute', attribute });

export const REDDIT_THREAD_SCHEMA = {
  name: 'reddit_thread',
  baseSelector: 'shreddit-post, shreddit-comment',
  fields: [
    attr('id', 'id'),
    attr('thingid', 'thingid'),
    attr('author', 'author'),
    attr('score', 'score'),
    attr('depth', 'depth'),
    attr('created', 'created'),
    attr('created_ts', 'created-timestamp'),
    attr('permalink', 'permalink'),
    attr('title', 'post-title'),
    attr('comment_count', 'comment-count'),
    attr('upvote_ratio', 'upvote-ratio'),
    attr('subreddit', 'subreddit-prefixed-name'),
    attr('post_type', 'post-type'),
    attr('link', 'content-href'),
    { name: 'comment_body', type: 'text', selector: 'div[slot=comment]' },
    { name: 'post_body', type: 'text', selector: 'div[slot=text-body]' },
  ],
};

export const REDDIT_RENDER_DELAY_S = 3;

export function buildRedditBody(urls: string[]) {
  return {
    urls: urls.map(normalizeRedditUrl),
    crawler_config: {
      type: 'CrawlerRunConfig',
      params: {
        // Comments hydrate after load; without a delay ~1 in 3 fetches returned 9 of 25 comments.
        // (wait_for would time out on threads with zero comments.)
        delay_before_return_html: REDDIT_RENDER_DELAY_S,
        extraction_strategy: {
          type: 'JsonCssExtractionStrategy',
          params: { schema: REDDIT_THREAD_SCHEMA },
        },
      },
    },
  };
}

export interface RedditRow { [k: string]: string | undefined }

export const DEFAULT_MAX_THREAD_CHARS = 60_000;

/**
 * Render extracted rows as markdown, or null when no post record was found (blocked/challenge).
 * Output is capped (maxChars) so a huge thread can never flood an agent's context; comments are kept
 * in page order (Reddit's own ranking) and the cut is announced.
 */
export function formatThread(rows: RedditRow[], opts: { maxChars?: number } = {}): string | null {
  const post = rows.find((r) => r.id?.startsWith('t3_') && r.title);
  if (!post) return null;
  const maxChars = opts.maxChars ?? DEFAULT_MAX_THREAD_CHARS;
  const comments = rows.filter((r) => r.thingid && r.comment_body?.trim());
  const total = Number(post.comment_count ?? '0') || comments.length;
  const date = (post.created_ts ?? '').slice(0, 10);
  const head: string[] = [
    `# ${post.title}`,
    `${post.subreddit ?? ''} · u/${post.author ?? '[deleted]'} · ${post.score ?? '?'} points` +
      `${post.upvote_ratio ? ` (${Math.round(Number(post.upvote_ratio) * 100)}% upvoted)` : ''}` +
      ` · ${total} comments${date ? ` · ${date}` : ''}`,
  ];
  if (post.link && post.post_type !== 'text') head.push(`Link: ${post.link}`);
  if (post.post_body?.trim()) head.push('', post.post_body.trim());
  let used = head.join('\n').length + 80;

  const body: string[] = [];
  for (const c of comments) {
    const indent = '  '.repeat(Math.max(0, Number(c.depth ?? '0') || 0));
    const when = (c.created ?? '').slice(0, 10);
    const text = c.comment_body!.trim().replace(/\s*\n\s*/g, ' ');
    const line = `${indent}- u/${c.author ?? '[deleted]'} (${c.score ?? '?'} pts${when ? `, ${when}` : ''}): ${text}`;
    if (used + line.length + 2 > maxChars) break;
    body.push(line);
    used += line.length + 2;
  }
  const cut = comments.length - body.length;
  return [
    ...head,
    '',
    `## Comments (Showing ${body.length} of ${total} comments)`,
    '',
    // Blank line between comments: the pipeline chunker splits on paragraphs, so a single-newline
    // list would become one giant chunk (measured: 13-21K chars vs a ~2K target).
    body.join('\n\n'),
    ...(cut > 0 ? ['', `[truncated: ${cut} more extracted comments omitted to stay within ${maxChars} chars]`] : []),
  ].join('\n');
}

/** Turn a /crawl result entry for a Reddit thread into {title, markdown}, or null. */
export function threadFromResult(r: any): { title: string; markdown: string } | null {
  if (r?.success === false || !r?.extracted_content) return null;
  let rows: RedditRow[];
  try { rows = JSON.parse(r.extracted_content); } catch { return null; }
  if (!Array.isArray(rows)) return null;
  const md = formatThread(rows);
  if (!md) return null;
  const title = rows.find((x) => x.id?.startsWith('t3_'))?.title ?? r.url;
  return { title: title as string, markdown: md };
}

// --- Optional comment expansion via POST /execute_js (needs CRAWL4AI_EXECUTE_JS_ENABLED=true on the server) ---
// Validated against the hosted instance: 25 server-rendered comments -> 55 in ~7 s on a 97-comment thread.
// NOTE: execute_js wraps scripts and only awaits a *returned* promise; a bare async IIFE is silently not awaited.
export const REDDIT_EXPAND_SCRIPT =
  'return (async()=>{const s=ms=>new Promise(r=>setTimeout(r,ms));' +
  'for(let round=0;round<6;round++){' +
  'const btns=[...document.querySelectorAll("button")].filter(b=>/\\d+ more repl|more comment/i.test((b.innerText||"").trim()));' +
  'if(!btns.length)break;btns.slice(0,15).forEach(b=>{try{b.click()}catch(e){}});await s(2200);}' +
  'return document.querySelectorAll("shreddit-comment").length})()';

/** Re-run the thread schema over already-rendered HTML (no second browser fetch of reddit.com). */
export function buildRedditRawBody(html: string) {
  return {
    urls: ['raw:' + html],
    crawler_config: {
      type: 'CrawlerRunConfig',
      params: { extraction_strategy: { type: 'JsonCssExtractionStrategy', params: { schema: REDDIT_THREAD_SCHEMA } } },
    },
  };
}

/**
 * Expand "N more replies" in a real browser, then extract from the expanded HTML.
 * Returns a /crawl-result-shaped entry ({url, success, extracted_content}) or null on any failure
 * (execute_js disabled -> 403, timeout, ...) so callers can fall back to plain extraction.
 */
export async function fetchExpandedThread(
  base: string, token: string, url: string, timeoutMs: number
): Promise<{ url: string; success: boolean; extracted_content: string } | null> {
  const target = normalizeRedditUrl(url);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
  try {
    const ex = await fetch(`${base}/execute_js`, {
      method: 'POST', headers, signal: ctl.signal,
      body: JSON.stringify({ url: target, scripts: [REDDIT_EXPAND_SCRIPT] }),
    });
    if (!ex.ok) return null;
    const html: string | undefined = (await ex.json())?.html;
    if (!html) return null;
    const cr = await fetch(`${base}/crawl`, {
      method: 'POST', headers, signal: ctl.signal, body: JSON.stringify(buildRedditRawBody(html)),
    });
    if (!cr.ok) return null;
    const entry = (await cr.json())?.results?.[0];
    if (!entry?.extracted_content) return null;
    return { url: target, success: true, extracted_content: entry.extracted_content };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
