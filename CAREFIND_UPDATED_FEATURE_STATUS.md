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
| 4 | Profile Stories | COMPLETE | No gaps found. `stories` + `story_views` tables exist with RLS and the `increment_story_view` RPC is live; story rails (own profile composer, public profile seen-ring, feed rail) all use the shared `StoryViewer` with expiry filtering and seen tracking. |
| 5 | Video Feed | COMPLETE | No gaps found. `posts.video_url` column + `posts_video_feed_idx` partial index live; DDL now tracked in repo; `VideoPlayer.jsx` real playback with IntersectionObserver play/pause, reduced-motion handling, loading/error/retry; Videos tab in `FEED_TABS` with server-side filter + empty state. |
| 6 | Personalized Feed | COMPLETE | No gaps found. `feedEngine.js` multi-signal pipeline (pools + diversity) wired into the For You tab with pull-to-refresh; all 5 feed tables live with correct RLS; `set_feed_ranking_config` SECURITY DEFINER admin-gated (authenticated only); admin editor mounted; 43 engine/experiment tests pass. |
| 7 | Markdown Rendering | PARTIAL | Feed posts, comments/replies, saved posts and the profile post modals render Markdown as raw text (`**bold**`, `# heading`, lists, links show literally). No renderer existed for these surfaces (only the article-specific `renderArticleHtml`). |
| 8 | Wallet Withdrawal Banks + Security | COMPLETE | Two gaps found and fixed: (1) `request_withdrawal` RPC derived identity from `auth.uid()` but is only called by the service-role handler, so `auth.uid()` was always null and withdrawals never debited the wallet or created a request — reworked to take server-verified `p_user_id`, EXECUTE revoked from PUBLIC/anon/authenticated, leftover PUBLIC-executable overload dropped; (2) no account-name verification — added Paystack `/bank/resolve` check so the typed name must match the account number before any transfer. |
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

Status: COMPLETE (verified 2026-08-14 — no code changes required)
Frontend: COMPLETE
Backend: COMPLETE
Database: COMPLETE
Auth/RLS: COMPLETE
- Audit confirmed the full story feature was already implemented end-to-end;
  the "updated pending issue" was verified, not re-worked.
- Frontend: story rail + composer inside `Profile.jsx` (`storyComposer`,
  `setSTitle`/`setSBody`/`setSBg`/`setSImage`); `PublicProfile.jsx` renders the
  rail with per-user seen tracking (`viewedStoryIds`, `allSeen` ring logic =
  `!isOwnProfile && hasStory && userStories.every(s => viewedStoryIds.has(s.id))`);
  the feed rail (`Stories.jsx`) fetches active stories
  (`.gt('expires_at', now)`), drives the shared `StoryViewer` and fires the
  `increment_story_view` RPC as the viewer advances.
- Database (verified live): `stories` (18 rows) and `story_views` tables exist
  with RLS enabled; policies — stories readable by all while active
  (`expires_at > now()`), insertable/deletable only by their own user
  (insert with check `user_id = auth.uid() AND is_platform = false`), and
  `story_views` insertable/readable only by the viewer.
- RPC: `increment_story_view(story_id uuid)` exists (SECURITY INVOKER).
- Persistence/state: `storyViews.js` `fetchViewedStoryIds` / `markStoriesViewed`
  (upsert on `story_id, user_id`); ring greys out once every story is watched.
- Tests: `StoryViewer.test.jsx` covers the shared sequential viewer (renders
  title/body/header, `onViewStory` per watched story, navigation/close).
- Note: `increment_story_view` (like the other `increment_*` RPCs) carries a
  pre-existing `function_search_path_mutable` WARN advisor lint — consistent
  with the rest of the codebase, not introduced here, and left unchanged.

## FEATURE 5 — VIDEO FEED

Status: COMPLETE (verified 2026-08-14 — no code changes required)
Frontend: COMPLETE
Backend: COMPLETE
Database: COMPLETE
- Audit confirmed the video journey is fully implemented end-to-end; the
  "updated pending issue" was verified, not re-worked.
