import { create, insert, search } from '@orama/orama';
import type { SearxngResult } from './types.js';
import type { CrawlResult } from './crawl.js';
import { chunkText } from './chunk.js';

export async function buildSnippetIndex(
  results: SearxngResult[],
  query: string
) {
  const db = await create({
    schema: {
      id: 'string',
      url: 'string',
      title: 'string',
      content: 'string',
    },
  });

  for (const r of results) {
    await insert(db, {
      id: r.url,
      url: r.url,
      title: r.title,
      content: r.content,
    });
  }

  const hits = await search(db, {
    term: query,
    properties: ['title', 'content'],
    limit: results.length,
  });

  return hits;
}

export async function buildChunkIndex(
  crawled: CrawlResult[],
  query: string,
  chunkTokenTarget: number
) {
  const db = await create({
    schema: {
      id: 'string',
      url: 'string',
      title: 'string',
      chunk: 'string',
      chunkIndex: 'number',
    },
  });

  for (let i = 0; i < crawled.length; i++) {
    const page = crawled[i];
    const pageChunks = chunkText(page.markdown, chunkTokenTarget);

    for (let j = 0; j < pageChunks.length; j++) {
      await insert(db, {
        id: `${i}-${j}`,
        url: page.url,
        title: page.title,
        chunk: pageChunks[j],
        chunkIndex: j,
      });
    }
  }

  const hits = await search(db, {
    term: query,
    properties: ['title', 'chunk'],
    limit: 50,
  });

  return hits;
}
