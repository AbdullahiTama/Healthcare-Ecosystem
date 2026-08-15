# CareFind Updated Feature Changelog

Append-only log for the 10-feature UPDATED PENDING ISSUES program.
Never erase historical entries.

---

## 2026-08-14 — Feature 1: Products WhatsApp + Call

**What:** Ensure every product-listing surface offers both a WhatsApp deep link
and a Call deep link.

**Audit findings:**
- CareFind buyer surfaces (Search product cards, DrugProfile "Where to buy"
  seller cards, BusinessProfile facility card) already render WhatsApp **and**
  Call via `whatsappLink`/`telLink`, with Nigerian number normalisation
  (`080…` → `234…`) covered by 34 `marketplace.test.js` cases.
- **Missed surface:** the CareHub `CareFind.jsx` module — the business owner's
  "CareFind public view" preview — showed only `WhatsApp: <number>`, with no
  Call button.

**Changes:**
- `packages/shared-marketplace/src/index.js`: added `whatsappLink(contact,
  message)` and `telLink(contact)` (single normalisation source: strip
  non-digits, `0…` → `234…`, bare/passthrough `234…`/`+234…`, `null` on empty
  input so buttons hide). Added `normalizeContact` internal helper.
- `packages/shared-marketplace/src/index.test.js`: 6 new cases (null inputs,
  Nigerian normalisation for wa.me, message encoding, tel: passthrough and
  formatting strip). Suite now 13/13.
- `apps/carefind/src/modules/utils/marketplace.js`: removed the local
  `whatsappLink`/`telLink` copies and re-exported them from the shared package
  so every existing CareFind import path is unchanged. Marketplace suite 34/34.
- `apps/carehub/src/modules/carefind/CareFind.jsx`: import `whatsappLink`/
  `telLink` from the shared package (replacing the hand-rolled `wa.me` string
  build) and render a `Call: <phone>` link next to WhatsApp in the public-view
  preview using the business's `phone`.

**Verification:**
- Shared package 13/13, CareFind 257/257, CareHub 306/306 tests pass.
- `npm run build` clean for both `apps/carehub` and `apps/carefind`.
- Manual checks: preview renders both links when `brand.whatsapp` and
  `brand.phone` are set; each link hides itself when its number is missing;
  `wa.me` and `tel:` hrefs normalise Nigerian numbers identically to CareFind.

---

## 2026-08-14 — Feature 2: News Engagement (author notifications)

**What:** Notify an article's author when a reader likes or comments on it.

**Audit findings:**
- `NewsArticle.jsx` already provides the full engagement surface (like,
  comment, save, share, gift, view count, comments panel).
- `services/notify.js` already defines `news_like` and `news_comment`
  messages, and `Notifications.jsx` already renders both kinds with icons —
  but **nothing ever sent them**: `toggleLike` and `addComment` never called
  `notify()`, so authors were never told.

**Changes:**
- `apps/carefind/src/modules/news-publishing/NewsArticle.jsx`: import `notify`
  from `services/notify.js`; `toggleLike` fires type `news_like` on a new like
  (author recipient, link `/news/:id`, postId set); `addComment` fires type
  `news_comment` after a successful comment insert. `notify()` already skips
  self-notifications (recipient === actor) and never blocks the main action.

**Verification:**
- `newsArticle.test.jsx` extended to 7 cases (+2): a logged-in reader liking
  the article triggers `news_like` for the author; a logged-in reader
  commenting triggers `news_comment` for the author (comments panel opened
  first, `waitFor` on the async notify).
- Full CareFind suite 259/259 passes; `npm run build` clean.

---

## 2026-08-14 — Feature 3: Media Attachments in Sharing

**What:** Attach a post's media (image/video) to its share so WhatsApp and
other targets receive the actual media, not just the caption.

**Audit findings:**
- `Feed.jsx` `sharePost` shared only `{ title, text, url }`. The post's
  `image_url`/`video_url` (selected in `POST_FEED_COLS`) were never attached,
  so sharing a visual/video post sent only the caption text + the feed URL.
- `shareOrCopy` supported `navigator.share` + clipboard fallback but never
  passed files.

