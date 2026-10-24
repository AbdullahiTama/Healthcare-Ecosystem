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
| U2 | **RESOLVED on a replica of the live policy: refused (see section 8).** Whether `staff_notifications` inserts addressed to *another* user succeed. The only live policy requires `staff_id` in the caller's own staff ids (or caller is the owner). One live `activity` notification and two `activity_comment` rows exist, which proves it worked at least once (possibly owner/self). | Needs a write attempt | PGlite test (`scripts/db-tests`), not production |
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

## 6. Baseline test run (before any change)

Targeted vitest run over live-activity, checkins, business-discovery, business-directory and lib: **475 passed, 3 failed**. All three failures are in `business-directory`, a module this work did not touch: the 3000 x 3000 dedup timing assertion, and two XLSX tests that timed out.

---

# Outcome (added after implementation)

Work is on branch `feat/live-activity-client-phases`, cut from `main` (confirmed by the product owner as the deployed branch; that is their statement, not something readable from the repository). Nothing has been pushed, merged, deployed or applied to the database. No SQL, migration or policy file was changed.

## 7. Commits

| Commit | What |
|---|---|
| `ac617a0` | Team Reports shows what the person's permissions allow (`canSeeAllActivity` mirrors `caller_sees_all_activity`); this audit |
| `880e22c` | Server-side feed scope, exact counts, `(created_at, id)` cursor, full-range export |
| `d183eb2` | Retry-safe save: client-made id + ignore-duplicates, viewers read-then-add, lock against double tap, frozen payload on retry, notification outcome shown |
| `6d80a28` | Catch-up on every confirmed connection, scoped reaction/comment refresh, honest status badge |
| `23c5965` | A nearby place is a suggestion until chosen; one target per report; "Location matches" / "Compare location" wording |
| `988c505` | A new business can log its first report (starter "What happened" note) |
| `e316ecb` | Distinct location failures with Try again; throttled, cached, attributed area lookup |
| `90f305b` | Unsent report survives reload or accidental close |
| `1ca91ac`, `7fa7335` | Real-Postgres tests: retry-safe save, notification policy, equal-timestamp paging, check-in creates no report |
| `b4478c6` | No Retry offered for a notification the database will always refuse |

## 8. Status of each finding

FIXED = changed and tested in this branch. OPEN = needs a decision or a database change that was not made.

| # | Status | Notes |
|---|---|---|
| F1 Team Reports filtered by tags | FIXED | `feedScope.js`, role-matrix tests |
| F2 "Manager" defined three ways | PARTIAL | Page now uses the database's rule. `manager_checkin_overview` still admits only manager-role names, so a directory-only role sees Team Reports but not Team check-ins. Needs a database decision. |
| F3 Voice bucket public, anon can upload | **FIXED (applied 2026-10-20)** | Bucket private; section 17.1. (Was the highest-severity item.) |
| F4 Save not atomic, failure invites duplicate | **FIXED (applied 2026-10-20)** | `log_field_activity` saves the report and its viewers in one transaction; section 17. |
| F5 Double submit | FIXED | |
| F6 Tagged non-managers miss the live push | **FIXED in the database; live push UNVERIFIED** | The report and its viewers now commit together, so a tagged person can see it at once. Whether Realtime then pushes it to a tagged non-manager has not been observed: see the verification checklist, section 18.3. |
| F7 Default viewers writable for anyone's staff id | **FIXED (applied 2026-10-20)** | Restrictive policies; section 17. |
| F8 Nearest place pre-selected | FIXED | |
| F9 Duplicate columns for one fact | PARTIAL | `facility_*` is the source of truth; `place_*` still written for compatibility. |
| F10 Coverage ignores facility-only reports | OPEN, product decision | See "Decisions needed". |
| F11 Misleading labels | FIXED | |
| F12 Initial subscription not reconciled | FIXED | |
| F13 Global subscriptions / full reloads | FIXED | Initial `load()` still awaits requests one after another. |
| F14 Paging skips tied timestamps | FIXED | Also proven on real Postgres. |
| F15 Count capped at 1000 | FIXED | |
| F16 Export covers loaded rows only | FIXED | Capped at 10,000 rows and says so. "Shared with me" exports only what is loaded and says so. |
| F17 First report blocked | FIXED | |
| F18 GPS failure collapsed | FIXED; accuracy storage DRAFTED | Accuracy is shown at capture. The app now sends it with the report and judges the location match with it ("Location uncertain" for a poor fix); the column that stores it is a draft awaiting approval (section 18). |
| F19 Nominatim use | FIXED for this module | `lib/nigeriaGeo.js` still calls Nominatim directly without throttling or attribution. |
| F20 Check-in self view has no staleness | **FIXED** | The person's own screen labels a check-in older than 60 minutes as old, the same limit managers see (section 18). |
| F21 Dead duplicate `logActivity`/`uploadActivityVoice` in `services/supabase.js` | **FIXED** | Removed; nothing imported them (section 18). |
| F22 Whitespace passes required | FIXED | |
| F23 Missing tests | FIXED | |

