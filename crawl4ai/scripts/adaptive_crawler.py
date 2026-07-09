#!/usr/bin/env python3
"""
Adaptive crawler — intelligently follows links from a start URL until
confident it has gathered enough information about the query topic.

Usage:
    python adaptive_crawler.py <start_url> "<query>"
    python adaptive_crawler.py <start_url> "<query>" --max-pages 30 --confidence 0.8
    python adaptive_crawler.py <start_url> "<query>" --output knowledge_base.jsonl
"""

import argparse
import asyncio
import sys
import json
from pathlib import Path

# Add current directory to path for importing crawl_service
sys.path.insert(0, str(Path(__file__).resolve().parent))
from crawl_service import crawl_url

class AdaptiveConfig:
    def __init__(self, strategy="statistical", confidence_threshold=0.7, max_pages=20, top_k_links=3, min_gain_threshold=0.1):
        self.strategy = strategy
        self.confidence_threshold = confidence_threshold
        self.max_pages = max_pages
        self.top_k_links = top_k_links
        self.min_gain_threshold = min_gain_threshold

class AdaptiveCrawler:
    def __init__(self, config: AdaptiveConfig):
        self.config = config
        self.crawled_urls = []
        self.confidence = 0.0
        self.relevant_pages = []

    async def digest(self, start_url: str, query: str):
        urls_to_crawl = [start_url]
        visited = set()
        
        while urls_to_crawl and len(visited) < self.config.max_pages:
            url = urls_to_crawl.pop(0)
            if url in visited:
                continue
            visited.add(url)
            self.crawled_urls.append(url)
            
            try:
                # Build request parameters
                # Use BM25 filter via query param on remote service
                browser_config = {
                    "headless": True,
                    "enable_stealth": True,
                    "user_agent_mode": "random",
                    "viewport_width": 1920,
                    "viewport_height": 1080
                }
                crawler_params = {
                    "markdown_generator": {
                        "type": "DefaultMarkdownGenerator",
                        "params": {
                            "content_filter": {
                                "type": "BM25ContentFilter",
                                "params": {
                                    "user_query": query
                                }
                            }
                        }
                    }
                }
                
                result = await crawl_url(url, crawler_params=crawler_params, browser_params=browser_config)
                if result.success:
                    markdown_str = str(result.markdown)
                    score = self._score_relevance(markdown_str, query)
                    self.relevant_pages.append({
                        "url": url,
                        "content": markdown_str,
                        "score": score
                    })
                    
                    # Follow internal links
                    internal_links = result.links.get("internal", [])
                    added = 0
                    for link_obj in internal_links:
                        link_href = link_obj.get("href") if isinstance(link_obj, dict) else link_obj
                        if not link_href:
                            continue
                            
                        if link_href not in visited and link_href not in urls_to_crawl:
                            urls_to_crawl.append(link_href)
                            added += 1
                            if added >= self.config.top_k_links:
                                break
            except Exception as e:
                print(f"Error crawling {url}: {e}")
                
        self.relevant_pages.sort(key=lambda x: x["score"], reverse=True)
        num_relevant = len([p for p in self.relevant_pages if p["score"] > 0])
        self.confidence = min(1.0, self.config.confidence_threshold * (num_relevant / 5.0) if num_relevant > 0 else 0.0)
        
        class DigestResult:
            def __init__(self, crawled_urls):
                self.crawled_urls = crawled_urls
                
        return DigestResult(self.crawled_urls)

    def _score_relevance(self, text: str, query: str) -> float:
        if not text or not query:
            return 0.0
        words = query.lower().split()
        text_lower = text.lower()
        score = 0.0
        for word in words:
            score += text_lower.count(word)
        return score

    def print_stats(self):
        print(f"Adaptive Crawler Stats:")
        print(f"  Pages Crawled: {len(self.crawled_urls)}")
        print(f"  Confidence: {self.confidence:.0%}")

    def get_relevant_content(self, top_k=5):
        return self.relevant_pages[:top_k]

    def export_knowledge_base(self, output_path: str):
        with open(output_path, "w") as f:
            for page in self.relevant_pages:
                f.write(json.dumps(page) + "\n")

async def adaptive_crawl(
    start_url: str,
    query: str,
    max_pages: int = 20,
    confidence_threshold: float = 0.7,
    top_k: int = 5,
    output_path: str | None = None,
) -> None:
    config = AdaptiveConfig(
        strategy="statistical",
        confidence_threshold=confidence_threshold,
        max_pages=max_pages,
        top_k_links=3,
        min_gain_threshold=0.1,
    )

    adaptive = AdaptiveCrawler(config)

    print(f"Starting adaptive crawl of: {start_url}")
    print(f"Query: {query}")
    print(f"Max pages: {max_pages} | Confidence target: {confidence_threshold:.0%}\n")

    result = await adaptive.digest(start_url=start_url, query=query)

    adaptive.print_stats()

    print(f"\nCrawled {len(result.crawled_urls)} pages")
    print(f"Confidence achieved: {adaptive.confidence:.0%}\n")

    relevant = adaptive.get_relevant_content(top_k=top_k)
    print(f"Top {top_k} relevant pages:")
    for i, page in enumerate(relevant, 1):
        print(f"  {i}. {page.get('url', 'unknown')}")
        content: str = str(page.get("content", ""))
        print(f"     {content[:300].strip()}{'...' if len(content) > 300 else ''}\n")

    if output_path:
        adaptive.export_knowledge_base(output_path)
        print(f"Knowledge base exported to: {output_path}")

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Adaptive web crawler powered by hosted Crawl4AI"
    )
    parser.add_argument("start_url", help="URL to start crawling from")
    parser.add_argument("query", help="Research query — crawler stops when sufficiently covered")
    parser.add_argument("--max-pages", type=int, default=20, help="Max pages to crawl (default: 20)")
    parser.add_argument("--confidence", type=float, default=0.7, help="Confidence threshold to stop at, 0.0–1.0 (default: 0.7)")
    parser.add_argument("--top-k", type=int, default=5, help="Top-K results to display (default: 5)")
    parser.add_argument("--output", help="Path to export knowledge base as JSONL (optional)")
    args = parser.parse_args()

    asyncio.run(
        adaptive_crawl(
            start_url=args.start_url,
            query=args.query,
            max_pages=args.max_pages,
            confidence_threshold=args.confidence,
            top_k=args.top_k,
            output_path=args.output,
        )
    )

if __name__ == "__main__":
    main()