- Frontend: `VideoPlayer.jsx` renders a real `<video>` element that autoplays
  muted only while on screen — IntersectionObserver (~35% viewport threshold)
  plays/pauses as cards scroll, `visibilitychange` pauses in hidden tabs,
  reduced-motion users get a manual play affordance, and loading/error/retry
  states render instead of a blank hole (aria-labels included). Wired into
  `VisualCard.jsx` (`videoUrl` prop) and the composer (visual posts write
  `video_url`).
- Feed: the **Videos** tab (`FEED_TABS` entry `['video', 'Videos']`) runs a
  dedicated server query — `loadFeed` filters `.not('video_url','is',null)`
  (with the pre-repost-columns fallback) — and `visiblePosts` keeps only video
  posts; empty state "No videos yet" present.
- Database (verified live): `posts.video_url` column exists (1 col) and the
  `posts_video_feed_idx` partial index on `(created_at desc) where video_url is
  not null` exists. DDL now tracked in the repo:
  `apps/carefind/sql/20260814_posts_video_url_ddl.sql` (idempotent add-column +
  partial index) — the historical untracked-DDL gap is closed.
- Tests: `VideoPlayer.test.jsx` (5 cases) covers the player; full CareFind
  suite 266/266 passes; production build clean.
- Advisor run after the DDL migration showed no new findings (all WARNs are
  pre-existing multiple-policy / duplicate-index entries unrelated to this
  change).

## FEATURE 6 — PERSONALIZED FEED

Status: COMPLETE (verified 2026-08-14 — no code changes required)
Frontend: COMPLETE
Backend: COMPLETE
Database: COMPLETE
Auth/RLS: COMPLETE
- Audit confirmed the personalized-feed system is fully implemented and live;
  the "updated pending issue" was verified, not re-worked.
