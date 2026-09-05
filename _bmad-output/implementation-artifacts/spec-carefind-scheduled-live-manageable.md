---
title: 'Make scheduled Live events manageable (edit/reschedule/delete, lifecycle)'
type: 'bugfix'
created: '2026-09-04'
status: 'done'
baseline_commit: 'd438df1e493caef2918eb12deacb8ce70e5b8de7'
review_loop_iteration: 0
context:
  - 'apps/carefind/src/modules/social-feed/UserGoLive.jsx'
  - 'apps/carefind/src/modules/account/Profile.jsx'
  - 'apps/carefind/src/modules/live-streaming/LiveDashboard.jsx'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** User can schedule Live and see it under Upcoming, but cannot edit title, reschedule date/time, or cancel/delete; past `scheduled_at` events remain Upcoming indefinitely (no expiry), no lifecycle.

**Approach:** Give owner Manage/Edit for own `live_shows` where `status=scheduled`: edit title/trailer, reschedule `scheduled_at`, cancel/delete; implement lifecycle `Scheduled→Live→Ended` with expiry of past `scheduled_at` from Upcoming (move to Past/Ended or hide), and enforce `status` transitions via RLS/validation.

## Boundaries & Constraints

**Always:** Use `live_shows` table (`status` `scheduled`/`live`/`ended`, `scheduled_at`, `host_id`, `is_platform`); keep `host_id=auth.uid()` RLS for update/delete; keep admin `schedule_show`/`start_scheduled_show`/`cancel_scheduled_show` via service-role.

**Ask First:** Adding `cancelled`/`expired` status vs reusing `ended`; adding DELETE RLS vs soft-cancel to `ended`.

**Never:** Allow non-owner to edit/delete others’ scheduled; keep past `scheduled` indefinitely under Upcoming; allow reschedule to past time.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Edit title | Owner edits scheduled title | Title updates, profile reflects immediately | Must be owner + status scheduled; else 42501 |
| Reschedule | New `scheduled_at` future | `scheduled_at` updates, Upcoming shows new date/time | Past date → validation error, not saved |
| Cancel/delete | Owner cancels scheduled | Disappears from Upcoming immediately (status `ended` or row deleted) | Non-owner → 42501; already live → not allowed |
| Expiry | `scheduled_at < now - 24h` and still `scheduled` | No longer shown as Upcoming; moved to Past/Ended or hidden | No manual action needed |
| Upcoming filter | List Upcoming | Only `status=scheduled` and `scheduled_at > now` (or recent `scheduled` within window) | Past shows in Past tab, not Upcoming |

</frozen-after-approval>

## Code Map

- `apps/carefind/src/modules/social-feed/UserGoLive.jsx:77-97` -- `scheduleShow` inserts `live_shows {status:'scheduled', host_id, scheduled_at, trailer_url}`; keep validation `scheduledAt`.
- `apps/carefind/src/modules/account/Profile.jsx:347-356,691-726` -- `loadMyShows` `.in(status ['live','scheduled'])` without expiry; Upcoming render `live vs scheduled` with diff `715` `diff<=0 ? 'soon'` infinite; must add `gt('scheduled_at', now)` or client filter + Past tab, and add Manage menu (Edit/Reschedule/Cancel) per scheduled row.
- `apps/carefind/src/modules/live-streaming/LiveDashboard.jsx:67,161-198` -- `endShow` `update status:'ended'`, `startNow` `status:'live'`; must add `update` for title/`scheduled_at` and `delete` with RLS.
- `apps/carefind/src/modules/live-streaming/LiveShow.jsx:291` -- `status==='scheduled'` countdown; must respect expiry.
- `apps/carefind/api/_handlers/admin-auth.js:283-331` -- admin `schedule_show`/`cancel_scheduled_show` service-role; keep.

## Tasks & Acceptance

