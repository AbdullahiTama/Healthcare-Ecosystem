# CareFind Implementation Status

Source of truth for the 10-feature sequential implementation program.
Last updated: 2026-08-14

---

## PHASE 0 — CURRENT STATE AUDIT

Audit of the full repo (backend + frontend + DB) for all 10 features was
completed via parallel sub-agent investigation on 2026-08-14. Key finding:
the prior program (`planning/20260813_carefind_systemwide_program.md`) shipped
extensive backend + SQL + tests, and the **majority of features are already
wired end-to-end**. This pass verifies each user-facing journey, fixes the
identified gaps, and marks nothing complete until it is actually verified.

Audit verdicts (detail in `CAREFIND_CHANGELOG.md` §Phase 0):

| Feature | Audit verdict | Gaps found |
|---|---|---|
| 1. MedMarket Distance | PARTIAL | No distance on featured-rail cards; only browser geolocation (no search-location coords); format uses spaces ("820 m away" vs "850m away"); nearest-first capped at newest-100/first-40; load-more appends unsorted; registration writes `lat`/`lng` but CareFind reads `latitude`/`longitude` |
| 2. WhatsApp + Call | PARTIAL | WhatsApp label correct everywhere; **Call button missing on business-owned MedMarket product cards** (`businesses.phone` not selected in Search.jsx:145); **no Call on DrugProfile**; `telLink` untested |
| 3. News Article Detail | BROKEN | Root cause: `renderArticleHtml(b.content)` throws `TypeError` on non-string block content → no ErrorBoundary → whole tree unmounts → blank page. Tests mock ArticleEditor so they miss it |
| 4. Post Engagement | MOSTLY DONE | Every action real + persistent + idempotent. Gaps: share count not displayed; save count not displayed; comment notifications not sent (`handleNotifyComment` never called); gift recipient notification unverifiable |
| 5. Clean Share Formatting | PARTIAL | Central formatter used by all live text shares, BUT article posts store content as JSON array of blocks → `toShareText` doesn't unwrap arrays → raw JSON leaks in share/copy. No tests for formatShare/share |
| 6. Followers/Following | DONE | Fixed (missing `created_at` + FKs). loading/empty/error states present. Tested |
| 7. Gifting | MOSTLY DONE | Real `send_gift` RPC (SECURITY DEFINER, wallet debit/credit, transactions ledger). Gaps: no recipient `notify()`; no gift tests |
| 8. Profile Stories | DONE | Rail at top of profile, sequential viewer, expiry + seen-state, reused system. 3 duplicated viewers (cosmetic) |
| 9. Video Feed | DONE | Real `<video>` + IntersectionObserver; Videos tab reuses feed pipeline. Caveat: `video_url` DDL untracked in repo |
| 10. Personalized Feed | DONE | Engine wired into Feed.jsx; pull-to-refresh refetches; rollout + metrics wired; admin cards mounted. Caveats: ranks newest-50 only; Nearby is text-token based |

---

## FEATURE 1 — MEDMARKET DISTANCE
Status: COMPLETE (2026-08-14)
Backend: n/a (client-side haversine; no server distance RPC exists)
Frontend: COMPLETE
Integration: COMPLETE
- Added `coordsFrom`, `businessCoords`, `productCoords` (coalesce `lat`/`lng` and `latitude`/`longitude`) in `marketplace.js`. Live DB has `lat`/`lng` populated (22 rows) and `latitude`/`longitude` always null — distance now works against the real shape.
- `formatDistance` now outputs no-space labels ("850m away" / "2.3km away") in line with the spec.
- Featured-rail product cards now show a distance label.
- `loadMoreBusinesses` re-sorts the merged list nearest-first so pager pages don't break ordering.
- Business card distance switched from dead `latitude`/`longitude` reads to `businessCoords`.
- Added `lat`, `lng` to every relevant select (`Search.jsx`, `DrugProfile.jsx`, `BusinessProfile.jsx` business embed + products embed, `loadFeatured`).
- `BusinessProfile` Directions link coalesces coords via `coordsFrom`.
- Tests: `marketplace.test.js` covers `coordsFrom`/`businessCoords`/`productCoords` coalescing and no-space format. 34/34 pass; production build clean.

