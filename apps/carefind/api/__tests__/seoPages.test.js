// @vitest-environment node
// Search engines and AI crawlers get server-rendered pages (api/_handlers/seo.js) and live sitemaps
// (api/_handlers/sitemap.js), routed by api/router.js and vercel.json; people keep the app.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
// The other handlers create a Supabase client when the router is imported; none is used here.
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: () => ({}), auth: {}, rpc: () => ({}) }) }))
import router from '../router.js'
import { CRAWLER_UA_REGEX_SOURCE } from '../../src/lib/seo/crawlers.js'

const BIZ_ID = '0b6f2c4e-1111-4222-8333-944455556666'
const PRO_ID = '1c6f2c4e-1111-4222-8333-944455556666'
const MEMBER_ID = '2d6f2c4e-1111-4222-8333-944455556666'
const POST_ID = '3e6f2c4e-1111-4222-8333-944455556666'
const NOTE_ID = '4f6f2c4e-1111-4222-8333-944455556666'
const BUSINESS = { id: BIZ_ID, name: 'MedPlus Pharmacy', business_type: 'pharmacy', status: 'active', visible_on_carefind: true, city: 'Ikeja', state: 'Lagos', address: '12 Allen Avenue', phone: '08030000000', created_at: '2026-10-01T00:00:00Z', show_prices: true }
const LISTING = { id: 'l1', name: 'Paracetamol 500mg', generic_name: 'Paracetamol', price: 300, show_price: true, stock: 10, created_at: '2026-11-01T00:00:00Z', business_id: BIZ_ID, businesses: { ...BUSINESS } }

// A small PostgREST stand-in: answers by table and the filters the handlers use; `updated_at` is refused (400)
// unless `hasUpdatedAt`, like the database before the carehub migration.
let calls, hasUpdatedAt
const COLUMNS = Object.fromEntries(Object.entries({
  businesses: 'id,name,address,city,state,business_type,whatsapp,phone,website,hours,maps_link,cover_url,logo_url,description,status,visible_on_carefind,latitude,longitude,lat,lng,show_prices,created_at',
  carefind_products: 'id,business_id,owner_id,name,generic_name,category,emoji,image_url,description,whatsapp,sale_type,price_unit,min_purchase,seller_location,latitude,longitude,stock,list_on_carefind,created_at,rx_status,rx_restricted,price,show_price',
  profiles: 'id,display_name,created_at,is_verified,verification_label,full_name,cover_url,location,website,specialty,avatar_url,bio',
  news: 'id,headline,subtitle,body,hero_image_url,author_id,status,created_at,published_at,posting_as_business_id',
  posts: 'id,content,post_type,image_url,image_urls,subscriber_only,is_premium,repost_of,user_id,created_at',
  business_services: 'id,name,price_kobo,duration_minutes,is_active,business_id',
  reviews: 'id,rating,comment,created_at,user_id,business_id',
}).map(([t, cols]) => [t, new Set(cols.split(','))]))
function fakeFetch(url) {
  const u = new URL(url)
  const table = u.pathname.split('/').pop()
  const q = Object.fromEntries(u.searchParams)
  calls.push({ table, q })
  const json = (body, status = 200) => Promise.resolve({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) })
  if (!hasUpdatedAt && (q.select || '').includes('updated_at')) return json({ message: 'column updated_at does not exist' }, 400)
  // Strict like PostgREST: a column the live table does not have is a 400 (the live columns, read 2026-11-22).
  const unknown = (q.select || '').replace(/\w+\([^)]*\)/g, '').split(',').map((c) => c.trim()).filter(Boolean).filter((c) => c !== 'updated_at' && !(COLUMNS[table] || new Set()).has(c))
  if (unknown.length) return json({ message: `column ${table}.${unknown[0]} does not exist` }, 400)
  const byId = (rows) => rows.filter((r) => !q.id || q.id === `eq.${r.id}`)
  switch (table) {
    case 'businesses': return json(byId([BUSINESS]))
    case 'carefind_products': return json(q.business_id ? [LISTING] : (q.name ? (q.name.toLowerCase().includes('paracetamol') ? [LISTING] : []) : [LISTING]))
    case 'business_services': return json([])
    case 'reviews': return json([{ rating: 5, comment: 'Very helpful' }])
    case 'profiles': return json(byId([
      { id: PRO_ID, full_name: 'Ada Obi', specialty: 'Pharmacist', is_verified: true, bio: 'Community pharmacist.', created_at: '2026-09-01T00:00:00Z' },
      { id: MEMBER_ID, full_name: 'Private Member', is_verified: false, bio: 'My personal bio' },
    ]).filter((p) => !q.is_verified || p.is_verified))
    case 'news': return json([])
    case 'posts': return json(byId([
      { id: POST_ID, post_type: 'article', content: '**Five Facts About Malaria Prevention**\n\nSleep under a net.', created_at: '2026-11-03T00:00:00Z', user_id: PRO_ID },
      { id: NOTE_ID, post_type: 'text', content: 'Good morning everyone', created_at: '2026-11-04T00:00:00Z' },
    ]).filter((p) => !q.post_type || q.post_type === `eq.${p.post_type}`))
    default: return json([])
  }
}

