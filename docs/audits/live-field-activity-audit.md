# Live Field Activity: Phase 0 audit (read-only)

Audit date: 2026-10-20. Scope: Live Field Activity, check-ins, Business Discovery, directory linkage, realtime.
Nothing in this document was changed or deployed; the only file written is this one.
Evidence labels: **CONFIRMED** (read in code, or read from the live catalog), **UNVERIFIED** (needs a scratch DB, a browser, or deploy settings), **BLOCKED** (cannot be inspected from here).

## 0. Baseline

| Item | Finding |
|---|---|
| Checkout | `main`, HEAD `5e58001a32ffa4e29089d1d3ac1af7347aa948be`, working tree clean. Other worktrees exist under `.claude/worktrees/` and `AppData/Local/Temp/opencode/`; none touched. |
| Remote | `AbdullahiTama` only (`github.com/AbdullahiTama/Healthcare-Ecosystem`). |
| main vs master | CONFIRMED divergent: `main` has 752 commits not on remote `master`; remote `master` has 14 SHAs not on `main`. Their subjects (Business Directory, Territory Intelligence, CareFind directory unification) also appear on `main` under different SHAs (e.g. `82f1d8b`), so they were re-applied, not merged. Content equality of the two copies is UNVERIFIED. Local `master` is 111 commits behind its remote. |
| Deployment branch | **BLOCKED / UNVERIFIED.** `apps/carehub/vercel.json` has no branch setting. CI (`.github/workflows/carehub-ci.yml`) triggers on `main` and `master`. The project memory says a push to `main` deploys, but that is a note, not a configuration I can read. Needs confirmation in the Vercel dashboard. |
| Live DB | Supabase project `szdybxmgmhndoytqanfb` ("carehub", ACTIVE_HEALTHY, Postgres 17). Only SELECTs against catalogs and counts were run. |
| Required docs | `docs/PROJECT_OVERVIEW.md`, `planning/ROADMAP.md`, `planning/CODE_AUDIT.md` (named in CLAUDE.md) **do not exist** in this tree. `README.md` and `AGENTS.md` exist. The CI header cites a `ROADMAP.md §10.2` that is not present. |
| Test commands | `apps/carehub`: `npm test` (vitest run), `npm run build`, `npm run lint`, `npm run lint:undef`. DB tests: `scripts/db-tests/*.pglite.mjs` (PGlite, no Docker). |
| Baseline run | Targeted vitest run (live-activity, checkins, business-discovery, business-directory, lib) was started; result appended in section 6. |

### Migration naming and history (CONFIRMED)
- Repo files `carehub_20261130_staff_checkins.sql`, `carehub_20261131_field_activity_access.sql`, `..._20261132_...`, `..._20261133_...` are **not dated files**: 2026-11-31 is not a calendar date, and the real apply date is 2026-10-19. The live `supabase_migrations` rows are `20261019135844`, `...135948`, `...140138`, `...140215`. The apply tool stamps its own timestamp, so file name and live version do not match.
- A manual convention is visible in the live list (`202608019001` style = date + 9001 sequence) alongside tool-stamped versions. No document in the repo states the procedure. `supabase/config.toml` exists, so the CLI would order by file name; the invented far-future prefixes would sort after any real later timestamp.
- Realtime publication SQL (`carehub_20261127_realtime_activity_tables.sql`) is in `docs/architecture/retired-migrations/` and marked DO NOT APPLY, on the grounds that the tables were already published. CONFIRMED live: `field_activities`, `activity_reactions`, `activity_comments`, `staff_notifications` are in `supabase_realtime`; `activity_viewers` and `staff_checkins` are not. **No migration in the repo records this**, so publication membership is live-only state and cannot be recreated from the repo.
- `apps/carehub/sql/20261011_territory_intelligence.sql` and `20261012_directory_platform_scope.sql` are outside `supabase/migrations/` and absent from the live migration list. The live functions they define (`directory_unvisited`, `directory_coverage_summary`, `directory_rep_activity`, `directory_visit_totals`, `can_manage_directory`) exist, so something applied them by another route. Whether the `20261012` platform-scope changes are live is UNVERIFIED.
- Stale comments: `carehub_20261131` and `carehub_20261130` headers say `is_business_manager()` is not executable by `authenticated`; live ACL (after `20261132`) grants it. `checkins/repositories/index.js:3-5` cites `carehub_20261123_staff_checkins.sql`, which no longer exists under that name.

