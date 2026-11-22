// Server-rendered pages for search engines and AI crawlers (owner decision 2026-11-22: crawler pages now).
//
// CareFind is a single-page app: the HTML every URL returns is the same empty shell, with the homepage's title and a
// canonical pointing at the homepage, so search engines saw every pharmacy, medicine and article as a copy of the
// homepage, and crawlers that do not run JavaScript (Bing, ChatGPT, Perplexity, Claude…) saw nothing at all.
// vercel.json rewrites requests from those crawlers (src/lib/seo/crawlers.js) to /api/router, which hands them
// here; people keep getting the app unchanged. Each page carries the same content the app shows for that URL
// (no cloaking), with its own title, description, canonical URL and schema.org structured data.
//
// Reads as a logged-out visitor (api/_lib/publicData.js: anon key, RLS). A record that is not public gives a
// noindex 404; anything unexpected gives the home page (200) rather than an error a crawler would cache.
import { serverSiteUrl } from '../../src/lib/seo/site.js'
import { idFromParam, medicineName, newsPath, postPath } from '../../src/lib/seo/slugs.js'
import {
  businessPage, medicinePage, professionalPage, newsPage, articlePostPage, homePage, directoryPage,
  articlesIndexPage, medicinesIndexPage, aboutPage, unavailablePage, medicineListings,
} from '../../src/lib/seo/pages.js'
import { renderPage } from '../../src/lib/seo/render.js'
import { titleFromContent } from '../../src/lib/openGraph.js'
import { rows, one, allRows } from '../_lib/publicData.js'
import ogHandler from './og.js'

const BUSINESS_COLUMNS = 'id,name,address,city,state,business_type,whatsapp,phone,website,hours,maps_link,cover_url,logo_url,description,status,visible_on_carefind,latitude,longitude,lat,lng,show_prices'
const LISTING_COLUMNS = 'id,name,generic_name,price,show_price,rx_restricted,rx_status,stock,image_url,description,seller_location,business_id,businesses(id,name,city,state,business_type,show_prices,status,visible_on_carefind)'
const PUBLIC_BUSINESSES = { select: 'id,name,city,state,business_type', status: 'eq.active', visible_on_carefind: 'eq.true', order: 'name.asc', limit: '1000' }
const PUBLIC_ARTICLE_POSTS = { post_type: 'eq.article', repost_of: 'is.null', or: '(subscriber_only.is.null,subscriber_only.eq.false)', and: '(or(is_premium.is.null,is_premium.eq.false))' }

// A medicine name typed into a URL is matched as the app matches it (ilike); "%" and "_" are literal here.
const likeValue = (s) => String(s).replace(/[%_\\]/g, (c) => '\\' + c)

async function latestArticles(limit = 30) {
  const [news, posts] = await Promise.all([
    rows('news', { select: 'id,headline,published_at,created_at', status: 'eq.approved', order: 'published_at.desc.nullslast', limit: String(limit) }),
    rows('posts', { select: 'id,content,created_at', ...PUBLIC_ARTICLE_POSTS, order: 'created_at.desc', limit: String(limit) }),
  ])
  return [
    ...news.map((n) => ({ title: n.headline || 'News', path: newsPath(n), date: n.published_at || n.created_at })),
    ...posts.map((p) => { const t = titleFromContent(p.content, 'Article'); return { title: t, path: postPath(p, t), date: p.created_at } }),
  ].sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, limit)
}

// Medicine names with at least one public, in-stock listing, most widely stocked first.
export async function popularMedicines(limit = 100) {
  const listings = await allRows('carefind_products', { select: 'name,stock,business_id,businesses(id,status,visible_on_carefind)', order: 'id.asc' }, { max: 30000 })
  const counts = new Map()
  for (const r of medicineListings(listings)) {
    const key = medicineName(r.name)
    if (!key) continue
    const entry = counts.get(key) || { name: String(r.name).trim(), n: 0 }
    entry.n += 1
    counts.set(key, entry)
  }
  return [...counts.values()].sort((a, b) => b.n - a.n || a.name.localeCompare(b.name)).slice(0, limit).map((e) => e.name)
}

async function authorName(profileId, businessId) {
  if (businessId) {
    const b = await one('businesses', { select: 'name', id: `eq.${businessId}` })
    if (b?.name) return b.name
  }
  if (!profileId) return null
  const p = await one('profiles', { select: 'full_name,display_name', id: `eq.${profileId}` })
  return p?.full_name || p?.display_name || null
}

