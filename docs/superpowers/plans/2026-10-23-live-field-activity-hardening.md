# Live Field Activity Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring Live Field Activity to the field-force market baseline: offline-safe reporting, accuracy-aware location verification, photo evidence, a privacy notice, and one real end-to-end verification.

**Architecture:** Client work stays inside `apps/carehub/src/modules/live-activity/` behind the existing repository seam (`createLiveActivityRepository`). Pure rules (verification, backoff, failure classification) are separate tested functions; the offline queue is a store plus a flusher that calls the same idempotent `logActivity` the page uses today. Database changes are drafted in `docs/architecture/pending-migrations/` and applied only with the owner's approval, one tracked migration at a time.

**Tech Stack:** React 18 + Vite, vitest + Testing Library, IndexedDB (raw), Supabase (PostgREST, Storage, Realtime), PGlite DB tests under `scripts/db-tests/`.

**Spec:** `docs/superpowers/specs/2026-10-23-live-field-activity-hardening-design.md` (and `docs/audits/live-field-activity-audit.md` for what already exists).

## Global Constraints

- Branch from `main` in a **separate worktree** (`feat/live-activity-hardening`). The primary tree has unrelated uncommitted dependency-audit work; never stage or commit there.
- Push to `main` is a production deploy. Work on the branch and open a PR; push to `main` only when told.
- Never apply a migration without explicit owner approval. Use `apply_migration` (never `execute_sql` for DDL) on project `szdybxmgmhndoytqanfb`. After any function create/replace: read `pg_proc` for sibling overloads and `proacl` (expect `postgres | authenticated | service_role`, not `anon`).
- Position stays one-shot and user-triggered. No `watchPosition`, no background capture.
- One commit per unit of work; behaviour fixes separate from moves/refactors. Commit with an explicit path list in the same command as `git add`.
- No new runtime dependency. Dev dependency `fake-indexeddb` needs the owner's approval before `npm install`.
- Every UI addition needs loading, error and empty states, keyboard and screen-reader support, and a check at mobile, tablet and desktop widths (a CSS wrap is not proof).
- CareHub ESLint has no React plugin: after moving or adding JSX, run `npm run lint:undef` to catch un-imported components.
- No `business_type` branching in any of this (financial-eligibility style guard applies to money code only, but keep the feature type-agnostic).

## Review Focus

1. A report written offline, then the tab or browser closed: on reopen it is still pending and is sent exactly once (Task 3).
2. Two tabs flushing the same queue at once: one report, no duplicate (Task 3).
3. Shared device: person B signs in after person A signed out with reports pending; B's session never sends A's reports, and A's are purged on sign-out (Task 3).
4. GPS accuracy missing, zero, or enormous (e.g. 5000 m): never "verified", never a crash, and it fits the database CHECK (Task 2).
5. An attached "photo" that is not an image, is huge, or carries EXIF GPS: rejected with a clear message, or re-encoded with EXIF removed (Task 5).
6. IndexedDB unavailable or over quota when saving offline: the person is told the report was NOT kept; it is never silently dropped (Task 3).

---

### Task 1: Worktree, baseline, and record the realtime publication

**Files:**
- Create: `docs/architecture/pending-migrations/carehub_20261023_realtime_publication.sql`
- Create: `apps/carehub/src/modules/live-activity/__tests__/realtimePublication.migration.test.js`
- Modify: `docs/architecture/pending-migrations/README.md` (add the entry to the apply order)

**Interfaces:**
- Produces: an idempotent migration that guarantees `public.field_activities`, `public.activity_comments`, `public.activity_reactions`, `public.staff_notifications` are members of `supabase_realtime`.

