/* Aggregates public RSS/Atom feeds into news.json (crypto-heavy).
   Zero dependencies — runs on Node 20+ (global fetch) in GitHub Actions.
   Add or remove sources in FEEDS below. */

const fs = require('fs');

const FEEDS = [
  // crypto
  { source: 'CoinDesk',         url: 'https://www.coindesk.com/arc/outboundfeeds/rss/' },
  { source: 'Cointelegraph',    url: 'https://cointelegraph.com/rss' },
  { source: 'Decrypt',          url: 'https://decrypt.co/feed' },
  { source: 'CryptoSlate',      url: 'https://cryptoslate.com/feed/' },
  { source: 'Bitcoin Magazine', url: 'https://bitcoinmagazine.com/.rss/full/' },
  { source: 'The Defiant',      url: 'https://thedefiant.io/api/feed' },
  { source: 'CoinJournal',      url: 'https://coinjournal.net/news/feed/' },
  { source: 'CryptoBriefing',   url: 'https://cryptobriefing.com/feed/' },
  // markets / economy (lighter mix)
  { source: 'MarketWatch',      url: 'https://feeds.marketwatch.com/marketwatch/topstories/' },
  { source: 'Yahoo Finance',    url: 'https://finance.yahoo.com/news/rssindex' }
];

const MAX_ITEMS = 40; // total kept in news.json
const PER_FEED = 12;  // max taken from each source

function decode(s) {
  return String(s || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ').replace(/&#(\d+);/g, (m, n) => String.fromCharCode(+n))
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ').trim();
}
function tag(block, name) {
  const m = block.match(new RegExp('<' + name + '[^>]*>([\\s\\S]*?)</' + name + '>', 'i'));
  return m ? m[1] : '';
}
function atomLink(block) {
  let m = block.match(/<link[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["']/i);
  if (m) return m[1];
  m = block.match(/<link[^>]*href=["']([^"']+)["']/i);
  return m ? m[1] : '';
}
function parse(xml, source) {
  const items = [];
  const isAtom = /<entry[\s>]/i.test(xml) && !/<item[\s>]/i.test(xml);
  const blocks = xml.match(isAtom ? /<entry[\s\S]*?<\/entry>/gi : /<item[\s\S]*?<\/item>/gi) || [];
  for (const b of blocks.slice(0, PER_FEED)) {
    const title = decode(tag(b, 'title'));
    let link = isAtom ? atomLink(b) : decode(tag(b, 'link'));
    if (!link) link = decode(tag(b, 'guid'));
    const dateStr = tag(b, 'pubDate') || tag(b, 'published') || tag(b, 'updated') || tag(b, 'dc:date');
    let ts = Date.parse(decode(dateStr));
    if (isNaN(ts)) ts = Date.now();
    let sum = decode(tag(b, 'description') || tag(b, 'summary') || tag(b, 'content'));
    if (sum.length > 220) sum = sum.slice(0, 217) + '\u2026';
    if (title && link && /^https?:\/\//.test(link)) items.push({ title, link, source, date: new Date(ts).toISOString(), ts, summary: sum });
  }
  return items;
}
async function fetchFeed(f) {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    const res = await fetch(f.url, { signal: ctrl.signal, headers: { 'User-Agent': 'weiword-news/1.0', 'Accept': 'application/rss+xml, application/xml, text/xml, */*' } });
    clearTimeout(timer);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return parse(await res.text(), f.source);
  } catch (e) { console.warn('feed failed:', f.source, e.message); return []; }
}

(async () => {
  const all = [];
  for (const f of FEEDS) {
    const items = await fetchFeed(f);
    console.log(f.source + ':', items.length);
    all.push(...items);
  }
  const seen = new Set();
  const dedup = all.filter(it => { const k = it.link.split('?')[0]; if (seen.has(k)) return false; seen.add(k); return true; });
  dedup.sort((a, b) => b.ts - a.ts);
  const out = { updated: new Date().toISOString(), items: dedup.slice(0, MAX_ITEMS).map(({ ts, ...r }) => r) };
  fs.writeFileSync('news.json', JSON.stringify(out, null, 2));
  console.log('wrote news.json with', out.items.length, 'items');
})();