**Changes:**
- `apps/carefind/src/utils/share.js`:
  - `shareOrCopy` now accepts `files` (passed to `navigator.share` behind a
    `navigator.canShare({ files })` guard) and `mediaUrl` (appended to the
    clipboard text). When files can't be shared, the Web Share call is skipped
    so the media link lands on the clipboard instead of being dropped.
  - New `mediaToFile(url)`: fetches a media URL into a `File` (name derived
    from the URL), returns null on any failure so media attach never blocks
    the text share.
- `apps/carefind/src/modules/social-feed/Feed.jsx` `sharePost`: resolves
  `post.image_url || post.video_url`, builds a `File` via `mediaToFile`, and
  passes `files` + `mediaUrl` to `shareOrCopy`.

**Verification:**
- `share.test.js` +7 cases: files passed to share when `canShare` accepts;
  files omitted + clipboard fallback when rejected; media URL appended to
  clipboard; `mediaToFile` returns null for missing/bad fetch, builds a File
  with the URL-derived name/type, and falls back on fetch throw.
- Full CareFind suite 266/266 passes; `npm run build` clean.

---

## 2026-08-14 — Feature 4: Profile Stories

**What:** Users post 24-hour stories with text/image and a coloured background;
viewers see a seen/unseen ring; views are tracked.

**Audit findings:**
- The feature was already implemented end-to-end — verified, not re-worked.
- `Profile.jsx` has the story rail + composer (`storyComposer`,
  `setSTitle`/`setSBody`/`setSBg`/`setSImage`); `PublicProfile.jsx` renders the
  rail with per-user seen ring (`allSeen` = own-story check + every story in
  `viewedStoryIds`); feed rail `Stories.jsx` filters `expires_at > now()`,
  drives the shared `StoryViewer` and fires `increment_story_view`.
- Live DB: `stories` (18 rows) + `story_views` tables with RLS; policies limit
  read to active stories and write to the story's own user (`is_platform =
  false` guard on insert); `story_views` only the viewer. `increment_story_view`
  RPC exists (SECURITY INVOKER).
- `storyViews.js` `fetchViewedStoryIds` / `markStoriesViewed` persist seen state
  (upsert on `story_id, user_id`).

**Changes:** none required.

**Verification:**
- Live RLS policy dump + RPC inspection against the project DB.
- `StoryViewer.test.jsx` covers the shared viewer (title/body/header render,
  single `onViewStory` call per watched story, navigation, close).
- Full CareFind suite 266/266 passes; `npm run build` clean.
- Note: `increment_story_view` carries the same pre-existing
  `function_search_path_mutable` WARN as the other `increment_*` RPCs — left
  unchanged for consistency.

---

## 2026-08-14 — Feature 5: Video Feed

**What:** Users watch real video posts in a dedicated Videos tab — autoplay on
scroll, no jank, graceful failure states.

**Audit findings:**
- The feature was already implemented end-to-end — verified, not re-worked.
- `VideoPlayer.jsx` is a real `<video>` element with IntersectionObserver
  autoplay/pause (~35% viewport threshold), `visibilitychange` handling for
  hidden tabs, reduced-motion manual play, loading/error/retry states and
  aria-labels. Wired into `VisualCard.jsx` and the composer (visual posts
  write `video_url`).
- The **Videos** tab is in `FEED_TABS` (`['video', 'Videos']`); `loadFeed`
  filters `.not('video_url','is',null)` server-side (with the older-column
  fallback), `visiblePosts` keeps only video posts, empty state present.
- Live DB: `posts.video_url` column and the `posts_video_feed_idx` partial
  index (`created_at desc where video_url is not null`) both exist; the DDL is
  now tracked in the repo (`apps/carefind/sql/20260814_posts_video_url_ddl.sql`)
  — the historical untracked-DDL caveat is closed.

**Changes:** none required.

**Verification:**
- Live column + index inspection against the project DB.
- `VideoPlayer.test.jsx` (5 cases) covers the player.
- Full CareFind suite 266/266 passes; `npm run build` clean.
- Advisor run after the DDL migration showed no new findings.

---

## 2026-08-14 — Feature 6: Personalized Feed

**What:** A For You feed that ranks posts by multi-signal personalization
(engagement, recency, affinity, authority, medical, interests, location) with
candidate pools, diversity caps and staged rollout experiments.

**Audit findings:**
- The feature was already implemented end-to-end — verified, not re-worked.
- `feedEngine.js` is pure/I/O-free: pools → weighted multi-signal ranking →
  diversity (maxPerAuthor 3, maxPerType 5) across 6 candidate pools.
- `Feed.jsx` `enrichAndSetPosts` builds the full engine context (reactions,
  comments, shares, saves, gifts, follows, subscriptions, interest profile,
  viewer region) and runs `rankForYou` on the For You tab, `rankNearby` for
  Nearby, plain weighted score elsewhere; pull-to-refresh refetches through it.
- Staged rollout: `resolveExperiment` buckets deterministically per
  user/session; treatment users refetch once with treatment config; both groups
  log `feed_view` via `logExperimentEvent`.
- Live DB: all five tables (`feed_ranking_config` 2 rows,
  `candidate_generation_pools` 6, `content_distribution_experiments` 1,
  `distribution_experiment_events` 92, `feed_config` 4) exist with correct RLS.
  `set_feed_ranking_config` is SECURITY DEFINER, checks `profiles.is_admin`,
  and is authenticated-only. `FeedRankingConfig.jsx` editor mounted in Admin.

**Changes:** none required.

**Verification:**
- Live table/policy/RPC inspection against the project DB.
- `feedEngine.test.js` 17/17 and `distributionExperiments.test.js` 26/26
  pass (43 total). Full CareFind suite 266/266; production build clean.

---

## 2026-08-14 — Feature 7: Markdown Rendering

**What:** Render standard Markdown as formatted content in post and comment
bodies instead of raw asterisks/hashes.

**Audit findings:**
- Feed post bodies, comment/reply bodies, saved-post cards and the profile post
  modals all rendered content as plain text (`whiteSpace: pre-wrap`), so
  `**bold**`, `*italic*`, `# heading`, lists, inline code and `[link](url)`
  appeared literally. Only the article-specific `renderArticleHtml` knew any
  markup; the composer toolbar writes a separate `{b}..{/b}` /
  `{h:yellow}..{/h}` / `{c:red}..{/c}` bracket-marker syntax.