## FEATURE 2 — WHATSAPP + CALL
Status: COMPLETE (2026-08-14)
Frontend: COMPLETE
- `telLink(contact)` normalises any phone into a `tel:+234…` deep link (same Nigerian 080 handling as `whatsappLink`).
- `sellerPhone(p)` resolves business phone → owner profile phone → product phone (already present in `sellerLookup.js`).
- Business-owned MedMarket product cards in `Search.jsx` now render a Call button (queries select `phone`); the business tab cards already had it.
- `DrugProfile` now selects `businesses.phone` (plus `lat`/`lng`) and renders WhatsApp + Call buttons side by side on every seller card.
- `BusinessProfile` already rendered WhatsApp + Call from `biz.phone`.
- Tests: `telLink` fully covered (null, 080 rewrite, bare digits, international passthrough, formatting-strip). 34/34 marketplace tests pass; production build clean.

## FEATURE 3 — NEWS ARTICLE DETAIL
Status: COMPLETE (2026-08-14)
Frontend: COMPLETE
- Root cause fixed: `renderArticleHtml(b.content)` threw `TypeError` on non-string block content (`.split` on null/object) and, with no ErrorBoundary, unmounted the whole app → blank page.
- `renderArticleHtml` now coerces any content to a string defensively and never throws (malformed block renders as an empty paragraph).
- `ArticleEditor.parseBlocks` now normalizes every block: non-string `content` is coerced, drawing/text types are validated, already-parsed array/object values are handled, and null values fall back to an empty text block.
- `DrawingBlock` canvas operations all guard against a null 2d context (was crashing in canvas-less environments).
- Added route-level `ErrorBoundary` (`src/components/ErrorBoundary.jsx`) wrapping all routes in `main.jsx` — a crash in any section shows a friendly fallback with Try again / Go to feed instead of a white page.
- Tests: `articleFormat.test.js` (+3 defensive cases → 11), new `articleEditor.test.jsx` (6 regression cases rendering the REAL editor against malformed bodies), new `ErrorBoundary.test.jsx` (3 cases). News-publishing suite 22/22 pass; production build clean.

## FEATURE 4 — POST ENGAGEMENT SYSTEM
Status: COMPLETE (2026-08-14)
Backend: COMPLETE
Frontend: COMPLETE
- Share count now displayed on cards (button label `formatCount(shareCount(post.id))` when > 0, else "Share").
- Save count now displayed on cards (same pattern via `saveCount(post.id)`).
- `enrichAndSetPosts` stores the per-post share/save counts (previously computed for the ranking engine but never surfaced).
- `sharePost` and `toggleSave` optimistically bump/rollback the displayed counts so the UI never fakes a count the DB didn't record.
- Comment notifications wired end-to-end: `CommentThread` fires `onCommentAdded({ postId, parentId })` after a successful insert; `Feed.handleCommentAdded` notifies the post author (`type: comment`) and, for replies, the parent comment author (`type: reply`).
- Gift recipient notification added in `GiftPanel` (`type: gift`, fire-and-forget after `send_gift` succeeds).
- Tests: new `CommentThread.test.jsx` (2 cases — top-level `onCommentAdded` and reply `parentId`); ErrorBoundary suite hardened with per-test `cleanup()` to stop single-fork DOM leakage. Social-feed + news + marketplace + ErrorBoundary suites 120/120; full suite 230/231 (only the pre-existing VideoPlayer timing flake, passes in isolation). Production build clean.

## FEATURE 5 — CLEAN SHARE FORMATTING
Status: COMPLETE (2026-08-14)
Backend: COMPLETE
Frontend: COMPLETE
- `toShareText` now unwraps article-style JSON block arrays (`[{type, content}, …]`) into readable words — text/heading/quote blocks yield their content, drawing/image/voice map to short labels — so sharing an article post no longer leaks raw JSON.
- Also accepts an already-parsed block array, and strips article highlight markers (`==#hex|text==`, `==text==`) alongside the existing markdown cleaning.
- Tests: new `src/utils/share.test.js` (14 cases — toShareText objects/arrays/highlights/truncation/fallback + shareOrCopy share/copy/dismiss/fail). Full suite 244/245 (only the pre-existing VideoPlayer timing flake, passes in isolation). Production build clean.

## FEATURE 6 — FOLLOWERS / FOLLOWING
Status: VERIFIED DONE (no changes planned unless tests reveal issues)

## FEATURE 7 — GIFTING
Status: NOT STARTED
Backend: COMPLETE (send_gift RPC)
Frontend: MOSTLY COMPLETE
Next action: recipient notification; add gift tests

## FEATURE 8 — PROFILE STORIES
Status: VERIFIED DONE (no changes planned)

## FEATURE 9 — VIDEO FEED
Status: VERIFIED DONE (track `video_url` DDL if feasible)

## FEATURE 10 — PERSONALIZED FEED + PROGRESSIVE DISTRIBUTION
Status: VERIFIED DONE (caveats documented; no changes unless required)