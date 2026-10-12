# CareFind admin Phase 4a: Content (Posts, Stories, News, Promotions)

Date: 2026-10-12
Builds on: Phase 3 (`2026-10-12-carefind-admin-phase3-design.md`, PR #25).
Branch: `feat/carefind-admin-phase4`, based on the Phase 3 branch.
Phase 4b (Go live) is a separate spec and PR; it will reuse the upload helper built here.

## Goal

Move Posts, Stories, News and Promotions out of `legacy/LegacyTabHost.jsx` into redesigned
screens. Three existing problems are fixed as part of the move because they make the screens
dishonest: image uploads that silently fail, lists that show a failed load as empty, and the
Posts list that only searches the newest 50 posts.

## Scope and constraints

- No backend, SQL or auth change. Same `callAdminAuth` actions and payloads: `list_posts`,
  `delete_post`, `list_news`, `approve_news { id, edits }`, `reject_news { id }`,
  `delete_news { id }`, `create_story { title, body, imageUrl, bgColor }`, `delete_story { id }`,
  `create_promotion { title, linkUrl, imageUrl, days }`, `delete_promotion { id }`. Never a `token`.
- Browser uploads keep using the same Supabase storage client, the same buckets
  (`story-images`, `promo-images`) and the same path scheme (`story-<Date.now()>.<ext>`,
  `promo-<Date.now()>.<ext>`). Only the failure handling changes.
- No UI-only permission check presented as security. The server decides (Phase 1 finding 1).
  `AdminPanel`'s `isAllowed` gate covers all four tabs.
- A source that fails to load shows "Couldn't load, Retry", never an empty list or
  "No news submissions yet".
- `AdminShell` keeps `useAdminNews` for its session-expired toast; that hook is not removed.

## Units

| Unit | Responsibility |
|---|---|
| `lib/uploadMedia.js` | `uploadToBucket(bucket, file, prefix)` returns `{ ok: true, url }` or `{ ok: false, error }`. Same upload and `getPublicUrl` calls as the legacy code, but the error is returned, never ignored. A missing file returns `{ ok: true, url: null }`. Reused by Phase 4b. |
| `hooks/usePostsDirectory.js` | key `['admin','posts', params]`; `list_posts { search, type, dateFrom, dateTo, limit: 25+1, offset }`; `{ rows, hasNext, total }` with the head count of `posts` only when unfiltered; failure is an error. Search and type/date trimmed and `'all'` mapped as today. |
| `hooks/useContentLists.js` | `useStoriesList()`, `useNewsList()`, `usePromotionsList()`: same sources as the legacy hooks (`contentRepository.getStories`, `list_news`, `commerceRepository.getPromotions`) but a failed read is an error, not `[]`. `useNewsList` returns `{ items, phones }`. |
| `hooks/useNewsActions.js` | `approveNews({ id, headline, subtitle, body, edited })`, `rejectNews(id)`, `deleteNews(id)` -> `{ ok }` / `{ ok:false, error }`. Same audit and `recordAction` as the legacy handlers (approve and reject: audit + action history; delete: audit only). One refresh; no optimistic cache edit. |
| `hooks/useContentActions.js` | `createStory(values)`, `deleteStory(id)`, `createPromotion(values)`, `deletePromotion(id)`; uploads through `uploadToBucket` first and stops with the error when an upload fails. No audit (as legacy). |
| `sections/PostsSection.jsx` | `DirectoryTable`; filters: search, type pills, date range; page-level CSV export; drawer. |
| `sections/StoriesSection.jsx`, `PromotionsSection.jsx` | Create panel above a list with delete. |
| `sections/NewsSection.jsx` | `ReviewQueue` (Pending / All) with an editing drawer. |

Post deletion reuses `useReviewActions().deletePost(postId)` (Phase 2a). Removed from
`LegacyTabHost`: the four tabs' render lines, their state (`postSearch`, `postTypeFilter`,
`postDateFrom`, `postDateTo`, `selectedPost`, `postAuthor`, story/news/promo form state,
`savingStory`, `savingNews`, `savingPromo`, `editingNews`) and handlers (`viewPostDetails`,
`createStory`, `deleteStory`/`reallyDeleteStory`, `approveNews`, `rejectNews`,
`deleteNews`/`reallyDeleteNews`, `createPromotion`, `deletePromotion`/`reallyDeletePromotion`,
`deletePost`/`reallyDeletePost` once no tab uses them). With Posts gone, nothing in the legacy
host reads the moderation store, so its `ModerationProvider` wrapper is removed too, but only
after a grep confirms it. The old tabs are deleted once unreferenced. `useAdminStories`,
`useAdminPromotions` and `useAdminNews` in `hooks/queries.js` stay only if another consumer
remains (the shell uses `useAdminNews`).