- Engine: `feedEngine.js` is pure and I/O-free — candidate pools →
  multi-signal weighted ranking → diversity caps. Signals (each normalized
  0..1): engagement (likes·3 + comments·5 + shares·4 + saves·2 + gifts·8 +
  reposts·6 + views/100), recency (linear decay over a week), affinity
  (follows the author + the viewer's own direct engagements), authority
  (verified professional / active business), medical (medical author),
  interests (implicit profile from what the viewer engages with), location
  (shared region tokens). Six candidate pools with per-pool caps and
  `maxPerAuthor 3` / `maxPerType 5` diversity caps.
- Wiring: `Feed.jsx` `enrichAndSetPosts` builds the full engine context
  (reactions, comments, shares, saves, gifts, follows, subscriptions, interest
  profile, viewer region) and runs `rankForYou` (pools + diversity) on the For
  You tab, `rankNearby` for Nearby, and the plain weighted score for every
  other explicit tab. Pull-to-refresh refetches through the same pipeline.
- Staged rollout: `resolveExperiment` buckets the reader deterministically
  (user + session), treatment users get a one-time refetch with the treatment
  config, and both groups log `feed_view` events via `logExperimentEvent`.
- Database (verified live): `feed_ranking_config` (2 rows),
  `candidate_generation_pools` (6 rows), `content_distribution_experiments`
  (1 row), `distribution_experiment_events` (92 rows), `feed_config` (4 rows)
  all exist. RLS: configs readable by everyone, `feed_config` scoped to its
  own user (SELECT + ALL with `user_id = auth.uid()`), experiment events
  insertable by self/anon.
- Admin gating: `set_feed_ranking_config` is SECURITY DEFINER with
  `search_path = public`, checks `profiles.is_admin` and raises
  `not_authorized` otherwise, and is granted to `authenticated` only (no
  anon/public) — config editing is properly admin-only. The
  `FeedRankingConfig.jsx` editor is mounted in `AdminPanel.jsx`.
- Tests: `feedEngine.test.js` 17/17, `distributionExperiments.test.js` 26/26
  — 43/43 pass.

## FEATURE 7 — MARKDOWN RENDERING

Status: COMPLETE (2026-08-14)
Frontend: COMPLETE
Backend: n/a (pure client renderer; content stays stored as plain text)
- Audit: feed post bodies, comment/reply bodies, saved-post cards and the
  profile post modals rendered Markdown as raw text — `**bold**`, `*italic*`,
  `# heading`, `- list`, `` `code` ``, `[link](url)` all showed literally as
  asterisks/hashes. Only the article-specific `renderArticleHtml` knew any
  markup, and the composer's toolbar writes a separate bracket-marker syntax
  (`{b}..{/b}`, `{h:yellow}..{/h}`, `{c:red}..{/c}`).
- New `modules/social-feed/markdown.jsx` — a small dependency-free renderer
  that turns Markdown into React nodes (bold, italic, inline code, links,
  headings `#..######`, unordered/ordered lists, blockquotes, code fences,
  `<br/>`-preserved line breaks).
  - **Security:** input is never injected as HTML — every string becomes a
    React text node (auto-escaped), so `<script>` etc. can't run, and link
    hrefs are sanitised to `http(s)://`, `mailto:`, `tel:`, `/relative` or
    `#` — `javascript:` never reaches an anchor.
  - **Composer compatibility:** the legacy bracket-marker syntax is rendered
    too, so content written with the toolbar keeps its styling on these
    surfaces.
- Wired into: feed post body (`Feed.jsx`), comment + reply bodies
  (`CommentThread.jsx`), saved-post cards (`SavedPosts.jsx`), and the post
  detail modals (`Profile.jsx`, `PublicProfile.jsx`). Article/premium posts
  keep their dedicated `ArticleEditor`/`renderArticleHtml` path; visual cards
  keep their card layout.
- Tests: new `markdown.test.jsx` (14 cases — bold/italic/code, http/mailto/
  relative links, `javascript:` link rejection, HTML escaping, headings, ul/ol,
  blockquote, code fence, `<br/>` line breaks, legacy markers, null/blank).
  Full CareFind suite 280/280 passes; production build clean.

## FEATURE 8 — WALLET WITHDRAWAL BANKS + SECURITY

Status: COMPLETE (2026-08-14)

Verified end-to-end:
- **Frontend** — Wallet.jsx withdraw tab: bank dropdown fed by `/api/banks` (Paystack proxy, 5-min cache), amount gated at 5 CareCoins / balance, account number + name fields, submitting/error/success toasts, wallet + history refresh after a successful request.
- **Backend** — `api/_handlers/initiate-withdrawal.js`: POST-only, server-verified user (`verifyUser`), input validation, wallet-balance check, Paystack balance pre-check, then Paystack recipient + transfer; updates the request with `paystack_reference`/`transfer_code`/`recipient_code`.
- **Database** — `request_withdrawal(uuid, integer, text, text, text)` SECURITY DEFINER, `search_path=public`, atomic row-locked debit + request insert + ledger row; `EXECUTE` for `postgres`/`service_role` only. `withdrawal_requests` has RLS enabled with no direct policies (service-role/RPC-only access). Admin list/approve/reject behind `api/admin-auth.js`.
- **Security fixes shipped** — identity now passed as server-verified `p_user_id` (the RPC previously read `auth.uid()` which is always null under the service-role caller, so withdrawals never completed); account name verified against the account number via Paystack `/bank/resolve` before any transfer.
- **Tests** — `transfer.test.js` 10/10 (added `normalizeAccountName`); full suite 284/284; `vite build` clean.

## FEATURE 9 — COMMENT LIKES, REPLIES + MENTIONS

Status: NOT STARTED (pending sequential order)

## FEATURE 10 — ROLE-SPECIFIC PROFESSIONAL VERIFICATION BADGES

Status: NOT STARTED (pending sequential order)