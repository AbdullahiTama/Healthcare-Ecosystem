// Page models for the server-rendered pages search engines and AI crawlers receive (api/_handlers/seo.js), built
// from the rows a logged-out visitor may read (anon key, RLS), with the same content the app shows: nothing a
// visitor cannot see (prices follow lib/priceVisibility.js; non-public records give a noindex page).
//
// A page is plain data; lib/seo/render.js turns it into HTML and escapes every value.
//   { title, description, canonical, robots, image, ogType, h1, intro, facts, sections, breadcrumbs, jsonLd }
//   facts:    [{ label, value, href? }]
//   sections: [{ heading, paragraphs?: [text], items?: [{ text, href?, meta? }] }]
import { SITE_NAME, COUNTRY, CURRENCY, absolute } from './site.js'
import { businessPath, professionalPath, newsPath, postPath, medicinePath, medicineName } from './slugs.js'
import { canShowPrice, isRxRestricted } from '../priceVisibility.js'
import { plainTextFromContent, titleFromContent, truncate } from '../openGraph.js'

export const INDEX = 'index, follow, max-image-preview:large, max-snippet:-1'
export const NOINDEX = 'noindex, follow'
const DESC = 160

const BUSINESS_TYPES = {
  pharmacy: { schema: 'Pharmacy', label: 'Pharmacy', plural: 'Pharmacies' },
  hospital: { schema: 'Hospital', label: 'Hospital', plural: 'Hospitals' },
  clinic: { schema: 'MedicalClinic', label: 'Clinic', plural: 'Clinics' },
  laboratory: { schema: 'DiagnosticLab', label: 'Laboratory', plural: 'Laboratories' },
  lab: { schema: 'DiagnosticLab', label: 'Laboratory', plural: 'Laboratories' },
  imaging: { schema: 'DiagnosticLab', label: 'Imaging centre', plural: 'Imaging centres' },
  skincare: { schema: 'HealthAndBeautyBusiness', label: 'Skincare store', plural: 'Skincare stores' },
  manufacturer_importer: { schema: 'Organization', label: 'Pharmaceutical manufacturer and importer', plural: 'Manufacturers and importers' },
  wholesale: { schema: 'Store', label: 'Pharmaceutical wholesaler', plural: 'Wholesalers' },
}
export const businessType = (t) => BUSINESS_TYPES[String(t || '').toLowerCase()] || { schema: 'MedicalBusiness', label: 'Healthcare provider', plural: 'Healthcare providers' }

export const naira = (n) => '₦' + Number(n).toLocaleString('en-NG', { maximumFractionDigits: 2 })
const place = (r) => [r?.city, r?.state].filter(Boolean).join(', ')
const coords = (r) => {
  const lat = r?.latitude ?? r?.lat
  const lng = r?.longitude ?? r?.lng
  return lat != null && lng != null && Number.isFinite(Number(lat)) && Number.isFinite(Number(lng)) ? { lat: Number(lat), lng: Number(lng) } : null
}
const httpUrl = (u) => (/^https?:\/\//i.test(String(u || '')) ? String(u) : null)
const pageTitle = (t) => truncate(t, 70)
const isPublicBusiness = (b) => !!b && b.status === 'active' && b.visible_on_carefind !== false && !b.deleted_at
const inStock = (p) => p.stock == null || Number(p.stock) > 0

function breadcrumbLd(siteUrl, crumbs) {
  return {
    '@context': 'https://schema.org', '@type': 'BreadcrumbList',
    itemListElement: crumbs.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c.name, item: absolute(siteUrl, c.path) })),
  }
}
const publisherLd = (siteUrl) => ({ '@type': 'Organization', name: SITE_NAME, url: siteUrl, logo: { '@type': 'ImageObject', url: absolute(siteUrl, '/icon-512.png') } })

