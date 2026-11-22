import { describe, it, expect } from 'vitest'
import { slugify, idFromParam, businessPath, professionalPath, newsPath, medicinePath } from './slugs.js'
import { isSearchOrAiCrawler, CRAWLER_UA_REGEX_SOURCE } from './crawlers.js'
import { normaliseSiteUrl, serverSiteUrl } from './site.js'
import { businessPage, medicinePage, professionalPage, newsPage, articlePostPage, homePage, directoryPage, INDEX, NOINDEX } from './pages.js'
import { renderPage, esc } from './render.js'
import { sitemapIndexXml, urlsetXml } from './sitemap.js'

const SITE = 'https://carefind.ng'
const BIZ = { id: '0b6f2c4e-1111-4222-8333-944455556666', name: 'MedPlus Pharmacy', business_type: 'pharmacy', status: 'active', visible_on_carefind: true,
  address: '12 Allen Avenue', city: 'Ikeja', state: 'Lagos', phone: '0803 000 0000', hours: 'Mon-Sun 8am-10pm', website: 'https://medplus.ng', lat: 6.6, lng: 3.35, show_prices: true }
const ld = (page, type) => page.jsonLd.find((x) => x['@type'] === type)

describe('slugs', () => {
  it('readable slug then the id; the id is recovered from either form', () => {
    expect(businessPath(BIZ)).toBe('/business/medplus-pharmacy-ikeja-lagos-0b6f2c4e-1111-4222-8333-944455556666')
    expect(idFromParam('medplus-pharmacy-ikeja-lagos-0b6f2c4e-1111-4222-8333-944455556666')).toBe(BIZ.id)
    expect(idFromParam(BIZ.id.toUpperCase())).toBe(BIZ.id)
    expect(idFromParam('not-an-id')).toBeNull()
    expect(slugify('Dr. Ádà Obi & Sons, Ltd')).toBe('dr-ada-obi-and-sons-ltd')
    expect(medicinePath('  Ampiclox  500mg ')).toBe('/drug/ampiclox%20500mg')
    expect(professionalPath({ id: BIZ.id, full_name: 'Ada Obi', specialty: 'Pharmacist' })).toBe('/u/ada-obi-pharmacist-' + BIZ.id)
    expect(newsPath({ id: BIZ.id, headline: 'Malaria: what to know' })).toBe('/news/malaria-what-to-know-' + BIZ.id)
  })
})

describe('crawlers and site', () => {
  it('search and AI crawlers are recognised, people and preview bots are not', () => {
    for (const ua of ['Mozilla/5.0 (compatible; Googlebot/2.1)', 'Mozilla/5.0 (compatible; bingbot/2.0)', 'GPTBot/1.1', 'OAI-SearchBot/1.0', 'ClaudeBot/1.0', 'PerplexityBot/1.0'])
      expect(isSearchOrAiCrawler(ua), ua).toBe(true)
    for (const ua of ['Mozilla/5.0 (iPhone) Safari', 'WhatsApp/2.23', 'facebookexternalhit/1.1', '', null]) expect(isSearchOrAiCrawler(ua), String(ua)).toBe(false)
    expect(new RegExp(CRAWLER_UA_REGEX_SOURCE).test('Mozilla/5.0 (compatible; Googlebot/2.1)')).toBe(true)
  })
  it('the canonical site defaults to carefind.ng; a bad setting falls back to it', () => {
    expect(serverSiteUrl({})).toBe(SITE)
    expect(serverSiteUrl({ SITE_URL: 'https://carefind.ng/' })).toBe(SITE)
    expect(normaliseSiteUrl('javascript:alert(1)')).toBe(SITE)
  })
})

