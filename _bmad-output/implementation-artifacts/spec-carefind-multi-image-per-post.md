---
title: 'Allow up to 5 images per post with guard and carousel'
type: 'feature'
created: '2026-09-04'
status: 'done'
baseline_commit: '3507ab00c489b949269595589d48f0ba39d5aee7'
review_loop_iteration: 0
context:
  - 'apps/carefind/src/modules/social-feed/components/PostComposer.jsx'
  - 'apps/carefind/src/modules/social-feed/Feed.jsx'
  - 'apps/carefind/src/modules/social-feed/postDisplay.jsx'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Composer allows only one image; product requires 1–5 images per post with sixth-image guard and proper multi-image display, while preserving single-image experience.

**Approach:** Expand composer state to array (1–5 files), upload loop to `post-images` bucket, store `image_urls` JSON array (keep `image_url` as first-image mirror for legacy readers/crawler), guard sixth, and render via `imagesOf` with single-image layout vs 2–5 snap carousel.

## Boundaries & Constraints

**Always:** Use `mediaLimits.js:11` `MAX_POST_IMAGES=5` as single source; keep `posts.image_url` mirror + `image_urls jsonb DEFAULT '[]'` (`sql/20260826_post_multi_image.sql:15`); keep `post-images` public bucket; keep single-image not carousel when count==1; preserve existing `post_type` logic.

**Ask First:** Changing `image_urls` from jsonb to normalized `post_images` table; hardening `post-images` RLS to owner-scoped folder.

**Never:** Allow sixth image; store `blob:` URL in DB; show grid capped at 6 with square waste for single; bypass `MAX_POST_IMAGES` client check.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| 1 image | 1 file selected | Uploads 1, `image_url` = `image_urls[0]`, renders single `width:100%` image | No error |
| 2–5 images | 2,3,4,5 files | Uploads all, `image_urls` length matches, renders snap carousel with dots, `loading=lazy` | No error |
| 6th image | Already 5, try 6th | Prevented client-side toast “You can add up to 5 photos (5/5)”, input disabled, no upload | No DB write |
| Remove | Remove one of 5 | Count decrements, input re-enabled, preview updates, revokes URL | No leak |
| Mixed post | Text + 3 images | `content` + `image_urls[3]` stored, preview shows carousel | No error |
| Storage fail | One upload fails | Abort whole post, no partial orphan row, toast error | No post created |

</frozen-after-approval>

## Code Map

- `apps/carefind/src/modules/social-feed/mediaLimits.js:11` -- `MAX_POST_IMAGES=5` already exported but unused; must gate composer and upload.
- `apps/carefind/src/modules/social-feed/components/PostComposer.jsx:82-195,322-339` -- `imageFile`/`imagePreview` scalar, `handleImageSelect` single, `PostComposer.jsx:231` stores `image_url:imagePreview` blob (no upload); must become `imageFiles[]`/`imagePreviews[]`, `handleImagesSelect(FileList)` + `removeImageAt(idx)` + `clearAll`, input `multiple`, upload loop `resizeImage`→`post-images`→`getPublicUrl`, insert `image_urls` + mirror `image_url`.
- `apps/carefind/src/modules/social-feed/Feed.jsx:139-140,772-777,815-864` -- same scalar + `POST_FEED_COLS:78` only `image_url`; must array, `multiple`, upload loop, `POST_FEED_COLS` include `image_urls`, `INSERT` with both fields, handle `imageFile/imagePreview` revokes.
- `apps/carefind/src/modules/social-feed/postDisplay.jsx:108-117` -- `imagesOf(post)` already multi-aware (array → fallback `image_url`); keep, extend `PostTile` badge if needed.
- `apps/carefind/src/modules/social-feed/PostCard.jsx:508-521` -- `gallery=imagesOf(post)` currently `grid 1fr 1fr slice(0,6)` square; must branch: 1→single `width:100%`, 2–5→snap carousel `flex overflowX:auto scrollSnapType`, dots, `aspect 1/1`, `loading=lazy`, `aria-roledescription=carousel`.
- `apps/carefind/sql/20260826_post_multi_image.sql:15` -- `image_urls jsonb DEFAULT '[]'` already added; keep `image_url` mirror.

## Tasks & Acceptance