// A record that is missing or not public: a thin noindex page, never its details.
export function unavailablePage(siteUrl, path, what = 'page') {
  return {
    title: `${SITE_NAME}`, description: `This ${what} is not available on ${SITE_NAME}.`, canonical: absolute(siteUrl, path),
    robots: NOINDEX, h1: `This ${what} is not available`, intro: `Search medicines, pharmacies and healthcare providers on ${SITE_NAME}.`,
    sections: [], breadcrumbs: [{ name: 'Home', path: '/' }], jsonLd: [], status: 404,
  }
}

// ── Business (pharmacy, hospital, clinic, lab, store) ────────────────────────────────────────────────────────────
export function businessPage(siteUrl, biz, { products = [], services = [], reviews = [] } = {}) {
  if (!isPublicBusiness(biz)) return unavailablePage(siteUrl, biz?.id ? `/business/${biz.id}` : '/business', 'business')
  const type = businessType(biz.business_type)
  const path = businessPath(biz)
  const url = absolute(siteUrl, path)
  const where = place(biz)
  const listed = products.filter(inStock)
  const names = [...new Set(listed.map((p) => String(p.name || '').trim()).filter(Boolean))]
  const rating = reviews.length ? Math.round((reviews.reduce((s, r) => s + (Number(r.rating) || 0), 0) / reviews.length) * 10) / 10 : null
  const image = httpUrl(biz.logo_url) || httpUrl(biz.cover_url)

  const description = truncate(
    `${biz.name} is a ${type.label.toLowerCase()}${where ? ` in ${where}` : ''}. ` +
    (names.length ? `${names.length} medicines and products listed, including ${names.slice(0, 4).join(', ')}. ` : '') +
    (biz.description ? plainTextFromContent(biz.description) + ' ' : '') +
    `Contact, opening hours${listed.some(canShowPrice) ? ', prices' : ''} and reviews on ${SITE_NAME}.`, DESC)

  const facts = [
    { label: 'Type', value: type.label },
    biz.address && { label: 'Address', value: [biz.address, where].filter(Boolean).join(', ') },
    !biz.address && where && { label: 'Location', value: where },
    biz.phone && { label: 'Phone', value: biz.phone, href: 'tel:' + String(biz.phone).replace(/[^\d+]/g, '') },
    biz.whatsapp && { label: 'WhatsApp', value: biz.whatsapp },
    biz.hours && { label: 'Opening hours', value: biz.hours },
    httpUrl(biz.website) && { label: 'Website', value: biz.website, href: httpUrl(biz.website) },
    rating != null && { label: 'Rating', value: `${rating} out of 5 (${reviews.length} review${reviews.length === 1 ? '' : 's'})` },
  ].filter(Boolean)

  const sections = []
  if (biz.description) sections.push({ heading: 'About', paragraphs: [plainTextFromContent(biz.description)] })
  if (listed.length) {
    sections.push({
      heading: `Medicines and products at ${biz.name}`,
      items: listed.slice(0, 300).map((p) => ({
        text: p.name, href: medicinePath(p.name),
        meta: [p.generic_name && p.generic_name !== p.name ? p.generic_name : null,
          canShowPrice({ ...p, businesses: { show_prices: biz.show_prices } }) ? naira(p.price) : (isRxRestricted(p) ? 'Prescription: ask the pharmacist' : 'Ask for price')].filter(Boolean).join(' · '),
      })),
    })
  }
  const activeServices = services.filter((s) => s.is_active !== false)
  if (activeServices.length) {
    sections.push({ heading: 'Services', items: activeServices.map((s) => ({ text: s.name, meta: s.price_kobo ? naira(s.price_kobo / 100) : null })) })
  }
  const withComments = reviews.filter((r) => String(r.comment || '').trim())
  if (withComments.length) {
    sections.push({ heading: 'Reviews', items: withComments.slice(0, 10).map((r) => ({ text: `${r.rating}/5: ${truncate(r.comment, 300)}` })) })
  }

  const geo = coords(biz)
  const pricedOffers = listed.filter((p) => canShowPrice({ ...p, businesses: { show_prices: biz.show_prices } })).slice(0, 50)
  const org = {
    '@context': 'https://schema.org', '@type': type.schema, '@id': url + '#business', name: biz.name, url,
    description, ...(image ? { image, logo: image } : {}),
    ...(biz.phone ? { telephone: biz.phone } : {}),
    address: { '@type': 'PostalAddress', ...(biz.address ? { streetAddress: biz.address } : {}), ...(biz.city ? { addressLocality: biz.city } : {}),
      ...(biz.state ? { addressRegion: biz.state } : {}), addressCountry: COUNTRY },
    ...(geo ? { geo: { '@type': 'GeoCoordinates', latitude: geo.lat, longitude: geo.lng } } : {}),
    ...(httpUrl(biz.website) ? { sameAs: [httpUrl(biz.website)] } : {}),
    ...(httpUrl(biz.maps_link) ? { hasMap: httpUrl(biz.maps_link) } : {}),
    ...(rating != null ? { aggregateRating: { '@type': 'AggregateRating', ratingValue: rating, reviewCount: reviews.length, bestRating: 5, worstRating: 1 } } : {}),
    ...(pricedOffers.length ? {
      hasOfferCatalog: { '@type': 'OfferCatalog', name: `Medicines and products at ${biz.name}`, itemListElement: pricedOffers.map((p) => ({
        '@type': 'Offer', price: Number(p.price), priceCurrency: CURRENCY, availability: 'https://schema.org/InStock',
        itemOffered: { '@type': 'Product', name: p.name, url: absolute(siteUrl, medicinePath(p.name)) },
      })) },
    } : {}),
  }
  const crumbs = [{ name: 'Home', path: '/' }, { name: type.plural, path: '/business-directory' }, { name: biz.name, path }]
  return {
    title: pageTitle(`${biz.name}: ${type.label}${biz.city ? ` in ${biz.city}` : ''}${biz.state && biz.state !== biz.city ? `, ${biz.state}` : ''}`),
    description, canonical: url, robots: INDEX, image, ogType: 'business.business',
    h1: biz.name, intro: `${type.label}${where ? ` in ${where}` : ''}`, facts, sections, breadcrumbs: crumbs,
    jsonLd: [org, breadcrumbLd(siteUrl, crumbs)],
  }
}

