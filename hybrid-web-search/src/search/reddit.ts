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

/** Render extracted rows as markdown, or null when no post record was found (blocked/challenge). */
export function formatThread(rows: RedditRow[]): string | null {
  const post = rows.find((r) => r.id?.startsWith('t3_') && r.title);
  if (!post) return null;
  const comments = rows.filter((r) => r.thingid && r.comment_body?.trim());
  const total = Number(post.comment_count ?? '0') || comments.length;
  const date = (post.created_ts ?? '').slice(0, 10);
  const lines: string[] = [
    `# ${post.title}`,
    `${post.subreddit ?? ''} · u/${post.author ?? '[deleted]'} · ${post.score ?? '?'} points` +
      `${post.upvote_ratio ? ` (${Math.round(Number(post.upvote_ratio) * 100)}% upvoted)` : ''}` +
      ` · ${total} comments${date ? ` · ${date}` : ''}`,
  ];
  if (post.link && post.post_type !== 'text') lines.push(`Link: ${post.link}`);
  if (post.post_body?.trim()) lines.push('', post.post_body.trim());
  lines.push('', `## Comments (Showing ${comments.length} of ${total} comments)`, '');
  for (const c of comments) {
    const indent = '  '.repeat(Math.max(0, Number(c.depth ?? '0') || 0));
    const when = (c.created ?? '').slice(0, 10);
    const body = c.comment_body!.trim().replace(/\s*\n\s*/g, ' ');
    lines.push(`${indent}- u/${c.author ?? '[deleted]'} (${c.score ?? '?'} pts${when ? `, ${when}` : ''}): ${body}`);
  }
  return lines.join('\n');
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
