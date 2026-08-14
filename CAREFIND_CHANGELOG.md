# CareFind Changelog

Append-only log of changes for the 10-feature implementation program.
Do not erase previous history.

---

## 2026-08-14 — Production hotfix: ambiguous news→profiles embed (PGRST201)

**What:** News article load failed with `PGRST201` — "Could not embed because
more than one relationship was found for 'news' and 'profiles'." The `news`
table has two foreign keys on `author_id` → `profiles(id)`:
`fk_news_author` (ON DELETE CASCADE, NOT VALID) and `news_author_id_fkey`
(ON DELETE SET NULL), so PostgREST cannot pick an embed automatically.

**Fix:** disambiguated the embed with the constraint hint
`profiles!news_author_id_fkey` in the two queries that join news→profiles:
- `src/modules/news-publishing/News.jsx` — article list (author name).
- `src/modules/news-publishing/NewsArticle.jsx` — article detail (author info).

**Why:** Live `PGRST201` on news load; both the news feed and article pages
were broken.

**Tests performed:** full suite 256/257 pass (only the pre-existing VideoPlayer
timing flake, passes in isolation). Production build clean.

---

## 2026-08-14 — Production hotfix: products 400 on `lat`/`lng`

**What:** All four marketplace product queries returned `400 Bad Request` in
production (`products?select=...lat,lng...`). PostgREST rejects a `select` that
references a non-existent column, and the `products` table has
`latitude`/`longitude` but **no `lat`/`lng` columns** (businesses has both
naming conventions; products does not).

**Fix:** dropped `lat, lng` from the products `select` at every site, keeping
the columns that actually exist. Distance still resolves because
`coordsFrom` (src/modules/utils/marketplace.js) reads `latitude`/`longitude`
first and falls back to the nested `businesses` coords:
- `src/modules/healthcare-discovery/Search.jsx` — featured fallback rail + product search query.
- `src/modules/business-profiles-reviews/BusinessProfile.jsx` — business products.
- `src/modules/healthcare-discovery/DrugProfile.jsx` — drug detail sellers.

**Why:** Live feed of `400` errors on the products endpoints; product search,
featured rail and drug/business product lists were all broken.

**Tests performed:** full suite 256/257 pass (only the pre-existing VideoPlayer
timing flake, passes in isolation). Production build clean.

---

## 2026-08-14 — Production hotfix: `.catch` on postgrest builders

**What:** Fixed a production crash — `TypeError: ... .catch is not a function`
thrown at feed load. supabase-js `PostgrestBuilder` implements `.then()` only;
chaining `.catch()` directly on a builder (e.g. `supabase.rpc(...).catch(...)`)
threw on every affected path.

**Fix:** wrapped the thenable builders in a real Promise (`.then(() => {}).catch(...)`
or `Promise.resolve(builder)`) at every site:
- `src/modules/social-feed/engagement.js` — `record_post_view` (module-level feed
  view recorder; this was the feed-route crash, one RPC per post in the batch).
- `src/modules/social-feed/distributionExperiments.js` — `logExperimentEvent`
  now returns `Promise.resolve(client.rpc(...))`, fixing all 5 `.catch()` call
  sites in `Feed.jsx` (feed_view, engage, report, share events) in one place.
- `src/modules/account/Profile.jsx` — `increment_story_view`.
- `src/modules/news-publishing/NewsArticle.jsx` — `increment_news_view`.

**Why:** The feed crash was reported live; view counting, experiment metrics and
story/news view counters all silently used the same unsafe pattern.

**Tests performed:** full suite 256/257 pass (only the pre-existing VideoPlayer
timing flake, passes in isolation). Production build clean.

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

---

## 2026-08-14 — Feature 3 (News Article Detail)

