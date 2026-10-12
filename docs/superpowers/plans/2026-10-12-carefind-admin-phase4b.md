# CareFind admin Phase 4b (Go live) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the Go live tab out of `LegacyTabHost` into a redesigned screen whose live views stay current (realtime plus polling), show failures instead of hiding them, and stop two silent upload failures.

**Architecture:** `uploadToBucket` gains a `contentType` option. Read hooks (`useLiveShows`, `useLiveControl`, `useGuestSearch`) surface failures as errors and refresh through `useRealtimeChannel` with `pollAlways`. `useLiveActions` holds the moved handlers with legacy payloads. `GoLiveSection` composes a live-show card with a control room, scheduled-show cards and a start/schedule panel, reusing the four shared recorder components unchanged.

**Tech Stack:** React, @tanstack/react-query v5, vitest + Testing Library (jsdom), `@care-ecosystem/design-system/components/ui`.

**Spec:** `docs/superpowers/specs/2026-10-12-carefind-admin-phase4b-design.md`

## Global Constraints

- All paths are relative to the worktree root. `ADM` = `apps/carefind/src/modules/admin/`. Run tests from `apps/carefind`: `npx vitest run <path>`. Branch `feat/carefind-admin-phase4b` (based on `feat/carefind-admin-phase4`).
- One commit per task unless a task says otherwise, staged and committed in one command with explicit paths: `git add <paths> && git commit -m "..." -- <paths>` (use a message file with `-F` if PowerShell quoting breaks; for commits that include deletions use `git add -A -- <paths>` then `git commit`). Messages end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- No backend/SQL/auth change (nothing under `apps/carefind/api`); `packages/design-system`, `ADM/ui/ReviewQueue.jsx`, `ReviewDrawer.jsx`, `DirectoryTable.jsx` and the four shared components `apps/carefind/src/components/{VoiceRecorder,SlideUploader,VideoRecorder,VideoUploader}.jsx` are NOT modified. Never send a `token` field.
- **Payloads unchanged** (read the legacy handlers in `ADM/legacy/LegacyTabHost.jsx` ~lines 90-260 and `ADM/tabs/GoLiveTab.jsx` before writing): `start_live_show { title, guestIds }`, `schedule_show { title, scheduledAt, trailerUrl, guestIds }`, `start_scheduled_show { showId }`, `cancel_scheduled_show { showId }`, `end_live_show { showId }`, `post_live_item { showId, kind, content }` with kinds `text`, `image`, `voice`, `video`, `slide` (slide content is `${url}|||${num}|||${total}`), `hide_live_comment { id }`; guests via `list_user_profiles { search, verified: 'all', specialty: '', limit: 20, offset: 0 }`.
- Uploads: same `supabase` client, bucket `live-media`, paths `trailer-<Date.now()>.<ext>` and `live-<showId>-<Date.now()>.<ext>`; the trailer is uploaded with `contentType: trailerFile.type || 'video/mp4'`. A failed upload stops the action: no server call, the form/draft and the chosen file are kept, the error is shown.
- `useRealtimeChannel` (`ADM/hooks/useRealtimeChannel.js`) re-subscribes whenever any handler identity changes: pass STABLE handlers (`useCallback`/refs). Use `pollAlways: true` with the stated interval so a channel that connects but receives nothing (row-level security) cannot leave the screen stale.
- No UI-only permission check presented as security; `AdminPanel`'s `isAllowed` gate covers the tab.
- A source that fails to load shows "Couldn't load" with Retry; never an empty list. Media from the database (images, audio, video, trailer, slides) renders only for http(s) URLs; DB text renders as text; no `dangerouslySetInnerHTML`.
- The shared Modal card has `role="button"` (known defect, Phase 2a finding 21): tests use exact role names and `within(...)`.
- Test plumbing lessons: `createWrapper` is NOT exported by `src/test/renderWithQueryClient.jsx` (use a local `QueryClientProvider` wrapper created ONCE per test in a `makeWrapper()` factory, `retry: false`); do not return a mock from a `beforeEach` arrow; fake timers only where a timer/debounce is exercised, restored afterwards; section tests mock `../provider/AdminProvider.jsx` (`useAdmin: () => ({ askConfirm, showToast, invalidateAdmin, confirming: false })`); mock `../hooks/useRealtimeChannel` to capture its config rather than opening channels.
- ESLint has no React plugin: check every JSX component is imported; run `npm run lint` (0 errors). The full suite takes 10+ minutes: during tasks run only `npx vitest run src/modules/admin`.

