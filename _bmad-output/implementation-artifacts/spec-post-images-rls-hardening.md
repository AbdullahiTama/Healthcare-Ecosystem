---
title: 'Harden post-images bucket to owner-scoped writes'
type: 'chore'
created: '2026-09-05'
status: 'done'
baseline_commit: '1549b259c15710e64b59a6d0b30d39767a7ee96d'
review_loop_iteration: 0
context:
  - 'apps/carefind/sql/20260826_post_multi_image.sql'
  - 'apps/carefind/src/modules/social-feed/Feed.jsx'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `post-images` bucket is `public` with `anon`+`authenticated` write (`storage.objects` `bucket_id='post-images'` `TO {anon,authenticated}`) — any anon can upload, no size/MIME limit, unlike `credentials` owner-scoped pattern.

**Approach:** Harden to owner-scoped `storage.foldername(name))[1]=auth.uid()` like `credentials`, keep `public read`, add `file_size_limit=5MB` + `allowed_mime_types {image/jpeg,image/png,image/webp}` and update client upload path to `<auth.uid()>/<ts>.jpg` + `contentType` explicit.

## Boundaries & Constraints

**Always:** Keep `public read` for `post-images`; keep `image_urls` jsonb + `image_url` mirror; keep `live-media` 100MB as is.

**Ask First:** Changing `post-images` from public to private with signed URLs.

**Never:** Break existing public reads; allow anon to write outside own folder; remove `image_url` mirror.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Owner upload | `auth.uid()=abc`, file `abc/123.jpg` 5MB jpeg | Upload succeeds, public URL returned | No error |
| Anon upload | No session, `bucket_id=post-images` | 42501 RLS denied | No upload |
| Wrong folder | `other-uid/123.jpg` with `auth.uid()=abc` | 42501 | No upload |
| Oversize | 6MB jpeg | 413 or storage limit error before RLS | Toast size error |
| Wrong MIME | `video/mp4` to `post-images` | 42501 or storage MIME error | Toast type error |
| Public read | `anon` GET `post-images/abc/123.jpg` | 200 public URL works | No auth needed |

</frozen-after-approval>

## Code Map

- `apps/carefind/sql/20260826_post_multi_image.sql:17` -- `update storage.buckets set file_size_limit=104857600 where id='live-media'` — `post-images` remains `null` limit + `null` MIME; must set `file_size_limit=5242880` + `allowed_mime_types`.
- `storage.objects` policies -- `post-images read: (bucket_id='post-images') TO {anon,authenticated}` SELECT (keep), `post-images write: TO {anon,authenticated} INSERT` (must replace with `(storage.foldername(name))[1]=auth.uid()::text` TO `authenticated` only).
- `apps/carefind/src/modules/social-feed/Feed.jsx:815` -- `supabase.storage.from('post-images').upload(path, resized, {contentType:'image/jpeg'})` with `path=${user.id}-${Date.now()}.jpg` (flat); must change to `${user.id}/${Date.now()}.jpg` (folder = uid for RLS) and keep `contentType`.
- `apps/carefind/src/modules/social-feed/components/PostComposer.jsx:190` -- same upload path; must align.
- `apps/carefind/src/modules/social-feed/hooks/usePostComposer.js:5` -- same.

## Tasks & Acceptance

**Execution:**
- [x] `apps/carefind/sql/20260906_post_images_rls_hardening.sql` (new) -- `update storage.buckets set public=true, file_size_limit=5242880, allowed_mime_types='{image/jpeg,image/png,image/webp}' where id='post-images'`; `drop policy` anon write, `create policy "post-images owner write" on storage.objects for insert to authenticated with check `(bucket_id='post-images' AND (storage.foldername(name))[1]=auth.uid()::text)`.
- [x] `apps/carefind/src/modules/social-feed/Feed.jsx` + `PostComposer.jsx` + `hooks/usePostComposer.js` -- change upload path from `${user.id}-${Date.now()}.jpg` flat to `${user.id}/${Date.now()}.jpg` (folder = uid), keep `contentType:'image/jpeg'` explicit, keep `resizeImage` and `image_urls` flow.
- [x] `apps/carefind/src/modules/social-feed/postDisplay.test.jsx` + `Feed.multiImage.test.jsx` -- verify path includes `user.id/` prefix and RLS mock denies anon.

**Acceptance Criteria:**
- Given owner uploads 1–5 images, when path is `auth.uid()/ts.jpg` and size ≤5MB jpeg, then upload succeeds and public URL works for anon read
- Given anon tries to upload to `post-images`, when no session, then 42501 denied
- Given owner tries `other-uid/ts.jpg`, when `auth.uid()` mismatch, then 42501 denied
- Given 6MB or `video/mp4` to `post-images`, when uploading, then storage limit/MIME error before RLS and post not created

## Spec Change Log

## Design Notes

Follow `credentials` pattern `storage.foldername(name))[1]=auth.uid()` (`sql/20260822_credentials_bucket_hardening.sql:11`). Keep `post-images` public read (no signed URL) like `live-media` bucket; only write becomes owner-scoped. Path change is load-bearing for RLS.

## Verification

**Commands:**
- `npm test -- src/modules/social-feed/Feed.multiImage.test.jsx` -- expected: upload path contains `user.id/`, anon denied
- `supabase advisors` security -- expected: no anon `storage.objects` INSERT for `post-images`
- `npm run build` (apps/carefind) -- expected: vite build clean