export async function pageFor(siteUrl, url) {
  const [rawPath, rawQuery = ''] = String(url || '/').split('?')
  const segments = rawPath.split('/').filter(Boolean).map((s) => { try { return decodeURIComponent(s) } catch { return s } })
  const query = new URLSearchParams(rawQuery)
  const [head, param] = segments

  if (!head) {
    const [businesses, medicines, articles] = await Promise.all([rows('businesses', PUBLIC_BUSINESSES), popularMedicines(100), latestArticles(20)])
    return homePage(siteUrl, { businesses, medicines, articles })
  }
  if (head === 'business' && param) {
    const id = idFromParam(param)
    if (!id) return unavailablePage(siteUrl, rawPath, 'business')
    const biz = await one('businesses', { select: BUSINESS_COLUMNS, id: `eq.${id}` }, { optional: 'updated_at' })
    if (!biz) return unavailablePage(siteUrl, rawPath, 'business')
    const [products, services, reviews] = await Promise.all([
      rows('carefind_products', { select: 'id,name,generic_name,price,show_price,rx_restricted,rx_status,stock', business_id: `eq.${id}`, order: 'name.asc', limit: '1000' }),
      rows('business_services', { select: 'name,price_kobo,is_active', business_id: `eq.${id}`, is_active: 'eq.true' }),
      rows('reviews', { select: 'rating,comment,created_at', business_id: `eq.${id}`, order: 'created_at.desc', limit: '50' }),
    ])
    return businessPage(siteUrl, biz, { products, services, reviews })
  }
  if (head === 'drug' && param) {
    const name = param.trim()
    if (!name || name.length > 120) return unavailablePage(siteUrl, rawPath, 'medicine')
    const listings = await rows('carefind_products', { select: LISTING_COLUMNS, name: `ilike.*${likeValue(name)}*`, limit: '300' })
    const generics = [...new Set(listings.map((l) => String(l.generic_name || '').trim()).filter(Boolean))].slice(0, 3)
    const related = generics.length
      ? [...new Set((await rows('carefind_products', { select: 'name', generic_name: `in.(${generics.map((g) => `"${g.replace(/"/g, '')}"`).join(',')})`, limit: '200' }))
        .map((r) => String(r.name).trim()).filter((n) => n && medicineName(n) !== medicineName(name)))].slice(0, 20)
      : []
    return medicinePage(siteUrl, name, { listings, related })
  }
  if (head === 'u' && param) {
    const id = idFromParam(param)
    const profile = id && await one('profiles', { select: 'id,full_name,display_name,bio,avatar_url,specialty,verification_label,is_verified,location,website', id: `eq.${id}` })
    return professionalPage(siteUrl, profile || null)
  }
  if (head === 'news' && param) {
    const id = idFromParam(param)
    const article = id && await one('news', { select: 'id,headline,subtitle,body,hero_image_url,status,published_at,created_at,author_id,posting_as_business_id', id: `eq.${id}` }, { optional: 'updated_at' })
    if (!article) return unavailablePage(siteUrl, rawPath, 'article')
    return newsPage(siteUrl, article, { authorName: await authorName(article.author_id, article.posting_as_business_id) })
  }
  if (head === 'news') return articlesIndexPage(siteUrl, await latestArticles(200))
  if (head === 'post' && param) {
    const id = idFromParam(param)
    const post = id && await one('posts', { select: 'id,content,post_type,image_url,image_urls,subscriber_only,is_premium,repost_of,user_id,created_at', id: `eq.${id}` }, { optional: 'updated_at' })
    const page = post && articlePostPage(siteUrl, post, { authorName: await authorName(post.user_id) })
    return page || { delegate: 'og' }   // an ordinary post: its preview card, as before
  }
  if (head === 'business-directory') return directoryPage(siteUrl, await rows('businesses', PUBLIC_BUSINESSES))
  if (head === 'search') return medicinesIndexPage(siteUrl, await popularMedicines(5000), { query: query.get('q') || '' })
  if (head === 'about') return aboutPage(siteUrl)
  return { delegate: 'og' }   // every other route: the site's own tags, as preview bots get
}

export default async function handler(req, res) {
  const siteUrl = serverSiteUrl()
  let page
  try {
    page = await pageFor(siteUrl, req.url || '/')
  } catch (err) {
    console.error('[seo] falling back to the home page', { path: req.url, error: err?.message })
    page = homePage(siteUrl, {})
  }
  if (page.delegate === 'og') {
    // Not one of the indexable pages (an ordinary feed post, an app screen): its preview card, kept out of search
    // results as the app keeps it (src/lib/seo/useSeo.js).
    res.setHeader('X-Robots-Tag', 'noindex, follow')
    return ogHandler(req, res)
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.setHeader('X-Robots-Tag', page.robots)
  // A crawl of thousands of pages must not become thousands of database reads; a changed listing shows within the hour.
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400')
  res.setHeader('Vary', 'User-Agent')
  return res.status(page.status || 200).send(req.method === 'HEAD' ? '' : renderPage(page, { siteUrl }))
}