**Execution:**
- [x] `apps/carefind/src/modules/account/Profile.jsx` + `LiveDashboard.jsx` -- add Manage/Edit UI per scheduled `live_shows` where `host_id=user.id` and `status=scheduled`: Edit title, reschedule `datetime-local` (validate future > now+5min), trailer; Cancel/Delete button with confirm → `supabase.from('live_shows').update/delete` where `host_id` and `status=scheduled`; on success reload list.
- [x] `apps/carefind/src/modules/account/Profile.jsx:347` -- fix Upcoming: filter `.gt('scheduled_at', new Date().toISOString())` or client `scheduled_at > now` for Upcoming; add Past/Ended section for `scheduled_at < now` or `status=ended` so expired not under Upcoming.
- [x] `apps/carefind/src/modules/live-streaming/LiveDashboard.jsx` -- add same edit/reschedule/delete for single show view when `status=scheduled` and is owner; enforce RLS `host_id=auth.uid()`.
- [x] `apps/carefind/sql/202608XX_live_shows_delete_rls.sql` (new) -- add `DELETE` RLS `USING (host_id=auth.uid() AND status='scheduled')` or document soft-cancel to `ended`; keep `SELECT true` public, `UPDATE host_id=auth.uid()`.
- [x] `apps/carefind/src/modules/live-streaming/LiveDashboard.test.jsx` + `Profile.live.test.jsx` (new) -- tests: owner can edit title/reschedule future succeeds, past reschedule rejected, cancel makes disappear from Upcoming, expired `scheduled_at` not in Upcoming but in Past, non-owner edit rejected.

**Acceptance Criteria:**
- Given scheduled Live under Upcoming, when owner edits title, then profile updates immediately
- Given owner reschedules to new future date/time, when saved, then Upcoming shows new date/time
- Given owner cancels/deletes scheduled, when confirmed, then it disappears from Upcoming immediately
- Given scheduled event whose `scheduled_at` has passed (>24h or now), when viewing Upcoming, then it is no longer shown as Upcoming (moved to Past/Ended or hidden)

## Spec Change Log

## Design Notes

No new table; reuse `live_shows`. Upcoming = `status=scheduled AND scheduled_at > now`; Past = `status=ended OR (scheduled AND scheduled_at <= now - grace)`. Keep `is_platform` platform shows separate. Lifecycle `scheduled→live→ended` and `scheduled→ended` via cancel.

## Verification

**Commands:**
- `npm test -- src/modules/live-streaming/LiveDashboard.test.jsx src/modules/account/Profile.live.test.jsx` -- expected: edit/reschedule/cancel, expiry filter, non-owner guard
- `npm run build` (apps/carefind) -- expected: vite build clean

## Suggested Review Order

**Upcoming vs Past — expiry**

- Filter Upcoming `scheduled_at > now`, Past shows expired `scheduled` + `ended`
  [`Profile.jsx:356`](../../apps/carefind/src/modules/account/Profile.jsx#L356)

- `LiveShow` respects expiry with “time has passed” notice
  [`LiveShow.jsx:291`](../../apps/carefind/src/modules/live-streaming/LiveShow.jsx#L291)

**Manage — edit/reschedule**

- `toLocalDatetimeValue` + `openEditShow` + `saveEditedShow` validates future >5min and `host_id`
  [`Profile.jsx:367`](../../apps/carefind/src/modules/account/Profile.jsx#L367)

- Same manage in single-show Dashboard with trailer upload
  [`LiveDashboard.jsx:223`](../../apps/carefind/src/modules/live-streaming/LiveDashboard.jsx#L223)

**Cancel — delete or soft-ended with RLS**

- `confirmCancelShow` tries DELETE then fallback `update status:ended`
  [`Profile.jsx:420`](../../apps/carefind/src/modules/account/Profile.jsx#L420)

- DELETE RLS `host_id=auth.uid() AND status=scheduled`
  [`20260831_live_shows_delete_rls.sql:1`](../../apps/carefind/sql/20260831_live_shows_delete_rls.sql#L1)

**Tests**

- Owner edit/reschedule/cancel, past reschedule rejected, expiry, non-owner 42501
  [`Profile.live.test.jsx:1`](../../apps/carefind/src/modules/account/Profile.live.test.jsx#L1)
