# CareFind System-Wide Engineering Program (Master Spec + Status)

> **Purpose:** Single source of truth for the CareFind system-wide engineering program.
> Read this instead of re-pasting the original spec prompt. Update the status
> sections here as work progresses, so any agent (or human) can resume instantly.
>
> **Created:** 2026-08-13
> **Sibling plans:** `planning/20260813_carefind_engagement_reposts.md` (detailed engagement-phase design)
> **SQL directory:** `apps/carefind/sql/`
> **Apps:** `apps/carefind` (React + Vite), Supabase backend.

---

## 1. Objective

Transform CareFind's social feed and marketplace from a flat, dated, print-like
experience into a modern, engagement-driven social commerce platform.

Three priorities, in order:

1. **Performance** — fast, responsive, mobile-first.
2. **Adoption** — feed people want to open daily (personalized, 5 tabs, stories, video).
3. **Monetization** — engagement → gifts, premium content, marketplace.

---

## 2. Scope

### In scope (deliverables)

1. Discovery + intent-aware + engagement-driven feed with **5 tabs**.
2. Engagement stats/counters platform: **views, likes, shares, comments, gifts, reposts, saves**.
3. UI for **all** engagement actions.
4. Validation/remediation of **existing** CareFind issues (news detail, followers, engagement, sharing, reposts).
5. Test plans + regression suite for every feature group.
6. Feature validation gates (each feature ships with its acceptance checks).

### Out of scope

- New payment providers (Paystack exists).
- Rebuilding profiles/marketplace from scratch.
- Native mobile apps.

---

## 3. System-Wide Engineering Rules (non-negotiable)

1. **Views, likes, shares, comments, gifts, reposts, saves are REAL, persistent data.** Never fake counts, never mock actions.
2. **No placeholder actions** — every button must actually work end-to-end.
3. **Strict idempotency** — likes/reactions/shares/reposts/saves never create duplicates (DB uniqueness + client reconciliation).
4. **Full state-machine correctness** — every action has loading, success, failure, and rollback paths.
5. **React quality** — every view: loading, error, and empty states; optimistic UI where appropriate.
6. **Mobile-first, zero layout shift** — no jank on phones; stable layout on load.
7. **Supabase limits respected** — 500-row default select, 5 MB payload, 60 rows/s realtime.
8. **Supabase best practices** — materialized counts, cascading deletes, RLS on every table, single session per trigger op, LISTEN/NOTIFY, custom claims, seed data.
9. **Exotic keys** — if any table uses them, remove (businesses/positions use UUID; verify nothing else).
10. **Clean content sharing** — external shares (WhatsApp/clipboard) never leak raw JSON or markdown; single central formatter.
11. **Security first** — RLS never weakened, permissions never bypassed, secrets never exposed, private/hidden content never client-filtered.

---

## 4. Feature Groups

### A. MedMarket Distance
- Display distance on every MedMarket listing.
- **Format:** < 1 km → metres (`850m away`); ≥ 1 km → kilometres (`1.2km away`).
- **Nearest-first sort** toggle on MedMarket pages.
- Use indexed geospatial queries where supported; avoid loading the entire dataset into the browser just to sort.
- Handle missing/invalid coordinates gracefully (sort unknown-locations last; hide label when no coords).

### B. MedMarket Contact
- **WhatsApp** (existing) and **Call** (new) on every MedMarket page.
- Call must open the dialer (`tel:`) with the **seller's actual phone number**.
- Consistent affordances across Search, BusinessProfile, DrugProfile, product cards.
- Accessible touch targets (min 44px).

### C. News Article Detail
- Dedicated route (`/news/:id`) with full article rendering.
- Feed/news cards deep-link to the article detail.
- No blank pages — must handle missing/invalid IDs (not-found state).
- Loading, error, empty states. Print-safe. Accessible.

### D. Engagement UI
- **Likes/reactions, shares, gifts, reposts, saves, comments** with real persistence.
- "View all" bottom sheets for lists (e.g. who liked, who reposted).
- Real-time count updates on cards; rollback on failure; idempotent (23505 → reconcile, not error).
- Reposted posts appear in the feed and on the profile of the reposter.

### E. Clean External Sharing
- Central sharing formatter (one implementation, used everywhere).
- Strips JSON bodies, markdown emphasis/headings/links before sharing.
- Fallback to clipboard when `navigator.share` unavailable; confirm "copied" to the user.

### F. Followers / Following
- Correct follower/following counts (created_at present, real FKs).
- Privacy respected (`show_followers`).

### G. Stories
- Instagram/TikTok-style story **circle row at the TOP of the profile**.
- Sequential playback (tap next/previous), expiry handled (expired stories excluded), seen/unseen indicators.
- Preserve existing story composer.

### H. Real Video Posts
- Real `<video>` playback (not voice-card exports only).
- Autoplay/pause driven by viewport visibility (`IntersectionObserver`), no scroll jank.
- Poster image, loading and error states, accessibility (controls, captions/alt).