**What:**
- Fixed the blank-page bug. Root cause: `renderArticleHtml(b.content)` in
  `ArticleEditor.jsx` called `.split()` on block content that was not a string
  (null, object, etc.) → `TypeError` → and because the app had NO ErrorBoundary,
  the entire React tree unmounted → white page on any malformed article body.
- `renderArticleHtml` is now defensive: null → empty paragraph, non-string →
  coerced via `String()`, never throws.
- `ArticleEditor.parseBlocks` normalizes every block before render: coerces
  non-string `content`, validates type, accepts already-parsed arrays/objects,
  and falls back to an empty text block for null values.
- `DrawingBlock`'s canvas code all guards against a null 2d context (resize,
  startDraw, draw, clearCanvas) — previously it crashed in canvas-less
  environments.
- Added `src/components/ErrorBoundary.jsx` and wrapped all routes in
  `main.jsx`. Any runtime crash now renders a friendly fallback with
  "Try again" and "Go to feed" instead of a blank page.

**Why:** Audit found the article detail page could blank the whole app on a
malformed body; tests mocked `ArticleEditor` so the crash shipped undetected.

**Affected files:**
- `apps/carefind/src/modules/news-publishing/articleFormat.js` (defensive coercion)
- `apps/carefind/src/modules/news-publishing/ArticleEditor.jsx` (normalizeBlock/parseBlocks, canvas guards)
- `apps/carefind/src/components/ErrorBoundary.jsx` (new)
- `apps/carefind/src/main.jsx` (wrap routes)
- `apps/carefind/src/modules/news-publishing/articleFormat.test.js` (+3)
- `apps/carefind/src/modules/news-publishing/articleEditor.test.jsx` (new, 6 — renders real editor)
- `apps/carefind/src/components/ErrorBoundary.test.jsx` (new, 3)

**Tests performed:** news-publishing suite 22/22 pass (articleFormat 11,
articleEditor regression 6, newsArticle 5). ErrorBoundary 3/3 pass. Production
build clean.

**Known limitations / next:** Feature 4 (Post Engagement: display share + save
counts, wire comment notification).

---

## 2026-08-14 — Feature 4 (Post Engagement)

**What:**
- Share and save counts now show on feed cards. `enrichAndSetPosts` stores the
  per-post `shareCounts` / `saveCounts` (they were computed for the ranking
  engine but never surfaced), and the Share / Save buttons render
  `formatCount(...)` when non-zero.
- `sharePost` and `toggleSave` optimistically bump (or roll back) the displayed
  counts only after the DB insert succeeds — the UI never shows a count the
  database did not record.
- Comment notifications are now sent end-to-end. `CommentThread` fires
  `onCommentAdded({ postId, parentId })` after a successful comment insert;
  `Feed.handleCommentAdded` notifies the post author (`type: comment`, via the
  previously dead `handleNotifyComment`) and, for replies, the parent comment
  author (`type: reply`).
- `GiftPanel` now notifies the gift recipient (`type: gift`) after `send_gift`
  succeeds — fire-and-forget so a failed notification can never look like a
  failed gift (the RPC already moved the coins).

**Why:** Audit found every engagement action was real and persistent, but the
share/save counters were invisible and comment + gift notifications were never
sent despite the `notify()` service and message map already existing.

**Affected files:**
- `apps/carefind/src/modules/social-feed/Feed.jsx` (counts state, Share/Save labels, `handleCommentAdded`)
- `apps/carefind/src/modules/social-feed/components/CommentThread.jsx` (`onCommentAdded` callback)
- `apps/carefind/src/modules/subscriptions-monetization/GiftPanel.jsx` (recipient notify)
- `apps/carefind/src/modules/social-feed/components/CommentThread.test.jsx` (new, 2)
- `apps/carefind/src/components/ErrorBoundary.test.jsx` (per-test `cleanup()` hardening)

**Tests performed:** social-feed + news-publishing + marketplace + ErrorBoundary
120/120 pass (CommentThread 2 new). Full suite 230/231 in forks mode — the single
failure is the same pre-existing `VideoPlayer` timing flake (passes in
isolation). Production build clean.

