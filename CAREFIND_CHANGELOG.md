# CareFind Changelog

Append-only log of changes for the 10-feature implementation program.
Do not erase previous history.

---

## 2026-08-14 — Phase 0: Current state audit

**What:** Audited the entire CareFind repo (frontend + backend + SQL + tests)
for all 10 pending features using parallel sub-agent investigation.

**Why:** The prior program shipped extensive backend/SQL work; the task requires
verifying each actual user-facing journey and fixing gaps before marking
anything complete.

**Findings by feature:**
- **F1 MedMarket Distance** — distance computed client-side (haversine) and
  rendered on Search product cards, business cards, DrugProfile sellers, and
  BusinessProfile products. Gaps: featured-rail product cards show no distance;
  only browser geolocation is supported (no search-location coords); format has
  spaces ("820 m away"); nearest-first only sorts newest-100 products / first-40
  businesses; `loadMoreBusinesses` appends unsorted pages; registration writes
  `lat`/`lng` but CareFind reads `latitude`/`longitude`.
- **F2 WhatsApp + Call** — WhatsApp label correct everywhere. Call (`tel:`) is
  MISSING on business-owned MedMarket product cards (products query at
  `Search.jsx:145` doesn't select `businesses.phone`, so `sellerPhone` returns
  null) and entirely missing on DrugProfile. `telLink` has zero test coverage.
- **F3 News Article Detail** — ROOT CAUSE FOUND: `renderArticleHtml(b.content)`
  at `ArticleEditor.jsx:422` throws `TypeError` on any non-string block content
  (`.split` on undefined/null/object). The app has NO ErrorBoundary, so the
  whole React tree unmounts → blank white page. `newsArticle.test.jsx:41` mocks
  `ArticleEditor`, so tests pass while the bug is live.
- **F4 Post Engagement** — verified every action (view/like/share/gift/repost/
  save/comment) is real, persistent, and idempotent (DB unique indexes + 23505
  reconciliation). Gaps: share count not rendered on cards; save count not
  rendered; comment notifications never sent (`handleNotifyComment` is dead);
  gift recipient notification unverifiable.
- **F5 Clean Sharing** — central `toShareText` used by all live text-share
  entry points, BUT article posts store `posts.content` as a JSON **array** of
  blocks (`ArticleEditor.jsx:369-372`) and `toShareText` only unwraps the object
  form → raw block JSON (with internal `id`/`type` fields) leaks to share/copy.
  No tests for `formatShare.js`/`share.js`.
- **F6 Followers** — verified fixed (fallback query when `created_at` absent;
  FKs added). Loading/empty/error states present.
- **F7 Gifting** — real `send_gift` RPC (SECURITY DEFINER) debits sender wallet,
  credits recipient, writes ledger. No recipient `notify()` in the client; no
  gift tests. `send_gift` SQL body lives only in the live DB, not the repo.
- **F8 Stories** — verified done: rail at top of profile, sequential viewer,
  expiry excluded, seen-state preserved.
- **F9 Video** — verified done: real `<video>`, IntersectionObserver play/pause,
  Videos tab reusing feed pipeline. `video_url` DDL not in tracked SQL.
- **F10 Personalized Feed** — verified done: engine wired into Feed.jsx
  (For You uses full pool+diversity+experiment pipeline), pull-to-refresh
  refetches, rollout metrics logged, admin cards mounted. Nearby is text-token
  based (no coords).

**Affected files:** none (audit only).

**Tests performed:** none (audit only). Existing suite: CareFind 208 tests pass.

**Known limitations / next:** begin Feature 1 (MedMarket Distance) fixes.

---

## 2026-08-14 — Feature 1 (MedMarket Distance) + Feature 2 (WhatsApp + Call)

**What:**
- **F1 Distance** — Added `coordsFrom`, `businessCoords`, `productCoords` to
  `marketplace.js` to coalesce both coordinate naming conventions
  (`lat`/`lng` — what CareHub registration writes, live DB has 22 populated rows —
  and `latitude`/`longitude` — what CareFind reads, live DB has 0 rows). All
  distance reads now go through these helpers.
  - `formatDistance` emits no-space labels: "850m away", "2.3km away".
  - Featured-rail product cards now show a distance label.
  - `loadMoreBusinesses` re-sorts the whole merged list nearest-first when
    "Near me" is active (previously page 2+ appended unsorted).
  - Business card distance + BusinessProfile Directions link no longer read the
    dead `latitude`/`longitude` columns.
  - `lat`/`lng` added to every product/business select: `Search.jsx` (featured,
    products, businesses), `DrugProfile.jsx`, `BusinessProfile.jsx` (embed).
- **F2 WhatsApp + Call** — `telLink(contact)` added (Nigerian 080 handling, same
  logic as `whatsappLink`). Business-owned product cards in `Search.jsx` now
  select `businesses.phone` and render a Call button. `DrugProfile` selects
  `businesses.phone` and renders WhatsApp + Call side by side on every seller
  card. `BusinessProfile` already had both.

**Why:** F1 audit found distance broken against the live data shape
(`latitude`/`longitude` always null) and missing on rail cards; F2 audit found
the Call button absent on business-owned product cards and DrugProfile.

**Affected files:**
- `apps/carefind/src/modules/utils/marketplace.js` (coords helpers, no-space format, `telLink`)
- `apps/carefind/src/modules/utils/marketplace.test.js` (+6 tests → 34)
- `apps/carefind/src/modules/healthcare-discovery/Search.jsx` (selects, rail distance, load-more sort, business-card coords)
- `apps/carefind/src/modules/healthcare-discovery/DrugProfile.jsx` (selects, Call button)
- `apps/carefind/src/modules/business-profiles-reviews/BusinessProfile.jsx` (selects, Directions coords)

**Tests performed:** `marketplace.test.js` 34/34 pass (added `coordsFrom`/
`businessCoords`/`productCoords` coalescing, no-space format, `telLink` cases).
Full suite 217/218 pass in forks mode — the single failure is a pre-existing
`VideoPlayer` timing flake that passes in isolation and is unrelated to these
changes. Production build clean (`vite build`).

**Known limitations / next:** Feature 3 (News Article Detail blank page).