**Changes:**
- `apps/carefind/src/modules/social-feed/markdown.jsx` (new): a small,
  dependency-free `renderMarkdown(text)` that returns React nodes for bold,
  italic, inline code, links, headings `#..######`, unordered/ordered lists,
  blockquotes, code fences and `<br/>`-preserved line breaks.
  - Security: no `dangerouslySetInnerHTML` with user input — every string
    renders as a React text node (auto-escaped), and link hrefs are sanitised
    to `http(s)://` / `mailto:` / `tel:` / `/relative` / `#` so `javascript:`
    never becomes an anchor.
  - Compat: the legacy bracket-marker syntax is rendered too, so composer
    toolbar content keeps its styling on these surfaces.
- Wired into: `Feed.jsx` (post body), `CommentThread.jsx` (comment + reply
  bodies), `SavedPosts.jsx` (saved-post cards), and the post detail modals in
  `Profile.jsx` + `PublicProfile.jsx`. Article/premium posts keep their
  `ArticleEditor`/`renderArticleHtml` path; visual cards keep their layout.

**Verification:**
- `markdown.test.jsx` (14 cases): bold/italic/code, http/mailto/relative
  links, `javascript:` link rejection, HTML escaping, headings, ul/ol,
  blockquote, code fence, `<br/>` line breaks, legacy markers, null/blank.
- Full CareFind suite 280/280 passes; `npm run build` clean (only the usual
  chunk-size warning).
---

## 2026-08-14 - Feature 8: Wallet Withdrawal Banks + Security

**What:** Withdraw CareCoins to a bank account via a bank dropdown, with the
withdrawal request hardened so identity is server-verified and the target
account is verified before any money moves.

**Audit findings:**
- The flow was already largely built and secure: Wallet.jsx withdraw tab with
  Paystack-backed bank dropdown (/api/banks, 5-min cache), POST-only handler
  with server-verified user + balance/Paystack checks, atomic RPC, RLS enabled
  on withdrawal_requests with no direct policies, admin list/approve/reject
  behind pi/admin-auth.js.
- **Gap 1 (bug):** equest_withdrawal derived identity from uth.uid(), but
  the only caller (initiate-withdrawal.js) invokes it through a **service-role**
  client. Service-role JWTs carry no sub claim, so uth.uid() was always
  null and the RPC returned 
