---
title: 'Fix Drawing auto-publish — one Post creates one post'
type: 'bugfix'
created: '2026-09-04'
status: 'done'
baseline_commit: '1402aa5b0f5750563e9d48c593824483b00bd9c7'
review_loop_iteration: 0
context:
  - 'apps/carefind/src/components/DrawingBoard.jsx'
  - 'apps/carefind/src/modules/social-feed/components/PostComposer.jsx'
  - 'apps/carefind/src/modules/social-feed/Feed.jsx'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Drawing produced ~50 unintended posts while user was still drawing — strokes/erases triggered publication before explicit Post, violating "one Post = one post" and polluting feed.

**Approach:** Guarantee Drawing stays draft until explicit user Post: strokes never call `supabase.from('posts').insert`; only `Post` button publishes exactly one post. Separate autosave/recovery (if any) from publication; audit draft→final→publish flow.

## Boundaries & Constraints

**Always:** Keep existing `DrawingBoard` UX (colors, sizes, Clear, Use this drawing); keep single-image pipeline (`imageFile` → `posts.image_url`); preserve feed behavior for non-drawing posts; keep `createSelector`/`BottomNav` create flow untouched.

**Ask First:** Adding persistent draft autosave (localStorage/IndexedDB) or image upload before Post; changing `posts` schema.

**Never:** Auto-create feed rows on stroke/move/touch events; allow autosave/recovery to insert into `posts`; create more than one row per Post tap (disable double-tap, idempotency guard).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Slow drawing | 3 min strokes, erases, redraws, no Post | 0 feed posts created; canvas only updates local state/imageFile | No network calls; no error |
| Single Post | Draw + Post once | Exactly 1 post with drawing image; preview uses same blob | Disable Post while `posting===true`; dedupe rapid double-click |
| With caption | Draw + caption + Post once | 1 post with content + image | Validate content/image presence as per postType |
| Autosave | Strokes with local autosave enabled (if added) | Autosave writes to separate draft store, not `posts` | Recovery restores canvas, never inserts feed row |
| Cancel | Draw then Cancel | No post; imageFile cleared | No side effects |

</frozen-after-approval>

## Code Map

- `apps/carefind/src/components/DrawingBoard.jsx:6-79` -- canvas draw lifecycle (`start`/`move`/`end`, `ctx.lineTo`), `save()` calls `canvas.toBlob→onSave(blob)` only on Use-this-drawing click; must never call `supabase` or `notify`; verify no `useEffect` auto-saves to `posts`.
- `apps/carefind/src/modules/social-feed/Feed.jsx:1924-1936` -- `DrawingBoard onSave` sets `imageFile`/`imagePreview` only, does not insert; `onCancel` clears; ensure no effect watches `imageFile` to auto-insert.
- `apps/carefind/src/modules/social-feed/components/PostComposer.jsx:185-284` -- `createPost` is single insertion `supabase.from('posts').insert(postData).single()` gated by `posting` flag; drawing image passed via `imageFile`; must not auto-trigger on `imageFile` change.
- `apps/carefind/src/modules/social-feed/createSelector.js:66-77` -- create tap vs selector rendered telemetry; not involved in publish gate but keep.
- `apps/carefind/src/components/BottomNav.jsx:18-32` -- handleCompose always shows selector first; ensure drawing entry via `showDraw` does not auto-post.

## Tasks & Acceptance

**Execution:**
- [x] `apps/carefind/src/components/DrawingBoard.jsx` -- verify no auto-publish paths: `start`/`move`/`end`/`clearCanvas` only mutate canvas ctx, never call `onSave` or `supabase`; `save()` is sole `onSave(blob)` caller on explicit click; add guard `saving` disables double-tap.
- [x] `apps/carefind/src/modules/social-feed/Feed.jsx` -- verify drawing `onSave` only sets `imageFile`/`imagePreview` + closes board, does not call `createPost`/`supabase`; add invariant comment and ensure no `useEffect` watches `imageFile` to publish.
- [x] `apps/carefind/src/modules/social-feed/components/PostComposer.jsx` -- verify `createPost` is only caller of `posts.insert`; keep `posting` guard, disable button while posting, ensure drawing image flow uses `imageFile` already set, no auto-trigger on `handleImageSelect`.
- [x] `apps/carefind/src/components/DrawingBoard.test.jsx` (new) + `apps/carefind/src/modules/social-feed/Feed.drawing.test.jsx` (new) -- tests: strokes without Post create 0 posts; one Post creates exactly 1; rapid double Post still 1; cancel creates 0; imageFile set without insertion.

**Acceptance Criteria:**
- Given user draws slowly for 3 minutes with erases/redraws and never presses Post, when inspecting `posts` feed, then 0 new posts exist
- Given user draws and presses Post once, when post appears in feed, then exactly 1 post exists with the drawing image and no duplicates on rapid double-tap
- Given user draws + adds caption and presses Post once, when checking feed, then 1 post with content + image exists
- Given drawing autosave draft exists (if feature present), when user reloads without Post, then draft restores canvas but 0 posts are created

## Spec Change Log

## Design Notes

No new tables/buckets. Draft stays in React state (`imageFile`/`imagePreview`) until `createPost`; autosave, if added later, must use separate store (`localStorage`/`indexedDB` draft key) never `posts`. Keep `posting` boolean as publish lock; `save()` in DrawingBoard uses `saving` to prevent double `onSave`.

## Verification

**Commands:**
- `npm test -- src/components/DrawingBoard.test.jsx src/modules/social-feed/Feed.drawing.test.jsx` -- expected: 0 posts on strokes, 1 on single Post, 1 on double-tap, 0 on cancel
- `npm test -- src/components/BottomNav.test.jsx` -- expected: still 4/4 (5 navs always)
- `npm run build` (apps/carefind) -- expected: vite build clean

## Suggested Review Order

**Publish gate — draft stays draft**

- Only `save()` calls `onSave`, strokes never publish
  [`DrawingBoard.jsx:72`](../../apps/carefind/src/components/DrawingBoard.jsx#L72)

- Drawing onSave only sets draft image, never inserts
  [`Feed.jsx:1927`](../../apps/carefind/src/modules/social-feed/Feed.jsx#L1927)

- Single insertion gated by `posting` flag
  [`PostComposer.jsx:200`](../../apps/carefind/src/modules/social-feed/components/PostComposer.jsx#L200)

**Tests and safety nets**

- Strokes without Post create 0, double-tap still 1
  [`DrawingBoard.test.jsx:1`](../../apps/carefind/src/components/DrawingBoard.test.jsx#L1)

- Draft → Post integration: 0 until Post, 1 on Post
  [`Feed.drawing.test.jsx:1`](../../apps/carefind/src/modules/social-feed/Feed.drawing.test.jsx#L1)
