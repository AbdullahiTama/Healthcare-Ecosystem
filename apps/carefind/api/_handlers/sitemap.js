// XML sitemaps from live data, so every public business, medicine, verified professional and article is listed for
// search engines, and new or changed ones appear without a deploy (the static sitemap listed 5 fixed pages).
//   /sitemap.xml              index of the sitemaps below
//   /sitemaps/<kind>.xml      pages | businesses | medicines | professionals | articles
// Only what a logged-out visitor may see (api/_lib/publicData.js), by the same rules as the pages
// (src/lib/seo/pages.js). lastmod uses updated_at where the table has it (carehub migration), else the creation date.
import { serverSiteUrl } from '../../src/lib/seo/site.js'
import { businessPath, professionalPath, newsPath, postPath, medicinePath, medicineName } from '../../src/lib/seo/slugs.js'
import { medicineListings, isIndexableProfessional } from '../../src/lib/seo/pages.js'
import { sitemapIndexXml, urlsetXml, SITEMAP_KINDS, STATIC_PAGES } from '../../src/lib/seo/sitemap.js'
import { titleFromContent } from '../../src/lib/openGraph.js'
import { allRows } from '../_lib/publicData.js'

export async function urlsFor(kind) {
  switch (kind) {
    case 'pages': return STATIC_PAGES
    case 'businesses': {
      const list = await allRows('businesses', { select: 'id,name,city,state,created_at', status: 'eq.active', visible_on_carefind: 'eq.true', order: 'id.asc' }, { optional: 'updated_at' })
      return list.map((b) => ({ path: businessPath(b), lastmod: b.updated_at || b.created_at, changefreq: 'weekly', priority: 0.8 }))
    }
    case 'medicines': {
      const list = await allRows('carefind_products', { select: 'name,generic_name,stock,created_at,business_id,businesses(id,status,visible_on_carefind)', order: 'id.asc' }, { max: 60000, optional: 'updated_at' })
      const byName = new Map()
      const add = (name, when) => {
        const key = medicineName(name)
        if (!key || key.length > 120) return
        const prev = byName.get(key)
        if (!prev || (when && when > prev)) byName.set(key, when || prev || null)
      }
      for (const r of medicineListings(list)) {
        const when = r.updated_at || r.created_at
        add(r.name, when)
        if (r.generic_name) add(r.generic_name, when)   // "paracetamol" as well as "Emzor Paracetamol 500mg"
      }
      return [...byName.entries()].map(([name, lastmod]) => ({ path: medicinePath(name), lastmod, changefreq: 'weekly', priority: 0.7 }))
    }
    case 'professionals': {
      const list = await allRows('profiles', { select: 'id,full_name,display_name,specialty,verification_label,is_verified,created_at', is_verified: 'eq.true', order: 'id.asc' }, { optional: 'updated_at' })
      return list.filter(isIndexableProfessional).map((p) => ({ path: professionalPath(p), lastmod: p.updated_at || p.created_at, changefreq: 'monthly', priority: 0.6 }))
    }
    case 'articles': {
      const [news, posts] = await Promise.all([
        allRows('news', { select: 'id,headline,published_at,created_at', status: 'eq.approved', order: 'id.asc' }, { optional: 'updated_at' }),
        allRows('posts', { select: 'id,content,created_at', post_type: 'eq.article', repost_of: 'is.null', or: '(subscriber_only.is.null,subscriber_only.eq.false)', and: '(or(is_premium.is.null,is_premium.eq.false))', order: 'id.asc' }, { optional: 'updated_at' }),
      ])
      return [
        ...news.map((n) => ({ path: newsPath(n), lastmod: n.updated_at || n.published_at || n.created_at, changefreq: 'monthly', priority: 0.6 })),
        ...posts.map((p) => ({ path: postPath(p, titleFromContent(p.content, 'Article')), lastmod: p.updated_at || p.created_at, changefreq: 'monthly', priority: 0.5 })),
      ]
    }
    default: return null
  }
}

export default async function handler(req, res) {
  const siteUrl = serverSiteUrl()
  const path = String(req.url || '/').split('?')[0]
  res.setHeader('Content-Type', 'application/xml; charset=utf-8')
  // New and changed pages appear within a few hours; crawlers re-read sitemaps often, the database is read rarely.
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=10800, stale-while-revalidate=86400')
  try {
    if (path === '/sitemap.xml') {
      // Each URL carries its own lastmod; the index lists the sitemaps without re-reading every table.
      return res.status(200).send(sitemapIndexXml(siteUrl, SITEMAP_KINDS.map((kind) => ({ path: `/sitemaps/${kind}.xml` }))))
    }
    const m = /^\/sitemaps\/([a-z]+)\.xml$/.exec(path)
    const urls = m && SITEMAP_KINDS.includes(m[1]) ? await urlsFor(m[1]) : null
    if (!urls) return res.status(404).send('<?xml version="1.0" encoding="UTF-8"?><error>No such sitemap</error>')
    return res.status(200).send(urlsetXml(siteUrl, urls))
  } catch (err) {
    console.error('[sitemap] failed', { path, error: err?.message })
    res.setHeader('Cache-Control', 'no-store')
    return res.status(503).send('<?xml version="1.0" encoding="UTF-8"?><error>Sitemap temporarily unavailable</error>')
  }
}
