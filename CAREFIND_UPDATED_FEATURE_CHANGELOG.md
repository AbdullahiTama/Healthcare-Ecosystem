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