**Known limitations / next:** Feature 5 (Clean Share Formatting — `toShareText`
must unwrap article JSON block arrays).

---

## 2026-08-14 — Feature 5 (Clean Share Formatting)

**What:**
- Article posts store `content` as a JSON array of blocks (`[{type, content}, …]`).
  `toShareText` only unwrapped JSON *objects*, so sharing an article leaked raw
  JSON ("`[{\"type\":\"text\",\"content\":...`") over WhatsApp/clipboard.
- `toShareText` now unwraps JSON block arrays using the same vocabulary as
  `previewText` (text/heading/quote → content, drawing → ✏️ drawing, image →
  🖼 image, voice → 🎙 voice note), accepts an already-parsed array, and strips
  article highlight markers (`==#hex|text==`, `==text==`) on top of the existing
  markdown cleaning.
- Added `src/utils/share.test.js` covering the formatter (objects, block arrays,
  already-parsed arrays, highlights, truncation, JSON-parse fallback) and
  `shareOrCopy` (share / copy / dismiss / fail).

**Why:** Audit found the central share formatter produced clean text for JSON
objects but dumped raw block JSON for article posts, with no tests at all on
`formatShare.js` or `share.js`.

**Affected files:**
- `apps/carefind/src/utils/formatShare.js` (block-array unwrap, highlight strip)
- `apps/carefind/src/utils/share.test.js` (new, 14)

**Tests performed:** full suite 244/245 pass in forks mode — the single failure
is the same pre-existing `VideoPlayer` timing flake (passes in isolation).
Production build clean.

**Known limitations / next:** Feature 6 was audited DONE (followers/following
verified). Moving to Feature 7 (Gifting — recipient notification added in F4;
remaining: wallet-deduction verification + gift tests).

---

## 2026-08-14 — Feature 7 (Gifting)

**What:**
- **Critical gap found during verification:** the `send_gift` RPC no longer
  exists in the live database. The C15/C16 hardening dropped the vulnerable
  caller-supplied-sender overloads and applied a safe `auth.uid()`-based
  replacement directly to the live DB, but it was never saved back into the
  repo — and only `pay_creator_subscription` survived. Gifting has been silently
  broken since ~July (the 9 rows in `gifts` all predate the loss).
- Recreated the RPC in `apps/carefind/sql/20260814_recreate_send_gift_rpc.sql`
  and applied it to live. `send_gift(p_recipient, p_coins, p_gift_type,
  p_gift_emoji, p_post_id default null, p_live_session_id default null)`:
  - SECURITY DEFINER; sender is always `auth.uid()` (never caller-supplied).
  - Self-gifting blocked (`'self'`), returns `'ok' | 'insufficient' |
    'unauthorized' | 'self'`.
  - Row-locks the sender wallet, debits sender, credits recipient, writes one
    `gifts` row + two `transactions` rows (`gift_sent` negative /
    `gift_received` positive) sharing a single `gift_<uuid>` reference — safe
    because the `transactions` unique indexes are partial (topup +
    consultation_payment only), so no C16 collision regression.
  - Revoked from `public`/`anon`, granted to `authenticated` only. Verified live:
    `prosecdef=true`, proacl has no anon exposure, and an unauthenticated call
    returns `'unauthorized'`. Security advisors show no new findings.
- Verified the client path: `GiftPanel` and `LiveSession` call `send_gift` with
  the correct parameter names; wallet display uses the real `wallets.balance`
  from an exact-count query; ledger types `gift_sent`/`gift_received` match what
  `Wallet.jsx` renders.
- Tests: new `GiftPanel.test.jsx` (4 cases — correct `send_gift` args, recipient
  notified on success, no notify on failure, blocked when the wallet can't cover
  the gift), with per-test `cleanup()` to stop single-fork DOM leakage.

