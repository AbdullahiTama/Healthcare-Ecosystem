# Port: nine-issue batch onto main + WYSIWYG phase 2 (2026-08-26)

Status: READY TO EXECUTE. Written after conflict analysis; no code applied yet.
Batch source commit: `7814817` on `feature/landing-premium-pass` (pushed).
Port branch: `port/nine-issue-batch` exists off local main tip `cdbede7` (clean).
Local main is AHEAD of `AbdullahiTama/main` (34+ unpushed commits incl. /post/:id permalinks). Push both at the end.

## Decisions made
- Sequence: finish port FIRST, then implement inline editing once on the surviving editor.
- Storage stays MARKERS (`**…**`, `*…*`, `==#hex|…==`). No data migration. DOM serializes back to markers.

## Why not a plain merge
Main evolved its own `usePostEngagement.js` (`0c51792`→`9b2171e`: pure selectors in `postSelectors`, merge-aware `hydrate`, `handleDeletePost` moved in) plus `/post/:id` overlay routing that retires Feed's detail modal. Our batch contains a competing older hook. Overlap files: `Feed.jsx`, `api/_handlers/og.js`, `src/lib/openGraph.js`, `planning/CODE_AUDIT.md` (+`main.jsx` from landing work, out of scope here).

## Step 1 — wholesale-safe files from 7814817
Main never touched these since base `2aa49c3` — checkout directly:
- social-feed/components/CommentThread.jsx + .test.jsx
- social-feed/PostCard.jsx + PostCard.test.jsx
- news-publishing/ArticleEditor.jsx + articleEditor.test.jsx
- social-feed/postDisplay.jsx + postDisplay.test.jsx
- account/Profile.postcards.test.jsx
- social-feed/mediaLimits.js + mediaLimits.test.js
- sql/20260826_post_multi_image.sql

## Step 2 — Profile.jsx wiring swap (file taken wholesale, then adapt)
Take Profile.jsx from 7814817, then replace its `usePostEngagement({...})` destructuring block with main's API:
```js
const { hydrate, engagementProps, state } = usePostEngagement(<main's option shape — copy how main's Feed.jsx calls it>)
const cardProps = {
  ...engagementProps,
  user, navigate,
  authorName,                       // local fn over state.profiles (+ posted_as_*)
  myUsername, myAvatar,
  onGift: (p) => setGiftingPost({ postId: p.id, authorId: p.user_id }),
  onOpenDetail: setDetailPost,
}
```
Locals kept in component: `giftingPost/detailPost/editingPost,setEditingPost/confirmDeleteId,setConfirmDeleteId` (hook does NOT expose these except delete handler). After `loadMyPosts/loadSavedPosts` land, call `hydrate(...)` with their ids so counts/isSaved populate (mirror Feed's hydrate usage). Delete the branch-local `unlockedCreators` loader if `state.unlockedCreators` suffices; keep `isLockedPost` fallback otherwise.
Profile.postcards.test.jsx may need its supabase mock extended for hydrate's queries (Proxy mock already generic).

## Step 3 — Feed.jsx composer deltas onto MAIN's file (anchors verified)
Apply from batch commit (regions, not whole file):
1. import mediaLimits (after reposts.js import)
2. state: `imageFiles/imagePreviews` next to `const [imageFile…` (line ~135)
3. `handleImagesSelect/removeImageAt/clearAllImages` after `clearImage()` (~line 771)
4. video validation: replace 12MB toast block (~line 708) with MAX_VIDEO_BYTES + probeVideoDuration/validateVideoFile; help text ~line 1378 → `Up to {MAX_VIDEO_MB}MB · {MAX_VIDEO_SECONDS/60} minutes`
5. upload loop + `uploadedImageUrls` around existing single-image block; insert payload adds `...(uploadedImageUrls.length ? { image_urls: uploadedImageUrls } : {})` after `image_url: imageUrl,` (~line 849); success reset calls `clearAllImages()`
6. preview strip replaces `Selected photo preview` block (~1684); footer multi-picker at ~1705 (`Add photos` / `Add another (n/5)`)

## Step 4 — OG first-photo fallback (merge around canonical-link changes)
- `og.js` both post selects: add `image_urls` column
- `openGraph.js buildPostMeta`: `previewImage = Array.isArray(post.image_urls)&&post.image_urls[0] || post.image_url`

## Step 5 — CODE_AUDIT.md: append batch section from 7814817 (git show 7814817 -- planning/CODE_AUDIT.md tail).

## Verification gates (do not skip)
1. `npx vitest run` in apps/carefind — expect ≥553 passing + main's own suites green
2. `npm run build` clean
3. Migration ALREADY applied live & verified (post_multi_image_video_limits) — do NOT re-run
4. ff-merge `port/nine-issue-batch` → main; push main AND feature branch updates

## Phase 2 — inline contentEditable editing (after port lands)
Contract (agreed):
- TextBlock → uncontrolled `contentEditable` seeded once per external value change via key/effect guard; React never writes innerHTML while focused (caret stability)
- Bold/italic: `document.execCommand('bold'|'italic')`; colour: `hiliteColor` with palette hex
- NEW PURE FN in articleFormat.js: `htmlToArticleMarkers(html)` — inverse of renderArticleHtml restricted to emitted tags (`<p><strong><em><mark style=background>`); everything else flattened to text. Round-trip test law: `htmlToArticleMarkers(renderArticleHtml(x)) === x` for bold/italic/highlight/multi-para/newline cases (+tests)
- Paste intercepted to plain text only (blocks external HTML/XSS surface)
- onChange emits marker string upward; live-preview pane from phase 1 becomes redundant inside editor but STAYS for readOnly surfaces
- execCommand deprecation note: still universally supported; acceptable with paste-sanitiser isolating risk