### I. Personalized Feed Engine
- Candidate generation → multi-signal ranking → diversity → results.
- Multi-signal score (configurable weights): recency, affinity, engagement, viral coefficient, provider authority, location, medical relevance, user interests.
- Personalization inputs: interests + engagement + clicks + dwell time + explicit follow/favorite signals.
- Candidate pools (e.g. `candidate_generation_pools`): trending, following, similar providers, interests, nearby.

---

## 5. Feed Architecture (target)

**5 tabs:**
1. **For You** — recommended, multi-signal ranking.
2. **Following** — only posts by people the user follows.
3. **Nearby** — location-based discovery.
4. **Medical** — **only** posts from approved medical professionals/facilities; never mixed with general content; clear "medical professionals only" disambiguation.
5. **Videos** — video-only feed.

**Ranking weights** (configurable, stored — e.g. `feed_ranking_config`):
- Engagement 40%, Recency 20%, Affinity 20%, Location 10%, Diversity 10% (baseline; tune with data).

**State/persistence:** `seen_posts`, `feed_config` (tab preference, read-all marker) — already implemented.

---

## 6. Staged Content Rollout

- `content_distribution_experiments` table: progressive rollout %, metrics tracking.
- Rollout gates + kill switches; staged/A-B groups.
- Metric collection: engagement, retention, spam reports.

---

## 7. Database Design

### Key tables
- `posts` — `post_type`, `theme`, `image_url`, `audio_url`, `video_url`, `rating`, `view_count`, subscriber flags.
- `post_reactions` — unique (`post_id`, `user_id`, `reaction`).
- `post_shares` — unique (`post_id`, `user_id`).
- `post_gifts` — money moves; provider earns wallet credit; CareFind take-rate; gifting requires funded wallet.
- `post_reposts` — real repost records (no duplicate-post hack).
- `post_view_events` — view counting with session dedupe; persisted counters via trigger.
- `saved_posts` — unique (`post_id`, `user_id`).
- `follows` — unique, cascade delete.
- `feed_ranking_config`, `candidate_generation_pools`, `content_distribution_experiments` — feed engine.

### Rules
- **Materialized counts** (counters maintained by DB triggers, not by SELECT COUNT at render).
- **Indexes** on every FK + uniqueness constraints; cascading deletes; `updated_at` triggers.
- **RLS on every table** — private/hidden content visible only via RLS (never client-side filtering).
- Comments already exist as real nested comments.

---

## 8. Engineering Quality Standard (every feature)

- Loading state, error state, empty state.
- Responsive layout + accessibility.
- Logging where appropriate.
- Documentation updates + test plan.

## 9. Security

- RLS never weakened; private/hidden content stays hidden server-side.
- Permissions never bypassed; secrets never exposed; always explain security implications of changes.

## 10. Performance

- Pagination, indexes, materialized counts, no N+1.
- Feed: batch profile fetches, cached counters, 60 fps scroll target.

## 11. Testing

- **Unit:** helpers/utilities (e.g. `marketplace.test.js`, sharing formatter).
- **Integration:** repositories (`repositories.test.js`).
- **Component/UI:** loading/empty/error/rollback/idempotency (e.g. `followers.test.js`, `newsArticle.test.jsx`).
- Every feature group ships a test plan.

## 12. Migration Discipline

- Idempotent SQL: `CREATE ... IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`.
- Ordered, sequential, unique filenames.
- Tested on staging/preview before prod.
- After each migration: explain usage + run advisor checks (RLS).

---

## 13. Delivery Phases

| Phase | Scope | Status |
|---|---|---|
| 0 | Architecture audit | ✅ done |
| 1 | Database + backend foundations | ✅ done (SQL written) |
| 2 | Existing bug fixes | ✅ done (news, followers, engagement, sharing, reposts) |
| 3 | MedMarket | ✅ done (distance + contact; geospatial skip documented) |
| 4 | Engagement platform | ✅ done (SQL + JS + tests) — **SQL not yet applied to live DB** |
| 5 | Stories + video | 🔶 partial — stories exist but not per spec; real video not done |
| 6 | Personalized feed | 🔶 partial — heuristic score only; no candidate pools/multi-signal |
| 7 | Staged content distribution | ❌ not started |
| 8 | Testing, security, performance, regression review | 🔶 partial |

---

## 14. Final Acceptance Criteria (full program)