| Unverified item | Status |
|---|---|
| U1 Deployed branch | Stated by the product owner as `main`; not independently readable. |
| U2 Cross-user notification inserts | **RESOLVED on a replica of the live policy: refused (42501).** A rep cannot write a notification for a colleague or the owner; the owner cannot for staff; only a platform admin can. Not executed against the live database. The old code swallowed this, so tagged colleagues were presumably never alerted from the browser. |
| U3 `20261012` platform scope live? | Still unverified. |
| U4 Live realtime per role / reconnect | NOT TESTED (needs two browser sessions). |
| U5 Global notification bell subscription | Not read. |
| U6 Platform-directory candidates in the picker | Not offered: suggestions cover the company directory only. |
| U8 Responsive layout and accessibility | NOT TESTED in a browser. |

## 9. Acceptance (task Phase 7)

PASS means a test that was run passed. "Replica" means PGlite with the live policies copied from the catalog, not Supabase itself.

| # | Item | Result | Evidence and limits |
|---|---|---|---|
| 1 | Check-in creates no report | **PASS** | `checkins.pglite.mjs` 61/0 incl. "check in, check out and a failed capture create no field report"; `record_checkin` writes only `staff_checkins`. Not exercised in a browser. |
| 2 | Business Discovery read-only | PASS (static) | Code trace: only writes are "report incorrect information" and manager-only adopt. Existing discovery tests ran green. No dedicated "no writes" test was added. |
| 3 | Nearby facility is not a confirmed visit | **PASS** | `LiveActivity.target.test.jsx` (14): nothing saved until tapped; one target per report. |
| 4 | Target and evidence consistent in feed, table, export, coverage | **PARTIAL** | Feed, table, export PASS (`activityTarget`). Coverage analytics still count only directory-linked reports (F10). |
| 5 | Manager sees Team Reports untagged | **PASS** | Component role-matrix tests; replica confirms the database returns them. Live session not tested. |
| 6 | Ordinary user cannot read another's report | **PASS on replica** | `activity.pglite.mjs` 70/0. No signed-in live session was available. |
| 7 | Tagged recipient receives it live after commit | **FAIL / not implemented** | Needs an atomic save (database function), not approved. |
| 8 | Subscription, reconnect, catch-up: no omissions, no duplicates | **PASS (component level)** | `LiveActivity.realtime.test.jsx` (12) with a mocked socket. Real websocket NOT TESTED. |
| 9 | Write failure cannot duplicate on retry | **PASS** | Repository and page tests; replica proves same-id insert is idempotent and cannot be hijacked. PostgREST's translation of the header is NOT TESTED live. |
| 10 | Repeated clicks make one report | **PASS** | `LiveActivity.save.test.jsx`. |
| 11 | Check-in location current / stale / unavailable / failed is understandable | **PARTIAL** | Manager view PASS (existing tests). The person's own view has no stale label (F20). |
| 12 | Empty fields, permission denial, GPS failure, voice upload failure, offline recoverable | **PARTIAL** | Empty fields, GPS failures, failed save: PASS. Voice-note upload failure: PASS through a fake recorder (nothing saved, form kept, retry reuses the report id, removing the note lets the report through). The real microphone and recorder are NOT TESTED. **No offline queue exists**; a failed send is retried by the user under the same id. |
| 13 | Pagination, counts, export accurate | **PASS (unit + replica)** | Cursor and tie handling proven on real Postgres; count and export paging unit-tested against a scripted backend. PostgREST parsing of the filters checked for syntax only. |

