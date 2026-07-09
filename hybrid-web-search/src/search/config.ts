export interface SearchConfig {
  // Max URLs to pass from SearXNG ranking to Crawl4AI
  maxCrawlUrls: number;         // default: 3

  // Max chunks returned to caller across all crawled pages
  maxOutputChunks: number;      // default: 5

  // Approximate token target per chunk (1 token ≈ 4 chars)
  chunkTokenTarget: number;     // default: 512

  // Minimum Orama BM25 snippet score to trigger a crawl.
  // If no snippet exceeds this threshold, return snippet-only results.
  crawlScoreThreshold: number;  // default: 0.5

  // Request timeout in ms for each external call
  timeoutMs: number;            // default: 8000
}

export const DEFAULT_CONFIG: SearchConfig = {
  maxCrawlUrls: 3,
  maxOutputChunks: 5,
  chunkTokenTarget: 512,
  crawlScoreThreshold: 0.5,
  timeoutMs: 8000,
};
