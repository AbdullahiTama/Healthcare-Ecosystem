# Live Field Activity hardening: design

Status: draft for owner review. Builds on `docs/audits/live-field-activity-audit.md` (sections 8-17), which records what is already fixed and applied. This document covers only what is left to reach the market standard.

## Why

Field-force products converge on the same baseline: proof a visit happened (position, time, evidence), reporting that works offline, safe retries, and a lawful, explained use of staff location. CareHub already has the retry safety (client-made ids, `log_field_activity`), the private voice bucket, server-side alerts and a live feed. Three gaps remain: reports cannot be written without a connection, location evidence ignores how accurate the GPS fix was, and there is no photo evidence or privacy notice. A fourth need is not a build task: nobody has run the repaired feature end to end in a browser, and no report has been saved since the 2026-10-20 deploy.

## Goals

1. A report written with no connection is kept on the device and sent exactly once when the connection returns, with the person told honestly what is pending, sent or refused.
2. A location match is judged with the GPS accuracy taken into account, and the accuracy is stored.
3. A report can carry up to three proof photos, stored as privately as the voice notes.
4. Staff are told, in the app, exactly when their position is captured and what happens to it.
5. The whole flow is verified once by a person in two browser sessions, and the result is written down.

## Non-goals

- Continuous or background location tracking. Position stays one-shot and user-triggered.
- Replacing Postgres Changes with Broadcast. The live feed and `staff_notifications` already push (both tables are in the `supabase_realtime` publication, checked live 2026-10-23). Revisit only if subscriber counts grow; Supabase documents that Postgres Changes scales less well because each event is access-checked per subscriber.
- Fixing F2 (check-in overview roles) and F10 (coverage of map-data facilities). Both need an owner decision and are listed in the audit.
- Sample accountability or any pharma-specific call report. No Nigerian rule was confirmed by the research; ask the owner whether reps hand out samples before scoping it.

## Anti-goals (a failure even if it technically works)

- A queued report sent under the wrong person's identity on a shared device.
- A "verified" badge that appears because of a poor GPS fix.
- Proof photos readable by anyone outside the company or the report's viewers.
- Location captured without the person pressing something.

## Decisions (calls made by the author; the owner can override)

- **Offline store:** IndexedDB, hand-written thin wrapper, no new runtime dependency. `fake-indexeddb` as a dev dependency for tests (needs approval to install). Background Sync API is not used (Chrome/Edge only); the queue flushes on `online`, on tab becoming visible, and every 60 s while the app is open.
- **Retry policy:** transient failures back off 2 s, 4 s ... capped at 5 min. A permission refusal, or a Postgres error class that will fail again (invalid input, constraint), moves the entry to `failed_permanent` and is shown to the person; it is never retried silently.
- **Verification rule** (distance `d`, threshold `T = FACILITY_VERIFY_THRESHOLD_M`, accuracy `a`, `LOW_ACCURACY_M = 100`):
  - verified: `d <= T` and (`a` unknown or `a <= LOW_ACCURACY_M`)
  - uncertain: `a > LOW_ACCURACY_M` and `d <= T + a`
  - unverified: everything else. Pending review (rep-added place) is unchanged.
  The stored `facility_verified` boolean keeps its meaning (true only for the verified case), so coverage figures do not change. "Uncertain" is derived when displayed, from the stored distance and accuracy.
- **Photos:** private bucket `activity-photos`, same policy shape as `activity-voice`, 5 MB cap, jpeg/png/webp only. The browser re-encodes to JPEG at max 1280 px, which also strips EXIF (including embedded GPS).
- **Retention of coordinates:** a purge function is drafted but not scheduled. The retention period is the owner's decision (see Open questions).

## Open questions for the owner

1. Retention period for check-in and report coordinates (suggested: 12 months; the author's guess, not researched).
2. Do reps hand out product samples? If yes, a sample register is a separate project.
3. The NDPA and its 2025 General Application and Implementation Directive were not read in full by the research. Counsel should confirm the lawful basis for location capture before the privacy notice text is final.