// ── Medicine: who has it, where, at what price ───────────────────────────────────────────────────────────────────
// `listings`: carefind_products rows matching the name, each with `businesses` embedded (null when the business is
// not public). Kept as DrugProfile keeps them: a public business with stock, or a product listed directly on CareFind.
// Listed by a public seller (or by an individual), in stock or not.
export const isPublicListing = (p) => !!p && (p.business_id ? !!p.businesses && isPublicBusiness({ status: 'active', ...p.businesses }) : true)
// What a medicine page shows: public listings that are in stock.
export function medicineListings(listings) {
  return (listings || []).filter((p) => isPublicListing(p) && inStock(p))
}

export function medicinePage(siteUrl, name, { listings = [], related = [] } = {}) {
  const label = String(name || '').trim()
  const path = medicinePath(label)
  const rows = medicineListings(listings)
  if (!label || rows.length === 0) return { ...unavailablePage(siteUrl, path, 'medicine'), h1: label ? `${label} is not listed yet` : 'Medicine not found' }
  const display = rows.find((r) => medicineName(r.name) === medicineName(label))?.name || rows[0].name || label
  const generics = [...new Set(rows.map((r) => String(r.generic_name || '').trim()).filter((g) => g && medicineName(g) !== medicineName(display)))]
  const priced = rows.filter(canShowPrice)
  const prices = priced.map((r) => Number(r.price)).filter(Number.isFinite)
  const sellers = rows.map((r) => r.businesses ? { ...r.businesses, id: r.business_id } : null).filter(Boolean)
  const sellerCount = new Set(sellers.map((s) => s.id)).size + rows.filter((r) => !r.business_id).length
  const cities = [...new Set(sellers.map((s) => s.city).filter(Boolean))]
  const rx = rows.some(isRxRestricted)
  const about = rows.map((r) => plainTextFromContent(r.description)).find(Boolean)

  const description = truncate(
    `${display}${generics.length ? ` (${generics.slice(0, 2).join(', ')})` : ''}: available at ${sellerCount} pharmac${sellerCount === 1 ? 'y' : 'ies'}` +
    `${cities.length ? ` in ${cities.slice(0, 4).join(', ')}` : ''}. ` +
    (prices.length ? `Prices from ${naira(Math.min(...prices))}. ` : '') +
    `Check availability${prices.length ? ', compare prices' : ''} and contact the pharmacy on ${SITE_NAME}.`, DESC)

  const items = rows.slice(0, 100).map((r) => {
    const b = r.business_id ? r.businesses : null
    return {
      text: b ? b.name : (r.seller_location ? `Seller in ${r.seller_location}` : 'Independent seller'),
      href: b ? businessPath({ ...b, id: r.business_id }) : null,
      meta: [b ? place(b) : null, r.name !== display ? r.name : null, canShowPrice(r) ? naira(r.price) : (isRxRestricted(r) ? 'Prescription: ask the pharmacist' : 'Ask for price')].filter(Boolean).join(' · '),
    }
  })
  const sections = [{ heading: `Where to get ${display}`, items }]
  if (about) sections.unshift({ heading: `About ${display}`, paragraphs: [about] })
  if (rx) sections.push({ heading: 'Prescription', paragraphs: ['Some listings are prescription medicines: prices are not shown, and the pharmacist will ask for your prescription.'] })
  if (related.length) sections.push({ heading: 'Related medicines', items: related.slice(0, 20).map((n) => ({ text: n, href: medicinePath(n) })) })

  const url = absolute(siteUrl, path)
  const offerLd = priced.slice(0, 20).map((r) => ({
    '@type': 'Offer', price: Number(r.price), priceCurrency: CURRENCY, availability: 'https://schema.org/InStock',
    ...(r.businesses ? { seller: { '@type': businessType(r.businesses.business_type).schema, name: r.businesses.name, url: absolute(siteUrl, businessPath({ ...r.businesses, id: r.business_id })) } } : {}),
  }))
  const image = rows.map((r) => httpUrl(r.image_url)).find(Boolean) || null
  const product = {
    '@context': 'https://schema.org', '@type': 'Product', '@id': url + '#product', name: display, url, description,
    ...(generics.length ? { alternateName: generics.slice(0, 5) } : {}), ...(image ? { image } : {}), category: 'Medicine',
    ...(prices.length ? { offers: { '@type': 'AggregateOffer', priceCurrency: CURRENCY, lowPrice: Math.min(...prices), highPrice: Math.max(...prices), offerCount: priced.length, offers: offerLd } } : {}),
  }
  const crumbs = [{ name: 'Home', path: '/' }, { name: 'Medicines', path: '/search' }, { name: display, path }]
  return {
    title: pageTitle(`${display}: price and availability in Nigeria (${sellerCount} pharmac${sellerCount === 1 ? 'y' : 'ies'})`),
    description, canonical: url, robots: INDEX, image, ogType: 'product',
    h1: display, intro: generics.length ? `Also listed as ${generics.join(', ')}` : `Available on ${SITE_NAME}`,
    facts: [{ label: 'Available at', value: `${sellerCount} pharmac${sellerCount === 1 ? 'y' : 'ies'}` },
      prices.length && { label: 'Price range', value: Math.min(...prices) === Math.max(...prices) ? naira(prices[0]) : `${naira(Math.min(...prices))} to ${naira(Math.max(...prices))}` },
      cities.length && { label: 'Locations', value: cities.join(', ') }].filter(Boolean),
    sections, breadcrumbs: crumbs, jsonLd: [product, breadcrumbLd(siteUrl, crumbs)],
  }
}