## 10. Final workflow and event model

1. **Check in / out**: an explicit press captures one position and writes `staff_checkins` through `record_checkin`. It is not a visit, a report or a login. A failed capture is stored as failed with no coordinates.
2. **Business Discovery**: read-only research. Creates no activity, attendance event, visit or notification.
3. **Log Field Activity**: the authoritative record. Opening the form requests one fresh position. The rep may choose one place (company directory or map data); nothing is chosen for them. The report is saved under a client-made id, viewers are added, and notification is attempted.
4. **Manager team view**: Team Reports shows everything the person's permissions allow. Team check-ins shows each person's latest explicit check-in with its age, never as live tracking.

**Who sees what.** The database decides (restrictive policy). The page mirrors it: owner, manager role, or a role granted directory management see all; everyone else sees their own reports plus those shared with them. Being tagged grants read access to one report; it is not a notification subscription.

**Provider dependencies.** OpenStreetMap Nominatim (area names): at most one request per second, cached about 110 m, attribution shown. Overpass/OSM for nearby facilities (existing).

## 11. Database work that remained at the time of the original audit (items 1-4 and 6 have since been applied or superseded; see sections 17 and 18)

In suggested order:

1. **Voice bucket** (F3): make `activity-voice` private, authenticated and business-scoped policies, size and type limits, signed URLs. Plan for existing public links.
2. **Default viewers** (F7): restrictive policies so a member writes only their own rows.
3. **Atomic save** (F4/F6): one function that inserts the activity and its viewers in a single transaction, so a tagged recipient is authorised when the row is published.
4. **Server-side alerts** (U2): a trigger or function that writes the notification when a viewer is added or a comment is made, since the browser cannot. This also lets replies reach the rep.
5. **Check-in overview** (F2): decide whether directory-management roles may use `manager_checkin_overview`.
6. **Record realtime publication membership** in a real migration (it is live-only state today) and write down the apply procedure; stop using far-future file names for new work.

## 12. Decisions needed

- Reports about a map-data facility with no directory record are invisible to coverage figures. Show them as "unmatched external places", or add a reviewed import step?
- Offer suggestions from the shared platform directory in the picker (U6)?

## 13. Outstanding risks

- Until item 4 above ships, tagged colleagues are not alerted. The page now says so plainly instead of failing silently.
- Live behaviour has not been observed by a person in a browser. Realtime, layout, accessibility and the real microphone/recorder are NOT TESTED (a fake recorder is tested).
- The `dedup 3000 x 3000` timing test in `business-directory` fails (also in isolation, also before this work); unrelated, but it keeps the full suite red.

## 14. Commands

```
cd apps/carehub
npx vitest run src/modules/live-activity src/modules/checkins src/modules/business-discovery
npx vitest run                      # full suite
npm run build
npm run lint:undef
# real-Postgres tests (PGlite installed outside the repo, scripts copied beside it):
REPO_ROOT=<repo> node activity.pglite.mjs     # 70 passed, 0 failed
REPO_ROOT=<repo> node checkins.pglite.mjs     # 61 passed, 0 failed
```

## 15. What was verified at the final commit, and what was not

Be precise about this: the last complete run of everything is older than the last commit.

