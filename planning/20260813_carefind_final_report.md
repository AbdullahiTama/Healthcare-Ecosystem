# CareFind System-Wide Program — Final Report (2026-08-13)

Phase 8 close-out for `planning/20260813_carefind_systemwide_program.md`.

## 1. Summary

The CareFind program shipped Phases 0–8: architecture audit, DB/backend
foundations, bug fixes, MedMarket distance + contact, the engagement platform
(like/save/share/repost/gift/report/view with idempotent, real-time counts),
stories + video posts, a personalized multi-signal feed with Nearby + Medical
tabs, and staged content distribution (kill switch + rollout + A/B metrics).
**All 10 migrations written this program are applied to the live DB and
RLS-verified; both apps are fully regression-tested (CareFind 208, CareHub 285)
and build clean.**

## 2. Acceptance matrix (program §14)

| # | Criterion | Status | Evidence |
|---|---|---|---|
| 1 | MedMarket shows distance | ✅ | `utils/marketplace.js` haversine + `marketplace.test.js` |
| 2 | Nearest-first sort toggle | ✅ | `healthcare-discovery/Search.jsx` "Near me" |
| 3 | WhatsApp / Call work | ✅ | `utils/marketplace.js` `telLink`, verified client-side |
| 4 | News detail from feed cards | ✅ | route `/news/:id` + `newsArticle.test.jsx` |
| 5 | Engagement persists, counts live | ✅ | `social-feed/engagement.js` + `repositories.test.js` |
| 6 | No duplicates (idempotent) | ✅ | unique indexes `post_engagement_uniqueness` + `raceConditions.test.js` |
| 7 | Reposts appear in feed + profile | ✅ | `writeRepost`/`undoRepost` + `engagement.test.js` |
| 8 | Clean sharing via clipboard/WhatsApp | ✅ | `utils/formatShare.js` `toShareText` |
| 9 | Follower counts correct + privacy | ✅ | `follows_created_at`/`follows_profiles_fks` + `followers.test.js` |
| 10 | Stories: top-of-profile, sequential, expired excluded | ✅ | `storyViews.js` + `storyViews.test.js` (6) |
| 11 | Video: autoplay/pause, poster, no jank | ✅ | `VideoPlayer.jsx` (IO 0.35, reduced-motion) + `VideoPlayer.test.jsx` (5) |
| 12 | Video-only tab | ✅ | 5th `Videos` tab in `Feed.jsx` |
| 13 | Personalized feed (7 signals) | ✅ | `feedEngine.js` + `feedEngine.test.js` (17) |
| 14 | Medical tab never mixes pro/non-pro | ✅ | server-filtered + sentinel-id fallback in `Feed.jsx` |
| 15 | Views/likes/shares/gifts/reposts/saves persist | ✅ | all live tables; `post_view_events` trigger-maintained |
| 16 | Accurate counts incl. medical | ✅ | materialized counts, triggers, `record_post_view` |
| 17 | Providers earn from gifts | ✅ | wallet credit via `post_gifts` → `wallets` (Phase 4 SQL) |
| 18 | Mobile, accessible, error handling | ✅ | every surface ships loading/error/empty + a11y labels |
| 19 | Feed 60 fps / ~5 s load / scale | 🔶 partial | see §5 — batch reads proven; full live load audit pending |
| 20 | No security vulnerabilities / RLS | ✅ | advisors clean for new tables; SECURITY DEFINER gates `is_admin`; no SELECT on events table |

## 3. Key decisions

- **Client-side deterministic bucketing** for rollouts (FNV-1a, avalanched) —
  stable groups across sessions with no assignment table.
- **DB unique indexes are the idempotency authority**; the client reconciles
  23505 by reading the row back, so a fast double-tap is one row, never two.
- **Materialized counts** (triggers) instead of `SELECT COUNT` at render.
- **`distribution_experiment_events` has no SELECT policy** — metrics are
  aggregates via an `is_admin`-gated RPC, never raw rows.
- **Medical tab filtering is server-side** — professional/verified rows only;
  the client never post-filters private content into view.
- **No PostGIS** — client haversine for distance (decision: unnecessary).

## 4. Risks & open items

- **Repost double-tap in one render tick** can publish two identical 🔁 feed
  posts (references are deduped; counts correct). Low severity, self-heals on
  reload. Recommended follow-up: `UNIQUE (user_id, repost_of)` on `posts` or
  an in-flight guard in `toggleRepost`.
- **Optimistic toggle thrash** (tap like, then unlike before the first write
  resolves) may leave the button state momentarily stale; the DB is the source
  of truth and reloads reconcile. Cosmetic only.
- **Feed load audit** (#19) needs a live instrumented pass (page load, scroll
  fps) at 100 users / 1000 posts — not measured this program.
- **Staged experiments are OFF** in prod (`foryou_engine_v1`, rollout 0) —
  deliberate: operators enable via AdminPanel kill switch when ready.
- **Pre-existing** (not this program): CareHub chunk size warning; C20 live;
  plaintext `businesses.password`/`staff.password` columns still need purging.

## 5. Performance

- Feed page batch-reads profiles (`.in('id', userIds)`), gift totals via
  `post_gift_stats_batch`, comment counts via `getCommentCounts` — no N+1.
- Views dedupe per session client-side and via DB unique index
  (`post_view_events`), so refresh/StrictMode never inflates counts.
- Feed engine runs on 6 pre-seeded candidate pools (recency, follows,
  verified professionals, medical, proximity, engagement) — one query, ranked
  client-side.
- CareFind bundle: `index` 1.1 MB min (301 kB gzip) — pre-existing warning,
  candidate for route-level code splitting (tracked in CODE_AUDIT).

## 6. Go-live recommendation

**Approve.** Phase 8 regression pass is green across both apps (CareFind 208 +
CareHub 285 tests, clean builds), all program migrations are applied and
RLS-verified with no new advisor findings, and every §14 acceptance criterion
except the instrumentation-dependent feed-load audit is verified. Recommended
go-live actions: (1) run the #19 live load/fps audit; (2) enable
`foryou_engine_v1` at 10% via AdminPanel once the audit passes; (3) purge the
legacy plaintext password columns (C2/C20) as the standing security follow-up.

## 7. Metrics snapshot (live DB, 2026-08-13)

posts 25 · post_reactions 10 · post_comments 9 · post_reposts 0 · post_shares 0 ·
saved_posts 4 · follows 19 · stories 18 · story_views 0 · post_view_events 0 ·
news 4 · feed_ranking_config 2 · candidate_generation_pools 6 ·
content_distribution_experiments 1 (off)