## 1. Confirmed architecture and event flow

**Four separate events, four separate tables.**

| Event | Entry point | Write path | Table |
|---|---|---|---|
| Check in / out | Button in `CheckInPanel.jsx:49-50` | `checkinRepository.record` -> RPC `record_checkin` (SECURITY DEFINER; membership from `auth.email()`; 5 s duplicate guard; failed capture stored as `status='failed'`, no coordinates) | `staff_checkins` (append-only trigger, no direct INSERT grant) |
| Business Discovery | `BusinessDiscovery.jsx` | Reads only. Only write is a "report incorrect information" note (`:218`) and manager-only adopt (`:209`). No activity, check-in or notification is created. | none of the above |
| Field report | `LiveActivity.jsx` `submitActivity` (`:592`) | `uploadActivityVoice` -> `logActivity` (repo `:83`): POST `field_activities`, then POST `activity_viewers`, then POST `staff_notifications` (best effort) | `field_activities`, `activity_viewers`, `staff_notifications` |
| Manager team view | `TeamLocations.jsx` | RPC `manager_checkin_overview` (requires `is_business_manager`, writes `location_access_log`) | read of `staff_checkins` |

**Report trace.** `openLogger` (`:520`) hard-stops if `fields.length === 0`, resets state, then calls `getCurrentPosition` (`:541`) as soon as the form opens. On a fix it (a) reverse-geocodes via Nominatim, (b) runs `discoverFacilities` and **pre-selects** the nearest facility (`:567-577`); `FacilityPicker` also auto-selects the first result when nothing is chosen. `NearbyBusinessPicker` independently lists directory businesses; the rep's click sets `confirmedBiz`. On submit the row stores facility fields (`facility_*`, plus duplicates `place_of_visit`, `place_coords`, `place_verified`) and, only if the rep confirmed one, `directory_business_id` + `directory_business_name`. A BEFORE INSERT/UPDATE trigger (`trg_field_activities_directory_link`) guards the link; FK is `ON DELETE SET NULL`.

**Feed trace.** `load()` (`:245`) runs sequential awaits (fields, activities, staff, territories, counts, viewers, reactions, comments, default viewers). Realtime: `watchTable('field_activities', business_id)` inserts the row into state; reactions/comments subscribe unfiltered with a debounced refetch. Comments/reactions notify only the rep (`repo :115-129`).

**Who decides what (owners of state).**
- Navigation/Team tab: client regex `isManagerRole(role)` (`permissions.js:200`) at `LiveActivity.jsx:105`.
- Row visibility: database RESTRICTIVE policy `field_activities_select_restrict` -> `caller_sees_all_activity()` = platform admin OR `is_business_manager()` OR `can_manage_directory()`, else author, else tagged viewer.
- Check-in overview: `is_business_manager()` only.
- Visit target: **three competing owners**: `facility` (picker + `openLogger` auto-pick), `confirmedBiz` (NearbyBusinessPicker), `placeName` (reverse geocode, feeds `location_label`).
- Coverage analytics count only `directory_business_id IS NOT NULL`.

## 2. Confirmed findings

Severity: High = security exposure or silent data/behaviour failure; Medium = wrong or misleading behaviour; Low = hygiene.

### High

**F1. Team Reports is filtered by viewer tags.** `LiveActivity.jsx:749-755`: when `scope === 'team'` and the user is a non-owner manager, the filter falls through to "authored or tagged as viewer". Only the owner (`isOwner`) skips it. The database returns all rows to a manager, so the UI hides rows the user is entitled to see. Impact: managers see only tagged activity under "Team Reports"; the tab count (`countFieldActivities`, `:61`) disagrees with the list.

**F2. "Manager" is defined three ways.** Client `/manager/i` on role name; DB `is_business_manager` (`role ~* 'manager'`, or an owner/ancestor email) for check-ins; `caller_sees_all_activity` adds `can_manage_directory` (custom roles granting directory management). Consequence for a custom role with directory management but no "manager" in its name: RLS lets it read all activity, the Team tab and `TeamLocations` never render (`LiveActivity.jsx:883,903`), and `manager_checkin_overview` would refuse it. `LiveActivity` is not given `perms`, only `allowedModules`.