function call(path, ua = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)') {
  return new Promise((resolve) => {
    const res = { statusCode: 200, headers: {}, body: '' }
    res.setHeader = (k, v) => { res.headers[k.toLowerCase()] = v }
    res.status = (c) => { res.statusCode = c; return res }
    res.send = (b) => { res.body = b; resolve(res) }
    res.json = (b) => { res.body = b; resolve(res) }
    router({ url: path, method: 'GET', headers: { 'user-agent': ua, host: 'carefind.ng' } }, res)
  })
}
const jsonLd = (html) => [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]))

beforeEach(() => {
  calls = []
  hasUpdatedAt = false
  vi.stubEnv('SUPABASE_URL', 'https://db.test')
  vi.stubEnv('SUPABASE_ANON_KEY', 'anon-key')
  vi.stubEnv('SITE_URL', '')
  vi.stubGlobal('fetch', vi.fn(fakeFetch))
})
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })

describe('pages for search engines and AI crawlers', () => {
  it('a pharmacy: its own title, canonical (carefind.ng, readable URL), products and Pharmacy structured data', async () => {
    const res = await call('/business/' + BIZ_ID)
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toMatch(/text\/html/)
    expect(res.body).toContain('<title>MedPlus Pharmacy: Pharmacy in Ikeja, Lagos | CareFind</title>')
    expect(res.body).toContain(`<link rel="canonical" href="https://carefind.ng/business/medplus-pharmacy-ikeja-lagos-${BIZ_ID}" />`)
    expect(res.body).toContain('href="/drug/paracetamol%20500mg"')
    const org = jsonLd(res.body).find((x) => x['@type'] === 'Pharmacy')
    expect(org).toMatchObject({ name: 'MedPlus Pharmacy', aggregateRating: { ratingValue: 5 } })
    // Only the public key is ever used.
    expect(fetch.mock.calls.every(([, init]) => init.headers.apikey === 'anon-key')).toBe(true)
  })

  it('the same page by its readable URL; an unknown id is a noindex 404', async () => {
    expect((await call(`/business/medplus-pharmacy-${BIZ_ID}`)).statusCode).toBe(200)
    const missing = await call('/business/not-a-real-id')
    expect(missing.statusCode).toBe(404)
    expect(missing.headers['x-robots-tag']).toBe('noindex, follow')
  })

  it('a medicine: the pharmacies that have it, with Product offers', async () => {
    const res = await call('/drug/paracetamol%20500mg', 'Mozilla/5.0 (compatible; bingbot/2.0)')
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('Paracetamol 500mg: price and availability in Nigeria (1 pharmacy)')
    expect(res.body).toContain(`href="/business/medplus-pharmacy-ikeja-lagos-${BIZ_ID}"`)
    expect(jsonLd(res.body).find((x) => x['@type'] === 'Product').offers).toMatchObject({ lowPrice: 300, priceCurrency: 'NGN' })
  })

  it('AI crawlers get the same pages', async () => {
    for (const ua of ['GPTBot/1.1 (+https://openai.com/gptbot)', 'ClaudeBot/1.0', 'PerplexityBot/1.0']) {
      expect((await call('/drug/paracetamol', ua)).body, ua).toContain('price and availability in Nigeria')
    }
  })

  it('a verified professional is indexed; an ordinary member is not described', async () => {
    const pro = await call('/u/' + PRO_ID)
    expect(pro.body).toContain('Ada Obi, Pharmacist')
    expect(jsonLd(pro.body).some((x) => x['@type'] === 'Person')).toBe(true)
    const member = await call('/u/' + MEMBER_ID)
    expect(member.statusCode).toBe(404)
    expect(member.body).not.toContain('Private Member')
    expect(member.body).not.toContain('My personal bio')
  })

  it('an article post is an Article page; an ordinary post keeps its preview card', async () => {
    const art = await call('/post/' + POST_ID)
    expect(art.body).toContain('<h1>Five Facts About Malaria Prevention</h1>')
    expect(jsonLd(art.body).find((x) => x['@type'] === 'Article')).toMatchObject({ author: { name: 'Ada Obi' } })
    const note = await call('/post/' + NOTE_ID)
    expect(note.body).toContain('og:title')
    expect(note.body).not.toContain('application/ld+json')
  })

  it('home and directory link to every business; /search lists medicines A to Z', async () => {
    expect((await call('/')).body).toContain(`/business/medplus-pharmacy-ikeja-lagos-${BIZ_ID}`)
    expect((await call('/business-directory')).body).toContain('<h2>Lagos</h2>')
    const search = await call('/search')
    expect(search.body).toContain('href="/drug/paracetamol%20500mg"')
    expect((await call('/search?q=amox')).headers['x-robots-tag']).toBe('noindex, follow')
  })

  it('SITE_URL changes the canonical host', async () => {
    vi.stubEnv('SITE_URL', 'https://www.carefind.ng')
    expect((await call('/business/' + BIZ_ID)).body).toContain('href="https://www.carefind.ng/business/')
  })
})

