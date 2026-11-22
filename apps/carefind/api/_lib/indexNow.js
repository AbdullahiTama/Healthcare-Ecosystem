// Tells search engines about new and changed public pages straight away, through IndexNow (https://www.indexnow.org):
// Bing (which also serves ChatGPT search and Copilot), Yandex, Seznam, Naver and others. Google does not take IndexNow;
// it reads the sitemaps' lastmod (api/_handlers/sitemap.js) and Search Console.
//
// The key is public by design: the protocol proves ownership by serving it at https://<host>/<key>.txt
// (public/251dc62b967a9be1ce9795bdfc87f10e.txt). Runs once a day from the cron endpoint (api/cron/process-email-outbox.js, step seo_indexnow),
// production only, and reads as a logged-out visitor (api/_lib/publicData.js), so only public pages are ever sent.
import { serverSiteUrl, absolute } from '../../src/lib/seo/site.js'
import { businessPath, professionalPath, newsPath, postPath, medicinePath, medicineName } from '../../src/lib/seo/slugs.js'
import { isPublicListing, isIndexableProfessional } from '../../src/lib/seo/pages.js'
import { titleFromContent } from '../../src/lib/openGraph.js'
import { allRows } from './publicData.js'

export const INDEXNOW_KEY = '251dc62b967a9be1ce9795bdfc87f10e'
export const INDEXNOW_ENDPOINT = 'https://api.indexnow.org/indexnow'
const BATCH = 10000

// Paths of public pages created or changed since `sinceIso` (needs the updated_at columns of
// carefind_20270201_seo_updated_at; before it, the reads that need them return nothing and are logged).
export async function changedPaths(sinceIso) {
  const gte = `gte.${sinceIso}`
  const [biz, pros, news, posts, products] = await Promise.all([
    allRows('businesses', { select: 'id,name,city,state', status: 'eq.active', visible_on_carefind: 'eq.true', updated_at: gte, order: 'id.asc' }),
    allRows('profiles', { select: 'id,full_name,display_name,specialty,verification_label,is_verified', is_verified: 'eq.true', updated_at: gte, order: 'id.asc' }),
    allRows('news', { select: 'id,headline', status: 'eq.approved', updated_at: gte, order: 'id.asc' }),
    allRows('posts', { select: 'id,content', post_type: 'eq.article', repost_of: 'is.null', or: `(created_at.gte.${sinceIso},updated_at.gte.${sinceIso})`, and: '(or(subscriber_only.is.null,subscriber_only.eq.false),or(is_premium.is.null,is_premium.eq.false))', order: 'id.asc' }),
    allRows('carefind_products', { select: 'name,generic_name,stock,business_id,businesses(id,status,visible_on_carefind)', updated_at: gte, order: 'id.asc' }, { max: 20000 }),
  ])
  // Out-of-stock listings count too: a medicine whose last seller ran out now shows as not listed, and search engines
  // should hear about that as well.
  const meds = new Set()
  for (const p of products.filter(isPublicListing)) {
    if (medicineName(p.name)) meds.add(medicineName(p.name))
    if (medicineName(p.generic_name)) meds.add(medicineName(p.generic_name))
  }
  return [
    ...biz.map(businessPath),
    ...pros.filter(isIndexableProfessional).map(professionalPath),
    ...news.map(newsPath),
    ...posts.map((p) => postPath(p, titleFromContent(p.content, 'Article'))),
    ...[...meds].map(medicinePath),
  ]
}

export async function submitUrls(urls, { siteUrl = serverSiteUrl(), fetchImpl = fetch } = {}) {
  const host = new URL(siteUrl).host
  let sent = 0
  for (let i = 0; i < urls.length; i += BATCH) {
    const urlList = urls.slice(i, i + BATCH)
    const res = await fetchImpl(INDEXNOW_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ host, key: INDEXNOW_KEY, keyLocation: absolute(siteUrl, `/${INDEXNOW_KEY}.txt`), urlList }),
    })
    // 200 / 202: accepted. 4xx: the request or key was refused (reported, not retried: next day's run resends).
    if (res.status !== 200 && res.status !== 202) throw new Error(`IndexNow refused the submission: HTTP ${res.status}`)
    sent += urlList.length
  }
  return sent
}

// The daily step: everything changed in the last `sinceHours` (a little over a day, so a late run misses nothing).
export async function submitChangedPages({ sinceHours = 26, env = process.env, now = Date.now() } = {}) {
  if (env.VERCEL_ENV && env.VERCEL_ENV !== 'production') return { skipped: 'not production' }
  if (env.INDEXNOW_DISABLED === 'true') return { skipped: 'disabled' }
  const siteUrl = serverSiteUrl(env)
  const paths = await changedPaths(new Date(now - sinceHours * 3600000).toISOString())
  if (paths.length === 0) return { sent: 0 }
  const sent = await submitUrls([...new Set(paths)].map((p) => absolute(siteUrl, p)), { siteUrl })
  return { sent }
}
