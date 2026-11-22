# CareFind: SEO and AI search visibility

2026-11-22. Code audit A46. Owner decisions: canonical domain **carefind.app**; **crawler pages now** (dynamic rendering);
**verified professionals only** get public profile pages.

## Root causes (before)

| # | Finding | Effect |
|---|---|---|
| 1 | `index.html` carried a static `<link rel="canonical" href="…/">`, `og:url` and the homepage title on every URL | Every pharmacy, medicine and article page told search engines "I am a copy of the homepage" |
| 2 | CareFind is a client-rendered SPA; crawlers that do not run JavaScript (Bing in part, every AI crawler: GPTBot, ClaudeBot, PerplexityBot…) received an empty `<div id="root">` | Nothing to index or cite |
| 3 | `public/sitemap.xml` was a static list of 5 URLs | ~28 pharmacies, ~5,700 medicines, articles and profiles undiscoverable |
| 4 | No structured data; URLs were bare UUIDs (`/business/3f2a…`) | No rich results; no keywords in URLs |
| 5 | No table recorded when a public row changed; nothing told search engines about changes | No `<lastmod>`, no prompt re-indexing |

## Design

```
                       ┌─ user-agent matches a search / AI crawler ─► /api/router ─► seo handler ─► full HTML page
request to carefind.app ┤                                                                (title, meta, canonical, JSON-LD,
                       │                                                                 content, internal links)
                       ├─ /sitemap.xml, /sitemaps/<kind>.xml ─────────► /api/router ─► sitemap handler
                       └─ everyone else ──────────────────────────────► index.html (the SPA, unchanged)
                                                                         └─ useSeo sets title/description/canonical/robots per page
```

**Dynamic rendering** (vercel.json `has: user-agent` rewrite, regex `CRAWLER_UA_REGEX_SOURCE` in
`src/lib/seo/crawlers.js`; the router re-checks with `isSearchOrAiCrawler`). People keep the SPA. Search engines accept
this as long as the bot page carries the same content as the human page; both are built from the **same page models**
(`src/lib/seo/pages.js`), used by the server renderer and by the SPA's `useSeoPage`, so title, description, canonical and
robots cannot drift apart. Link-preview bots (WhatsApp, Facebook, X…) keep the existing Open Graph handler.

### Files

| Area | File |
|---|---|
| Site URL (`SITE_URL` → `VITE_SITE_URL` → `https://carefind.app`) | `src/lib/seo/site.js` |
| SEO-friendly URLs: `/business/<name-city-state>-<uuid>`, `/u/<name-specialty>-<uuid>`, `/news/<headline>-<uuid>`, `/post/<title>-<uuid>`, `/drug/<name>` | `src/lib/seo/slugs.js` (`idFromParam` reads the UUID at the end, so old bare-UUID links keep working) |
| Page models (title, description, canonical, robots, JSON-LD, content, links) | `src/lib/seo/pages.js` |
| HTML renderer for crawlers | `src/lib/seo/render.js` |
| Crawler lists | `src/lib/seo/crawlers.js` |
| SPA head tags | `src/lib/seo/useSeo.js` (BusinessProfile, DrugProfile, PublicProfile, NewsArticle, PostPage) |
| Crawler page handler | `api/_handlers/seo.js` |
| Sitemaps | `api/_handlers/sitemap.js`, `src/lib/seo/sitemap.js` |
| Public reads (anon key) | `api/_lib/publicData.js` |
| IndexNow | `api/_lib/indexNow.js`, key file `public/251dc62b967a9be1ce9795bdfc87f10e.txt` |
| Change times | `supabase/migrations/carefind_20270201_seo_updated_at.sql` |
| robots / AI guidance | `public/robots.txt`, `public/llms.txt` |
| Price visibility rule (shared by app and crawler pages) | `src/lib/priceVisibility.js` |

### Structured data (JSON-LD)

| Page | Types |
|---|---|
| Home | `WebSite` + `SearchAction` (sitelinks search box) |
| Pharmacy / hospital / clinic | `Pharmacy` / `Hospital` / `MedicalClinic` (manufacturers `Organization`, else `MedicalBusiness`): address, geo, telephone, website, `aggregateRating`, `hasOfferCatalog` of in-stock products (opening hours are in the page text) |
| Medicine | `Product` + `AggregateOffer` (low/high price in NGN, seller count, `InStock`); prescription-only note |
| Professional (verified only) | `Person` (jobTitle, image, sameAs) |
| News / article | `NewsArticle` / `Article` (author, publisher `Organization`, `datePublished`, `dateModified`) |
| Every page | `BreadcrumbList` |