describe('business page', () => {
  const products = [
    { id: 'p1', name: 'Paracetamol 500mg', generic_name: 'Paracetamol', price: 300, show_price: true, stock: 20 },
    { id: 'p2', name: 'Ampiclox 500mg', price: null, rx_restricted: true, stock: 5 },
    { id: 'p3', name: 'Hidden Price Cream', price: 900, show_price: false, stock: 3 },
    { id: 'p4', name: 'Sold Out Syrup', price: 500, stock: 0 },
  ]
  it('carries the name, type, place, contacts, products (linked) and structured data', () => {
    const page = businessPage(SITE, BIZ, { products, reviews: [{ rating: 5, comment: 'Helpful staff' }, { rating: 4, comment: '' }] })
    expect(page.robots).toBe(INDEX)
    expect(page.title).toBe('MedPlus Pharmacy: Pharmacy in Ikeja, Lagos')
    expect(page.canonical).toBe(SITE + businessPath(BIZ))
    expect(page.description).toMatch(/pharmacy in Ikeja, Lagos/)
    const list = page.sections.find((s) => /Medicines and products/.test(s.heading)).items
    expect(list.map((i) => i.text)).toEqual(['Paracetamol 500mg', 'Ampiclox 500mg', 'Hidden Price Cream'])   // sold out is left out
    expect(list[0]).toMatchObject({ href: '/drug/paracetamol%20500mg', meta: 'Paracetamol · ₦300' })
    expect(list[1].meta).toBe('Prescription: ask the pharmacist')
    expect(list[2].meta).toBe('Ask for price')                                                          // hidden price stays hidden
    const org = ld(page, 'Pharmacy')
    expect(org).toMatchObject({ name: 'MedPlus Pharmacy', telephone: '0803 000 0000', address: { addressLocality: 'Ikeja', addressRegion: 'Lagos', addressCountry: 'NG' },
      geo: { latitude: 6.6, longitude: 3.35 }, aggregateRating: { ratingValue: 4.5, reviewCount: 2 } })
    expect(org.hasOfferCatalog.itemListElement.map((o) => o.itemOffered.name)).toEqual(['Paracetamol 500mg'])
    expect(ld(page, 'BreadcrumbList').itemListElement.map((c) => c.name)).toEqual(['Home', 'Pharmacies', 'MedPlus Pharmacy'])
  })
  it('a business that hides all prices shows none, in the page or the structured data', () => {
    const page = businessPage(SITE, { ...BIZ, show_prices: false }, { products })
    expect(page.sections[0].items[0].meta).toBe('Paracetamol · Ask for price')
    expect(ld(page, 'Pharmacy').hasOfferCatalog).toBeUndefined()
  })
  it('a business that is not public gives a noindex page with none of its details', () => {
    for (const b of [{ ...BIZ, status: 'suspended' }, { ...BIZ, visible_on_carefind: false }, null]) {
      const page = businessPage(SITE, b, { products })
      expect(page.robots).toBe(NOINDEX)
      expect(JSON.stringify(page)).not.toMatch(/0803|Allen Avenue|Paracetamol/)
    }
  })
})

describe('medicine page', () => {
  const listings = [
    { name: 'Paracetamol 500mg', generic_name: 'Paracetamol', price: 300, show_price: true, stock: 10, business_id: BIZ.id, businesses: { ...BIZ } },
    { name: 'paracetamol 500mg', price: 250, show_price: true, stock: 4, business_id: 'b2', businesses: { id: 'b2', name: 'Alpha Pharmacy', city: 'Yaba', state: 'Lagos', business_type: 'pharmacy', show_prices: true } },
    { name: 'Paracetamol 500mg', price: 999, show_price: true, stock: 0, business_id: 'b3', businesses: { id: 'b3', name: 'Out Of Stock Ltd', city: 'Ikeja' } },
    { name: 'Paracetamol 500mg', price: 100, stock: 9, business_id: 'b4', businesses: null },   // business not public (RLS)
  ]
  it('lists the pharmacies that have it, with prices, the range and Product structured data', () => {
    const page = medicinePage(SITE, 'paracetamol 500mg', { listings, related: ['Panadol Extra'] })
    expect(page.h1).toBe('Paracetamol 500mg')
    expect(page.title).toMatch(/^Paracetamol 500mg: price and availability in Nigeria \(2 pharmacies\)/)
    expect(page.description).toMatch(/available at 2 pharmacies in Ikeja, Yaba\. Prices from ₦250/)
    const where = page.sections.find((s) => /Where to get/.test(s.heading)).items
    expect(where.map((i) => i.text)).toEqual(['MedPlus Pharmacy', 'Alpha Pharmacy'])
    expect(where[0].href).toBe(businessPath(BIZ))
    const product = ld(page, 'Product')
    expect(product.offers).toMatchObject({ lowPrice: 250, highPrice: 300, priceCurrency: 'NGN', offerCount: 2 })
    expect(product.alternateName).toEqual(['Paracetamol'])
  })
  it('nothing in stock at a public seller: noindex', () => {
    expect(medicinePage(SITE, 'Unobtainium', { listings: [listings[2], listings[3]] }).robots).toBe(NOINDEX)
  })
  it('a prescription medicine shows no price and says why', () => {
    const page = medicinePage(SITE, 'Ampiclox', { listings: [{ name: 'Ampiclox', rx_restricted: true, price: null, stock: 2, business_id: BIZ.id, businesses: BIZ }] })
    expect(ld(page, 'Product').offers).toBeUndefined()
    expect(page.sections.some((s) => s.heading === 'Prescription')).toBe(true)
  })
})