| Check | Where | Result |
|---|---|---|
| Whole test suite | at `90f305b` (before the last three commits) | **1908 passed, 2 failed**, run to completion. The 2 failures are in `business-directory`: the 3000 x 3000 dedup timing check, and an XLSX template round-trip that times out only under load (it and `exportService` pass when run alone). |
| Whole test suite | at the final commit `7fa7335` | **Not completed.** The run was stopped by the system for low memory after 61 of 163 test files had reported, with no summary. The only failure it showed was the dedup timing check. No total is claimed. |
| Live Activity, check-ins, Business Discovery tests | at `b4478c6` and again in the partial run at `7fa7335` | All of these files ran and passed (live-activity folder: 16 files, 187 tests). These are the files that cover every source file changed after `90f305b`. |
| `lint:undef` (un-imported components) | at `7fa7335` | Passed, exit 0. |
| Production build | at `7fa7335` | Passed, built in 2m 36s. |
| Real-Postgres tests | scratch copies of `7fa7335` scripts | activity 70 passed / 0 failed; check-ins 61 passed / 0 failed. |
| Lint (errors only) on every changed source file | at each commit | Clean. Warnings were not reviewed one by one. |

The dedup timing test fails on its own as well (11.8 s against its limit), and failed before this work began; it is unrelated to these changes but keeps the full suite red. A complete re-run of the whole suite at the final commit is still owed and should be done on a machine with free memory.

## 16. Drafted database fixes (written and tested; at the time NOT applied. All four were applied on 2026-10-20: section 17)

The four items from section 11 that the product owner asked to be drafted now exist as files in
`docs/architecture/pending-migrations/` (outside `supabase/migrations/`, so nothing can apply them by accident).
`README.md` there has the apply order and the rules for applying. Nothing was applied to any real database.

Tested on real Postgres (PGlite) with the live policies copied from the catalog: `scripts/db-tests/activity.pglite.mjs`,
**143 passed, 0 failed**. Each draft is shown BEFORE (the exposure is real on the replica), AFTER (closed), and re-applied
to prove it can run twice.

| Draft | Fixes | Proven on the replica | Safe to apply alone? |
|---|---|---|---|
| `default_viewers_own_rows` | F7 | A colleague could delete or rewrite another person's list; after, they cannot, while a person still manages their own, a platform admin can correct any, and reading is unchanged. | Yes, no app change |
| `activity_server_alerts` | U2 | The database alerts a tagged viewer and a replied-to author in the same transaction; never the actor; skips inactive and other-company people; a retry adds no second alert; trigger functions are not callable by anyone. | Yes |
| `log_field_activity` | F4, F6 | Activity and viewers saved in one transaction (a bad viewer rolls everything back, leaving no half-saved report); same id twice is one row; cannot forge the author, cross companies, or tag onto someone else's report; tagged colleague can see it at once. Reports `alerts: 'server'` once the triggers exist. | Yes, but nothing calls it until the app does |
| `activity_voice_private` | F3 | Anyone online could read and upload; after, the bucket is private, capped at 10 MB, audio only, uploads limited to a company folder, reads limited to the uploader or to someone who can see the report. Another bucket's policy is untouched. | **No. The app must change first** |

Found while testing, and fixed in the draft: a new recording exists before its report does, and an `INSERT ... RETURNING`
must also pass the `SELECT` policy, so a read rule based only on the report would have refused a brand-new upload. The
uploader may now read their own upload. Live data shows the storage service records the uploader on signed-in uploads
(`owner_id` is set for every signed-in object in the other buckets); the 5 existing voice notes without an owner were
uploaded anonymously and are reached through their report.

Not proven, and needing a check on a Supabase branch or the live project before relying on them:
- that Supabase Storage's upload SQL behaves as modelled (the stand-in `storage.objects` is mine, not Supabase's);
- that PostgREST turns `Prefer: resolution=ignore-duplicates` and `rpc/log_field_activity` into the statements tested;
- that Realtime then pushes the report to a tagged non-manager (a scratch database cannot show it);
- that a voice note plays through a signed URL.