- [ ] **Step 1: Create the worktree off `main`** with `git worktree add ../HealthCare-Ecosystem-hardening -b feat/live-activity-hardening main`; run `npm ci` in `apps/carehub`; run `npx vitest run src/modules/live-activity src/modules/checkins` and record the pass count as the baseline.
- [ ] **Step 2: Write the failing test** `realtimePublication.migration.test.js`: reads the SQL file and asserts it (a) contains each of the four table names, (b) guards every `ALTER PUBLICATION supabase_realtime ADD TABLE` with a `pg_publication_tables` existence check (so a re-run is a no-op), (c) never contains `DROP`, and (d) does not mention the unrelated `"Inventory"` table.
- [ ] **Step 3: Run it, expect FAIL** (file missing): `npx vitest run src/modules/live-activity/__tests__/realtimePublication.migration.test.js`.
- [ ] **Step 4: Write the SQL** as one `DO $$` block looping over the four names. Header comment records that this state was live-only before 2026-10-23.
- [ ] **Step 5: Run the test, expect PASS.**
- [ ] **Step 6: Commit** `docs/architecture/pending-migrations/carehub_20261023_realtime_publication.sql`, the test, and the README line: `docs(live-activity): record realtime publication membership as an idempotent migration`.
- [ ] **Step 7 (owner-approved only): apply** as a tracked migration; verify by re-reading `pg_publication_tables` (the four tables present, `"Inventory"` untouched), then run the security advisor and compare with the pre-apply snapshot.

### Task 2: Store GPS accuracy and judge location with it

**Files:**
- Modify: `apps/carehub/src/lib/geo.js` (around `FACILITY_VERIFICATION`, `facilityVerification`, line ~271-297)
- Modify: `apps/carehub/src/modules/live-activity/LocationMatchBadge.jsx`
- Modify: `apps/carehub/src/modules/live-activity/LiveActivity.jsx` (`submitActivity`, the `draft.activity` object near line 718-744)
- Create: `docs/architecture/pending-migrations/carehub_20261023_activity_gps_accuracy.sql`
- Test: `apps/carehub/src/lib/__tests__/geoVerification.test.js`, `apps/carehub/src/modules/live-activity/LiveActivity.target.test.jsx` (extend), `scripts/db-tests/activity.pglite.mjs` (extend)

**Interfaces:**
- Produces: `FACILITY_VERIFICATION.UNCERTAIN = 'uncertain'`; `facilityVerification(gpsCoords, facility, thresholdM = FACILITY_VERIFY_THRESHOLD_M, accuracyM = null) -> 'verified' | 'uncertain' | 'unverified' | 'pending'`; new `field_activities.gps_accuracy_m integer CHECK (gps_accuracy_m IS NULL OR gps_accuracy_m BETWEEN 0 AND 1000000)`; the activity object gains `gps_accuracy_m`.
- Consumes: `captureLocation` result `accuracyM` (already returned) and `LOW_ACCURACY_M` from `modules/checkins/locationCapture.js`.