**Execution:**
- [x] `apps/carefind/src/modules/social-feed/mediaLimits.js` -- keep `MAX_POST_IMAGES=5`; ensure exported and used as gate (no hard-coded 5 elsewhere).
- [x] `apps/carefind/src/modules/social-feed/components/PostComposer.jsx` + `Feed.jsx` -- migrate `imageFile/imagePreview` scalar → `imageFiles[]/imagePreviews[]`; add `handleImagesSelect` (slice to `MAX - current`, toast on sixth, `multiple` input), `removeImageAt` (revoke URL), upload loop `for (f of imageFiles) { resized=await resizeImage(f,1400,0.85); upload to post-images getPublicUrl }` → `imageUrls`; on `supabase.from('posts').insert` include `image_urls: imageUrls` + `image_url: imageUrls[0]||null`; keep `image_url` mirror for legacy/crawler; abort on upload error without post.
- [x] `apps/carefind/src/modules/social-feed/Feed.jsx:78` -- extend `POST_FEED_COLS` + fallback to include `image_urls`.
- [x] `apps/carefind/src/modules/social-feed/PostCard.jsx` -- replace `grid slice(0,6)` with 1→single image, 2–5→snap carousel (`display:flex overflowX:auto scrollSnapType:x mandatory`, `minWidth:100% aspectRatio:1/1`, dots, `loading=lazy`, `role=region aria-roledescription=carousel`), keep `imagesOf` adapter.
- [x] `apps/carefind/src/modules/social-feed/postDisplay.test.jsx` + `Feed.multiImage.test.jsx` (new) -- tests: `imagesOf` ordering/fallback, `MAX_POST_IMAGES===5`, sixth guard (no upload when 5), carousel renders dots for 3, single renders not carousel, `image_urls` stored correctly.

**Acceptance Criteria:**
- Given 1 image selected, when posted, then `image_url` and `image_urls[0]` match and single image layout shown
- Given 2–5 images (test each count), when posted, then all stored in `image_urls` and carousel with correct count and dots shown
- Given 5 images already, when trying sixth, then prevented with message and no upload, input disabled until removal
- Given 3 images + text, when viewing post, then content + 3-image carousel shown, all retrievable after reload

## Spec Change Log

## Design Notes

Keep `image_url` as first-image mirror (`image_urls->>0`) for `openGraph.js:224` and legacy readers; new readers use `imagesOf`. Upload loop sequential for memory; abort on any storage error to avoid orphan partial post.

## Verification

**Commands:**
- `npm test -- src/modules/social-feed/postDisplay.test.jsx src/modules/social-feed/Feed.multiImage.test.jsx` -- expected: imagesOf, MAX 5, sixth guard, carousel vs single, image_urls storage
- `npm run build` (apps/carefind) -- expected: vite build clean

## Suggested Review Order

**State — single source `MAX_POST_IMAGES=5`**

- Gate kept as `mediaLimits.js:11` single source
  [`mediaLimits.js:11`](../../apps/carefind/src/modules/social-feed/mediaLimits.js#L11)

**Composer — array migration and sixth guard**

- `imageFiles[]` + `handleImagesSelect` slice + `multiple` + toast (5/5) + `removeImageAt`
  [`PostComposer.jsx:82`](../../apps/carefind/src/modules/social-feed/components/PostComposer.jsx#L82)

- Same array + `multiple` + sixth guard in Feed + `POST_FEED_COLS` includes `image_urls`
  [`Feed.jsx:139`](../../apps/carefind/src/modules/social-feed/Feed.jsx#L139)

- Upload loop `resizeImage`→`post-images`→`image_urls` + mirror `image_url`, abort on fail
  [`Feed.jsx:815`](../../apps/carefind/src/modules/social-feed/Feed.jsx#L815)

**Display — single vs carousel**

- `imagesOf` adapter already multi-aware
  [`postDisplay.jsx:108`](../../apps/carefind/src/modules/social-feed/postDisplay.jsx#L108)

- `PostCard` 1→single `width:100%`, 2–5→snap carousel with dots, `loading=lazy`
  [`PostCard.jsx:508`](../../apps/carefind/src/modules/social-feed/PostCard.jsx#L508)

**Tests**

- `imagesOf`, `MAX 5`, sixth guard, carousel dots, `image_urls` mirror
  [`Feed.multiImage.test.jsx:1`](../../apps/carefind/src/modules/social-feed/Feed.multiImage.test.jsx#L1)
