import { crawlUrl } from './src/search/crawl.js';

const r = await crawlUrl('https://www.oklahoman.com/story/sports/nba/thunder/2026/05/11/thunder-lakers-score-live-updates-nba-playoffs-game-4-highlights-stats-injury-report/90037121007/', 8000);
if (r) {
  const md = r.markdown?.raw_markdown ?? r.markdown;
  const lines = md.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].match(/score|Score|Final|final|game [1-4]|Thunder.*Lakers|Lakers.*Thunder|\d{2,} - \d{2,}/)) {
      console.log(lines.slice(Math.max(0,i-1), i+10).join('\n'));
      console.log('---');
    }
  }
}