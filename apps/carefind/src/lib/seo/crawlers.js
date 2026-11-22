// Which crawlers get the server-rendered pages (src/lib/seo/pages.js): search engines and AI search / answer engines,
// most of which do not run JavaScript, so the app's empty page told them nothing. Link-preview bots keep their cards
// (src/lib/openGraph.js). Names are written as each crawler sends them: vercel.json's User-Agent rewrite is a
// case-sensitive regular expression built from this list (kept in step by a test); the function itself re-checks
// case-insensitively.
export const SEARCH_CRAWLERS = [
  'Googlebot', 'Google-InspectionTool', 'Storebot-Google', 'AdsBot-Google', 'bingbot', 'BingPreview', 'msnbot',
  'DuckDuckBot', 'YandexBot', 'Baiduspider', 'Applebot', 'PetalBot', 'SeznamBot', 'Sogou', 'Yeti',
]
export const AI_CRAWLERS = [
  'GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'ClaudeBot', 'Claude-SearchBot', 'Claude-User', 'anthropic-ai',
  'PerplexityBot', 'Perplexity-User', 'CCBot', 'Amazonbot', 'cohere-ai', 'YouBot', 'Diffbot', 'MistralAI-User',
  'DuckAssistBot', 'meta-externalfetcher', 'Bytespider',
]
export const SEO_CRAWLERS = [...SEARCH_CRAWLERS, ...AI_CRAWLERS]
const LOWER = SEO_CRAWLERS.map((p) => p.toLowerCase())

export function isSearchOrAiCrawler(userAgent) {
  if (!userAgent) return false
  const ua = String(userAgent).toLowerCase()
  return LOWER.some((p) => ua.includes(p))
}

// The list as the regular expression vercel.json matches the User-Agent header against.
export const CRAWLER_UA_REGEX_SOURCE = '.*(' + SEO_CRAWLERS.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ').*'