App changes: DONE in this branch, written to work before and after each migration. Voice notes play through signed links and upload to `<business id>/<activity id>-<suffix>.<ext>` with a parameter-free MIME type (`2cb9a9e`); `logActivity` tries `rpc/log_field_activity` first and falls back to the two-request path only when the function is missing, and sends no browser alert when the database reports `alerts: 'server'` (`ecc0bb7`). 225 tests pass in the Live Activity folder. Still unproven on a live project: that a note plays through a signed link, that a new upload lands in the company folder, and that the function is called as modelled.

## 17. Applied to production, 2026-10-20

Three of the four drafts were applied to the live project, one at a time, as tracked migrations, with the product owner's
explicit approval. The first two attempts were rejected by the connector ("Invalid or expired requestState") before
anything ran; the catalog was re-read each time to confirm nothing had changed. After the connector was re-authorised
the third attempt worked.

| Migration | Version | Verified by |
|---|---|---|
| `default_viewers_own_rows` | 20261020154020 | Catalog read-back: three RESTRICTIVE policies for the signed-in role with the reviewed expressions. Rolled-back run on two real staff: a colleague can still read the row but updates 0 rows, deletes 0 rows and is refused when writing a row for someone else; they can write their own; the owner can change and remove their own. |
| `activity_server_alerts` | 20261020154138 | Catalog read-back: both triggers enabled; both functions SECURITY DEFINER with a pinned search_path and executable by neither `anon` nor signed-in users. Rolled-back run: a tagged colleague is alerted once with the right title, place and link; the author is not alerted about their own report; the colleague reads their own alert; the report's author is alerted of a reply; neither the replier nor someone replying to themselves is. |
| `log_field_activity` | 20261020154254 | Catalog read-back: exactly one overload, SECURITY INVOKER, executable by signed-in users and the service role but not `anon`, search_path pinned. Rolled-back run: first call created the report and its viewer and reported `alerts: server`; the retry created nothing and added nobody; an edited retry did not change the stored name; forging another staff member and writing into another company were refused; a bad viewer failed with 22P02 and left no half-saved report; the tagged colleague (role "Doctor", not a manager) could see the report at once; anonymous was refused. |

After every rolled-back run the counts were read again and matched the baseline (12 reports, 1 viewer, 2 comments,
0 default viewers, 3 activity alert rows, no probe rows). The security advisor snapshot after all three was
**identical to the one taken before** (same eight finding types, none naming the new objects).

**Initially held back, then applied (see 17.1): `activity_voice_private`.** The deployed app still plays voice notes from their public URLs and
uploads to the bucket root. Making the bucket private now would stop all 6 existing notes playing and refuse every new
upload until the new app is deployed. It is applied last, after the branch is merged and a voice note is confirmed to
play and upload through the new path (see `docs/architecture/pending-migrations/README.md`).

