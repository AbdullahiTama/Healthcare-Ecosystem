// XML sitemaps (sitemaps.org 0.9): an index at /sitemap.xml listing one sitemap per kind, each at /sitemaps/<kind>.xml.
// At most 50,000 URLs per file (the protocol limit); larger kinds are split into numbered pages.
import { absolute } from './site.js'

export const SITEMAP_KINDS = ['pages', 'businesses', 'medicines', 'professionals', 'articles']
export const MAX_URLS = 45000

const xmlEsc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
const day = (d) => {
  if (!d) return null
  const t = new Date(d)
  return Number.isNaN(t.getTime()) ? null : t.toISOString().slice(0, 10)
}

export function sitemapIndexXml(siteUrl, entries) {
  return '<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    entries.map((e) => `  <sitemap><loc>${xmlEsc(absolute(siteUrl, e.path))}</loc>${day(e.lastmod) ? `<lastmod>${day(e.lastmod)}</lastmod>` : ''}</sitemap>`).join('\n') +
    '\n</sitemapindex>\n'
}

// urls: [{ path, lastmod?, changefreq?, priority? }]
export function urlsetXml(siteUrl, urls) {
  const seen = new Set()
  const rows = []
  for (const u of urls) {
    const loc = absolute(siteUrl, u.path)
    if (seen.has(loc)) continue
    seen.add(loc)
    rows.push(`  <url><loc>${xmlEsc(loc)}</loc>${day(u.lastmod) ? `<lastmod>${day(u.lastmod)}</lastmod>` : ''}${u.changefreq ? `<changefreq>${u.changefreq}</changefreq>` : ''}${u.priority != null ? `<priority>${u.priority}</priority>` : ''}</url>`)
  }
  return '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + rows.join('\n') + '\n</urlset>\n'
}

export const STATIC_PAGES = [
  { path: '/', changefreq: 'daily', priority: 1.0 },
  { path: '/search', changefreq: 'daily', priority: 0.9 },
  { path: '/business-directory', changefreq: 'daily', priority: 0.9 },
  { path: '/news', changefreq: 'daily', priority: 0.8 },
  { path: '/about', changefreq: 'monthly', priority: 0.5 },
]