**F3. Voice-note bucket is public and anonymously writable.** Live: bucket `activity-voice` `public=true`; storage policies `activity-voice insert` (anon, authenticated; `with_check bucket_id = 'activity-voice'`) and `activity-voice read` (anon, authenticated). Object names are `voice-<Date.now()>-<5 random digits>.<ext>` (`repo :164`), so they are guessable in a bounded space, and any anonymous client can both upload arbitrary files and read any note. The audio is a first-person account of field work and may name patients or clients. No size or MIME limit is set on the bucket. Production change needed; not made.

**F4. Saving is not atomic and the failure message invites a duplicate.** `repo.logActivity` (`:83-103`) inserts the activity, then viewers. If the viewer insert fails, the activity exists but `submitActivity` shows "Could not log activity" and leaves the modal open (`:661-662`); retry creates a second report. A failed activity insert after a successful voice upload orphans the audio file (`:604`). `notify` swallows every error (`:19`), so a failed notification is invisible. There is no client-generated idempotency key.

**F5. Double submission is possible.** The footer button (`:1296`) is never disabled while `saving`; `saving` only changes its label. `submitActivity` has no in-handler guard. Two quick taps run two uploads and two inserts.

**F6. Tagged non-managers do not get the report live, and the feed claims they do.** `activity_viewers` is written after the activity (`:84-89`); Realtime evaluates RLS at insert time, when the tagged person is not yet authorised, so no push is delivered to them. The migration header admits this (`carehub_20261131` "KNOWN CONSEQUENCES"). The page description says "Tagged managers see it the moment it lands" (`:866`); managers are see-all by role, and the people who actually need tagging (non-managers) are the ones who miss the push. `activity_viewers` is not published. The `staff_notifications` row is published, but `LiveActivity` does not subscribe to it, and whether a global bell does is UNVERIFIED.

**F7. `activity_default_viewers` is writable by any business member for any staff id.** Live: the only policy is `activity_default_viewers of own business` (PERMISSIVE ALL, `business_id IN current_business_ids()`); no restrictive policy was added by `20261131`. `setDefaultViewers(businessId, staffId, ...)` (`repo :41`) takes the staff id from the caller. A colleague can therefore replace *another person's* default viewer list, including by adding themselves; the victim's next report is tagged to them and becomes readable through `is_activity_viewer`. The code path is CONFIRMED by reading; the exploit itself was not executed (it would need a write). Live table currently has 0 rows, so nothing is exposed today.

### Medium

**F8. A nearby candidate is recorded as the visit before the rep confirms it.** `openLogger` calls `setFacility(best)` (`:567-577`) and `FacilityPicker` auto-selects the first result again; the saved row gets `place_of_visit`, `facility_name`, `location_label` from it. Two independent auto-selectors. The directory business, by contrast, does require a click. The rep sees two different "where" controls with different save fields and different analytics treatment.

**F9. Duplicated columns for one fact.** `place_of_visit`/`facility_name`, `place_coords`/`facility_lat,lng`, `place_verified`/`facility_verified` are all written together (`:641-653`); the feed reads `facility_verified != null ? ... : place_verified` (`:1125`). Existing columns are sufficient to represent the model (see section 4), so no new schema is needed for the target.

**F10. Coverage analytics ignore facility-only visits.** `directory_visit_totals`, `directory_unvisited`, `directory_coverage_summary`, `directory_rep_activity` count only rows with `directory_business_id`. A report whose target is a detected facility counts as an unlinked activity. They are SECURITY INVOKER, so a non-see-all caller would also see understated totals through RLS (acceptable, since Territory Intelligence is manager-facing, but it is undocumented).

**F11. Misleading labels.** "Verify location" (`:1210`, modal `:1577`) opens a read-only comparison (`readOnly`, "without altering the record") and approves nothing. The "GPS verified" badge (`:1127`) is a distance test only. The `LIVE` badge (`:856`) shows a subscription state for one table and reads as "all records are being delivered".

**F12. Initial subscription is not reconciled.** `load()` runs at mount (`:178`); the subscription starts in a separate effect and catches up only on a `disconnected` -> `live` transition (`:196`). A row inserted between the fetch and `SUBSCRIBED` is never shown until reload.