## Review Focus

- A failed read of live shows or control data is never "no shows"/empty; the stale-data stamp is honest (Tasks 2, 3, 6, 8).
- Two live shows never share control-room data (Tasks 3, 6).
- A failed trailer or image upload makes NO server call and loses nothing (Tasks 5, 7).
- Go live now / Start now / End / Cancel are confirmed, act on the right show id, and cannot double-fire (Tasks 5-8).
- Realtime handlers are stable (no resubscribe per render) and a poll always runs (Tasks 2, 3).
- Nothing dangling in `LegacyTabHost`; other legacy tabs still work (Task 9).

---

### Task 1: uploadToBucket accepts a contentType

**Files:**
- Modify: `ADM/lib/uploadMedia.js`, `ADM/lib/uploadMedia.test.js`

**Interfaces:**
- Produces: `uploadToBucket(bucket, file, prefix, options)` where `options` is optional `{ contentType }`. When `options?.contentType` is truthy the upload call is `upload(path, file, { contentType })`; otherwise it is the unchanged `upload(path, file)`.

- [ ] **Step 1: Failing tests** appended to the existing file (read it first; it mocks `supabase.storage` and fake timers): (a) with `{ contentType: 'video/mp4' }` the upload is called as `(path, file, { contentType: 'video/mp4' })`; (b) with no options and with `{}` the upload is called with exactly `(path, file)` (arity 2); (c) a failed upload with options still returns `{ ok:false, error }`.
- [ ] **Step 2: FAIL. Step 3: implement. Step 4: PASS** (existing tests unchanged). Commit `feat(carefind): uploadToBucket can pass a contentType`.

---

### Task 2: useLiveShows

**Files:**
- Create: `ADM/hooks/useLiveShows.js`, `ADM/hooks/useLiveShows.test.jsx`

**Interfaces:**
- Consumes: `liveRepository.getActiveShows()` / `getScheduledShows()` (`ADM/repositories/liveRepository.js`; both throw on error), `useRealtimeChannel`.
- Produces: `useLiveShows(enabled = true)` -> react-query result, key `['admin','live','shows']`, `data = { active, scheduled }` each `{ status:'ok', data:[...] } | { status:'error' }` (a non-array result is an error), settled independently like `ADM/hooks/useTrustQueues.js`. Inside the hook, call `useRealtimeChannel({ channelName: 'admin-live-shows', subscription: { schema: 'public', table: 'live_shows' }, onAny: refetchStable, pollInterval: 15000, pollFn: refetchStable, pollAlways: true })` with a STABLE `refetchStable` (`useCallback`, `useRef` for the latest `refetch`).

- [ ] **Step 1: Failing test** (mock `../repositories/liveRepository` and `./useRealtimeChannel`, capture the config): each source settles on its own (active fails, scheduled ok -> `{status:'error'}` / ok); a non-array is an error; the channel is configured with table `live_shows`, `pollAlways: true`, `pollInterval: 15000`, and the handlers keep the SAME identity across re-renders (render the hook twice and compare `onAny` / `pollFn` references); `onAny` triggers a refetch.
- [ ] **Step 2: FAIL. Step 3: implement. Step 4: PASS.** Commit `feat(carefind): useLiveShows, live and scheduled shows that fail loudly and stay current`.

---

### Task 3: useLiveControl

**Files:**
- Create: `ADM/hooks/useLiveControl.js`, `ADM/hooks/useLiveControl.test.jsx`