### What is public, and what is not (security)

* Every read for crawler pages, sitemaps and IndexNow uses the **anon key** (`api/_lib/publicData.js`), never the
  service-role key, so RLS and column grants decide what can appear. Nothing a logged-out visitor cannot already see in
  the app can reach a crawler page.
* Prices follow the app's rule (`canShowPrice`): prescription-only / controlled medicines never show a price; a business
  with `show_prices = false` shows none.
* Indexed: active, CareFind-visible businesses; medicines with at least one in-stock public listing; **verified**
  professionals; approved news; public article posts (not reposts, not subscriber-only, not premium). Everything else
  gets `noindex` (unverified profiles, ordinary feed posts, search results with a query) or 404.
* `robots.txt` disallows private app areas (`/track/`, `/checkout`, `/cart`, `/orders`, `/account/`, …). These pages
  need sign-in anyway; the rule just keeps crawlers from wasting time on them.
* JSON-LD is escaped (`<` → `<`) and all text is HTML-escaped in `render.js`, so user content (business names,
  article text) cannot inject markup.
* The IndexNow key is public by design (the protocol proves ownership by serving it at `/<key>.txt`).

### Indexing updates

* **Sitemaps**: `/sitemap.xml` (index) → `/sitemaps/{pages,businesses,medicines,professionals,articles}.xml`, built live,
  cached at the edge for 3 hours. `<lastmod>` is `updated_at`, falling back to `created_at`.
* **`updated_at`** (`carefind_20270201_seo_updated_at`): set by trigger `seo_touch_updated_at` only when something a
  search engine shows changes (name, address, phone, hours, description, price, visibility, verification, article text…)
  or a product goes in or out of stock. Sales, payouts, plan changes, likes and views do not count, and clients cannot set
  it. Existing rows stay NULL until they next change.
* **IndexNow** (Bing, which also feeds ChatGPT search and Copilot; Yandex; Seznam; Naver): step `seo_indexnow` of the cron
  endpoint `api/cron/process-email-outbox.js`, once a day (`claim_job_slot`, 1440 minutes), production only
  (`VERCEL_ENV`), off with `INDEXNOW_DISABLED=true`. Sends every public page changed in the last 26 hours, including a
  medicine whose last seller just ran out (its page now says "not listed"). A product taken off CareFind leaves the
  public view, so it is not sent; it drops out of the sitemap instead.
* **Google** does not take IndexNow: it reads the sitemaps and Search Console.

### Caching and speed

Crawler pages: `Cache-Control: public, max-age=0, s-maxage=3600, stale-while-revalidate=86400`, `Vary: User-Agent`.
Pages are plain HTML with no scripts, so they load fast on mobile. They link to related medicines, sellers, the state
directory and recent articles (internal linking).

## Owner steps (outside the code)

1. Google Search Console and Bing Webmaster Tools: verify **carefind.app** (DNS TXT record) and submit
   `https://carefind.app/sitemap.xml`.
2. If the production host is not `carefind.app`, set `SITE_URL` (server) and `VITE_SITE_URL` (app build) in Vercel.
3. Make `carefind.app` the primary domain in Vercel, so other hosts (`*.vercel.app`, `www`) redirect to it.

## Tests

| What | Where |
|---|---|
| Slugs, page models, JSON-LD, renderer escaping, sitemap XML, crawler detection | `src/lib/seo/seo.test.js` |
| Router → crawler pages / sitemaps against a strict fake PostgREST (unknown column = 400) | `api/__tests__/seoPages.test.js` |
| IndexNow: queries, slug URLs, out-of-stock medicines, hidden sellers, batching, production-only | `api/__tests__/indexNow.test.js` |
| `updated_at` triggers, no spoofing, view shape and Rx masking, anon grants, idempotency (PGlite) | `src/test/seo/seoUpdatedAt.db.test.js` |
| Slug URLs on the business page; head tags | `src/modules/business-profiles-reviews/BusinessProfile.test.jsx` |
| Rewrites pinned (Hobby cron limit contract) | `src/lib/vercel-cron-hobby-limit.test.js` |

Manual check after deploy:

```bash
curl -sA "Googlebot/2.1" https://carefind.app/ | head -40
```

```bash
curl -s https://carefind.app/sitemap.xml
```

Also use Search Console "URL inspection" on one pharmacy page.

## Rollback

* App: revert the commit. The SPA works without the crawler rewrite.
* Database: see the ROLLBACK block in the migration header. The columns are nullable and unused by older code.
