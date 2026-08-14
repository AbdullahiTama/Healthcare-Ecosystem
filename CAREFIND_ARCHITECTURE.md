# CareFind Architecture

Architecture reference for the CareFind application. Update when architecture
changes. This mirrors the audited state as of 2026-08-14.

---

## 1. Frontend Architecture

- **Stack:** React 18 (createRoot + StrictMode), React Router v6 (`BrowserRouter`
  in `src/main.jsx`), Vite 5, Vitest for tests.
- **Entry/routing:** `src/main.jsx` — AuthProvider wraps BrowserRouter; routes
  for feed (`/feed`), search (`/search`), news (`/news`, `/news/:id`),
  business profiles (`/business/:id`), public profiles (`/u/:id`), account
  pages (wrapped in `RequireAuth`), admin (`/admin-login`, `/admin-panel`).
- **Page modules** under `src/modules/*`: `social-feed` (Feed, Stories,
  FollowersSheet, SavedPosts), `healthcare-discovery` (Search, DrugProfile),
  `news-publishing` (News, NewsArticle, ArticleEditor), `account` (Profile,
  Dashboard, Login/Onboarding), `business-profiles-reviews` (BusinessProfile),
  `subscriptions-monetization` (GiftPanel), `wallet-payments` (Wallet), `admin`
  (AdminPanel + FeedRankingConfig + DistributionExperiments).
- **State management:** React context (`AuthContext`) + local component state +
  custom hooks. No global store. Optimistic updates with server reconciliation.
- **Layout:** `components/layout/*` (AppShell, DesktopHeader, LeftSidebar,
  RightSidebar) + BottomNav. Mobile-first responsive design.

## 2. Backend Architecture

- **Serverless functions** `apps/carefind/api/*`: single catch-all `router.js`
  dispatching by path to `_handlers/*` (restored 2026-08-14; all payments/
  bookings/admin). `vercel.json` rewrites `/api/*` → `/api/router`.
- **Direct-to-Supabase client** for the feed/marketplace (no API layer): the
  frontend calls `@supabase/supabase-js` directly (anon/publishable key) for
  read/write with RLS enforcing access.
- **RPC functions** (SECURITY DEFINER where privileged): `record_post_view`,
  `send_gift`, `post_gift_stats(_batch)`, `set_feed_ranking_config`,
  `distribution_experiment_stats`, `set_distribution_experiment`,
  `log_distribution_event`, `read_posts_all`.

## 3. Database Architecture

- **Host:** Supabase Postgres (project `szdybxmgmhndoytqanfb`), shared with
  CareHub. Migrations under `apps/carefind/sql/` (26 files) applied to live DB.
- **Social/feed tables:** `posts` (post_type incl. article/visual/video; counts
  view_count/repost_count materialized by triggers), `post_reactions`,
  `post_comments` (nested), `post_shares`, `post_reposts` (+ real repost
  `posts` rows via `repost_of`), `post_view_events`, `saved_posts`, `follows`,
  `stories`, `story_views`, `gifts`, `notifications`.
- **Feed engine tables:** `feed_ranking_config`, `candidate_generation_pools`,
  `content_distribution_experiments`, `distribution_experiment_events`,
  `seen_posts`, `feed_config`.
- **Marketplace/business:** `businesses` (phone, whatsapp, latitude,
  longitude), `products`, `profiles`. Businesses shared with CareHub.
- **Shared package `@care-ecosystem/shared-marketplace`:** single source for
  sale types/units (`SALE_TYPES`, `UNITS_BY_SALE_TYPE`, `unitLabel`,
  `saleUnitError`) **and** contact deep links (`whatsappLink`, `telLink`, with
  Nigerian `080→+234` normalisation). CareFind re-exports both sets from
  `modules/utils/marketplace.js`; the CareHub `CareFind.jsx` preview builds
  its WhatsApp/Call links from the same package, so the normalisation lives in
  exactly one place.
- **Indexes:** every FK indexed; unique indexes are the idempotency authority
  (e.g. `post_reactions_user_post_uniq`, `posts_user_repost_uniq`).

## 4. Authentication

- Supabase Auth (email). `AuthContext` holds the session; `RequireAuth` guards
  consumer routes. Admin uses a separate `admin_token` mechanism
  (`AdminLogin`). RLS derives identity from `auth.uid()`.

## 5. RLS / Security

- RLS enabled on all tables. Private/hidden content filtered server-side
  (never client-side). SECURITY DEFINER RPCs pin `auth.uid()` (e.g.
  `record_post_view`, `send_gift` — sender never client-supplied) and gate
  admin writes on `profiles.is_admin`. `distribution_experiment_events` has no
  SELECT policy (aggregates via admin RPC only). Advisors clean for new tables.

## 6. Feed Architecture

- **Tabs:** For You, Following, Nearby, Medical, Videos (+ content-type tabs
  Question/Article/Voice/Review/Series).
- **Pipeline:** server fetch (latest 50, type/medical/video filtered) →
  `enrichAndSetPosts` builds engine context (counts, follows, viewer sets,
  interests, region, medical) → `feedEngine.rankForYou` (For You: candidate
  pools + weighted score + diversity caps) or `rankByScore`/`rankNearby`
  (other tabs) → rendered cards.
- **Config:** weights/pools read from `feed_ranking_config` +
  `candidate_generation_pools`; experiment config merged via
  `applyExperimentConfig`. Pull-to-refresh refetches + re-ranks.

## 7. Engagement Architecture

- Views: `record_post_view` RPC (session-deduped client Set + DB unique index)
  + trigger materializes `posts.view_count`.
- Likes/saves: optimistic insert with `insertRowResolvingConflict` (23505 →
  read-back), counts derived from table rows.
- Reposts: `post_reposts` reference + real `posts` row (`repost_of`), triggers
  maintain `repost_count`; undo reverses both.
- Shares: tracked after successful share/copy; used in ranking.
- Gifts: `send_gift` RPC (wallet debit/credit + ledger), counts via
  `post_gift_stats` batch RPC.
- Notifications: `services/notify.js` (type: like/subscribe/gift/…). Gaps: not
  sent for comments (live path) or gifts (client).

## 8. Media Architecture

- Buckets: `live-media` (uploads), `business-assets` (public). `VideoPlayer`
  (IntersectionObserver play/pause, poster, error/retry), `VisualCard` renders
  visual posts (image or video), `VideoRecorder`/`VideoUploader` for creation.
  `news.body` stored as JSON string of blocks (ArticleEditor) rendered by
  `articleFormat.renderArticleHtml`.

## 9. Location Architecture

- `useGeolocation` hook (browser geolocation, cached in sessionStorage).
- Client-side haversine (`marketplace.js`) for MedMarket distance; text-region
  token matching (`feedEngine.normalizeRegion`) for Nearby feed. No PostGIS.
  Registration writes `lat`/`lng`; CareFind reads `latitude`/`longitude`
  (coalesce needed).

## 10. API / Data-Fetching Patterns

- Direct Supabase queries in page components + `social-feed/engagement.js`
  (action layer) + `repositories/*` (comments; postRepository is legacy/dead).
- Batch fetches to avoid N+1 (profiles `.in('id',...)`, gift stats batch).
- Fire-and-forget writes guarded with `.catch`; optimistic UI with rollback.
- **Dead/legacy layers:** `PostCard.jsx`, `postRepository.js`, `useFeed.js`,
  `useComments.js` are not wired into the live app (Feed.jsx is authoritative).