## Per-screen behaviour

| Screen | Content | Behaviour |
|---|---|---|
| Posts | columns: excerpt, type, author id/time, views; filters: search over content, type pills, from/to dates | Server-side filtering and paging (25 per page, `limit + 1`). Unfiltered count shown only when unfiltered. Drawer: author profile (via `get_user_profile`, inline failure message), full content, images, video, audio, rating/theme when present; footer: Delete post (confirm, legacy wording). "Export this page (CSV)". Changing a filter resets to page 1. |
| Stories | create panel: title, body, background colour, optional image; list of stories | Create needs at least a title, body or image (as legacy). If the image upload fails, nothing is created and the error is shown. Delete confirms (legacy wording). |
| News | Pending / All; columns: headline, submitter, status, submitted | Drawer: edit headline, subtitle, body; Approve (sends only changed fields in `edits`, no confirmation as legacy), Reject (confirmation, new, like the other review queues), Delete (confirmation, legacy wording). Shows the submitter's phone when known. Failure keeps the drawer open with the error inline. |
| Promotions | create panel: title (required), link, days (default 7), optional image; list | Same upload rule as Stories. Delete confirms (legacy wording). |

## States

Loading skeleton / placeholders. Failed list: "Couldn't load, Retry" (never "No news submissions yet",
"No posts match", or an empty stories list). Empty: "No posts match these filters" /
"No posts yet", "Nothing pending" / "No news submissions yet", "No stories yet",
"No promotions yet". Create forms show their busy state and the specific upload or server
error; a failed create keeps the form values so nothing the admin typed is lost.

## Findings to document

56. Story, promotion, scheduled-show trailer and live-image uploads ignored a failed upload
    (`if (!upErr)`): the item was created without its image, or the live image was dropped,
    with no message. Stories and promotions fixed here; the live paths are fixed in Phase 4b.
57. Posts loaded the newest 50 posts and filtered them in the browser (same blind spot as Users).
    Fixed with `list_posts` server-side filters.
58. `useAdminNews` turned any non-auth error into an empty list; stories and promotions were
    defaulted to `[]` on failure. Now errors.
59. `list_news` ignores its query error and returns `[]`, and is capped at 60 rows; news
    submitter phone numbers come from verification requests. Documented, not changed.
60. Uploads go straight from the browser to storage buckets; the trust boundary is the bucket
    policies, not the admin API (Phase 1 finding 11). Documented.
61. The legacy news handlers edited the cache optimistically and called `invalidateAdmin()` twice;
    replaced by one refresh.

## Testing

- `uploadMedia`: success returns the public URL; an upload error returns `{ ok:false, error }`
  and never a URL; no file returns `{ ok:true, url:null }`; the bucket, path prefix and extension.
- `usePostsDirectory`: params sent, `limit + 1` and `hasNext`, failure is an error, unfiltered total.
- `useContentLists`: failure is an error (stories, news, promotions); `useNewsList` shape.
- `useNewsActions`, `useContentActions`: payloads, audit/history, upload failure stops creation
  without calling the create action, failure returns `{ ok:false, error }`, one refresh.
- Sections: loading, failed (never empty), empty, filter/paging, create forms (validation, upload
  failure keeps values and shows the error), confirmations, news edit and approve payload (`edits`),
  permission-hidden fallback; routing test extended for four tabs.
- Full suite, build and lint before the PR. Responsive widths cannot be measured without an admin
  session; the PR says so.

## Delivery

One commit per unit. `docs/ADMIN_REDESIGN.md` gets findings 56-61 and the phase table update. The PR
is a draft stacked on PR #25 with the responsive check stated as outstanding.
