# CareFind admin Phase 4a (Content: Posts, Stories, News, Promotions) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move Posts, Stories, News and Promotions out of `LegacyTabHost` into redesigned screens, fixing three dishonest behaviours on the way: image uploads that fail silently, lists that show a failed load as empty, and the Posts list that only searches the newest 50 posts.

**Architecture:** `lib/uploadMedia.js` returns upload errors instead of ignoring them. Read hooks surface failures as errors. Action hooks hold the moved handlers with the same payloads. Four sections are built on the shipped `DirectoryTable`, `ReviewQueue`, `ReviewDrawer` and `DataTable`.

**Tech Stack:** React, @tanstack/react-query v5, vitest + Testing Library (jsdom), `@care-ecosystem/design-system/components/ui`.

**Spec:** `docs/superpowers/specs/2026-10-12-carefind-admin-phase4a-design.md`

## Global Constraints

- All paths are relative to the worktree root. `ADM` = `apps/carefind/src/modules/admin/`. Run tests from `apps/carefind`: `npx vitest run <path>`. Branch `feat/carefind-admin-phase4` (based on `feat/carefind-admin-phase3`).
- One commit per task unless the task says otherwise, staged and committed in one command with explicit paths: `git add <paths> && git commit -m "..." -- <paths>` (if PowerShell quoting breaks the message, use a message file with `-F`). Messages end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- No backend/SQL/auth change (nothing under `apps/carefind/api`); `packages/design-system` and the shared `ADM/ui/ReviewQueue.jsx`, `ReviewDrawer.jsx`, `DirectoryTable.jsx` are not modified. Never send a `token` field.
- **Payloads unchanged** (read the legacy handlers in `ADM/legacy/LegacyTabHost.jsx` ~lines 291-470 and `ADM/tabs/*.jsx` before writing): `list_posts { search, type, dateFrom, dateTo, limit, offset }`, `delete_post { id }`, `list_news`, `approve_news { id, edits }` (**`edits` is `{ headline, subtitle, body }` when the admin edited the item, else `{}`**, exactly as legacy — the spec's wording "only changed fields" is superseded by "same payloads"), `reject_news { id }`, `delete_news { id }`, `create_story { title, body, imageUrl, bgColor }`, `delete_story { id }`, `create_promotion { title, linkUrl, imageUrl, days }`, `delete_promotion { id }`.
- Browser uploads keep the same Supabase storage client (`supabase` from `apps/carefind/src/config/supabaseClient.js`), buckets (`story-images`, `promo-images`) and path scheme (`story-<Date.now()>.<ext>`, `promo-<Date.now()>.<ext>`, `ext = file.name.split('.').pop()`); only the failure handling changes.
- No UI-only permission check presented as security; `AdminPanel`'s `isAllowed` gate must cover all four tabs.
- A list that fails to load shows "Couldn't load" with Retry; never an empty list or an "empty" message. A failed create keeps what the admin typed.
- `AdminShell` uses `useAdminNews` (from `hooks/queries.js`) for the session-expired toast: that hook stays.
- The shared `Modal` card has `role="button"` (known defect, Phase 2a finding 21): tests use exact role names and `within(screen.getByRole('dialog'))`.
- Test plumbing lessons: `createWrapper` is NOT exported by `src/test/renderWithQueryClient.jsx` (use a local `QueryClientProvider` with `new QueryClient({ defaultOptions: { queries: { retry: false } } })` created ONCE per test in a `makeWrapper()` factory); do not return a mock from a `beforeEach` arrow; fake timers only where a timer/debounce is exercised, restored afterwards; section tests mock `../provider/AdminProvider.jsx` with `useAdmin: () => ({ askConfirm, showToast, invalidateAdmin, recordAction, confirming: false, ... })`.
- ESLint has no React plugin: check every JSX component is imported; run `npm run lint` (0 errors). The full suite takes 10+ minutes: during tasks run only `npx vitest run src/modules/admin`.

## Review Focus

- A failed image upload never creates a story/promotion without its image and never loses what the admin typed (Tasks 1, 5, 7, 8).
- A failed read of posts/stories/news/promotions is never an empty-state message (Tasks 2, 3, 6-9).
- `approve_news` sends `{ id, edits }` exactly as legacy; Reject and Delete ask for confirmation; failures stay in the drawer (Tasks 4, 9).
- Posts search/type/date are server-side with `limit + 1` paging and page reset (Tasks 2, 6).
- Nothing dangling in `LegacyTabHost` after removal; `ModerationProvider` only removed if truly unused (Task 10).

---

### Task 1: uploadMedia

**Files:**
- Create: `ADM/lib/uploadMedia.js`, `ADM/lib/uploadMedia.test.js`

**Interfaces:**
- Produces: `uploadToBucket(bucket, file, prefix)` -> `Promise<{ ok: true, url: string | null } | { ok: false, error: string }>`. With no `file` it resolves `{ ok: true, url: null }` without touching storage. Otherwise it uploads `file` to `bucket` at path `${prefix}-${Date.now()}.${ext}` (`ext = file.name.split('.').pop()`) with `supabase.storage.from(bucket).upload(path, file)` (no extra options), returns `{ ok:false, error: uploadError.message }` if that returns an error (or the call throws), else `{ ok:true, url: getPublicUrl(path).data.publicUrl }`.

- [ ] **Step 1: Failing test** (mock the client module):

```js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const storage = vi.hoisted(() => ({ upload: vi.fn(), getPublicUrl: vi.fn(), from: vi.fn() }))
vi.mock('../../../config/supabaseClient.js', () => ({ supabase: { storage: { from: storage.from } } }))

import { uploadToBucket } from './uploadMedia'

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-12T10:00:00Z'))
  storage.upload.mockReset().mockResolvedValue({ error: null })
  storage.getPublicUrl.mockReset().mockReturnValue({ data: { publicUrl: 'https://cdn.example/story-1.png' } })
  storage.from.mockReset().mockReturnValue({ upload: storage.upload, getPublicUrl: storage.getPublicUrl })
})
afterEach(() => { vi.useRealTimers() })

const file = (name = 'pic.png') => ({ name, type: 'image/png' })

describe('uploadToBucket', () => {
  it('resolves ok with a null url and touches nothing when there is no file', async () => {
    expect(await uploadToBucket('story-images', null, 'story')).toEqual({ ok: true, url: null })
    expect(storage.from).not.toHaveBeenCalled()
  })

  it('uploads to the bucket at prefix-timestamp.ext and returns the public url', async () => {
    const f = file('holiday.photo.JPG')
    const out = await uploadToBucket('story-images', f, 'story')
    expect(storage.from).toHaveBeenCalledWith('story-images')
    const ts = new Date('2026-10-12T10:00:00Z').getTime()
    expect(storage.upload).toHaveBeenCalledWith(`story-${ts}.JPG`, f)
    expect(storage.getPublicUrl).toHaveBeenCalledWith(`story-${ts}.JPG`)
    expect(out).toEqual({ ok: true, url: 'https://cdn.example/story-1.png' })
  })

  it('returns the upload error and never a url when the upload fails', async () => {
    storage.upload.mockResolvedValue({ error: { message: 'Bucket policy denied' } })
    const out = await uploadToBucket('promo-images', file(), 'promo')
    expect(out).toEqual({ ok: false, error: 'Bucket policy denied' })
    expect(storage.getPublicUrl).not.toHaveBeenCalled()
  })

  it('returns an error when the storage call throws', async () => {
    storage.upload.mockRejectedValue(new Error('network down'))
    expect(await uploadToBucket('promo-images', file(), 'promo')).toEqual({ ok: false, error: 'network down' })
  })
})
```

- [ ] **Step 2: Run, expect FAIL** (module missing). **Step 3: Implement**

```js
import { supabase } from '../../../config/supabaseClient.js'

// One browser upload to a storage bucket. The legacy screens ignored a failed
// upload and created the story/promotion without its image; this returns the
// error so the caller can stop and tell the admin. Same client, bucket and path
// scheme as before: only the failure handling differs.
export async function uploadToBucket(bucket, file, prefix) {
  if (!file) return { ok: true, url: null }
  try {
    const ext = file.name.split('.').pop()
    const path = `${prefix}-${Date.now()}.${ext}`
    const { error } = await supabase.storage.from(bucket).upload(path, file)
    if (error) return { ok: false, error: error.message }
    const { data } = supabase.storage.from(bucket).getPublicUrl(path)
    return { ok: true, url: data.publicUrl }
  } catch (err) {
    return { ok: false, error: err.message }
  }
}
```

- [ ] **Step 4: Run, expect PASS (4 tests).** Commit `feat(carefind): uploadToBucket returns upload failures instead of ignoring them`.

---

### Task 2: usePostsDirectory

**Files:**
- Create: `ADM/hooks/usePostsDirectory.js`, `ADM/hooks/usePostsDirectory.test.jsx`

**Interfaces:**
- Consumes: `callAdminAuth` (`../adminApi`), `adminTransport` (`../repositories/transport`).
- Produces: `POSTS_PAGE_SIZE = 25`; `usePostsDirectory({ search, type, dateFrom, dateTo, page })` -> react-query result, key `['admin','posts', cleaned]`, `data = { rows, hasNext, total }`. Calls `callAdminAuth('list_posts', { search, type, dateFrom, dateTo, limit: 26, offset: page * 25 })` with `search` trimmed (`''` = none), `type` as given (`'all'` = none; the server ignores `'all'`), dates as given. `rows` is the first 25, `hasNext` is `length > 25`; a response without a list is an error; `total` = `adminTransport.query('posts', { select: 'id', count: 'head' }).count` only when no filter is active (`!search && type === 'all' && !dateFrom && !dateTo`), run in parallel with the list and never failing it, else `null`. `placeholderData: prev => prev`. Mirror `ADM/hooks/useUsersDirectory.js` (read it and its test first).

- [ ] **Step 1: Failing test.** Mirror `useUsersDirectory.test.jsx` with these cases (write them in full): params sent (`list_posts` with `{ search, type, dateFrom, dateTo, limit: 26, offset: 50 }` for page 2); a whitespace-only search is sent as `''` and treated as no filter (total loads); `hasNext` true only with the extra row and the extra row trimmed; short page `hasNext` false; total only when unfiltered; failed list is an error (`data` undefined); failed count does not fail the list (`total` null); response without a list is an error.
- [ ] **Step 2: FAIL. Step 3: implement. Step 4: PASS.** Commit `feat(carefind): usePostsDirectory, server-side search and paging for posts`.

---

### Task 3: useContentLists

**Files:**
- Create: `ADM/hooks/useContentLists.js`, `ADM/hooks/useContentLists.test.jsx`

**Interfaces:**
- Produces: `useStoriesList()` key `['admin','content','stories']`, data `Array` from `contentRepository.getStories()`; `useNewsList()` key `['admin','content','news']`, data `{ items, phones }` from `callAdminAuth('list_news')` (`items = r.data`, `phones = r.phones || {}`; a non-array `r.data` is an error); `usePromotionsList()` key `['admin','content','promotions']`, data `Array` from `commerceRepository.getPromotions()`. In all three a failure REJECTS (no catch that turns it into `[]`); a non-array result is an error. Read the legacy `useAdminStories`/`useAdminNews`/`useAdminPromotions` in `src/hooks/queries.js` (~lines 988-1032) and the two repositories first: the new hooks read the same sources (`contentRepository.getStories`, `commerceRepository.getPromotions`; both call `transport.query` and return `data`).

- [ ] **Step 1: Failing test.** Mock `../repositories/contentRepository`, `../repositories/commerceRepository`, `../adminApi`. Cases: each hook returns its data; each rejects (isError, `data` undefined) when its source throws; `useNewsList` returns `{ items, phones }` with `phones` defaulting to `{}`; a non-array `data` is an error for all three; `useNewsList` calls `list_news` with no `token`.
- [ ] **Step 2: FAIL. Step 3: implement (lazy `import()` is NOT needed; import the repositories at the top). Step 4: PASS.** Commit `feat(carefind): content list hooks that surface failures instead of an empty list`.

---

### Task 4: useNewsActions

**Files:**
- Create: `ADM/hooks/useNewsActions.js`, `ADM/hooks/useNewsActions.test.jsx`

**Interfaces:**
- Consumes: `useAdmin()` -> `showToast`, `invalidateAdmin`, `recordAction`; `callAdminAuth`; `bestEffort` from `../lib/bestEffort` (read it; used by the Phase 3 hooks to keep refresh/toast side effects from turning a committed success into a failure).
- Produces: `useNewsActions()` -> `{ busyId, approveNews({ id, headline, subtitle, body, edited }), rejectNews(id), deleteNews(id) }`, each resolving `{ ok:true }` or `{ ok:false, error }`. Only the server call is inside the `try`.
  - `approveNews`: `callAdminAuth('approve_news', { id, edits: edited ? { headline, subtitle, body } : {} })`; success: audit `('approve','news', id, { headline })` (non-blocking, via `log_audit_action { auditAction, targetType, targetId, metadata }`), `recordAction({ action:'approve', target:'news', id, timestamp })`, one `invalidateAdmin()`, toast `'News item approved'` (success).
  - `rejectNews`: `reject_news { id }`; audit `('reject','news', id, {})`, `recordAction({ action:'reject', target:'news', id, timestamp })`, refresh, toast `'News item rejected'`.
  - `deleteNews`: `delete_news { id }`; audit `('delete','news', id, {})` (no `recordAction`, as legacy), refresh, toast `'News item deleted'`.
  - Failures: no toast, no refresh, resolve `{ ok:false, error }`. `busyId` is the id being acted on, cleared in `finally`. No optimistic cache edit.

- [ ] **Step 1: Failing test** (write in full, in the style of `useUserActions.test.jsx`): payloads exactly (approve with `edited: true` sends `edits: { headline, subtitle, body }`; with `edited: false` sends `edits: {}`); audit and `recordAction` per action (and `recordAction` NOT called for delete); exactly ONE `invalidateAdmin` per success (the legacy code called it twice); failure -> `{ ok:false, error }`, no toast, no refresh; an audit failure does not fail the action; a throwing `invalidateAdmin` after success still resolves `{ ok:true }`; `busyId` lifecycle with a deferred promise.
- [ ] **Step 2: FAIL. Step 3: implement. Step 4: PASS.** Commit `feat(carefind): useNewsActions, the news handlers moved out of LegacyTabHost`.

---

### Task 5: useContentActions

**Files:**
- Create: `ADM/hooks/useContentActions.js`, `ADM/hooks/useContentActions.test.jsx`

**Interfaces:**
- Consumes: `uploadToBucket` (Task 1); `useAdmin()` -> `showToast`, `invalidateAdmin`; `callAdminAuth`; `bestEffort`.
- Produces: `useContentActions()` -> `{ busy, createStory({ title, body, bgColor, imageFile }), deleteStory(id), createPromotion({ title, linkUrl, days, imageFile }), deletePromotion(id) }`, each resolving `{ ok:true }` or `{ ok:false, error }`.
  - `createStory`: trims `title` and `body`; if title, body and imageFile are all empty resolve `{ ok:false, error:'Add a title, a message or an image' }` without any call; `uploadToBucket('story-images', imageFile, 'story')`; if `!ok` resolve `{ ok:false, error: \`Couldn't upload the image: ${error}\` }` and make NO `create_story` call; else `callAdminAuth('create_story', { title: title || null, body: body || null, imageUrl: url, bgColor })`; success: refresh once, toast `'Story published'`.
  - `deleteStory(id)`: `delete_story { id }`; success refresh, toast `'Story deleted'`.
  - `createPromotion`: a blank trimmed title resolves `{ ok:false, error:'Add a title' }` without any call; upload to `promo-images` with prefix `promo` (same stop-on-failure rule); `create_promotion { title, linkUrl: linkUrl.trim() || null, imageUrl: url, days }` (`days` passed through unchanged as the string); success refresh, toast `'Promotion created'`.
  - `deletePromotion(id)`: `delete_promotion { id }`; refresh, toast `'Promotion deleted'`.
  - Failure: no toast, no refresh. `busy` is true while a create/delete runs, cleared in `finally`. Only the server call is inside the `try`; refresh/toast via `bestEffort`.

- [ ] **Step 1: Failing test** (write in full; mock `../lib/uploadMedia`, `../adminApi`, `../provider/AdminProvider.jsx`): the empty-story and blank-promotion guards make no calls; a failed upload resolves the prefixed error and **never calls `create_story`/`create_promotion`** (assert the action name is not in `callAdminAuth.mock.calls`); a story with no image calls `create_story` with `imageUrl: null` and `title: null` for a blank title; payloads exactly as above (`days: '7'`, `linkUrl: null` for blank); delete payloads; one refresh per success; failure of the server call -> `{ ok:false, error }` with no toast; `busy` lifecycle.
- [ ] **Step 2: FAIL. Step 3: implement. Step 4: PASS.** Commit `feat(carefind): useContentActions, story and promotion handlers with honest upload failures`.

---

### Task 6: PostsSection

**Files:**
- Create: `ADM/sections/PostsSection.jsx`, `ADM/sections/PostsSection.test.jsx`

**Interfaces:**
- Consumes: `usePostsDirectory`, `POSTS_PAGE_SIZE`; `useReviewActions().deletePost(postId)` (`ADM/hooks/useReviewActions.js`, resolves `{ ok }` / `{ ok:false, error }`); `DirectoryTable` (read `ADM/ui/DirectoryTable.jsx` and `ADM/sections/UsersSection.jsx` + `.test.jsx` first: props, the `update()` page-reset pattern, debounced inputs applied only when the debounced value equals the box text, `filtersActive` including the applied search, `plural` prop); `useDebounced`; `FilterPills` (with `label`), `DateRange`, `exportCSV`, `timeAgo` from `../ui`; `useAdmin().askConfirm`; `useQuery` + `callAdminAuth('get_user_profile', { userId })` for the author.
- Produces: `<PostsSection />`.

Behaviour: title "Posts", `noun="post"`. State `{ search, type: 'all', dateFrom: '', dateTo: '', page: 0 }`; every change resets `page` to 0; `filtersActive = !!(search || type !== 'all' || dateFrom || dateTo)`; Clear filters resets everything. Filters: `FilterPills` (label "Post type") over `all, text, question, review, article, visual, premium`, `DateRange` (read `ui/FilterPills.jsx` for its props). Columns: Post (excerpt of `content`, 100 chars, with `…`), Type, Author (the `user_id` first 8 characters, or '—'), Views (`view_count ?? 0`... **show '—' when null**, never a made-up 0), Posted (`timeAgo`). `rowLabel` = the excerpt (or 'Post'). Toolbar "Export this page (CSV)" (disabled with no rows) -> `exportCSV(rows, 'posts_page.csv')`. Drawer: `title` = the post type label; body: the author block (via `useQuery(['admin','post-author', userId], …)`, enabled only while the drawer is open; the response must be `{ data }` with an object; failure shows "Couldn't load the author" inline, never "Unknown user"; no `user_id` shows "No author recorded"), full content (`white-space: pre-wrap`), images from `image_urls` (filtered, else `image_url`), video (`<video controls>` with `aria-label`), audio (`<audio controls>`), and rating/theme/subscriber-only badges when present; footer: "Delete post" -> `askConfirm({ title: 'Delete this post?', consequence: 'This permanently deletes the post along with its likes and comments. This cannot be undone.', confirmLabel: 'Delete', action })`; the action calls `deletePost(p.id)`: `{ ok:true }` -> `close()`; `{ ok:false, error }` -> `setError(error)`.

- [ ] **Step 1: Failing test** (`renderWithQueryClient` or a local `makeWrapper`; mock `../hooks/usePostsDirectory` (keep `POSTS_PAGE_SIZE` via importActual; record params), `../hooks/useReviewActions`, `../adminApi`, `../provider/AdminProvider.jsx`). Cases (write in full): one h1; rows with excerpt/type/views ('—' for a null view count); typing in search (fake timers, 300 ms) and each pill/date change change the hook params and reset `page` to 0 after paging; failed list -> Retry and not "No posts match"; empty filtered -> "No posts match these filters" + Clear filters; Export disabled with no rows and called with `(rows, 'posts_page.csv')`; drawer shows full content, images, and the author (`get_user_profile` called with `{ userId }`); a failing author request shows "Couldn't load the author" and not "Unknown user"; Delete post asks `askConfirm` with the exact consequence text and `deletePost` runs only when the confirm action runs, called with the post id; failure keeps the drawer open with the inline error; success closes it.
- [ ] **Step 2: FAIL. Step 3: implement. Step 4: PASS.** Commit `feat(carefind): Posts section with server-side search, paging and a detail drawer`.

---

### Task 7: StoriesSection

**Files:**
- Create: `ADM/sections/StoriesSection.jsx`, `ADM/sections/StoriesSection.test.jsx`

**Interfaces:**
- Consumes: `useStoriesList`, `useContentActions`, `useAdmin().askConfirm`, shared `Input`, `Textarea`, `Button`, `Empty`, `DataTable` or a simple list; `timeAgo`. Read `ADM/tabs/StoriesTab.jsx` for the legacy fields and wording (do not edit it).
- Produces: `<StoriesSection />`.

Behaviour: h1 "Stories", subtitle "Manage stories that appear at the top of the feed". Create panel "Post a Story" (note "Stories auto-expire after 24 hours"): `Input` "Story Title", `Textarea` "Story Message", background colour presets (exactly the legacy six: Teal `var(--color-primary)`, Dark Teal `var(--color-navy)`, Purple `var(--color-purple)`, Rose `var(--color-danger)`, Orange `var(--color-warning)`, Blue `var(--color-info)`; default Teal; buttons with `aria-pressed` and `aria-label` = the colour name), image file input (with a preview as legacy). "Publish story" is disabled until a trimmed title, a trimmed message or an image is present. On submit call `createStory({ title, body, bgColor, imageFile })`: `{ ok:true }` -> clear the form; `{ ok:false, error }` -> show the error in a `role="alert"` above the button and KEEP every field and the chosen file. The list: each story shows title, body excerpt, image thumbnail when present, `timeAgo(created_at)` and a Delete button -> `askConfirm({ title: 'Delete this story?', consequence: 'This permanently removes the story from the feed. This cannot be undone.', confirmLabel: 'Delete', action })` -> `deleteStory(id)` (a failure shows an inline `role="alert"` on that story, not a toast the hook never sends). States: loading placeholder; failed list -> "Couldn't load stories" + Retry (never the empty text); empty -> "No stories yet".

- [ ] **Step 1: Failing test** (mock `../hooks/useContentLists`, `../hooks/useContentActions`, `../provider/AdminProvider.jsx`; local `makeWrapper` only if needed). Cases (write in full): h1 and panel; Publish disabled until content; the six colour presets and the default; a successful create calls `createStory` with `{ title, body, bgColor, imageFile }` (trimmed values) and clears the form; a failed create shows the error, keeps the fields and the file, does not clear; busy state disables the button; list shows stories; delete asks confirmation (legacy text) and calls `deleteStory` only after the confirm action; delete failure shows an inline alert; failed list -> Retry and not "No stories yet"; empty -> "No stories yet".
- [ ] **Step 2: FAIL. Step 3: implement. Step 4: PASS.** Commit `feat(carefind): Stories section with a create panel that reports upload failures`.

---

### Task 8: PromotionsSection

**Files:**
- Create: `ADM/sections/PromotionsSection.jsx`, `ADM/sections/PromotionsSection.test.jsx`

Same shape as Task 7 (read `ADM/sections/StoriesSection.jsx` once it exists, and `ADM/tabs/PromotionsTab.jsx`). Behaviour: h1 "Promotions", subtitle "Manage featured promotions in the MedMarket strip". Create panel "Add a Promotion" (note "Promotions appear in the moving featured strip and auto-expire"): `Input` "Promotion Title" (required), `Input` "Link URL" (helper "Where users go when they tap the promotion"), `Select` "Duration" with exactly the legacy options 3/7/14/30/90 days (default `'7'`, the value passed as the STRING), image file input. "Add promotion" disabled until a trimmed title is present. Submit -> `createPromotion({ title, linkUrl, days, imageFile })`; `{ ok:false, error }` -> inline `role="alert"`, keep every field and the file. List: title, link (as text; shown as a link only when it is an `http(s)` URL, opened with `rel="noreferrer"`), image thumbnail, `timeAgo(created_at)`, expiry if the row has `expires_at` (read the legacy tab for the exact fields), Delete -> `askConfirm({ title: 'Delete this promotion?', consequence: 'This permanently removes the promotion from the app. This cannot be undone.', confirmLabel: 'Delete', action })` -> `deletePromotion(id)`. States: failed list -> "Couldn't load promotions" + Retry; empty -> "No promotions yet".

- [ ] **Step 1: Failing test.** Same case list as Task 7 adapted (title required, the five duration options and default `'7'`, `days` passed as the string `'7'`, `linkUrl` blank sent through as given for the hook to null; an upload failure keeps the fields; a `javascript:` link is shown as text only, never as an `href`; delete confirmation text; failed list vs empty).
- [ ] **Step 2: FAIL. Step 3: implement. Step 4: PASS.** Commit `feat(carefind): Promotions section with a create panel that reports upload failures`.

---

### Task 9: NewsSection

**Files:**
- Create: `ADM/sections/NewsSection.jsx`, `ADM/sections/NewsSection.test.jsx`

**Interfaces:**
- Consumes: `useNewsList` (`data = { items, phones }`), `useNewsActions`, `useAdmin().askConfirm`; `ReviewQueue` (read `ADM/ui/ReviewQueue.jsx` and `ADM/sections/ClaimsSection.jsx`/`WithdrawalsSection.jsx`: props `title, source, onRetry, columns, isOpen, cap, nothingWaiting, noneYet, drawerTitle, renderDrawer, toolbar`; `source` is `{ status:'ok', data } | { status:'error' } | undefined`); `Input`, `Textarea`, `Button`, `StatusBadge`; `timeAgo`. Read `ADM/tabs/NewsTab.jsx` for the legacy fields: headline, subtitle, body, `status`, `profiles.full_name || display_name`, `created_at`, `contact_phone`, `contact_email`, `hero_image_url`, and the `phones[author_id]` fallback.
- Produces: `<NewsSection />`.

Behaviour: title "News", `isOpen = n => n.status === 'pending'`, `cap={60}` (the server returns at most 60), `nothingWaiting="Nothing pending"`, `noneYet="No news submissions yet"`. `source` is built from `useNewsList()`: loading -> `undefined`; error -> `{ status:'error' }`; ok -> `{ status:'ok', data: items }`. Columns: Headline, Submitted by, Status (`StatusBadge`), Submitted (`timeAgo`, sortable via `sortValue`). Drawer (`drawerTitle` = headline): hero image when present, the body text (the legacy list stripped `{}[]"` characters from a preview: show the full body as plain text `white-space: pre-wrap`), contact block when any of `contact_phone`/`contact_email`/`phones[author_id]` exists (phone via a `tel:` link, email via `mailto:`), and, for a `pending` item, an edit mode: an "Edit" button reveals inputs Headline (required), Subtitle, Body with the current values; the footer for a pending item: Approve (calls `approveNews({ id, headline, subtitle, body, edited })` with the edited values when the admin edited, else the item's values with `edited: false`), Reject (`askConfirm({ title: 'Reject this news item?', consequence: 'The item is marked as rejected and is not published.', confirmLabel: 'Reject', action })`, then `rejectNews(id)`), Delete for any status (`askConfirm({ title: 'Permanently delete this news item?', consequence: 'This permanently removes the news item from the app. This cannot be undone.', confirmLabel: 'Delete', action })`, then `deleteNews(id)`). Approve is disabled while the edited headline is blank. Results: `{ ok:true }` -> `close()`; `{ ok:false, error }` -> `setError(error)` and the drawer stays open. Before writing the Reject consequence text, read the `reject_news` and `approve_news` handlers in `apps/carefind/api/_handlers/admin-auth.js` and say ONLY what they do; correct the text if it is not true and record what you found.

- [ ] **Step 1: Failing test** (mock `../hooks/useContentLists` (settable result `{ data, isLoading, refetch }`), `../hooks/useNewsActions`, `../provider/AdminProvider.jsx`). Cases (write in full): pending items by default and All shows approved/rejected; columns and status badge; the contact block shows `contact_phone`, falls back to `phones[author_id]`, `tel:`/`mailto:` links; Approve without edits sends `{ id, headline, subtitle, body, edited: false }` (the hook sends `edits: {}`); editing then Approve sends the edited values with `edited: true`; Approve disabled with a blank headline; Reject and Delete ask `askConfirm` with their texts and the action runs only after confirmation; failure keeps the drawer open with the inline error; success closes it; decided items have no Approve/Reject but keep Delete; failed list -> Retry and not "No news submissions yet"; loading shows neither.
- [ ] **Step 2: FAIL. Step 3: implement. Step 4: PASS.** Commit `feat(carefind): News section with an editing drawer and confirmed reject and delete`.

---

### Task 10: Wire the sections and retire the legacy code

**Files:**
- Modify: `ADM/AdminPanel.jsx`, `ADM/legacy/LegacyTabHost.jsx`, `ADM/AdminPanel.sections.test.jsx`
- Delete: `ADM/tabs/PostsTab.jsx`, `ADM/tabs/StoriesTab.jsx`, `ADM/tabs/NewsTab.jsx`, `ADM/tabs/PromotionsTab.jsx` (and any test files for them).

- [ ] **Step 1: AdminPanel.** Import the four sections; in `ActiveSection` after the `isAllowed` check (which stays first and unchanged) add branches `posts`, `stories`, `news`, `promotions`.
- [ ] **Step 2: LegacyTabHost.** Delete ONLY dead code: the four tab imports and render lines; the state listed in the spec (`postSearch`, `postTypeFilter`, `postDateFrom`, `postDateTo`, `selectedPost`, `postAuthor`, `storyTitle`, `storyBody`, `storyBg`, `storyImageFile`, `savingStory`, `editingNews`, `savingNews`, `promoTitle`, `promoLink`, `promoDays`, `promoImage`, `savingPromo`) and handlers (`viewPostDetails`, `createStory`, `deleteStory`/`reallyDeleteStory`, `approveNews`, `rejectNews`, `deleteNews`/`reallyDeleteNews`, `createPromotion`, `deletePromotion`/`reallyDeletePromotion`, and `deletePost`/`reallyDeletePost` once nothing else calls them). The legacy `useAdminStories`, `useAdminNews`, `useAdminPromotions` calls and their derived `stories`, `newsItems`, `newsPhones`, `promotions`, `posts` variables: remove each ONLY if grep shows nothing else in the file uses it (the Go live tab and others stay legacy; `users` is still passed to GoLiveTab). `ModerationProvider` and the `useModerationStore` import: grep `apps/carefind/src` for `useModerationStore`; if the only remaining consumer is `ModerationSection` (which mounts its own provider in `AdminPanel`), remove the wrapper from `LegacyTabHost`; otherwise keep it and say what still uses it. Grep every removed identifier and every import that may now be unused (`supabase`, `usersRepository`, `qc`, `useQueryClient`, `recordAction`, `logAuditAction`...): a ReferenceError in `LegacyTabHost` would crash every legacy tab.
- [ ] **Step 3: Delete the old tab files**, then `grep -rn "PostsTab\|StoriesTab\|NewsTab\|PromotionsTab" apps/carefind/src` and fix any importer (report what changed). `AdminPanel.news.test.jsx` mocks the legacy host's news path: read it and update it only as far as the removal requires (report exactly what changed); the session-expired toast behaviour in `AdminShell` must keep passing.
- [ ] **Step 4: Extend `AdminPanel.sections.test.jsx`** so the four tabs route to their sections and fall back to the Overview when not permitted.
- [ ] **Step 5: Verify** `npx vitest run src/modules/admin`, `npm run build`, `npm run lint` (0 errors); scan touched files for un-imported JSX components.
- [ ] **Step 6: Commit** `refactor(carefind): Posts, Stories, News and Promotions leave the legacy host`.

---

### Task 11: Docs

**Files:**
- Modify: `docs/ADMIN_REDESIGN.md` (docs only; no push, no PR, no full suite)

- [ ] **Step 1:** Phase table: Phase 3 "built (PR #25)", Phase 4a "built on `feat/carefind-admin-phase4` (Posts, Stories, News, Promotions)", Phase 4b "not started (Go live)"; keep 5. Code organisation: add `lib/uploadMedia`, `hooks/usePostsDirectory`, `useContentLists`, `useNewsActions`, `useContentActions`, the four sections; note what remains in `LegacyTabHost` (Go live and the Phase 5 tabs).
- [ ] **Step 2: Findings 56-61** (verify each fact with Read/Grep first; use real commit SHAs from `git log --oneline feat/carefind-admin-phase3..HEAD`):
  56. Story, promotion, scheduled-show trailer and live-image uploads ignored a failed upload (`if (!upErr)`): the item was created without its image, or the live image dropped, with no message. Stories and promotions FIXED; the live paths are Phase 4b.
  57. Posts loaded the newest 50 and filtered in the browser. FIXED (server-side filters).
  58. `useAdminNews` turned any non-auth error into an empty list; stories/promotions defaulted to `[]` on failure. FIXED in the new hooks (the old hooks remain for the shell's session-expired toast and until Phase 5).
  59. `list_news` ignores its query error and returns `[]`, is capped at 60 rows, and returns submitter phone numbers from verification requests. Documented.
  60. Uploads go straight from the browser to storage buckets; the trust boundary is the bucket policies (Phase 1 finding 11). Documented.
  61. The legacy news handlers edited the cache optimistically and called `invalidateAdmin()` twice; replaced by one refresh.
  Also record the behaviour changes: failed uploads stop creation; News Reject now confirms; failed creates keep the form.
- [ ] **Step 3: Verification state** (unit/component tests listed; responsive widths NOT measured; uploads against real buckets not exercised).
- [ ] **Step 4: Commit** `docs(carefind): Phase 4a state and findings 56-61`.

---

## Self-review

- **Spec coverage:** upload helper (T1); posts server-side (T2, T6); honest list reads (T3, T6-T9); news and content action hooks with legacy payloads/audit (T4, T5); four screens (T6-T9); legacy retirement incl. `ModerationProvider` (T10); findings 56-61 (T11).
- **Spec deviations called out:** (a) the spec said Approve "sends only changed fields in `edits`"; legacy sent `{ headline, subtitle, body }` when edited else `{}`, and the binding constraint is "same payloads", so the plan keeps legacy (`edited` flag). (b) The spec listed `list_posts` `limit: 25+1`; unchanged. (c) The spec's "author id/time, views" column for Posts becomes the first 8 characters of `user_id` and shows '—' for a null view count (no invented zero).
- **Known thin spots:** the section tests of Tasks 6-9 are exact case lists, not code (earlier phases needed fix rounds on exactly these). Task 3 and Task 10 depend on reading legacy code (queries.js hooks, the `AdminPanel.news.test.jsx` mocks) that this plan describes but cannot show in full.
- **Type consistency:** `createStory`/`createPromotion` resolve `{ ok, error? }`; `approveNews({ id, headline, subtitle, body, edited })` matches Task 9; `source` for `ReviewQueue` in Task 9 is built from `useNewsList()`'s `{ items, phones }`; `POSTS_PAGE_SIZE` exported in Task 2 and used in Task 6.
