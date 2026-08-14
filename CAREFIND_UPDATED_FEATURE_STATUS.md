# CareFind Updated Feature Status

Source of truth for the 10-feature UPDATED PENDING ISSUES program
(sequential full-stack implementation). A feature is marked COMPLETE only
after frontend + backend + database + auth/RLS + state + persistence +
loading/error/empty states + mobile + tests + manual user-flow verification
all pass.
Last updated: 2026-08-14

---

## PHASE 0 — READ-ONLY AUDIT (IN PROGRESS)

Read-only audit of the current codebase for all 10 updated pending issues.
Per-feature verdicts below. Anything marked PARTIAL/DONE was audited against
the actual implementation and the acceptance criteria from the updated issue
list; nothing is assumed missing or complete.

| # | Feature | Audit verdict | Gaps found |
|---|---|---|---|
| 1 | Products WhatsApp + Call | PARTIAL | All CareFind buyer surfaces already render WhatsApp **and** Call (Search product cards, DrugProfile seller cards, BusinessProfile). **Gap: the CareHub CareFind module "public view" preview renders WhatsApp only — no Call button.** |
| 2 | News Engagement | PARTIAL | Article page has full engagement (like/comment/save/share/gift/views) and the Notifications UI already supports `news_like`/`news_comment` types — but **neither is ever fired**: `toggleLike`/`addComment` never call `notify()`, so article authors get no notifications. |
| 3 | Media Attachments in Sharing | PARTIAL | `sharePost` shares only text + the feed URL — the post's `image_url`/`video_url` are never attached. `shareOrCopy` supports the Web Share API but never passes `files`, so a WhatsApp share of a visual/video post sends just the caption, not the media. |
| 4 | Profile Stories | NOT AUDITED | — |
| 5 | Video Feed | NOT AUDITED | — |
| 6 | Personalized Feed | NOT AUDITED | — |
| 7 | Markdown Rendering | NOT AUDITED | — |
| 8 | Wallet Withdrawal Banks + Security | NOT AUDITED | — |
| 9 | Comment Likes, Replies + Mentions | NOT AUDITED | — |
| 10 | Role-Specific Professional Verification Badges | NOT AUDITED | — |

---

## FEATURE 1 — PRODUCTS WHATSAPP + CALL

Status: COMPLETE (2026-08-14)
Frontend: COMPLETE
Backend: n/a (deep links only, no server change)
Shared: COMPLETE
- Audit found every CareFind buyer surface (Search product cards, DrugProfile
  "Where to buy" seller cards, BusinessProfile facility card) already renders
  WhatsApp **and** Call side by side via `whatsappLink`/`telLink`, with the
  Nigerian `080→+234` normalisation covered by 34 marketplace tests.
- **Missed surface closed:** the CareHub `CareFind.jsx` module — the business
  owner's "CareFind public view" preview — rendered a WhatsApp link with **no
  Call button**. Now renders `Call: <phone>` next to WhatsApp, resolving the
  business's `phone`.
- **De-duplicated the link builders:** `whatsappLink`/`telLink` moved from
  CareFind's `marketplace.js` into `@care-ecosystem/shared-marketplace` (the
  package both apps already share) so the normalisation lives in exactly one
  place. CareFind re-exports them from `marketplace.js` — existing import
  paths unchanged.
- Tests: shared-package suite extended to 13 (6 new cases: null handling,
  Nigerian number normalisation, message encoding, formatting strip); CareFind
  marketplace suite still 34/34 via re-export; CareHub suite 306/306.
- Production builds clean for CareHub and CareFind.

## FEATURE 2 — NEWS ENGAGEMENT

Status: COMPLETE (2026-08-14)
Frontend: COMPLETE
Backend: n/a (types `news_like`/`news_comment` already exist in
`services/notify.js` and render in `Notifications.jsx`)
- Audit confirmed the article page already has the full engagement surface
  (like, comment, save, share, gift, view count, comments panel). The gap was
  purely the **notification side**: `news_like` and `news_comment` types
  existed in `notify.js` and `Notifications.jsx` but were never sent.
- `NewsArticle.toggleLike` now calls `notify()` with type `news_like` on a
  new like (author recipient, never self-notifies).
- `NewsArticle.addComment` now calls `notify()` with type `news_comment` after
  a successful comment insert.
- Tests: `newsArticle.test.jsx` +2 cases (like notifies author, comment
  notifies author) using an explicit logged-in reader and a `notify` mock.
  Full CareFind suite 259/259; production build clean.

## FEATURE 3 — MEDIA ATTACHMENTS IN SHARING

Status: COMPLETE (2026-08-14)
Frontend: COMPLETE
Backend: n/a (pure client share enhancement)
- Audit: `sharePost` (`Feed.jsx`) shared only `{ title, text, url }`; a post's
  `image_url`/`video_url` were never included, so WhatsApp shares of a
  visual/video post carried just the caption + the feed URL.
- `utils/share.js`: `shareOrCopy` now accepts `files` (real File objects,
  handed to the Web Share API on capable browsers via an explicit
  `navigator.canShare` guard — when files can't be shared the whole share is
  skipped so the media link reaches the clipboard) and `mediaUrl` (appended
  to the clipboard text so recipients always get the media link).
- `utils/share.js`: new `mediaToFile(url)` — fetches a media URL into a `File`
  (name derived from the URL), returns null on any CORS/HTTP failure so an
  attachment is always best-effort and never blocks the text share.
- `Feed.jsx` `sharePost`: resolves the post's media (`image_url || video_url`),
  builds a `File` via `mediaToFile`, and passes `files` + `mediaUrl` to
  `shareOrCopy`.
- Tests: `share.test.js` +7 cases (files passed to share when canShare accepts;
  files omitted + clipboard fallback when rejected; media URL appended to
  clipboard; `mediaToFile` null for missing/bad fetch, File build with name/
  type, and throw fallback). Full suite 266/266; production build clean.

## FEATURE 4 — PROFILE STORIES

Status: NOT STARTED (pending sequential order)

## FEATURE 5 — VIDEO FEED

Status: NOT STARTED (pending sequential order)

## FEATURE 6 — PERSONALIZED FEED

Status: NOT STARTED (pending sequential order)

## FEATURE 7 — MARKDOWN RENDERING

Status: NOT STARTED (pending sequential order)

## FEATURE 8 — WALLET WITHDRAWAL BANKS + SECURITY

Status: NOT STARTED (pending sequential order)

## FEATURE 9 — COMMENT LIKES, REPLIES + MENTIONS

Status: NOT STARTED (pending sequential order)

## FEATURE 10 — ROLE-SPECIFIC PROFESSIONAL VERIFICATION BADGES

Status: NOT STARTED (pending sequential order)