**Interfaces:**
- Produces: `useLiveControl(showId, enabled = true)` -> react-query result, key `['admin','live','control', showId]`, queryFn `liveRepository.getLiveControl(showId)` (throws on error) returning `{ items, comments, stats }`; a response missing `items` or `comments` arrays is an error; `enabled: !!showId && enabled`; NO `placeholderData` (a different show never shows another show's data) but the previous data of the SAME show is kept while a refetch runs (react-query default). Realtime: one `useRealtimeChannel` on `live_comments` with `subscription: { schema:'public', table:'live_comments', filter: \`show_id=eq.${showId}\` }`, `channelName: \`admin-live-comments-${showId}\``, `pollInterval: 10000`, `pollAlways: true`; a second on `live_items` (`channelName: \`admin-live-items-${showId}\``, no poll). Stable handlers as in Task 2. Returns the query result plus nothing else (callers read `dataUpdatedAt`, `isError`, `refetch`).

- [ ] **Step 1: Failing test** (mock `../repositories/liveRepository`, `./useRealtimeChannel`): two different show ids use different keys and never return each other's data (render with show 'a' resolved, switch the prop to 'b' -> `data` is undefined/loading, not a's); failure is an error and, after a successful load followed by a failed refetch, the last good `data` is still present with `isError` true; `dataUpdatedAt` updates after a refetch; channel configs (tables, filters, channel names, `pollAlways`, 10000) and handler identity stability; a disabled hook (no showId) does not call the repository.
- [ ] **Step 2: FAIL. Step 3: implement. Step 4: PASS.** Commit `feat(carefind): useLiveControl, per-show control room data that stays current`.

---

### Task 4: useGuestSearch

**Files:**
- Create: `ADM/hooks/useGuestSearch.js`, `ADM/hooks/useGuestSearch.test.jsx`