**F13. Reaction/comment subscriptions are global and refetch broadly.** `subscribeChanges({table:'activity_reactions', event:'*'})` (`:236-237`) carries no business filter (those tables have no `business_id` column; RLS is the boundary) and triggers a refetch of reactions and comments for the newest 100 activities. After the user's own action, the whole page runs `load()` again (`:678,:702`), re-fetching staff and territories as well.

**F14. Pagination can skip rows.** Keyset on `created_at` alone with a strict `lt` (`repo :57`). Rows sharing a boundary timestamp are skipped by the next page. Live data has no ties today (queried), so this is latent.

**F15. Counts are capped.** `countFieldActivities` downloads up to 1,000 ids and counts them (`repo :61-65`); the badge then prints "1000+". It also counts different rows from what the tab shows (F1).

**F16. Export covers only loaded rows.** `exportCSV` (`:822`) exports `visible`, which is the client-filtered subset of the loaded pages (100 per page). The copy "Export downloads exactly what you see" is true, but "All time" does not export all time unless every older page was loaded.

**F17. First report is blocked for new businesses.** `openLogger` returns with a toast when no custom fields exist (`:521-524`); only the owner can add fields (`:868`), and a banner shows only to the owner (`:894`). Staff see a toast and nothing else.

**F18. GPS failure is collapsed.** The `getCurrentPosition` error callback ignores the error (`:586`), so denial, timeout, unavailable and unsupported all read "Location not available". Accuracy is not stored on `field_activities` (no column), so the poor-accuracy case cannot be shown in the feed. `captureLocation()` in `checkins/locationCapture.js` already classifies these correctly and is not reused. Opening the form is itself an explicit user action, so a one-time capture there is acceptable; it is not background tracking.

**F19. Nominatim use.** `repo.reverseGeocode` (`:131`) calls the public endpoint straight from the browser on every form open: no throttle, no cache, no attribution shown. Two more direct callers: `lib/nigeriaGeo.js:236`, `business-directory/services/geocoding.js:11`. The usage policy requires attribution and at most one request per second.

### Low

**F20. Check-in self view has no staleness.** `CheckInPanel` shows "Your last record ... at <time>" with no stale/unavailable label (`:57-60`). The manager view labels freshness correctly from the server (`describeStaffRow`), and a failed attempt is shown as failed.

**F21. Duplicate `logActivity`/`uploadActivityVoice`/`notify`** also exist in `services/supabase.js:921-936` next to the repository versions. Repository seam violation; callers of the old copy not checked.

**F22. Required-field validation** (`:593`) treats whitespace-only text as present.

**F23. Tests do not cover the high findings.** `LiveActivity.log.test.jsx`, `repositories/index.test.js` (20 lines) and `checkins.test.jsx` exist; there is no test of Team Reports filtering, retry/duplicate behaviour, realtime catch-up, or role matrix at UI level. `scripts/db-tests/activity.pglite.mjs` covers policies on a scratch DB.

## 3. Unverified or blocked

| # | Item | Why unverified | How to close |
|---|---|---|---|
| U1 | Deployed branch | No readable config | Vercel project settings |
| U2 | Whether `staff_notifications` inserts addressed to *another* user succeed. The only live policy requires `staff_id` in the caller's own staff ids (or caller is the owner). One live `activity` notification and two `activity_comment` rows exist, which proves it worked at least once (possibly owner/self). | Needs a write attempt | PGlite test (`scripts/db-tests`), not production |
| U3 | Whether `20261012_directory_platform_scope.sql` is live | Not in the migration list | Query live columns/functions it defines, compare |
| U4 | Live realtime delivery per role, reconnect behaviour | Needs two sessions in a browser | Browser test, staging project |
| U5 | Whether a global notification bell subscribes to `staff_notifications` | Not read | Read `BusinessDashboard`/notification code |
| U6 | Platform-directory (shared registry) candidates in `NearbyBusinessPicker` / link-guard behaviour for platform-scope rows | Search service and guard not read in this pass | Read `business-directory/services/search.js` and the guard function |
| U7 | Baseline test status | Run in progress | Section 6 |
| U8 | Responsive/a11y behaviour of the modal and feed | No browser run | Browser check at three breakpoints |

## 4. Mapping the visit target onto existing columns (no new schema)

