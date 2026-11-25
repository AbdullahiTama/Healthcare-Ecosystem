# CareFind: browsing without an account, nearby pharmacies first, sharing links instead of files

2026-11-25. Three pending CareFind issues. CODE_AUDIT item A51. Two migrations, neither applied yet (owner approval);
the app works in either order with them (see "Deployment").

> **None of this reaches users until CareFind production deploys again (CODE_AUDIT A48).** CareFind production has
> been frozen at `6248c0f` (2026-10-21) because the Vercel project `healthcare-ecosystem` only builds Previews from
> `main`. The migrations change the live database directly, so the guest shop starts working for the frozen app's
> product search immediately, but MED Market for guests, the ranking and link sharing need the new app.

## 1. Guests can browse MED Market

### Cause (verified live 2026-11-25, as the `anon` role in a rolled-back transaction)

Search, the feed, posts, news, business pages and the medicine search view (`carefind_products`) were already readable
by a logged-out visitor. MED Market was not:

```
anon: select … from ecommerce_products  →  42501 permission denied for function is_platform_admin
```

| Step | Policy (role) | What it does |
|---|---|---|
| 1 | `ecommerce_products public read` (public) | checks stock and prescription status with `EXISTS (SELECT … FROM products …)` |
| 2 | `public can view listed products` on `products` (public) | that subquery runs under products' own row security; it reads `business_claims` |
| 3 | `business_claims visible to claimant or claimed business` (public) | calls `is_platform_admin()` |
| 4 | function grants | `anon` may not execute `is_platform_admin` → the whole read fails |

The app then showed "Sign in to browse the shop" (`Shop.jsx`, on error 42501). The shop query also embedded
`products(...)` directly, which hits the same chain.

**Why not let guests run `is_platform_admin` (or scope the claims policy to signed-in users)?** Either would make
`products` readable by guests, and `products.cost_price` is still readable by the API roles until
`carehub_20270203_cost_price_column_guard` is applied (A25 / A47). That would publish every listed product's cost
price to the internet. The fix below leaves `products`, its policies, `business_claims` and that function untouched.

### Fix

| Piece | Where |
|---|---|
| `ecommerce_product_sellable(product_id)`: in stock and not prescription-restricted (the old `EXISTS`), SECURITY DEFINER, one boolean | `supabase/migrations/carefind_20270206_guest_shop_read.sql` |
| `ecommerce_products public read` recreated with that function; every other condition unchanged | same |
| `carefind_products` view gains `reorder_level` (appended; the "Low stock" badge) | same |
| Shop reads a shop item's product details from `carefind_products` (no cost column), never by embedding `products`: listing, product page, checkout stock check | `apps/carefind/src/modules/shop/shopRepository.js` |

Before the migration, the app retries the view read without `reorder_level` (logged), so signed-in shoppers are
unaffected in either order.

**Still needs an account** (unchanged, by design): checkout and paying, posting, commenting, liking, following,
gifting, saved items, wallet, dashboards. These already send a guest to sign in at the moment of the action, not before
browsing.

Also checked as a guest (live): `post_gift_stats`, `post_gift_stats_batch` and `read_posts_all` are not executable by
`anon`; every caller already skips them for guests or ignores the failure, so they do not block a page.

### Security implications

* Who sees which shop items is unchanged: the same four conditions, now evaluated for guests without error.
* The new function reveals only whether a product is in stock and not prescription-restricted, which `carefind_products`
  already shows guests for every listed product.
* `products` stays unreadable by guests; cost prices are not exposed. The view gains one non-sensitive column.

## 2. Medicine search: nearby pharmacies first

### Cause (verified in code)

The Products search asked `carefind_products` for the **100 newest** matches and only sorted by distance in the browser
when "Near me" was switched on. 13,988 products are listed (13,670 with their pharmacy's coordinates), so for a common
medicine a pharmacy next to the user was often never fetched at all. MED Market showed newest-listed first; a medicine's
"Where to buy" was sorted by price only. The search text was also placed unescaped in a PostgREST `or()` filter.

### The rule (one rule, two places)

1. Name or generic name matches, before a category-only match.
2. In stock (or stock unknown) before out of stock.
3. Nearest first (the product's coordinates, else its pharmacy's); sellers with no known location last.
4. Name / generic name *starting with* the search, before *containing* it.
5. Newest first.

Without the user's location, step 3 is skipped. A worked example and the reasons for this order are in the tests: a
pharmacy next door that is out of stock comes after one further away that has it; a category-only match nearby comes
after a name match further away.

| Where | How |
|---|---|
| Products search (all matches) | `search_carefind_products(query, lat, lng, sale_type, limit)` ranks every match in the database and returns the best 100 ids with distances; the app reads those rows from `carefind_products` in that order (`healthcareRepository.searchProducts`) |
| MED Market (small catalogue, already in the browser) | `lib/nearbyRanking.js` `rankProducts`, as the default order; an explicit sort (price, newest, rating) is left as chosen |
| A medicine's "Where to buy" | `rankSellers`: in stock, nearest, then cheapest |
| Before the migration | the previous query (search text sanitised), then `rankProducts` in the browser |

The user's location comes from the browser (asked once per session, `useGeolocation`); it is rounded to about 100 m for
the cache key, sent only with the Products search, and never stored. "Near me" still orders purely by distance.

Migration: `supabase/migrations/carefind_20270207_nearby_product_search.sql`. SECURITY INVOKER, reads only the public
view and `businesses` under the caller's own row security, so it returns nothing the caller could not already read (a
pharmacy hidden from the caller simply contributes no location). Limit clamped to 1–200; LIKE wildcards escaped.