- [ ] **Step 1: Write failing tests** in `geoVerification.test.js` for the spec's rule, with `T = FACILITY_VERIFY_THRESHOLD_M`, as a table: `(d<=T, a=null) -> verified`; `(d<=T, a=100) -> verified`; `(d<=T, a=101) -> uncertain`; `(d=T+50, a=101) -> uncertain`; `(d=T+500, a=101) -> unverified`; `(d<=T, a=5000) -> uncertain`; `(d>T, a=50) -> unverified`; `a=0` and `a=NaN` behave as known and unknown respectively; `pendingReview` still wins; no gps or no facility -> `unverified`.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** the new `accuracyM` parameter in `facilityVerification` (existing callers pass three arguments and must keep their result for known-good accuracy). Add the `UNCERTAIN` constant.
- [ ] **Step 4: Run, expect PASS**; run the full `src/lib` and `live-activity` folders to confirm no regression.
- [ ] **Step 5: Badge test + change.** `LocationMatchBadge` renders for `uncertain`: text "Location uncertain", warning colour, title explaining the GPS accuracy was too low to tell. Add a test per state (text, accessible name, no colour-only meaning).
- [ ] **Step 6: Page test + change.** In `LiveActivity.target.test.jsx` assert that `logActivity` receives `gps_accuracy_m` equal to the captured `accuracyM` (and `null` when absent), and that `facility_verified` is `false` for the uncertain case. In `submitActivity` add `gps_accuracy_m: gps ? gps.accuracy ?? null : null` and compute `verifyState` with the accuracy.
- [ ] **Step 7: Draft the migration**: `ALTER TABLE ... ADD COLUMN IF NOT EXISTS gps_accuracy_m` with the CHECK, then `CREATE OR REPLACE FUNCTION public.log_field_activity` with the **identical signature** and the column added to its explicit column list (read the live definition from `supabase/migrations/carehub_20261020_log_field_activity.sql` first and change only that). End with the sibling and `proacl` checks and a `REVOKE ... FROM anon`.
- [ ] **Step 8: DB test.** Extend `activity.pglite.mjs` (run per `docs/audits/live-field-activity-audit.md` section 14): the column is stored via `log_field_activity`; `-1` and `1000001` are refused; a retry with a different accuracy does not change the stored value; exactly one overload of the function exists afterwards.
- [ ] **Step 9: Commit** in two commits: `feat(live-activity): judge location match with GPS accuracy` (client + tests) and `docs(live-activity): draft gps_accuracy_m migration` (SQL + DB test).
- [ ] **Step 10 (owner-approved only): apply**, then verify behaviourally with a rolled-back `DO` block as a real staff user, and re-query for zero residue. The client works before and after the migration only if it omits `gps_accuracy_m` when the column is missing: confirm by checking the RPC returns an error for an unknown key, and if it does, gate the field behind a one-time capability probe in the repository (do not send it until the migration is applied).

### Task 3: Offline outbox

**Files:**
- Create: `apps/carehub/src/modules/live-activity/outbox/failureClass.js`, `backoff.js`, `outboxStore.js`, `outbox.js`, `OutboxStrip.jsx`
- Modify: `apps/carehub/src/modules/live-activity/LiveActivity.jsx` (`submitActivity` catch path, mount the strip, start/stop the flusher)
- Modify: the single sign-out function (find it with `grep -rn "carehub_auth" apps/carehub/src --include=*.js --include=*.jsx | grep removeItem`) to call `outbox.purgeAll()`
- Test: `outbox/failureClass.test.js`, `backoff.test.js`, `outboxStore.test.js`, `outbox.test.js`, `OutboxStrip.test.jsx`, `LiveActivity.offline.test.jsx`
- Modify: `apps/carehub/package.json` (dev dependency `fake-indexeddb`, after approval)

**Interfaces:**
- Produces:
  - `classifyFailure(error: unknown) -> 'retry' | 'permanent'` (permanent for `isPermissionRefusal`, Postgres `22P02`, `23502`, `23503`, `23514`, and HTTP 400/422; everything else, including network errors and 5xx/429, is `retry`).
  - `backoffMs(attempts: number) -> number` = `min(300000, 2000 * 2 ** attempts)`.
  - `createOutboxStore({ indexedDB = globalThis.indexedDB, dbName = 'carehub-live-activity' }) -> { put(entry), get(id), list(scope), update(id, patch), remove(id), clearAll() }` where `scope = { businessId, staffId }` and every method returns a promise that rejects with an `Error` whose `code` is `'unavailable' | 'quota'` when the store cannot be used.
  - Entry: `{ id, businessId, staffId, activity, viewers, voiceBlob, voiceUrl, state: 'pending' | 'failed_permanent', attempts, nextAttemptAt, lastError, createdAt }`, `id` equal to the activity id.
  - `createOutbox({ store, repository, now = Date.now, scope: () => ({ businessId, staffId }) }) -> { enqueue(entry), flush(), list(), retry(id), discard(id), purgeAll(), subscribe(fn) -> unsubscribe, start() -> stop }`. `flush()` takes a `navigator.locks` lock named `carehub-outbox-flush` when available, handles entries oldest first, only for the current scope, uploads the voice note first (storing `voiceUrl` back on the entry before `logActivity`), then calls `repository.logActivity(entry.activity, entry.viewers)`; success removes the entry; `retry`-class failures set `attempts + 1` and `nextAttemptAt`; `permanent` failures set `failed_permanent` with `lastError`.
  - `start()` registers `online`, `visibilitychange` (visible only) and a 60 s interval, and returns a stop function.