What this changes for users today, before the app is deployed: tagged colleagues and replied-to reps are now alerted by
the database (the old app's own attempt is still refused and tells the person so); a colleague can no longer rewrite
someone else's default viewers. The one-step save does nothing until the new app, which calls it, is deployed.

Still unproven on the live project: that Realtime pushes a newly saved report to a tagged non-manager (the database now
makes the access visible at once, but no two-session test was run), and everything listed as NOT TESTED above.

### 17.1 The voice bucket was applied too (version 20261020155843)

After being told that applying it before the new app is deployed would stop existing voice notes playing and refuse new
uploads in the older deployed app, the product owner chose to apply it now. It was applied as a tracked migration inside
one transaction (its built-in verification would have rolled everything back on any mismatch).

| Check | Before | After |
|---|---|---|
| Anonymous, signed-out request for an existing voice note (status only, nothing downloaded) | HTTP 200, `audio/mp4` | HTTP 400, JSON, no audio |
| Anonymous upload of a test file | accepted by policy | refused: "new row violates row-level security policy" |
| Bucket | public, no size or type limit, two policies open to `anon` | private, 10 MB, audio types only, exactly two policies, signed-in role only |
| Files kept | 6 | 6 (nothing deleted or moved) |

Rolled-back run as real users on the live policies: the owner sees all 6 existing notes; a brand-new upload is accepted
and read back in the same step (the case that would have failed under a report-only read rule); uploads to the bucket
root, to another company's folder, or to a made-up folder are refused; renaming existing notes changes 0 rows; an untagged
colleague sees 0 of the owner's notes but can upload into their own company's folder; a member of another company and a
signed-out user see 0. Afterwards 6 files, no probe files, all other counts at baseline. The security advisor snapshot
after all four migrations is identical to the one taken before the first.

**Consequence until the new app is deployed (historical):** the older app played voice notes from their stored public
URLs, which no longer worked, and uploaded to the bucket root, which was refused. Branch
`feat/live-activity-client-phases` fixed both and was merged to `main` as `86d7434` and deployed the same day
(`Production – carehub` deployment 7204795572). Not verified live: that a signed link actually plays in a browser (no user session was available to request
one), and that the storage service's own upload path behaves as the replica modelled.

Emergency rollback (restores the exposure) is in the header of `supabase/migrations/carehub_20261020_activity_voice_private.sql`.

## 18. Hardening, 2026-10-23 (branch `feat/live-activity-hardening`)

Design: `docs/superpowers/specs/2026-10-23-live-field-activity-hardening-design.md`. Plan:
`docs/superpowers/plans/2026-10-23-live-field-activity-hardening.md`.

### 18.1 What a read-only check of the live project showed (2026-10-23)

- No report has been saved since 2026-10-19 (12 reports), so the one-step save, the signed voice links, the private
  bucket and the server-side alerts had not been used by a real person after the 2026-10-20 deploy.
- `supabase_realtime` publishes `field_activities`, `activity_comments`, `activity_reactions` and
  `staff_notifications` (the bell subscribes to the last). This was live-only state; it is now written down as an
  idempotent draft migration.
- U3 is resolved: `20261012_directory_platform_scope` is applied.

### 18.2 What was built, and what is only drafted

| Item | State |
|---|---|
| Offline outbox: a dropped connection keeps the report (and an un-uploaded voice note or photos) on the device and sends it later under the same id; a refusal is never queued; a refused or missing-bucket upload is parked with a Retry; the queue shows on the page and runs on every dashboard page | Built, tested in a simulated browser. The real IndexedDB backend has **no automated test** (`fake-indexeddb` was not installed without approval) and has **not been run in a real browser**. |
| Sign-out | A deliberate sign-out removes unsent offline reports from the device; an expired session keeps them. **Consequence to decide on:** a person who signs out while reports are still unsent loses them. Consider a warning. |
| Location match judged with GPS accuracy ("Location uncertain" for a fix worse than 100 m) | Built. The accuracy is stored: `carehub_20261023_activity_gps_accuracy` was applied to production on 2026-10-23. |
| Proof photos (up to 3, resized, GPS stripped, private, shown on the report) | Built. `carehub_20261024_activity_photos` was applied to production on 2026-10-23 (it was applied AFTER the app that offers photos was deployed, so for a few hours a photo upload got a 404: reports parked or the form said nothing was saved; reports without photos were never affected). Not yet exercised by a real person. |
| Notice of when location is captured | Built (`LocationNotice`); retention wording stays neutral until the company sets a period. |
| F20 own check-in staleness, F21 dead code | Built. |

Applied to production on 2026-10-23 with the owner's approval, one at a time as tracked migrations (files now in
`supabase/migrations/`), each verified by catalog read-back and a rolled-back run as real users with zero residue:

1. `carehub_20261023_realtime_publication` (version 20261023160811): records the realtime membership. A no-op live.
2. `carehub_20261023_activity_gps_accuracy` (20261023160845): column + `log_field_activity` replaced (same signature).
   Probe: accuracy 25.6 stored as 26, a retry could not change it, -1 refused (23514), anonymous refused (42501),
   the viewer was added and the database alerted them in the same call.