**Why:** Feature 7 required wallet-deduction verification; verifying it against
live surfaced the missing RPC. Recreating it is both the fix and the regression
guard for gifting.

**Affected files:**
- `apps/carefind/sql/20260814_recreate_send_gift_rpc.sql` (new — RPC recreated in repo + applied to live)
- `apps/carefind/src/modules/subscriptions-monetization/GiftPanel.test.jsx` (new, 4)

**Tests performed:** full suite 248/249 pass in forks mode — the single failure
is the same pre-existing `VideoPlayer` timing flake (passes in isolation).
Production build clean.

**Known limitations / next:** Features 1–7 verified complete. Next: Feature 8
(Profile Stories — auto-advance gap + re-engagement).

---

## 2026-08-14 — Feature 8 (Profile Stories)

**What:**
- Verified the full story journey end-to-end. The circle rail renders at the
  top of the own profile (`Profile.jsx`), the public profile (`PublicProfile.jsx`)
  and the feed (`Stories.jsx`); playback is sequential with progress bars,
  auto-advance, and tap next/previous zones; expired stories are excluded on
  every load (`.gt('expires_at', …)`); `PublicProfile` greys its ring out once
  the viewer has seen every story (via `storyViews.js`).
- **Live DB verified:** `stories` and `story_views` tables exist; RLS is correct
  (`story_views` reads/inserts scoped to `user_id = auth.uid()`; `stories`
  insert restricted to the owner with `is_platform = false`); the
  `increment_story_view` RPC exists and is callable. The
  `20260813_story_views.sql` migration is tracked in the repo.
- **Removed the 3 duplicated viewers.** The full-screen viewer — ~90 lines of
  identical timer/progress/tap-zone/content JSX — was inlined three times.
  Extracted a shared `StoryViewer` component
  (`src/modules/social-feed/components/StoryViewer.jsx`) that owns the
  auto-advance timer, progress bars, tap zones, content layout and close
  button. Each caller supplies its header via `renderHeader` and keeps its own
  per-story side effects (view counting, seen marking) keyed on the index.
  Behaviour is unchanged; the duplication is gone.

**Why:** The audit marked F8 DONE but noted "3 duplicated viewers (cosmetic)" —
triplicated logic of exactly the kind the engineering standard forbids. The
feature itself needed verification against live before signing off.

**Affected files:**
- `apps/carefind/src/modules/social-feed/components/StoryViewer.jsx` (new — shared viewer)
- `apps/carefind/src/modules/social-feed/components/StoryViewer.test.jsx` (new, 8)
- `apps/carefind/src/modules/social-feed/Stories.jsx` (use shared viewer)
- `apps/carefind/src/modules/account/Profile.jsx` (use shared viewer)
- `apps/carefind/src/PublicProfile.jsx` (use shared viewer)

**Tests performed:** full suite 256/257 pass in forks mode — the single failure
is the same pre-existing `VideoPlayer` timing flake (passes in isolation).
Production build clean.

**Known limitations / next:** Features 1–8 verified complete. Next: Feature 9
(Video Feed — `video_url` DDL is untracked; add the DDL to the repo if
feasible).

---

## 2026-08-14 — Feature 9 (Video Feed)

**What:**
- Verified the video journey end-to-end. `VideoPlayer.jsx` is a real `<video>`
  element with IntersectionObserver autoplay/pause (~35% viewport threshold),
  `visibilitychange` handling for hidden tabs, reduced-motion users getting a
  manual play affordance, loading/error/retry states, and aria-labels. It is
  wired into `VisualCard.jsx`, the composer (visual posts write `video_url`),
  and the **Videos** tab — the 5th `FEED_TABS` entry — whose `loadFeed`
  filters `.not('video_url','is',null)` and whose `visiblePosts` keeps only
  video posts with an empty state.