- Consumes: `liveActivityRepository.logActivity`, `uploadActivityVoice`, `isPermissionRefusal` (all existing).

- [ ] **Step 1: Pure units, tests first.** `failureClass.test.js` (one case per code above plus a plain `TypeError('Failed to fetch')` -> retry) and `backoff.test.js` (0 -> 2000, 3 -> 16000, 20 -> 300000). Run, expect FAIL; implement; run, expect PASS.
- [ ] **Step 2: Store tests first** with `fake-indexeddb`: put/get/list scoped to a business and staff id (another person's entries are invisible), update merges, remove, `clearAll`; a store opened with `indexedDB: undefined` rejects with `code: 'unavailable'`. Run, expect FAIL; implement the raw IndexedDB wrapper (one object store, index on `businessId`); run, expect PASS.
- [ ] **Step 3: Outbox tests first** with a fake repository and a fake clock: enqueue then flush sends once and removes; a network error leaves the entry with `attempts: 1` and a future `nextAttemptAt`, and an early flush skips it; a refusal marks `failed_permanent` and is not retried by later flushes; `retry(id)` re-arms it; two concurrent `flush()` calls call `logActivity` once; the voice upload happens once even when `logActivity` fails and the entry is flushed again (`voiceUrl` persisted); entries for another scope are never sent; `purgeAll` empties the store. Run, expect FAIL; implement; run, expect PASS.
- [ ] **Step 4: Page integration test first** (`LiveActivity.offline.test.jsx`, modelled on `LiveActivity.save.test.jsx`): with `logActivity` rejecting a network error, the report is enqueued instead of the retry banner, the modal closes, and the toast says it is saved on this device and will send when online. With a refusal it is NOT enqueued and the existing error path runs. With the store rejecting `quota`, the modal stays open and says the report was not kept. Run, expect FAIL; implement in `submitActivity`; run, expect PASS.
- [ ] **Step 5: `OutboxStrip.jsx`** shows nothing when empty; otherwise "N report(s) waiting to send", each item with its state, last error and Retry/Discard for `failed_permanent`; entries older than 7 days get a line saying browsers may delete unsent data and to send it now. Tests: empty renders nothing; pending count; failed item exposes Retry and Discard as buttons with accessible names; the region has `role="status"`. Verify at 375, 768 and 1280 px.
- [ ] **Step 6: Sign-out purge.** Test that signing out calls `purgeAll` (use the existing auth test style next to that function); implement.
- [ ] **Step 7: Commit** per unit: `feat(live-activity): outbox failure classes and backoff`, `feat(live-activity): IndexedDB outbox store`, `feat(live-activity): outbox flusher`, `feat(live-activity): queue reports offline` (page + strip), `fix(auth): clear unsent field reports on sign-out`.
- [ ] **Step 8: Real-browser check** (the page can be driven with the Chrome tools): go offline in DevTools, log a report, close the tab, reopen online, confirm exactly one report appears in the feed and the strip clears. Record the result in the audit doc (Task 7).

### Task 4: Proof photos, storage and database (draft)

**Files:**
- Create: `docs/architecture/pending-migrations/carehub_20261024_activity_photos.sql`
- Test: `scripts/db-tests/activity.pglite.mjs` (extend)

**Interfaces:**
- Produces: private bucket `activity-photos` (5 MB, `image/jpeg|png|webp`, uploads only under `<business id>/`, reads for the uploader or anyone who can see the report, same shape as `carehub_20261020_activity_voice_private.sql`); column `field_activities.photo_paths text[] NOT NULL DEFAULT '{}' CHECK (cardinality(photo_paths) <= 3)`; `log_field_activity` replaced with the identical signature, writing `photo_paths`.

- [ ] **Step 1: DB tests first** (BEFORE shows the gap, AFTER closes it): anon cannot read or upload; a signed-in member uploads only into their company folder; another company and an untagged colleague read 0; a fourth photo path is refused by the CHECK; the function stores `photo_paths` and a retry does not append; one overload only. Run, expect FAIL.
- [ ] **Step 2: Write the SQL**, reusing the voice migration's policy pattern and verification block; include the `REVOKE ... FROM anon` follow-up and the rollback header.
- [ ] **Step 3: Run the DB tests, expect PASS** (including a second apply of the draft).
- [ ] **Step 4: Commit** `docs(live-activity): draft private activity-photos bucket and photo_paths`.
- [ ] **Step 5 (owner-approved only): apply** as its own tracked migration; verify bucket settings, policies, proacl and zero residue; security advisor unchanged.

### Task 5: Proof photos in the app

**Files:**
- Create: `apps/carehub/src/modules/live-activity/photoPrep.js`, `PhotoAttach.jsx`
- Modify: `repositories/index.js` (`uploadActivityPhoto`, `signedPhotoUrl`), `LiveActivity.jsx` (form + feed thumbnails), `outbox/outbox.js` (photos in the entry)
- Create: `apps/carehub/src/modules/live-activity/photoUrl.js` (mirrors `voiceUrl.js`)
- Test: `photoPrep.test.js`, `photoUrl.test.js`, `repositories/photos.test.js`, `PhotoAttach.test.jsx`, `outbox/outbox.photos.test.js`

**Interfaces:**
- Consumes: Task 3's outbox entry (adds `photoBlobs: Blob[]`, `photoPaths: string[]`) and Task 4's column.
- Produces: `prepareProofPhoto(file: File | Blob, { maxEdge = 1280, quality = 0.7 }) -> Promise<{ ok: true, blob: Blob } | { ok: false, reason: 'not_image' | 'too_large' | 'decode_failed' }>`; repository `uploadActivityPhoto(blob, { businessId, activityId, index }) -> Promise<string>` (storage path `<businessId>/<activityId>-<index>-<suffix>.jpg`); `signedPhotoUrl(path) -> Promise<string>`.

- [ ] **Step 1: Tests first** for `photoPrep` (a PDF renamed `.jpg` -> `not_image` by checking the decoded result, not the extension; a file over 15 MB before re-encoding -> `too_large`; output edge <= 1280; output type `image/jpeg`; decode failure -> `decode_failed`) using a stubbed canvas/`createImageBitmap`. Run, expect FAIL; implement; run, expect PASS. Note in a code comment that canvas re-encoding drops EXIF including GPS.
- [ ] **Step 2: Repository tests first** mirroring the voice tests: upload path shape, signed link cached like voice, failure falls back to nothing (never a public URL). Implement; run.
- [ ] **Step 3: `PhotoAttach` tests first**: add up to 3, the fourth control is disabled with a visible reason, each thumbnail has a Remove button with an accessible name, an invalid file shows its reason in a `role="alert"`, keyboard operable. Implement; check three widths.
- [ ] **Step 4: Save flow.** Test that photos upload before `logActivity` (as voice does), `photo_paths` is sent, a failed upload saves nothing and keeps the form, and an offline save stores the blobs in the outbox entry and uploads them on flush. Implement in `submitActivity` and `outbox.flush`.
- [ ] **Step 5: Feed thumbnails** with loading skeleton, error fallback ("photo unavailable"), alt text from the report's place name, and click-to-enlarge using the app's existing modal. Test the three states.
- [ ] **Step 6: Commit** per unit (`photoPrep`, repository, `PhotoAttach`, save/outbox integration, feed thumbnails).

### Task 6: Privacy notice and retention draft

**Files:**
- Create: `apps/carehub/src/modules/checkins/LocationNotice.jsx`, `LocationNotice.test.jsx`
- Create: `docs/privacy/field-activity-location.md`
- Create: `docs/architecture/pending-migrations/carehub_20261025_purge_old_coordinates.sql`
- Modify: `modules/checkins/CheckInPanel.jsx`, `modules/live-activity/LiveActivity.jsx` (render the notice at the two capture points)

**Interfaces:**
- Produces: `<LocationNotice context="checkin" | "report" />` with one-sentence text, an expandable "what is captured, when, who sees it, how long it is kept", and the owner's retention period read from a single exported constant `LOCATION_RETENTION_MONTHS` (value `null` until the owner decides, in which case the text says the period is set by the company); SQL function `public.purge_old_coordinates(p_months integer) RETURNS integer` that nulls `lat`, `lng`, `facility_lat/lng` and `gps_accuracy_m` on `field_activities` and `latitude`, `longitude`, `accuracy_m` on `staff_checkins` older than `p_months`, executable only by `service_role`, **not scheduled**.

- [ ] **Step 1: Component tests first**: renders on both contexts; the expandable section is a real button with `aria-expanded`; text states capture happens only when the person presses check-in or opens the report form, never in the background; with `LOCATION_RETENTION_MONTHS = null` it does not invent a period. Implement; verify at three widths.
- [ ] **Step 2: Docs.** `field-activity-location.md` holds the same facts plus the rights staff have (see their own reports and check-ins; ask the owner to correct or remove). Mark the lawful basis section **"pending counsel review: NDPA"**; do not assert a basis.
- [ ] **Step 3: SQL draft + DB test first** (`activity.pglite.mjs`): rows older than the cutoff lose coordinates but keep everything else; newer rows untouched; anon and authenticated cannot call it; idempotent. Implement; run.
- [ ] **Step 4: Commit** (`feat(checkins): location notice`, `docs(privacy): field activity location notice`, `docs(live-activity): draft coordinate purge, unscheduled`).

### Task 7: Cleanups, real verification, and doc refresh

**Files:**
- Modify: `apps/carehub/src/services/supabase.js` (remove `uploadActivityVoice` and `logActivity`, lines ~931-960, F21)
- Modify: `apps/carehub/src/modules/checkins/CheckInPanel.jsx` and `checkinView.js` (F20: the person's own latest check-in shows its age and a stale label, reusing the manager view's existing age helper)
- Modify: `docs/audits/live-field-activity-audit.md` (refresh the stale "not merged" wording; add section 18 with results)
- Test: `modules/checkins/checkins.test.jsx` (extend)

- [ ] **Step 1: F21.** `grep -rn "uploadActivityVoice\|logActivity" apps/carehub/src` and confirm no import of the `services/supabase.js` versions (the repository's own are the live ones); delete the two functions; run the full CareHub suite and `npm run lint:undef`; commit `refactor(carehub): remove unused logActivity and uploadActivityVoice` separately.
- [ ] **Step 2: F20 test first**: a self check-in older than the stale threshold shows the same stale wording the manager view uses; a fresh one does not; no check-in shows the empty state. Implement; commit `fix(checkins): show age on the person's own check-in`.
- [ ] **Step 3: Two-session verification (manual, needs two signed-in users: an owner and a non-manager staff member).** Record pass or fail for each, with the time and what was seen:
  1. Staff logs a report tagged to the owner and to a second non-manager: it appears live for both, with no reload.
  2. The tagged person's bell shows the server-created alert live.
  3. A voice note records, uploads under `<business id>/`, and plays through a signed link; an anonymous request for the stored URL is refused.
  4. A photo uploads, is private to anonymous requests, and the feed thumbnail loads.
  5. Offline: report queued, tab closed, reopened online, exactly one report.
  6. Sign out with a queued report: the queue is empty for the next person.
  7. Reconnect: kill the network for 60 s while the feed is open; on return the missed report appears (catch-up).
  Each failure becomes a finding in the audit doc and blocks the PR.
- [ ] **Step 4: Audit doc.** Replace the stale "not merged / deploy this branch" statements, add section 18 with the checklist results and the migrations applied with their versions, and update the status table rows for F18, F20, F21.
- [ ] **Step 5: Final gates:** full CareHub suite (note the known `business-directory` 3000x3000 timing failure is pre-existing), `npm run build`, `npm run lint:undef`, and a security advisor comparison against the pre-work snapshot. Open the PR with the standard footer; do not push to `main`.
