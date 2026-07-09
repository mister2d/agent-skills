import { hybridSearch } from './src/index.js';

const query = process.argv[2];
if (!query) {
  console.error('Usage: node run.mjs "<search query>"');
  process.exit(1);
}

try {
  const result = await hybridSearch(query);

  console.log(`\nQuery: ${result.query}`);
  console.log(`Stats: ${result.stats.searxngResultCount} SearXNG results, ${result.stats.crawledUrlCount} crawled, ${result.stats.totalChunksRanked} chunks ranked, ${result.stats.returnedItemCount} returned`);
  console.log('='.repeat(60));

  for (const item of result.items) {
    console.log(`\n[${item.crawled ? 'CRAWLED' : 'SNIPPET'}] ${item.title}`);
    console.log(`URL: ${item.url}`);
    console.log(`Score: ${item.oramaScore.toFixed(3)}`);

    if (item.crawled) {
      const chunk = item.chunk;
      // Truncate for display
      const display = chunk.length > 500 ? chunk.slice(0, 500) + '...' : chunk;
      console.log(`Chunk ${item.chunkIndex + 1}: ${display}`);
    } else {
      const snippet = item.snippet;
      const display = snippet.length > 300 ? snippet.slice(0, 300) + '...' : snippet;
      console.log(`Snippet: ${display}`);
    }
    console.log('-'.repeat(60));
  }
} catch (err) {
  console.error(`Error: ${err.message}`);
  process.exit(1);
}