// ── Healthcare professional (verified only: owner decision 2026-11-22) ───────────────────────────────────────────
export const isIndexableProfessional = (p) => !!p && p.is_verified === true
export function professionalPage(siteUrl, profile) {
  if (!isIndexableProfessional(profile)) return unavailablePage(siteUrl, profile?.id ? `/u/${profile.id}` : '/u', 'profile')
  const name = profile.full_name || profile.display_name || 'Healthcare professional'
  const credential = profile.specialty || profile.verification_label || 'Healthcare professional'
  const path = professionalPath(profile)
  const url = absolute(siteUrl, path)
  const bio = plainTextFromContent(profile.bio)
  const description = truncate(`${name}, ${credential}${profile.location ? ` in ${profile.location}` : ''}. ${bio || `Verified healthcare professional on ${SITE_NAME}.`}`, DESC)
  const image = httpUrl(profile.avatar_url)
  const crumbs = [{ name: 'Home', path: '/' }, { name: 'Professionals', path: '/search' }, { name, path }]
  return {
    title: pageTitle(`${name}, ${credential}`), description, canonical: url, robots: INDEX, image, ogType: 'profile',
    h1: name, intro: `${credential}${profile.location ? ` · ${profile.location}` : ''} · Verified on ${SITE_NAME}`,
    facts: [{ label: 'Profession', value: credential }, profile.location && { label: 'Location', value: profile.location },
      httpUrl(profile.website) && { label: 'Website', value: profile.website, href: httpUrl(profile.website) }].filter(Boolean),
    sections: bio ? [{ heading: 'About', paragraphs: [bio] }] : [], breadcrumbs: crumbs,
    jsonLd: [{ '@context': 'https://schema.org', '@type': 'Person', '@id': url + '#person', name, url, jobTitle: credential,
      ...(bio ? { description: truncate(bio, 300) } : {}), ...(image ? { image } : {}),
      ...(profile.location ? { homeLocation: { '@type': 'Place', name: profile.location } } : {}),
      ...(httpUrl(profile.website) ? { sameAs: [httpUrl(profile.website)] } : {}) }, breadcrumbLd(siteUrl, crumbs)],
  }
}