**Interfaces:**
- Consumes: `callAdminAuth` (`../adminApi`), `useDebounced` (`ADM/ui/useDebounced.js`).
- Produces: `useGuestSearch(search)` -> react-query result, key `['admin','live','guests', trimmedDebounced]`, queryFn `callAdminAuth('list_user_profiles', { search, verified: 'all', specialty: '', limit: 20, offset: 0 })` returning `res.data` (an array; otherwise an error); `search` trimmed and debounced 300 ms; the search term has `, ( ) " \` replaced by spaces (the server interpolates it into an `.or(...)`; Phase 2b finding 30) then whitespace-collapsed; `placeholderData: prev => prev`.

- [ ] **Step 1: Failing test** (fake timers for the debounce; restore after): the request payload exactly; debounce (no request for the intermediate keystrokes, one after 300 ms); `"Obi, Ada"` sends `"Obi Ada"`; `a),id.eq.1` never reaches the server unchanged; failure and non-array are errors; an empty search requests the newest 20.
- [ ] **Step 2: FAIL. Step 3: implement. Step 4: PASS.** Commit `feat(carefind): useGuestSearch, server-side guest search for live shows`.

---

### Task 5: useLiveActions

**Files:**
- Create: `ADM/hooks/useLiveActions.js`, `ADM/hooks/useLiveActions.test.jsx`

**Interfaces:**
- Consumes: `callAdminAuth`; `uploadToBucket` (`ADM/lib/uploadMedia.js`); `useAdmin()` -> `showToast`, `invalidateAdmin`; `bestEffort` (`ADM/lib/bestEffort.js`).
- Produces: `useLiveActions()` -> `{ busy, startShow({ title, guestIds }), scheduleShow({ title, scheduledAt, trailerFile, guestIds }), startScheduled(id), cancelScheduled(id), endShow(id), postItem({ showId, text, imageFile }), postMedia({ showId, kind, content }), hideComment(id) }`, each resolving `{ ok:true }` or `{ ok:false, error }`. `busy` is the name of the running action (or null), cleared in `finally`.
  - `startShow`: blank trimmed title -> `{ ok:false, error:'Add a show title' }` with no call; `start_live_show { title: title.trim(), guestIds }`; success: refresh once, toast `'Live show started! Open the Control Room to begin posting.'`.
  - `scheduleShow`: blank title -> `{ ok:false, error:'Add a show title' }`; missing `scheduledAt` -> `{ ok:false, error:'Pick a date & time for the show' }`; trailer: `uploadToBucket('live-media', trailerFile, 'trailer', { contentType: trailerFile?.type || 'video/mp4' })` — on `{ ok:false }` resolve `{ ok:false, error: \`Couldn't upload the trailer: ${error}\` }` and make NO `schedule_show` call; else `schedule_show { title: title.trim(), scheduledAt, trailerUrl: url (null when no file), guestIds }`; toast `'Show scheduled! It will show a countdown to your audience. Tap "Start Now" when you\'re ready to go live.'`.
  - `startScheduled(id)`: `start_scheduled_show { showId: id }`, toast `'You are now LIVE!'`. `cancelScheduled(id)`: `cancel_scheduled_show { showId: id }`, toast `'Scheduled show cancelled'`. `endShow(id)`: `end_live_show { showId: id }`, toast `'Live show ended'`.
  - `postItem({ showId, text, imageFile })`: if both empty -> `{ ok:false, error:'Write something or add an image' }` with no call. Order as legacy: image first, then text. Image: `uploadToBucket('live-media', imageFile, \`live-${showId}\`)`; on failure resolve `{ ok:false, error: \`Couldn't upload the image: ${error}\` }` and post NOTHING (not even the text; the draft stays intact); then `post_live_item { showId, kind:'image', content: url }`; then, if text, `post_live_item { showId, kind:'text', content: text.trim() }`. If the image post succeeds but the text post fails resolve `{ ok:false, error, partial:true }` (the image is already posted; the caller must keep only the text draft). Success toast none (the control room shows the item); refresh the control room via `invalidateAdmin()` once.
  - `postMedia({ showId, kind, content })` for `voice`/`video`/`slide` (`content` already formatted by the caller; helper `slideContent(url, num, total)` exported = `${url}|||${num}|||${total}`): `post_live_item { showId, kind, content }`; failure -> `{ ok:false, error }`.
  - `hideComment(id)`: `hide_live_comment { id }`; refresh once.
  - No audit, no `recordAction` (legacy wrote none). Only the server calls inside the `try`; refresh/toast via `bestEffort`; failures never toast (the card shows them).

- [ ] **Step 1: Failing test** (write in full; mock `../adminApi`, `../lib/uploadMedia`, `../provider/AdminProvider.jsx`): every payload exactly as above (including the slide format and `trailerUrl: null` without a file); `contentType` argument for the trailer (`'video/mp4'` default); a failed trailer upload and a failed image upload make NO server call (assert on `callAdminAuth.mock.calls`); the text is not posted when the image upload fails; partial failure sets `partial:true`; guards make no calls; one refresh per success; throwing refresh/toast after success still `{ ok:true }`; no audit action; `busy` lifecycle.
- [ ] **Step 2: FAIL. Step 3: implement. Step 4: PASS.** Commit `feat(carefind): useLiveActions, the live show handlers with honest upload failures`.

---

### Task 6: LiveShowCard (the control room)

**Files:**
- Create: `ADM/sections/live/LiveShowCard.jsx`, `ADM/sections/live/LiveShowCard.test.jsx`

**Interfaces:**
- Consumes: `useLiveControl(show.id)`, `useLiveActions()` (`postItem`, `postMedia`, `slideContent`, `hideComment`, `endShow`, `busy`), `useAdmin().askConfirm`, the four shared components (default exports from `apps/carefind/src/components/VoiceRecorder.jsx`, `SlideUploader.jsx`, `VideoRecorder.jsx`, `VideoUploader.jsx`; props: `VoiceRecorder({ showId, onRecorded })`, `SlideUploader({ showId, onPostSlide })` with `onPostSlide(url, num, total)`, `VideoRecorder({ showId, onRecorded })`, `VideoUploader({ showId, onUploaded })`), `Textarea`, `Button`, `Card`.
- Produces: `<LiveShowCard show={...} />` (default export).

Behaviour: header: pulsing red dot (respect `prefers-reduced-motion`: no animation), `show.title`, "Started {time}", an "Audience" link to `/live-show/${show.id}` (internal path), and "End show" -> `askConfirm({ title: 'End this live show?', consequence: 'This immediately ends the live broadcast for everyone watching. The show cannot be resumed once ended.', confirmLabel: 'End Show', action })` -> `endShow(show.id)` (a failure shows an inline `role="alert"` on the card). Stats strip: Likes, Views, Shares, Gifts (coins) from `data.stats` with "Updated {HH:MM:SS}" from `dataUpdatedAt`; while loading placeholders; a control failure with previous data keeps the data and shows "Couldn't refresh the control room" + Retry (`refetch`); a failure with no data shows "Couldn't load the control room" + Retry (never zeros). Composer: `Textarea` "Broadcast to the audience", an image file input (labelled "Add image"), "Post live" disabled when both empty or `busy`; submit -> `postItem({ showId, text, imageFile })`: `{ ok:true }` clears text and file; `{ ok:false, error, partial }` shows the error in `role="alert"`, keeps the draft and the file (if `partial`, clears the file but keeps the text). The four shared components are mounted unchanged: `onRecorded`/`onUploaded` -> `postMedia({ showId, kind:'voice'|'video', content: url })`, `onPostSlide` -> `postMedia({ showId, kind:'slide', content: slideContent(url, num, total) })`; a failure from `postMedia` shows the inline error. "Posted ({n})" list: text; image (`<img>` only for http(s)); voice (`<audio controls>`), video (`<video controls playsInline>`), slide (page number and image) — media only for http(s) URLs, otherwise a short "Unsupported media address" note. "Audience comments": author (`profiles.full_name || display_name || 'User'`), text, hidden ones dimmed with no Hide; Hide -> `hideComment(c.id)` (a failure shows an inline error). Everything that acts is disabled while `busy`.

- [ ] **Step 1: Failing test.** Mock `../../hooks/useLiveControl` (settable `{ data, isLoading, isError, refetch, dataUpdatedAt }`), `../../hooks/useLiveActions`, `../../provider/AdminProvider.jsx`, and the four shared components with tiny stubs exposing buttons that call their callbacks. Cases (write in full): two cards for two shows show their OWN data (render two with different mocked data keyed by show id); stats and the "Updated" stamp; control failure without data -> "Couldn't load the control room" + Retry and NO zeros; failure with data -> data kept + "Couldn't refresh…" + Retry; composer: Post disabled when empty; success clears; failed image upload keeps text and file and shows the error; partial failure keeps the text only; the voice/video/slide callbacks post the exact payloads (slide `url|||2|||5`); posted item rendering and a `javascript:` image/audio/video never a src; comments: Hide calls `hideComment`, hidden ones have no Hide; End show asks `askConfirm` with the legacy text and `endShow` runs only after confirm; end failure inline alert; everything disabled while `busy`.
- [ ] **Step 2: FAIL. Step 3: implement. Step 4: PASS.** Commit `feat(carefind): live show card with a control room that stays current`.

---

### Task 7: ScheduledShowCard and StartShowPanel

**Files:**
- Create: `ADM/sections/live/ScheduledShowCard.jsx`, `ADM/sections/live/StartShowPanel.jsx` and a test file for each (`.test.jsx`)

**Interfaces:**
- `<ScheduledShowCard show={...} />`: title, `new Date(show.scheduled_at).toLocaleString()`, the trailer (`<video controls playsInline>` only for an http(s) `trailer_url`), "Start now" -> `askConfirm({ title: 'Start this show now?', consequence: 'This starts the show now and shows the LIVE indicator to every CareFind user.', confirmLabel: 'Start now', action })` -> `startScheduled(show.id)`, "Preview" link `/live-show/${show.id}`, "Cancel" -> `askConfirm({ title: 'Cancel this scheduled show?', consequence: 'This cancels the scheduled show and removes its countdown from the audience view. Invited guests will need to be re-added if you reschedule it.', confirmLabel: 'Cancel Show', action })` -> `cancelScheduled(show.id)`; a failure shows an inline `role="alert"`; buttons disabled while `busy`.
- `<StartShowPanel liveCount={n} />`: `Input` "Show title"; guest picker: `Input` "Search users by name…" bound to `useGuestSearch`, a result list of up to 20 (name, initial, a checkbox/toggle with an accessible name), a "Selected guests (n)" list with remove buttons; failed search shows "Couldn't search users" + Retry (never "no users"); "Go live now" -> `askConfirm({ title: 'Go live now?', consequence: \`This starts a live show that every CareFind user will see. It stays live until you end it.${liveCount > 0 ? \` ${liveCount} other show${liveCount === 1 ? ' is' : 's are'} already live.\` : ''}\`, confirmLabel: 'Go live', action })` -> `startShow({ title, guestIds })`; "Schedule for later": `Input type="datetime-local"`, trailer file input ("Add trailer video (optional)"), "Schedule show" -> `scheduleShow({ title, scheduledAt, trailerFile, guestIds })`. Success clears the form; failure shows a `role="alert"` and KEEPS title, guests, date and trailer file. Buttons disabled while `busy`; title required for both (buttons disabled when blank; the hook also guards).

- [ ] **Step 1: Failing tests** (mock `../../hooks/useLiveActions`, `../../hooks/useGuestSearch`, `../../provider/AdminProvider.jsx`). Cases (write in full): ScheduledShowCard — Start now and Cancel ask confirmation with the exact texts and call the action only after the confirm action, with the card's show id; trailer only for http(s); failure inline; busy disables. StartShowPanel — Go live asks confirmation (with and without other live shows: text contains "1 other show is already live"); calls `startShow({ title, guestIds })` with the selected ids only after confirm; success clears the form; failure keeps everything (title, guests, date, file) and shows the error; schedule payload `{ title, scheduledAt, trailerFile, guestIds }`; selecting/removing guests; guest search failure shows Retry not "no users"; buttons disabled when the title is blank.
- [ ] **Step 2: FAIL. Step 3: implement. Step 4: PASS.** Commit `feat(carefind): scheduled show card and the start/schedule panel`.

---

### Task 8: GoLiveSection

**Files:**
- Create: `ADM/sections/GoLiveSection.jsx`, `ADM/sections/GoLiveSection.test.jsx`

Composes `useLiveShows()`, `LiveShowCard`, `ScheduledShowCard`, `StartShowPanel`. h1 "Go Live", subtitle "Manage live shows on CareFind". "Currently live (n)": cards keyed by show id; if the `active` source failed -> an alert panel "Couldn't load live shows" + Retry (calls `refetch`), and NEVER "No live shows right now"; loaded and empty -> "No live shows right now"; loading -> a placeholder. "Scheduled shows": same three states ("No scheduled shows"). The start panel always renders and receives `liveCount` (the number of active shows when that source loaded, else 0).

- [ ] **Step 1: Failing test** (mock `../hooks/useLiveShows`, and the three child components with simple stubs that render the show title/id so composition can be asserted; one extra test with the real `LiveShowCard` mocked hooks is NOT needed): failed active source -> Retry and not "No live shows right now"; failed scheduled source -> Retry and not "No scheduled shows"; both loaded and empty -> both empty texts; two active shows render two cards with their own ids; `liveCount` reaches `StartShowPanel`; Retry calls `refetch`; one h1.
- [ ] **Step 2: FAIL. Step 3: implement. Step 4: PASS.** Commit `feat(carefind): Go live section on the live shows hook`.

---

### Task 9: Wire the section and retire the legacy code

**Files:**
- Modify: `ADM/AdminPanel.jsx`, `ADM/legacy/LegacyTabHost.jsx`, `ADM/AdminPanel.sections.test.jsx`
- Delete: `ADM/tabs/GoLiveTab.jsx` (and any test for it)

- [ ] **Step 1: AdminPanel.** Import `GoLiveSection`; in `ActiveSection` after the `isAllowed` check (which stays first) add `golive`. Mirror the Phase 4a wiring commit (`git show af62a42 --stat`).
- [ ] **Step 2: LegacyTabHost.** Delete ONLY dead code: the `GoLiveTab` import and its render line; the live state and handlers listed in the spec; the `useAdminLiveShows` call and `activeShows`/`scheduledShows`; `users` from the `adminData` destructure (Go live was its only use there — grep to confirm; `useAdminData` itself is not modified); imports that become unused (`liveRepository`, `supabase`, ...) — grep every removed identifier and every import before removing; anything still used stays. A ReferenceError in `LegacyTabHost` would crash every legacy tab.
- [ ] **Step 3: Delete `tabs/GoLiveTab.jsx`**, then `grep -rn "GoLiveTab" apps/carefind/src` and fix importers (report what changed). `hooks/queries.js` is not modified (`useAdminLiveShows` becomes dead; documented).
- [ ] **Step 4: Extend `AdminPanel.sections.test.jsx`** so `golive` routes to the section and falls back to the Overview when not permitted.
- [ ] **Step 5: Verify** `npx vitest run src/modules/admin`, `npm run build`, `npm run lint`; scan touched files for un-imported JSX components.
- [ ] **Step 6: Commit** `refactor(carefind): Go live leaves the legacy host`.

---

### Task 10: Docs

**Files:**
- Modify: `docs/ADMIN_REDESIGN.md` (docs only; no push, no PR, no full suite)

- [ ] **Step 1:** Phase table: Phase 4a "built (PR #26)", Phase 4b "built on `feat/carefind-admin-phase4b` (Go live)"; keep 5. Code organisation: add the new hooks, `sections/GoLiveSection` and `sections/live/*`; note `useAdminLiveShows` in `hooks/queries.js` is dead until Phase 5 and the shared recorder components are unchanged.
- [ ] **Step 2: Findings 65-71** (verify each fact with Read/Grep first; real SHAs from `git log --oneline feat/carefind-admin-phase4..HEAD`) exactly as in the spec's findings list, plus the behaviour changes (confirmations for Go live now / Start now; a failed upload stops scheduling/posting; control room per show and live).
- [ ] **Step 3: Verification state** (unit/component tests listed; responsive layout NOT measured; realtime and live-show behaviour NOT exercised; uploads never run against the real bucket).
- [ ] **Step 4: Commit** `docs(carefind): Phase 4b state and findings 65-71`.

---

## Self-review

- **Spec coverage:** contentType option (T1); live shows hook (T2); per-show control hook with realtime+poll (T3); server-side guest search (T4); the moved handlers with upload-failure rules (T5); control room card (T6); scheduled card + start panel with the new confirmations (T7); composition with honest failed/empty states (T8); legacy retirement incl. `users` (T9); findings 65-71 (T10).
- **Spec points the plan makes concrete:** `partial:true` for image-posted-but-text-failed; the guest search strips `, ( ) " \` (Phase 2b finding 30); the stable-handler gotcha in `useRealtimeChannel`; the reduced-motion rule for the pulsing dot.
- **Known thin spots:** the section tests of Tasks 6-8 are exact case lists, not code (earlier phases needed fix rounds on exactly these); Task 3's realtime test relies on mocking `useRealtimeChannel` so subscription behaviour against real Supabase is never exercised.
- **Type consistency:** `useLiveActions` method names/arg shapes match their use in Tasks 6-7; `slideContent` is exported by Task 5 and used in Task 6; `useLiveShows` data shape (`{ active, scheduled }` of `{status,data}`) matches Task 8; `StartShowPanel liveCount` computed in Task 8.