1. MedMarket listings show distance (`850m away` / `1.2km away`).
2. Nearest-first sort toggle works on MedMarket pages.
3. WhatsApp opens WhatsApp; Call opens dialer with the seller's number.
4. News article detail opens from feed cards.
5. All engagement actions persist; counts update in real time.
6. No duplicates on likes/shares/reposts/saves/gifts/reactions (idempotent).
7. Reposted posts appear in feed + profile.
8. Sharing works via clipboard/WhatsApp with clean text.
9. Follower/following counts correct + privacy respected.
10. Stories: Instagram-style top-of-profile, sequential playback, expired excluded.
11. Real video posts: autoplay/pause on scroll, poster, no jank.
12. Video-only tab present (5 tabs total).
13. Personalized feed: interests + engagement + location + provider authority + medical relevance + diversity.
14. Medical tab shows professional-only posts, never mixed.
15. Views, likes, shares, gifts, reposts, saves all persist.
16. Accurate counts on all posts incl. medical.
17. Providers earn from gifts (wallet credit).
18. Everything mobile, accessible, with error handling.
19. Feed: 60 fps, ~5 s load, 100 users / 1000 posts scale.
20. No security vulnerabilities; RLS correct; no data leakage.

**Final report:** summary, key decisions, risks, metrics (views/likes/gifts/saves/shares), performance, go-live recommendation.

---

## 15. Implementation Status (verified 2026-08-13)

| Feature group | Status | Evidence / files |
|---|---|---|
| A — MedMarket distance | ✅ display + nearest-sort (client-side haversine); no PostGIS (decision: unnecessary) | `apps/carefind/src/modules/utils/marketplace.js`, `healthcare-discovery/Search.jsx` ("Near me" toggle), `marketplace.test.js` |
| B — Contact | ✅ WhatsApp kept + `tel:` Call via `telLink`/`sellerPhone` | `utils/marketplace.js`, `Search.jsx`, `BusinessProfile.jsx`, `DrugProfile.jsx` |
| C — News detail | ✅ route `/news/:id`, not-found/loading/error, feed deep-links | `modules/news/NewsArticle.jsx` + `newsArticle.test.jsx` |
| D — Engagement | ✅ SQL+JS+tests written | `sql/20260813_post_engagement_uniqueness.sql`, `post_reposts.sql`, `post_shares_and_gifts.sql`, `post_view_events.sql`, `apply_engagement_phase.sql`; `utils/` + `social-feed/` |
| E — Clean sharing | ✅ central formatter + fallback | `utils/formatShare.js` (`toShareText`), `utils/share.js` (`shareOrCopy`) |
| F — Followers/Following | ✅ root cause fixed (missing `created_at`, missing FKs) | `sql/20260813_follows_created_at.sql`, `20260813_follows_profiles_fks.sql`, `social-feed/followers.js` + `followers.test.js` |
| G — Stories | ❌ not per spec | circle below stats (`account/Profile.jsx:496–555`); single-story viewer; no sequential playback / seen / expiry UI |
| H — Real video posts | ❌ not per spec | upload + `VisualCard` video exist; no `<video>` autoplay/pause via IntersectionObserver, no poster/player states |
| Video tab | ❌ missing | `FEED_TABS` = `foryou`, `following` only (`social-feed/Feed.jsx:200`) |
| I — Personalized feed | 🔶 heuristic only | scoring in `Feed.jsx` (likes·3, comments·5, verified·25, recency, seen-boost); no candidate pools, no location/interest/provider-affinity signals, no configurable weights |
| Staged rollout | ❌ missing | no `content_distribution_experiments` table/code |
| Feed persistence | ✅ done | `sql/20260813_feed_persistence.sql` (`seen_posts`, `feed_config`, read-all) |
| Phase 8 tests | 🔶 partial | engagement/followers/news/marketplace covered; stories/video/personalization/rollout/race-conditions not |

---

## 16. How to Continue (next steps)

### Blocking item first
The **SQL is written but NOT applied to the live DB.** Apply + verify before any further code work:

1. Finish Supabase MCP setup (`.opencode/opencode.json` configured; user still needs to
   close the session → `opencode mcp auth supabase` → restart).
2. Apply the phase-4 migrations in order (or run `apps/carefind/sql/apply_engagement_phase.sql`),
   then run security/performance advisors to confirm RLS on every new table.
3. Smoke-test engagement flows in the app against the live DB.

### Then pick the next phase
- **Phase 5 — Stories + video:** move story circle to top of profile with sequential
  playback + seen/expiry; build real `<video>` player with IntersectionObserver.
- **Phase 5 — Video tab:** add 5th tab.
- **Phase 6 — Personalized feed:** candidate pools + configurable multi-signal ranking + Medical tab.
- **Phase 7 — Staged rollout:** `content_distribution_experiments`.
- **Phase 8 — Acceptance matrix:** complete remaining tests + final report.

---

## 17. Docs & Artifacts Index

- **Master plan:** this file.
- **Engagement phase plan:** `planning/20260813_carefind_engagement_reposts.md`
- **SQL:** `apps/carefind/sql/20260813_*.sql` + `apply_engagement_phase.sql`
- **Existing architecture notes:** `planning/CODE_AUDIT.md`, `planning/ROADMAP.md`, `docs/PROJECT_OVERVIEW.md`
- **Tests:** `apps/carefind/src/modules/social-feed/**/*.test.js`, `news/NewsArticle.test.jsx`, `utils/marketplace.test.js`