describe('professionals and articles', () => {
  const pro = { id: BIZ.id, full_name: 'Ada Obi', specialty: 'Pharmacist', bio: 'Community pharmacist.', is_verified: true, location: 'Lagos' }
  it('a verified professional is indexable, with Person data; anyone else is noindex', () => {
    const page = professionalPage(SITE, pro)
    expect(page.robots).toBe(INDEX)
    expect(ld(page, 'Person')).toMatchObject({ name: 'Ada Obi', jobTitle: 'Pharmacist' })
    const member = professionalPage(SITE, { ...pro, is_verified: false })
    expect(member.robots).toBe(NOINDEX)
    expect(JSON.stringify(member)).not.toMatch(/Ada Obi|Community pharmacist/)
  })
  it('approved news is a NewsArticle; a pending one is not described', () => {
    const page = newsPage(SITE, { id: BIZ.id, headline: 'Malaria season', subtitle: 'Protect your family', body: 'First paragraph.\n\nSecond.', status: 'approved', published_at: '2026-11-01T09:00:00Z' }, { authorName: 'Ada Obi' })
    expect(ld(page, 'NewsArticle')).toMatchObject({ headline: 'Malaria season', datePublished: '2026-11-01T09:00:00Z', author: { name: 'Ada Obi' } })
    expect(page.sections[0].paragraphs).toEqual(['Protect your family', 'First paragraph.', 'Second.'])
    expect(newsPage(SITE, { id: BIZ.id, headline: 'Draft', status: 'pending' }).robots).toBe(NOINDEX)
  })
  it('a public article post is an Article; paid posts and other post types are not', () => {
    const post = { id: BIZ.id, post_type: 'article', content: '**Movement Is Medicine at Every Age**\n\nWalk daily.', created_at: '2026-11-02T10:00:00Z' }
    const page = articlePostPage(SITE, post)
    expect(page.h1).toBe('Movement Is Medicine at Every Age')
    expect(page.canonical).toBe(SITE + '/post/movement-is-medicine-at-every-age-' + BIZ.id)
    expect(articlePostPage(SITE, { ...post, subscriber_only: true })).toBeNull()
    expect(articlePostPage(SITE, { ...post, post_type: 'text' })).toBeNull()
  })
})

describe('hubs, rendering and sitemaps', () => {
  it('home links to businesses, medicines and articles, with WebSite search', () => {
    const page = homePage(SITE, { businesses: [BIZ], medicines: ['Paracetamol'], articles: [{ title: 'A', path: '/news/a' }] })
    expect(page.sections.map((s) => s.heading)).toEqual(['Pharmacies and healthcare providers', 'Popular medicines', 'Health articles and news'])
    expect(ld(page, 'WebSite').potentialAction.target.urlTemplate).toBe(SITE + '/search?q={search_term_string}')
    expect(directoryPage(SITE, [BIZ]).sections[0]).toMatchObject({ heading: 'Lagos' })
  })
  it('escapes every value and keeps JSON-LD from closing its script', () => {
    const page = businessPage(SITE, { ...BIZ, name: '<script>alert(1)</script>', description: '</script><img src=x>' }, {})
    const html = renderPage(page, { siteUrl: SITE })
    expect(html).not.toContain('<script>alert(1)')
    expect(html).not.toContain('</script><img')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(html).toContain('<link rel="canonical" href="https://carefind.ng/business/')
    expect(html).toContain('<meta name="robots" content="index, follow')
    expect(esc('"&\'')).toBe('&quot;&amp;&#39;')
  })
  it('sitemaps: an index, and url sets with absolute, de-duplicated, escaped URLs', () => {
    expect(sitemapIndexXml(SITE, [{ path: '/sitemaps/businesses.xml', lastmod: '2026-11-20T10:00:00Z' }])).toContain('<sitemap><loc>https://carefind.ng/sitemaps/businesses.xml</loc><lastmod>2026-11-20</lastmod></sitemap>')
    const xml = urlsetXml(SITE, [{ path: '/drug/a%26b' }, { path: '/drug/a%26b' }, { path: '/x?y=1&z=2' }])
    expect(xml.match(/<url>/g)).toHaveLength(2)
    expect(xml).toContain('https://carefind.ng/x?y=1&amp;z=2')
  })
})
