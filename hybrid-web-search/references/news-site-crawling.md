# News Site Crawling Characteristics

## Reuters (reuters.com)
- **Crawl result**: Consistently returns HTTP 401 from Crawl4AI
- **Root cause**: Aggressive anti-bot protection (not intermittent — always fails)
- **Workaround**: Use alternative sources (AP, BBC, cross-reference via JustSecurity.org)
- **Search results**: SearXNG can surface Reuters article URLs, but Crawl4AI cannot extract content

## CNN (cnn.com, edition.cnn.com)
- **Crawl result**: HTTP 200, but returns 50K–65K chars of markdown per article
- **Noise ratio**: Majority of markdown is navigation, ad feedback forms, and site structure
- **Content extraction**: Filter for substantial paragraphs (>100 chars, not starting with navigation patterns like `*`, `#`, `[`, `http`, `!`)
- **Article URLs**: Prefer full article slugs (e.g., `/2026/05/13/politics/live-news/trump-china-visit-arrival-ceremony-hnk`) over homepage URLs
- **Live blogs**: CNN live update pages contain actual content interspersed with navigation — the live update timestamps and content paragraphs are the valuable content

## JustSecurity.org
- **Crawl result**: Clean markdown, good content density
- **Use case**: Excellent cross-reference source for news aggregation — publishes "Early Edition" digests that curate major stories from multiple sources
- **Article URLs**: `/138838/early-edition-may-13-2026/` format

## General Patterns
- **Live blog format**: CNN live update pages use a consistent pattern: timestamped entries with headlines and body text interspersed with navigation. The live updates are the primary content source.
- **Article URL patterns**:
  - CNN: `/2026/MM/DD/topic/slug-hnk` (hnk suffix indicates live/updated content)
  - Reuters: `/topic/article-slug-date/` (date in URL)
- **Video pages**: CNN video pages (`/video/...`) return minimal text content — mostly video descriptions and related video links