3. `carehub_20261024_activity_photos` (20261023161023): private bucket, `photo_paths`, `log_field_activity` replaced
   again. Probe as three real users and anonymous: own upload and read-back; outside the company folder, the bucket
   root, a fourth photo and an anonymous upload all refused; an untagged colleague saw 0 and a tagged one saw it; another
   company saw 0; **a report naming another company's file granted no read of it**; anonymous saw 0.

Security advisor: 8 findings before, 8 after, none new.

Still a draft, **held**: `carehub_20261025_purge_old_report_coordinates.sql`. Do not schedule it until the owner sets
the retention period.

PGlite database tests (`scripts/db-tests/activity.pglite.mjs`): 214 passed, 0 failed, with the live policies copied
from the catalog. Not proven by them: Supabase Storage's own upload path, PostgREST's handling of the new calls, and
Realtime delivery.

### 18.3 Verification checklist (nobody has run this yet)

Needs two signed-in people (an owner and a non-manager staff member) on the deployed or a preview build. Record each
result with the time and what was seen. A failure is a finding and blocks release.

| # | Check | Result |
|---|---|---|
| 1 | Staff logs a report tagged to the owner and to a second non-manager: it appears live for both, with no reload | NOT RUN |
| 2 | The tagged person's bell shows the server-created alert live | NOT RUN |
| 3 | A voice note records, uploads under `<business id>/`, and plays through a signed link; an anonymous request for the stored URL is refused | NOT RUN |
| 4 | (Migration 3 is now applied) A photo uploads, an anonymous request for it is refused, and the feed thumbnail loads | NOT RUN |
| 5 | Offline: go offline, log a report, close the tab, reopen online: exactly one report appears and the strip clears | NOT RUN (the browser tool was not connected) |
| 6 | A deliberate sign-out with a queued report empties the queue for the next person; an expired session keeps it | NOT RUN |
| 7 | Reconnect: drop the network for 60 s with the feed open; on return the missed report appears | NOT RUN |

### 18.4 Known gaps and decisions still open

- Retention: the period for report positions is undecided. Check-in positions have **no retention**: those rows must
  carry coordinates and the table is append-only by trigger, so removing them needs an audited exception to a security
  control (see `docs/privacy/field-activity-location.md`).
- The NDPA lawful basis for location capture has not been reviewed. The privacy document says so and asserts nothing.
- Whether the owner can in fact correct or remove a report is unverified; the notice tells people to ask their owner.
- `LiveActivity.draft.test.jsx` "after a failed send, editing the form again does not put a draft back" is a timing
  test (fixed 450 ms wait) that failed once or twice under heavy machine load and passes alone.
- F2 and F10 still need owner decisions (section 12).

## 19. Field team reorganisation, 2026-10-24 (branch `feat/field-team-reorganisation`)

Design: `docs/superpowers/specs/2026-10-23-field-team-reorganisation-design.md`. Plan:
`docs/superpowers/plans/2026-10-23-field-team-reorganisation.md`. Scope: manufacturers and wholesalers only (owner).

- **Reps** land on Field (check in, log a visit, My Feed, Shared with me) and their default menu is Field, Orders,
  Messages. "Raise order" on their own report opens the order form for that customer, linked to the visit.
- **Field managers** (owner, a manager role, or "Manage field team", the existing `canManageDirectory` key) get a
  Field team section: Team reports, Team check-ins, Order approvals, Places to confirm, Report fields (owner); and
  "Field team today" on the dashboard home.
- **Found and fixed in the app:** a role without the dashboard was redirected to the dashboard forever.
- **Found, drafted, not applied:** order approval was enforced only in the browser (see the README, draft 3).
- **F2** is closed by draft 1 once applied. **F10** still needs an owner decision.
- **Not verified in a browser** (none was connected): the five pages, the dashboard panel and Raise order at
  375, 768 and 1280 px. Team check-ins for a "Manage field team" role stays refused until draft 1 is applied; the
  dashboard panel then shows the check-in error and still shows the visits.