// ── Articles: approved news, and public article posts from the feed ──────────────────────────────────────────────
export const isPublicNews = (n) => !!n && n.status === 'approved'
export const isPublicArticlePost = (p) => !!p && p.post_type === 'article' && !p.repost_of && !p.subscriber_only && !p.is_premium

function articleModel(siteUrl, { path, headline, subtitle, body, image, published, modified, authorName, type }) {
  const url = absolute(siteUrl, path)
  const text = plainTextFromContent(body)
  const description = truncate(subtitle || text, DESC)
  const paragraphs = (subtitle ? [subtitle] : []).concat(splitParagraphs(body))
  const crumbs = [{ name: 'Home', path: '/' }, { name: type === 'NewsArticle' ? 'News' : 'Articles', path: type === 'NewsArticle' ? '/news' : '/feed' }, { name: truncate(headline, 60), path }]
  return {
    title: pageTitle(headline), description, canonical: url, robots: INDEX, image, ogType: 'article',
    h1: headline, intro: [authorName && `By ${authorName}`, published && `Published ${String(published).slice(0, 10)}`].filter(Boolean).join(' · '),
    facts: [], sections: [{ heading: null, paragraphs }], breadcrumbs: crumbs, published, modified, authorName,
    jsonLd: [{ '@context': 'https://schema.org', '@type': type, '@id': url + '#article', headline: truncate(headline, 110), description,
      mainEntityOfPage: url, url, ...(image ? { image: [image] } : {}),
      ...(published ? { datePublished: published } : {}), ...(modified || published ? { dateModified: modified || published } : {}),
      ...(authorName ? { author: { '@type': 'Person', name: authorName } } : {}), publisher: publisherLd(siteUrl),
      inLanguage: 'en-NG' }, breadcrumbLd(siteUrl, crumbs)],
  }
}
function splitParagraphs(body) {
  // Prose with line structure (openGraph keeps paragraphs as blank-line separated); one paragraph per block.
  const flat = plainTextFromContent(body)
  if (!flat) return []
  const raw = String(body).trim().startsWith('[') ? null : String(body)
  const parts = (raw ? raw.replace(/\*\*|==#?[0-9a-zA-Z_-]*\||==/g, '').split(/\n\s*\n/) : [flat]).map((p) => p.replace(/\s+/g, ' ').trim()).filter(Boolean)
  return parts.length ? parts : [flat]
}

export function newsPage(siteUrl, article, { authorName } = {}) {
  if (!isPublicNews(article)) return unavailablePage(siteUrl, article?.id ? `/news/${article.id}` : '/news', 'article')
  return articleModel(siteUrl, { path: newsPath(article), headline: article.headline || 'CareFind news', subtitle: article.subtitle, body: article.body,
    image: httpUrl(article.hero_image_url), published: article.published_at || article.created_at, modified: article.updated_at, authorName, type: 'NewsArticle' })
}

export function articlePostPage(siteUrl, post, { authorName } = {}) {
  if (!isPublicArticlePost(post)) return null   // not an article: the caller falls back to the post's preview card
  const headline = titleFromContent(post.content, 'Article on CareFind')
  return articleModel(siteUrl, { path: postPath(post, headline), headline, body: post.content,
    image: httpUrl(Array.isArray(post.image_urls) && post.image_urls[0]) || httpUrl(post.image_url), published: post.created_at, modified: post.updated_at, authorName, type: 'Article' })
}

// ── Hubs: home, directory, news index (crawl paths to every page) ────────────────────────────────────────────────
export function homePage(siteUrl, { businesses = [], medicines = [], articles = [] } = {}) {
  const crumbs = [{ name: 'Home', path: '/' }]
  return {
    title: `${SITE_NAME}: find medicines, pharmacies and healthcare providers in Nigeria`,
    description: truncate(`Search medicines like ${medicines.slice(0, 3).join(', ') || 'Paracetamol'}, compare prices, find pharmacies, hospitals, labs and verified professionals near you on ${SITE_NAME}.`, DESC),
    canonical: absolute(siteUrl, '/'), robots: INDEX, image: absolute(siteUrl, '/icon-512.png'), ogType: 'website',
    h1: `${SITE_NAME}: connecting people to better healthcare`, intro: 'Find medicines, pharmacies, hospitals, laboratories and verified healthcare professionals in Nigeria.',
    facts: [], breadcrumbs: crumbs,
    sections: [
      businesses.length && { heading: 'Pharmacies and healthcare providers', items: businesses.slice(0, 100).map((b) => ({ text: b.name, href: businessPath(b), meta: [businessType(b.business_type).label, place(b)].filter(Boolean).join(' · ') })) },
      medicines.length && { heading: 'Popular medicines', items: medicines.slice(0, 100).map((n) => ({ text: n, href: medicinePath(n) })) },
      articles.length && { heading: 'Health articles and news', items: articles.slice(0, 30).map((a) => ({ text: a.title, href: a.path })) },
    ].filter(Boolean),
    jsonLd: [
      { '@context': 'https://schema.org', '@type': 'WebSite', '@id': absolute(siteUrl, '/') + '#website', name: SITE_NAME, url: absolute(siteUrl, '/'), inLanguage: 'en-NG',
        potentialAction: { '@type': 'SearchAction', target: { '@type': 'EntryPoint', urlTemplate: absolute(siteUrl, '/search') + '?q={search_term_string}' }, 'query-input': 'required name=search_term_string' } },
      { '@context': 'https://schema.org', ...publisherLd(siteUrl), description: 'Healthcare discovery and social platform: find medicines, pharmacies, hospitals, labs and verified professionals in Nigeria.' },
    ],
  }
}

export function directoryPage(siteUrl, businesses = []) {
  const byState = {}
  for (const b of businesses) (byState[b.state || 'Other'] ||= []).push(b)
  const crumbs = [{ name: 'Home', path: '/' }, { name: 'Directory', path: '/business-directory' }]
  return {
    title: 'Pharmacies, hospitals and healthcare providers in Nigeria', canonical: absolute(siteUrl, '/business-directory'), robots: INDEX, ogType: 'website',
    description: truncate(`${businesses.length} pharmacies, hospitals, clinics, labs and healthcare businesses on ${SITE_NAME}, by state: ${Object.keys(byState).sort().slice(0, 6).join(', ')}.`, DESC),
    h1: 'Healthcare directory', intro: `${businesses.length} businesses listed on ${SITE_NAME}`, facts: [], breadcrumbs: crumbs,
    sections: Object.keys(byState).sort().map((st) => ({ heading: st, items: byState[st].map((b) => ({ text: b.name, href: businessPath(b), meta: [businessType(b.business_type).label, b.city].filter(Boolean).join(' · ') })) })),
    jsonLd: [breadcrumbLd(siteUrl, crumbs)],
  }
}

export function articlesIndexPage(siteUrl, articles = []) {
  const crumbs = [{ name: 'Home', path: '/' }, { name: 'News', path: '/news' }]
  return {
    title: `Health news and articles | ${SITE_NAME}`, canonical: absolute(siteUrl, '/news'), robots: INDEX, ogType: 'website',
    description: truncate(`Health news and articles from pharmacists, doctors and healthcare businesses on ${SITE_NAME}.`, DESC),
    h1: 'Health news and articles', intro: '', facts: [], breadcrumbs: crumbs,
    sections: [{ heading: 'Latest', items: articles.map((a) => ({ text: a.title, href: a.path, meta: a.date ? String(a.date).slice(0, 10) : null })) }],
    jsonLd: [breadcrumbLd(siteUrl, crumbs)],
  }
}

// /search for crawlers: every medicine with a page, A to Z (the search box itself needs JavaScript). With a query,
// a results page is not worth indexing (noindex), but its links still lead to the medicines.
export function medicinesIndexPage(siteUrl, names = [], { query = '' } = {}) {
  const sorted = [...names].sort((a, b) => a.localeCompare(b))
  const crumbs = [{ name: 'Home', path: '/' }, { name: 'Medicines', path: '/search' }]
  const byLetter = {}
  for (const n of sorted) (byLetter[/^[a-z]/i.test(n) ? n[0].toUpperCase() : '#'] ||= []).push(n)
  return {
    title: `Find medicines and compare prices in Nigeria | ${SITE_NAME}`, canonical: absolute(siteUrl, '/search'), robots: query ? NOINDEX : INDEX, ogType: 'website',
    description: truncate(`Search ${sorted.length.toLocaleString('en-NG')} medicines and health products, see which pharmacies have them and compare prices on ${SITE_NAME}.`, DESC),
    h1: 'Medicines and health products', intro: `${sorted.length.toLocaleString('en-NG')} medicines listed by pharmacies on ${SITE_NAME}`, facts: [], breadcrumbs: crumbs,
    sections: Object.keys(byLetter).sort().map((l) => ({ heading: l, items: byLetter[l].map((n) => ({ text: n, href: medicinePath(n) })) })),
    jsonLd: [breadcrumbLd(siteUrl, crumbs)],
  }
}

export function aboutPage(siteUrl) {
  const crumbs = [{ name: 'Home', path: '/' }, { name: 'About', path: '/about' }]
  return {
    title: `About ${SITE_NAME}`, canonical: absolute(siteUrl, '/about'), robots: INDEX, ogType: 'website',
    description: `${SITE_NAME} connects people to better healthcare in Nigeria: find medicines, pharmacies, hospitals, labs and verified professionals, with real listings and reviews.`,
    h1: `About ${SITE_NAME}`, intro: 'Connecting people to better healthcare.', facts: [], breadcrumbs: crumbs,
    sections: [{ heading: 'What you can do', items: [
      { text: 'Find a medicine and the pharmacies that have it', href: '/search' },
      { text: 'Browse pharmacies, hospitals, clinics and laboratories', href: '/business-directory' },
      { text: 'Read health news and articles from professionals', href: '/news' },
    ] }, { heading: 'Who runs it', paragraphs: [`${SITE_NAME} is operated by HATMA Brandtech Limited. Healthcare businesses manage their listings with CareHub.`] }],
    jsonLd: [breadcrumbLd(siteUrl, crumbs)],
  }
}
