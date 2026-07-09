import type {
  HybridSearchResult,
  RankedSnippet,
  RankedChunk,
  SearchResultItem,
} from './types.js';
import type { SearchConfig } from './config.js';
import { DEFAULT_CONFIG } from './config.js';
import { fetchSearxngResults } from './searxng.js';
import { crawlAll } from './crawl.js';
import { buildSnippetIndex, buildChunkIndex } from './rank.js';

export async function hybridSearch(
  query: string,
  config: SearchConfig = DEFAULT_CONFIG
): Promise<HybridSearchResult> {
  const {
    maxCrawlUrls,
    maxOutputChunks,
    crawlScoreThreshold,
    chunkTokenTarget,
    timeoutMs,
  } = config;

  // Step 1: Fetch SearXNG results
  const searxngResults = await fetchSearxngResults(query, timeoutMs);

  if (searxngResults.length === 0) {
    return {
      query,
      items: [],
      stats: {
        searxngResultCount: 0,
        crawledUrlCount: 0,
        totalChunksRanked: 0,
        returnedItemCount: 0,
      },
    };
  }

  // Step 2: Build Orama snippet index and query
  const snippetHits = await buildSnippetIndex(searxngResults, query);

  // Step 3: Sort hits by score descending
  const sortedHits = snippetHits.hits.sort((a, b) => b.score - a.score);

  // Step 4: Check threshold
  if (sortedHits.length === 0 || sortedHits[0].score < crawlScoreThreshold) {
    // Early exit — snippet-only results
    const items: RankedSnippet[] = sortedHits
      .slice(0, maxOutputChunks)
      .map((h) => ({
        url: h.document.url,
        title: h.document.title,
        snippet: h.document.content,
        oramaScore: h.score,
        crawled: false,
      }));

    return {
      query,
      items,
      stats: {
        searxngResultCount: searxngResults.length,
        crawledUrlCount: 0,
        totalChunksRanked: 0,
        returnedItemCount: items.length,
      },
    };
  }

  // Step 5: Take top-N URLs above threshold
  const crawlUrls = sortedHits
    .filter((h) => h.score >= crawlScoreThreshold)
    .slice(0, maxCrawlUrls)
    .map((h) => h.document.url);

  // Step 6: Crawl in parallel
  const crawled = await crawlAll(crawlUrls, query, timeoutMs);

  if (crawled.length === 0) {
    // All crawls failed — fall back to snippet results
    const items: RankedSnippet[] = sortedHits
      .slice(0, maxOutputChunks)
      .map((h) => ({
        url: h.document.url,
        title: h.document.title,
        snippet: h.document.content,
        oramaScore: h.score,
        crawled: false,
      }));

    return {
      query,
      items,
      stats: {
        searxngResultCount: searxngResults.length,
        crawledUrlCount: 0,
        totalChunksRanked: 0,
        returnedItemCount: items.length,
      },
    };
  }

  // Step 7: Build chunk index and query
  const chunkHits = await buildChunkIndex(crawled, query, chunkTokenTarget);

  // Step 8: Map to RankedChunk[]
  const items: RankedChunk[] = chunkHits.hits
    .slice(0, maxOutputChunks)
    .map((h) => ({
      url: h.document.url,
      title: h.document.title,
      chunk: h.document.chunk,
      chunkIndex: h.document.chunkIndex,
      oramaScore: h.score,
      crawled: true,
    }));

  return {
    query,
    items,
    stats: {
      searxngResultCount: searxngResults.length,
      crawledUrlCount: crawled.length,
      totalChunksRanked: chunkHits.hits.length,
      returnedItemCount: items.length,
    },
  };
}