| Concept | Existing column | Rule |
|---|---|---|
| Company directory record the rep confirmed | `directory_business_id` (+ `directory_business_name` snapshot) | Set only by an explicit click. Tenant-scoped by the link guard. |
| Facility from map/engine | `facility_name`, `facility_address`, `facility_category`, `facility_lat/lng`, `facility_source` (`detected`/`rep_added`/`manual`) | Provenance lives in `facility_source`. External provider ids are not stored today; none is needed until an adoption path exists. |
| GPS evidence | `lat`, `lng`, `facility_distance_m` | Evidence only. |
| Verification state | `facility_verified`, `facility_pending_review` | Distance-based; label as "location matches", not "visit verified". |
| Legacy duplicates | `place_of_visit`, `place_coords`, `place_verified` | Keep writing for compatibility; define `facility_*` as the source of truth in docs. |

Gap that does need a decision: a report about an *external* place that has no directory record (analytics ignore it, F10). Options: leave as "unmatched external" in analytics output, or add an import/adopt step. That is a product decision, listed below.

## 5. Implementation plan and acceptance criteria

Small phases, each with targeted tests and its own commit. Items marked **[prod]** change the live database and need explicit approval first.

1. **Permission single source (client).** Add `canSeeAllActivity(perms, role)` derived from the same inputs as `caller_sees_all_activity`; pass `perms` into `LiveActivity`; use it for Team tab, `TeamLocations`, and the feed filter. Fix F1/F2 client side. Accept: manager and directory-manager custom role both see every row in Team Reports; ordinary staff see own + tagged only; tab counts equal list length. Decision on whether `manager_checkin_overview` should also admit `can_manage_directory` **[prod]**.
2. **Server-side filter and counts.** Repository takes `{scope, staffId}`; "My Feed" = `staff_id = me`; counts via `Prefer: count=exact` + `head`; keyset on `(created_at, id)`. Fix F1, F14, F15. Accept: no duplicates or gaps across a tie boundary (test with equal timestamps); counts exact above 1,000.
3. **Atomic, idempotent save.** Prefer one RPC `log_field_activity(...)` that inserts the activity and its viewers in one transaction, with a client-generated `client_request_id` (unique per author) so a retry returns the existing row; notification enqueue in the same RPC if U2 confirms the current path cannot reach other users. **[prod]** (new function + a unique column). Client: ref guard + disabled button, preserved draft on failure, truthful states ("saved", "saved, notification pending", "retry"). Fix F4/F5. Accept: simulated viewer-insert failure then retry yields exactly one report; ten rapid clicks yield one.
4. **Realtime.** With viewers committed with the activity (phase 3) the tagged recipient is authorised when the row is published. Reconcile on first `live`; scope reaction/comment refresh to the affected activity ids; stop calling full `load()` after own actions; reword the badge to "Live updates on" and the page description. Fix F6, F11 (badge), F12, F13. **[prod]** only if `activity_viewers` is to be published (not required).
5. **Target selection.** One "Business or facility visited" control with a candidate source label; no auto-selection of a facility (candidate shown, rep clicks); single state owner; `location_label` set from the confirmed target or reverse geocode, never presented as the target. Rename "Verify location" to "Compare location" and the badge to "Location matches"/"Location differs". Fix F8, F9, F11.
6. **Setup, GPS, geocoding.** Default report fields when none exist, with staff-visible guidance; reuse `captureLocation()` for distinct GPS states; trim-based required check; throttled, cached geocoder behind one function with attribution. Fix F17, F18, F19, F22.
7. **Voice bucket hardening [prod].** Make `activity-voice` private, replace anon policies with authenticated, business-scoped policies, add size/MIME limits, serve through signed URLs; delete orphan on failed save. Fix F3. Needs a plan for existing public URLs (12 activities live; count of voice rows not yet checked).
8. **Default-viewers policy [prod].** Add RESTRICTIVE policies so a member can only write their own `staff_id` rows. Fix F7.
9. **Migration hygiene.** Record publication membership in a real migration (idempotent `ALTER PUBLICATION ... ADD TABLE` guarded by existence), write the apply procedure down, correct stale headers. No far-future file names for new work.
10. **Tests and docs.** Role-matrix component tests; PGlite tests for policies, idempotent RPC, default-viewer policy; update this file and the developer docs.

Definition of done is as in the task brief; every item stays NOT TESTED until its command is run and its output recorded here.

## 6. Baseline test run

(Appended after the run completes.)