ot_logged_in on every call - the wallet was
  never debited and no request row was ever created, despite the handler's
  comment assuming the deduction happened. The RPC was also EXECUTE-granted to
  PUBLIC (the C15/C17 dangerous default).
- **Gap 2 (security):** the typed account name was trusted as-is. A mistyped
  account number with a mismatched name would route money to the wrong account.

**Changes:**
- pps/carefind/sql/20260814_request_withdrawal_user_id_and_account_verify.sql
  (new, applied to live DB): equest_withdrawal(uuid, integer, text, text,
  text) now takes server-verified p_user_id; EXECUTE revoked from
  PUBLIC/anon/authenticated, granted to postgres/service_role only.
  Leftover PUBLIC-executable (integer, text, text, text) overload dropped
  (the exact leftover-overload failure mode C15/C17 documented).
- pps/carefind/api/_lib/paystackTransfer.js: new esolveAccount() (Paystack
  /bank/resolve) and 
ormalizeAccountName() pure helper.
- pps/carefind/api/_handlers/initiate-withdrawal.js: passes p_user_id:
  user.id, resolves the account name before creating the Paystack recipient,
  and rejects the request if the typed name does not match the account number.
- pps/carefind/src/test/payments/transfer.test.js: +4 
ormalizeAccountName
  cases (now 10/10).

**Verification:**
- Live DB: only equest_withdrawal(uuid,integer,text,text,text) remains,
  proacl {postgres=X/postgres,service_role=X/postgres}.
- Full CareFind suite 284/284 passes; 
ode --check clean on the handler and
  lib; 
pm run build clean (only the usual chunk-size warning).

## 2026-08-15 - Feature 10: Role-Specific Professional Verification Badges

**What:** Make the verified-professional trust signal show the professional's
role everywhere, not just a bare checkmark. Consistency pass only - no schema
change.

**Audit findings:**
- The verification system is fully live: `profiles.is_verified` +
  `verification_label` + `specialty`; `verification_requests` table with
  own-row read/insert RLS; `VerifyProfessional.jsx` 2-step form (15-option
  `SPECIALTIES` list); admin approve/reject/manual via `api/_handlers/
  admin-auth.js` writing `is_verified: true, verification_label: <role>,
  specialty: <role>`. Five verified profiles live across four distinct roles.
- Primary surfaces already render the role: Profile/PublicProfile headers
  (`verification_label || 'Verified'`), feed post headers + role pill,
  PostCard, CommentThread, Search, LiveSession host, Professional
  dashboard/monetization.
- **Gap:** ~13 secondary surfaces rendered only a bare `BadgeCheck` with no
  role text - LiveShow (host, comments, who-lists), SavedPosts, DrugProfile
  (seller + reviewer), BusinessProfile reviewer, FollowersSheet, NewsArticle
  (author + commenter), Notifications, PlaylistView, Profile/PublicProfile
  reviewer lists, UserGoLive guest search.

**Changes:**
- `src/components/VerifiedBadge.jsx` (new): shared check + role label
  (`specialty || verification_label`, falling back to "Verified"), `null` for
  unverified profiles, `size` + `style` props. Single source of truth for the
  trust badge.
- Wired the component into all 13 previously-bare surfaces; each surface's
  `profiles` select now pulls `specialty, verification_label` where it only
  selected `is_verified` (LiveShow host/comments/who-lists, SavedPosts,
  DrugProfile reviewers, BusinessProfile reviewers, Notifications actor,
  FollowersSheet via `followers.js`, PlaylistView owner, Profile/PublicProfile
  reviewers, UserGoLive guests; seller `_owner` via `SELLER_FIELDS`).
- NewsArticle byline: the separate `verification_label` text line was folded
  into the badge (role now sits next to the name); date kept alone.
- Removed now-unused `BadgeCheck` imports from the 12 wired files.

**Verification:**
- `VerifiedBadge.test.jsx` 5/5 (unverified -> null, no profile -> null, role
  shown, `verification_label` fallback, "Verified" fallback).
- Full CareFind suite 302/302; `vite build` clean.
- Security note (pre-existing, out of scope): `credentials` storage bucket is
  public - licenses/certificates/IDs are readable by URL. Recommend private
  bucket + signed URLs in a future hardening pass.
