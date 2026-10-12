# CareFind admin Phase 4b: Go live

Date: 2026-10-12
Builds on: Phase 4a (`2026-10-12-carefind-admin-phase4a-design.md`, PR #26), which added `lib/uploadMedia.js`.
Branch: `feat/carefind-admin-phase4b`, based on the Phase 4a branch.

## Goal

Move the Go live tab (start, schedule, end, the control room, guests, live posting) out of
`legacy/LegacyTabHost.jsx` into a redesigned screen. A live broadcast is the least forgiving screen in the
console, and the current tab has failure modes that hide exactly what an operator needs to see during a
show: a failed read of the live shows looks like "no shows", the control room loads once and goes stale, two
upload paths fail silently, and two live shows would share one set of state.

## Scope and constraints

- No backend, SQL or auth change. Same `callAdminAuth` actions and payloads: `start_live_show { title, guestIds }`,
  `schedule_show { title, scheduledAt, trailerUrl, guestIds }`, `start_scheduled_show { showId }`,
  `cancel_scheduled_show { showId }`, `end_live_show { showId }`, `post_live_item { showId, kind, content }`
  (kinds `text`, `image`, `voice`, `video`, `slide`; slide content is `${url}|||${num}|||${total}`),
  `hide_live_comment { id }`, `list_user_profiles { search, limit }` for guests. Never a `token` field (the legacy
  `postLiveItem` read a dead `admin_token`; it is not carried over).
- Reads keep their sources: `live_shows`, `live_items`, `live_comments`, `live_reactions`, `live_shares`,
  `live_views`, `gifts` through the admin transport / `liveRepository`. The gifts figure keeps the legacy sum of
  `gifts.coins` for `post_id = showId`.
- Browser uploads keep the same client, the `live-media` bucket and path schemes (`trailer-<ts>.<ext>`,
  `live-<showId>-<ts>.<ext>`). Only failure handling changes.
- The shared recorder/uploader components (`components/VoiceRecorder.jsx`, `SlideUploader.jsx`,
  `VideoRecorder.jsx`, `VideoUploader.jsx`) are used unchanged; they already report their own upload failures and
  are shared with the live session and the feed.
- No UI-only permission check presented as security; `AdminPanel`'s `isAllowed` gate covers the tab.
- A source that fails to load shows "Couldn't load, Retry" and never an empty list.

## Units

| Unit | Responsibility |
|---|---|
| `lib/uploadMedia.js` | Gains an optional 4th argument `{ contentType }`, passed to `upload(path, file, { contentType })` only when given. Default behaviour and existing tests unchanged. |
| `hooks/useLiveShows.js` | Key `['admin','live','shows']`. Active and scheduled shows from `liveRepository.getActiveShows` / `getScheduledShows`, each settled to `{ status:'ok', data }` or `{ status:'error' }`. `useRealtimeChannel` on `live_shows` (insert/update) with `pollAlways` and a 15 s poll. |
| `hooks/useLiveControl.js` | `useLiveControl(showId, enabled)`: key `['admin','live','control', showId]`, `liveRepository.getLiveControl(showId)`, failure is an error, per-show data (no shared state). `useRealtimeChannel` on `live_comments` and `live_items` filtered by `show_id` with `pollAlways` and a 10 s poll; exposes `dataUpdatedAt`. |
| `hooks/useLiveActions.js` | `startShow({ title, guestIds })`, `scheduleShow({ title, scheduledAt, trailerFile, guestIds })`, `startScheduled(id)`, `cancelScheduled(id)`, `endShow(id)`, `postItem({ showId, text, imageFile })`, `postMedia({ showId, kind, content })` for voice/video/slide, `hideComment(id)`. Each resolves `{ ok }` / `{ ok:false, error }`; only the server call inside the `try`; refresh/toast via `bestEffort`. A failed trailer or image upload stops the action without calling the server action. |
| `hooks/useGuestSearch.js` | Debounced (300 ms) server-side `list_user_profiles { search, verified:'all', specialty:'', limit: 20, offset: 0 }`; failure is an error; empty search returns the newest 20. |
| `sections/GoLiveSection.jsx` + `sections/live/*` | `LiveShowCard` (control room), `ScheduledShowCard`, `StartShowPanel`. |

Removed from `LegacyTabHost`: the `golive` render line; the state `liveTitle, scheduledAt, trailerFile, creatingShow,
liveGuests, guestSearch, liveItems, liveStats, liveComments, liveDraft, liveImage, postingLive`; the handlers
`scheduleShow, startScheduledShow, cancelScheduledShow/reallyCancelScheduledShow, toggleGuest, startLiveShow,
endLiveShow/reallyEndLiveShow, loadLiveControl, postLiveItem, hideLiveComment, postLiveVoice, postLiveSlide,
postLiveVideo`; the `useAdminLiveShows` call and `activeShows`/`scheduledShows`; `users` from the destructure
(grep confirms Go live was its only use there) and imports left unused (`liveRepository`, `supabase` only if nothing
else uses them). `tabs/GoLiveTab.jsx` is deleted. `useAdminLiveShows` in `hooks/queries.js` stays until Phase 5
(documented as dead).

## Behaviour

| Area | Behaviour |
|---|---|
| Currently live | One card per active show: title, start time, Audience link (`/live-show/<id>`), End show (confirmation, legacy text). A failed show list says "Couldn't load live shows" with Retry, never "no shows". The empty case (loaded, none live) is stated plainly. |
| Control room | Open on every live card (no "Load Control Room" button). Stats: likes, views, shares, gifts in coins, with "Updated HH:MM:SS". Failure of the control load shows an inline Retry and keeps the last good data visible. Composer: text and one optional image; "Post live" disabled when both are empty; a failed upload or post keeps the draft and the image and shows the error in `role="alert"`; success clears them. Voice, slides, camera and video use the shared components; their `onRecorded`/`onUploaded` callbacks call `postMedia`. Posted items are listed (text, image, voice, video, slide with its page number); media shown only for http(s) URLs. Comments list with Hide (hidden ones dimmed, no Hide). A failed hide shows an inline error. |
| Start a show | Title required. Guest picker with server-side search (selected guests listed and removable). "Go live now" asks for confirmation (new): "This starts a live show that every CareFind user will see. It stays live until you end it." with the count of shows already live when there is one. |
| Schedule | Title and a date-time required; optional trailer. A failed trailer upload stops scheduling and keeps the form (legacy scheduled without it, silently). Success clears the form. |
| Scheduled shows | Title, time, trailer (http(s) only), Start now (confirmation, new: "This starts the show now and shows the LIVE indicator to every user."), Preview link, Cancel (confirmation, legacy text). |

## States

Loading placeholders; failed shows list -> Retry; failed control -> inline Retry with the last data kept and the
"updated" stamp honest; empty lists have explicit text ("No live shows right now", "No scheduled shows"). All
destructive and public actions disable their buttons while running; a result arriving after the card unmounted
is toasted if it failed (late-result rule used elsewhere).

## Findings to document

65. `useAdminLiveShows` defaults a failed read to `[]`, so a failed read looks like "no live shows" and the
    admin cannot see or end a live show. Fixed in the new hook.
66. The control room loaded once on a button press, never refreshed (stale comments and stats during a
    show), shared one set of state across all live shows, and had no error handling (`loadLiveControl` was an
    unhandled rejection on failure). Fixed.
67. A failed trailer upload scheduled the show without its trailer, and a failed live-image upload dropped the
    image and cleared it from the form, silently. Fixed (these are the live half of Phase 4a finding 56).
68. The guest picker filtered the newest 100 users in the browser and showed 30. Fixed with a server-side search.
69. Nothing stopped starting a second live show, and "Go live now"/"Start now" had no confirmation although
    they publish a LIVE indicator to every user. Confirmations added; starting a second show is still allowed.
70. Realtime subscriptions run through the admin's browser Supabase session and may be silently filtered by row
    level security (a channel can connect and deliver nothing); a poll runs alongside realtime for that reason.
    Unverified without an admin session.
71. The gifts figure sums `gifts.coins` where `post_id = showId` through the browser client (money-adjacent;
    kept as legacy; RLS could make it read low). Documented.

## Testing

- `uploadToBucket`: `contentType` passed only when given; unchanged default call.
- `useLiveShows`: each source settles on its own; failure is an error not `[]`.
- `useLiveControl`: per-show keys (two shows never share data); failure is an error and keeps previous data;
  exposes `dataUpdatedAt`; realtime handlers invalidate its key; the poll runs alongside realtime.
- `useGuestSearch`: params, debounce, failure is an error.
- `useLiveActions`: exact payloads (including the slide content format), upload failure makes no server call,
  failure returns `{ ok:false, error }`, one refresh, text+image posting order and partial failure behaviour.
- `GoLiveSection`: states (failed shows -> Retry, never "no live shows"), live card with stats and stamp,
  composer keep-on-failure, comments hide, start/schedule/cancel/end confirmations and payloads, guests,
  media URL safety (`javascript:` never a src/href), the late-result rule, permission-hidden fallback; routing
  test extended for the `golive` tab. Full suite, build and lint before the PR.
- Responsive widths cannot be measured without an admin session; real-time behaviour against a live show cannot
  be exercised; the PR says so.

## Delivery

One commit per unit. `docs/ADMIN_REDESIGN.md` gets findings 65-71, the phase table update and the note that
`useAdminLiveShows` is dead. The PR is a draft stacked on PR #26 with the responsive and live-behaviour checks
stated as outstanding.