describe('routing', () => {
  it('people are not served these pages (the app keeps the URL); preview bots keep their cards', async () => {
    const human = await call('/business/' + BIZ_ID, 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Safari/604.1')
    expect(human.statusCode).toBe(404)                      // only reachable by a mis-routed request: no page leaks
    const preview = await call('/business/' + BIZ_ID, 'WhatsApp/2.23.20.0')
    expect(preview.body).toContain('og:title')
    expect(preview.body).not.toContain('application/ld+json')
  })
  it('an /api path is never turned into a page', async () => {
    const res = await call('/api/nope')
    expect(res.statusCode).toBe(404)
    expect(typeof res.body).toBe('object')
  })
  it('vercel.json sends search and AI crawlers and sitemaps to the router, before the app fallback; the static sitemap is gone', () => {
    const root = fileURLToPath(new URL('../../', import.meta.url))
    const cfg = JSON.parse(readFileSync(root + 'vercel.json', 'utf8'))
    const idx = (pred) => cfg.rewrites.findIndex(pred)
    const seo = idx((r) => r.has?.some((h) => h.key === 'user-agent' && h.value === CRAWLER_UA_REGEX_SOURCE))
    const spa = idx((r) => r.destination === '/index.html')
    expect(seo).toBeGreaterThan(-1)
    expect(cfg.rewrites[seo].destination).toBe('/api/router')
    expect(spa).toBeGreaterThan(seo)
    expect(idx((r) => r.source === '/sitemap.xml')).toBeLessThan(spa)
    expect(idx((r) => r.source === '/sitemaps/(.*)')).toBeLessThan(spa)
    expect(existsSync(root + 'public/sitemap.xml')).toBe(false)
    const robots = readFileSync(root + 'public/robots.txt', 'utf8')
    expect(robots).toContain('Sitemap: https://carefind.ng/sitemap.xml')
    expect(robots).toContain('User-agent: GPTBot')
    expect(robots).toContain('Disallow: /track/')
  })
})

describe('sitemaps', () => {
  it('the index lists one sitemap per kind on carefind.ng', async () => {
    const res = await call('/sitemap.xml', 'Mozilla/5.0')
    expect(res.headers['content-type']).toMatch(/xml/)
    for (const k of ['pages', 'businesses', 'medicines', 'professionals', 'articles']) expect(res.body).toContain(`<loc>https://carefind.ng/sitemaps/${k}.xml</loc>`)
  })
  it('each kind lists its public pages with lastmod, by the same rules as the pages', async () => {
    expect((await call('/sitemaps/businesses.xml')).body).toContain(`<loc>https://carefind.ng/business/medplus-pharmacy-ikeja-lagos-${BIZ_ID}</loc><lastmod>2026-10-01</lastmod>`)
    const meds = (await call('/sitemaps/medicines.xml')).body
    expect(meds).toContain('<loc>https://carefind.ng/drug/paracetamol%20500mg</loc>')
    expect(meds).toContain('<loc>https://carefind.ng/drug/paracetamol</loc>')     // the generic name too
    const pros = (await call('/sitemaps/professionals.xml')).body
    expect(pros).toContain(`/u/ada-obi-pharmacist-${PRO_ID}`)
    expect(pros).not.toContain(MEMBER_ID)
    const arts = (await call('/sitemaps/articles.xml')).body
    expect(arts).toContain(`/post/five-facts-about-malaria-prevention-${POST_ID}`)
    expect(arts).not.toContain(NOTE_ID)
    expect((await call('/sitemaps/nope.xml')).statusCode).toBe(404)
  })
  it('uses updated_at once the database has it (and works before)', async () => {
    hasUpdatedAt = true
    BUSINESS.updated_at = '2026-11-21T08:00:00Z'
    try {
      expect((await call('/sitemaps/businesses.xml')).body).toContain('<lastmod>2026-11-21</lastmod>')
    } finally { delete BUSINESS.updated_at }
    expect(calls.some((c) => c.table === 'businesses' && c.q.select.includes('updated_at'))).toBe(true)
  })
})