- **Closed the DDL gap.** `posts.video_url` existed in the live database but
  was never tracked in the repo (the column shipped before the SQL was
  versioned). Added `apps/carefind/sql/20260814_posts_video_url_ddl.sql` —
  idempotent `add column if not exists video_url text` plus a partial index
  `posts_video_feed_idx (created_at desc) where video_url is not null` so the
  Videos-tab filter reads only video posts in order without a full scan.
  Applied to live and verified the index exists.
- Security/perf check: advisor run after the migration showed no new findings
  — every WARN is a pre-existing multiple-permissive-policy or duplicate-index
  entry unrelated to this change.

**Why:** The audit marked F9 DONE but flagged `video_url` DDL as untracked —
any fresh environment could not reproduce the video schema from the repo.

**Affected files:**
- `apps/carefind/sql/20260814_posts_video_url_ddl.sql` (new — tracked DDL + partial index, applied to live)

**Tests performed:** full suite 256/257 pass in forks mode — the single failure
is the same pre-existing `VideoPlayer` timing flake (passes in isolation).
Production build clean.

**Known limitations / next:** Features 1–9 verified complete. Next: Feature 10
(Personalized Feed — audited DONE with documented caveats; verify, then close
the program).

---

## 2026-08-14 — Feature 10 (Personalized Feed) + Program Close

**What:**
- Verified the personalized-feed journey end-to-end. `feedEngine.js`
  (multi-signal weighted score, 6 candidate pools, diversity caps,
  `normalizeRegion`/`regionsOverlap`) is wired into `Feed.jsx`; the For You tab
  runs the full pipeline inside `enrichAndSetPosts`, pull-to-refresh refetches,
  and the config is read from `feed_ranking_config` + `candidate_generation_pools`.
- **Live DB verified:** `feed_ranking_config`, `candidate_generation_pools`,
  `content_distribution_experiments`, `distribution_experiment_events` and
  `feed_config` all exist with read RLS. `set_feed_ranking_config` (used by the
  admin `FeedRankingConfig.jsx` editor) is SECURITY DEFINER, checks
  `profiles.is_admin`, and is executable by `authenticated` only — no anon or
  public exposure.
- Staged rollout verified: `resolveExperiment` deterministically buckets the
  reader; treatment-group users get one refetch applying the treatment config;
  control and treatment both log `feed_view` events to
  `distribution_experiment_events` (fire-and-forget). Persisted feed-tab
  preference reads/writes `feed_config` per user.

**Why:** Feature 10 was audited DONE with documented caveats; this pass verifies
it against live and closes the 10-feature program with all journeys verified.

**Affected files:** none (verification only — no code change required).

**Tests performed:** `feedEngine.test.js` 17/17 pass. Full suite 256/257 in
forks mode — the single failure is the same pre-existing `VideoPlayer` timing
flake (passes in isolation). Production build clean.

**Program close (2026-08-14):** all 10 CareFind features are COMPLETE and
verified:
- **F1–F3** committed `2069527`; **F4** `53d46b9`; **F5** `e68036b`;
  **F6** verified (no changes); **F7** `0f9e198` (recreated `send_gift` RPC in
  repo + applied live); **F8** `7bba5b4` (shared StoryViewer, 3 duplications
  removed); **F9** `2b2206b` (`video_url` DDL tracked + index applied live);
  **F10** verified (no changes).
- Two critical live-DB gaps were found and fixed this program: the missing
  `send_gift` RPC (gifting silently broken) and the untracked `video_url` DDL.
- Known accepted limitations, documented in `CAREFIND_IMPLEMENTATION_STATUS.md`:
  MedMarket search uses browser geolocation only (no search-location coords);
  feed engine ranks the newest-50 candidate pool; Nearby is text-token based;
  `video_url` has no CHECK constraint by design (legacy rows); pre-existing
  advisor WARNs (multiple permissive policies / duplicate indexes) remain open
  and are out of scope for this program.