## 3. Sharing a link, not the file

### Cause

`utils/share.js` downloaded the post's image or video (`mediaToFile`) and handed the **file** to the phone's share sheet
(`navigator.share({ files })`), for feed posts and news articles. WhatsApp therefore received the raw video with no
way back to the post.

### Fix

* `shareOrCopy` shares **title, text and the link only**; a `files` argument from any caller is ignored. `mediaToFile`
  is removed. Feed posts (`usePostEngagement.sharePost`), news (`NewsArticle`, `NewsEngagementBar`) and `ShareSheet`
  share links.
* Every post and article has a unique, readable URL, the same one the sitemap uses: `postShareUrl` →
  `https://carefind.app/post/<title-slug>-<id>`, `newsShareUrl` → `/news/<headline-slug>-<id>`. Old `/post/<id>` links
  still open (the id is read from the end of the path).
* **Previews.** Preview crawlers (WhatsApp, LinkedIn, Facebook, X, Telegram, Slack…) are served a small page with
  Open Graph tags (`api/_handlers/og.js` → `src/lib/openGraph.js`). Added: the first image of a multi-image post;
  for a video, `og:video` (+ `secure_url`, `type`), `og:type video.other`, the title "Video by <name> on CareFind" when
  the post has no words, and the CareFind icon as the picture (videos have no stored thumbnail).
* **Logged-out recipients:** posts, profiles and news are readable by guests, the post page only skips personal
  details (likes, saved) for them, and previews are built with the public key under the same rules, so a public post's
  link works for anyone. Paid posts are acknowledged but never described.

Not changed: the voice-note card (`utils/voiceCard.js`) is an explicit "save / share as a video for WhatsApp Status"
export and still produces a file; live shows already shared a link.

## Deployment

1. Apply `carefind_20270206_guest_shop_read`, probe as `anon` (shop items readable; `products` still refused).
2. Apply `carefind_20270207_nearby_product_search`, probe as `anon` with Lagos coordinates.
3. Deploy CareFind (blocked by A48 until the Vercel project deploys `main` to Production).

Any order works: the app falls back when a migration is missing, and the migrations change nothing the current app relies
on (except that guests on the old app see shop items without details until the app is deployed). WhatsApp and Facebook
cache previews per URL; a link shared before the deploy needs a re-scrape (Facebook Sharing Debugger) to show the new
card.

Rollback: each migration header has its ROLLBACK; the app change is a revert.

## Test plan

Automated:

| Area | Tests |
|---|---|
| Guest shop, live chain reproduced | `apps/carefind/src/test/shop/guestShopRead.db.test.js` (PGlite: the 42501 before; guests see exactly the sellable items after; vendor and shopper unchanged; `products` and cost still refused to anon; view columns; idempotent) |
| Shop repository | `src/modules/shop/shopRepository.test.js` (no `products` embed, view read, fallback without `reorder_level`, detail, stock check) |
| Search ranking (database) | `apps/carefind/src/test/search/nearbyProductSearch.db.test.js` (order, distances, no location, unlisted, literal matching incl. filter syntax, sale type, limit, idempotent, **same order as the app's rule**) |
| Search ranking (app) | `src/lib/nearbyRanking.test.js`, `healthcareRepository.search.test.js`, `src/modules/shop/Shop.nearby.test.jsx` |
| Sharing | `src/utils/share.test.js` (no file ever sent, readable links), `Feed.test.jsx`, `newsArticle.test.jsx`, `src/lib/openGraph.test.js` (gallery image, video tags, paid post) |

Manual, after the migrations and the deploy (phone, tablet and desktop):

1. Signed out: open carefind.app/search, MED Market lists products; open one; add to cart; checkout asks to sign in.
2. Signed out, allow location in Lagos: search "paracetamol" on Products; the nearest in-stock pharmacies come first,
   each with "… away". Deny location: results still appear (newest first within each group).
3. Share a video post to WhatsApp from a phone: the chat receives a link with the CareFind card, not a video file;
   tapping it on a phone that is not signed in opens the post. Repeat for an image post, a multi-image post and a news
   article; check LinkedIn's Post Inspector shows the card.
