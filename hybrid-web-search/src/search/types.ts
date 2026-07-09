export interface SearxngResult {
  url: string;
  title: string;
  content: string;   // snippet text
  score?: number;    // raw SearXNG score if present, else undefined
  engine: string;
}

export interface RankedSnippet {
  url: string;
  title: string;
  snippet: string;
  oramaScore: number;
  crawled: false;
}

export interface RankedChunk {
  url: string;
  title: string;
  chunk: string;
  chunkIndex: number;
  oramaScore: number;
  crawled: true;
}

export type SearchResultItem = RankedSnippet | RankedChunk;

export interface HybridSearchResult {
  query: string;
  items: SearchResultItem[];
  stats: {
    searxngResultCount: number;
    crawledUrlCount: number;
    totalChunksRanked: number;
    returnedItemCount: number;
  };
}
