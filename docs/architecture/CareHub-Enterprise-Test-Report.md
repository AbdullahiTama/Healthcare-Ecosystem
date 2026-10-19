# CareHub Enterprise Directory and Field Operations: Test Report

Branch `feat/enterprise-directory` (head after this commit). Run 2026-10-19 on a Windows development machine. Nothing here was run against Supabase, a browser, or a live Google key.

## 1. What was actually run

| Check | Command | Result |
|---|---|---|
| Full CareHub suite | `npx vitest run` in `apps/carehub` | **141 files passed, 1,645 tests passed, 0 failed** (639 s). Baseline before any change: 132 files, 1,528 passed, 5 skipped, and 2 router files failed with `Hook timed out in 30000ms` on a loaded machine. Those two passed in the final run, which suggests load, not a regression, but they were never re-run in isolation at baseline |
| Production build | `npm run build` in `apps/carehub` | **Built, exit 0**, 3 m 39 s. The existing "chunks larger than 500 kB" warning remains (not caused by this work) |
| Undefined-identifier lint | `eslint -c eslint.no-undef.json` on every new/changed directory | Clean |
| Directory database tests | `scripts/db-tests/directory.pglite.mjs` | **64 passed, 0 failed** |
| Check-in database tests | `scripts/db-tests/checkins.pglite.mjs` | **60 passed, 0 failed** |
| Activity access, link and realtime publication tests | `scripts/db-tests/activity.pglite.mjs` | **56 passed, 0 failed** |
| Staff privilege and tenant tests | `scripts/db-tests/staff.pglite.mjs` | **29 passed, 0 failed** |
| Import merge database tests | `scripts/db-tests/merge.pglite.mjs` | **49 passed, 0 failed** |
| Spatial query plan | ad hoc script on 30,000 synthetic rows | Bounding box uses `directory_businesses_coord_idx` (bitmap index scan, 12 rows, ~8 ms). `directory_search` 270-340 ms in WebAssembly under load: **indicative only** |
| CareFind suite | not run | CareFind code was not changed |

Database tests run on **PGlite (real Postgres compiled to WebAssembly)** with stand-ins for Supabase's `auth.uid()/auth.email()` and minimal `businesses/staff/field_activities` tables. `is_platform_admin()` and `current_business_ids()` are the real definitions from `sql/phase2_rls_pilot.sql`; the permissive policies the hardening migrations sit on are copied from the same file. **The live policies may differ.** Re-run against a Supabase branch before applying anything. To reproduce: `npm i --no-save @electric-sql/pglite`, then `node scripts/db-tests/<name>.pglite.mjs`.

## 2. New automated tests by area

Unit/UI (vitest, all passing in the full run): `modules/directory/{directory,directoryImport}.test.js`, `pages/admin/directory/DirectoryPanel.test.jsx`, `modules/business-directory/{businessDirectory.test.js,BusinessDirectorySearch.test.jsx}`, `modules/checkins/checkins.test.jsx`, `modules/live-activity/{DirectoryBusinessLink.test.jsx,repositories/index.test.js}`, `lib/realtime.test.js`, plus additions to `LiveActivity.log.test.jsx` and `platformPermissions.test.js`.

Covered: name/phone normalisation and validation; coordinate validity; CSV parsing and column mapping; row classification and duplicate rules; batched, retry-safe, cancellable import; query parsing for the four example requests; radius and parameter validation; one-shot location capture and every failure mode; map and directions links (null for missing coordinates); CSV export safety; search is read-only; check-in success and failed-capture wording; stale/current/unavailable presentation; optional business link requires an explicit Select; realtime LIVE state.

Database (PGlite): see section 4.

## 3. Defects found by testing (and fixed)

- `captureLocation` turned a `null` latitude into 0, so a missing GPS position looked like valid coordinates (0, 0).
- Unterminated regex in the import repository (caught by the first test run).
- A similar-name rule (Alpha Pharmacy vs Alpha Pharmacy Ltd at the same address) missed because the threshold was too strict.
- `directory_search` reported the wrong total when the offset was past the end.
- Selecting a State filter silently became a 5 km radius search around the state centre (caught in review, now an explicit opt-in button).
- Several of my own test fixtures were wrong; each was corrected on evidence rather than by loosening the code.

## 4. Tenant isolation and security tests (database)

All pass on PGlite unless noted. "Before" rows show the finding is real on the pilot policies.

| Requirement | Evidence |
|---|---|
| Company A cannot list Company B representatives | staff: company B sees only its own staff; A owner sees no B staff |
| Company A cannot retrieve B's private field activities | activity: another company sees none, owner and staff of B alike |
| Company A cannot retrieve B's private location history | checkins: B rep and B owner read zero A rows; overview refused for B owner and B staff |
| A rep cannot assign themselves to another company | staff insert into B refused; `rep_territories` for B's territory refused; `record_checkin` for B refused |
| A company cannot change global directory verification | directory: company UPDATE affects 0 rows; `directory_set_verification` refused (42501); a direct admin UPDATE cannot change it either |
| Import merge cannot launder or overwrite trusted data | merge: company and rep refused (42501); name, verification, source, active flag cannot be merged; verified records keep existing values; verification columns unchanged by a merge; bad value fails the whole call atomically; retry does not undo a later edit; merge log not writable by anyone |
| A company cannot access unauthorised imports | `directory_imports`: company insert refused, no read policy for companies |
| Revoked membership removes access | check-in write refused and staff leaves the overview; (activity: not separately tested after revocation) |
| Client-supplied company ids cannot bypass membership | forged business id refused for check-in, activity insert, staff insert |
| Unauthorised directory modification | company INSERT/UPDATE/categories/audit all refused; anon refused everywhere |
| Invalid coordinates rejected | CHECK constraints and RPC validation for directory, check-ins, search |
| Unauthorised export | **Not tested at database level.** Export is client-side CSV over the same `directory_search` the user may already call; the button is hidden without `canExportReports`, which is a UI gate only |
| Finding S1 (anon enumeration) | `discover_facilities_cursor` refused for anon after the fix |
| Finding S3-S5 (activity) | Before: colleague reads, forges attribution, deletes. After: attribution, visibility, viewers, reactions, comments, edit/delete restricted |
| Finding S8 (self-promotion) | Before: rep promotes self, gains team locations. After: refused |

Not tested: SQL injection beyond wildcard escaping (parameters are bound), rate limiting (none exists), PostgREST behaviour, service-role paths against the live schema.

## 5. Failure-mode checks

| Failure | Result |
|---|---|
| Location permission denied / unavailable / timeout / unsupported / bad data | Tested (unit and UI). Failed check-in stored as failed with no position |
| Google Maps unavailable or no key | Tested (no key): list works and a message replaces the map. A bad or restricted key (`gm_authFailure`) is handled in code, **not exercised** |
| Invalid import file | Tested: wrong extension, `.xls`/password-protected (OLE) files, non-workbook bytes, corrupt zip, valid zip that is not a workbook, oversize, decompression-bomb and too-many-entries archives, unclosed quote, no name column, invalid rows, empty workbook |
| Duplicate import retry | Tested with mocks (409 reported as already imported) and in the database (unique `source_ref`) |
| Realtime disconnect | Mocked-client tests: status transitions, exponential backoff 2 s to 30 s, retry stops on unsubscribe, keeps retrying without a session, catch-up refetch on reconnect, debounced live refresh of reactions and comments. **No real disconnect or two-session delivery test** |
| Network/database failure | Error states tested in search, directory console, check-in panels |
| Empty search results | Tested |
| Missing coordinates | Tested (no map entry, no directions) |
| Unauthorised requests | Tested at database level |

## 6. Not done

- No browser run: **responsive layout (mobile/tablet/desktop), keyboard and screen-reader behaviour of the new screens were not verified**, only that they render in jsdom. `aria` labels and live regions were added but not tested with assistive technology.
- No end-to-end test of the complete journey (admin imports, rep searches, opens map, reports, manager sees it, other company cannot). The parts are tested separately.
- No Google credentials: the live map has never loaded.
- No test on Supabase or against live policies.
- Check-in retention, undo for a merge. Excel import is implemented and tested against real generated workbooks, but not against files saved by Excel itself, LibreOffice or Google Sheets (formulas, date cells, merged cells and very large sheets are untested).

## 7. Production-readiness review (Phase 11)

- **Indexes.** Directory: normalised name, normalised phone (partial), state/LGA/city, coordinates (partial), category, active/verification, unique `(data_source, source_ref)`. Check-ins: by business/time, user/time, business/staff/time. The coordinate btree is used for the radius prefilter (plan above). No PostGIS added; revisit only if real data shows the prefilter is too loose at scale. Substring `ILIKE '%x%'` name search cannot use a btree and will scan the filtered set; add `pg_trgm` only if measured necessary.
- **Pagination.** Directory search: server-side, limit capped at 100. Activity feed: keyset "load older". Import: batches of 50, 5,000-row file cap. Not paginated: `countFieldActivities` still caps at 1,000 and fetches ids; `getActivityViewers/Reactions/Comments` use `in.(ids)` URLs, fine at 100 ids.
- **External calls.** Directory search makes none. Google Maps JS loads only with a key. Directions use plain links. The legacy live search still calls Overpass and Nominatim straight from the browser (privacy and usage-policy risk, finding S7, unchanged).
- **Logging.** `sbFetch` used to log a 20-character prefix of the user's access token on every call. Removed (the anon-key warning is kept). Search the rest of the app for other token logging before production.
- **Secrets.** No secrets added or committed. `VITE_GOOGLE_MAPS_BROWSER_KEY` is a public browser key and must be referrer- and API-restricted. No server-side Google key is used.
- **Remaining blockers before production.** All eight migrations unapplied and untested on Supabase; two behaviour-change migrations need a decision; directory ownership undecided; retention undecided; legal/consent review of location data not done; Google key and restrictions not created.

## 8. Acceptance checklist (honest)

Legend: PASS = verified as described; PARTIAL = code and tests exist but a stated gap remains; BLOCKED = needs something I do not have; NOT DONE.

**Directory**
- Authorized administration can manage the directory: PARTIAL. Console and RLS tested (UI with mocks, database on PGlite); not run on Supabase or in a browser
- Categories and subcategories: PARTIAL. Add and list only; no rename/reorder
- Verification explicit and auditable: PASS on PGlite (RPC-only, actor and time stamped, audit rows); not on Supabase
- Bulk imports validate and report errors: PASS (unit, mocks); CSV only
- Duplicate handling safe: PARTIAL. Classification, review and a reviewed field-by-field merge are tested (49 database checks, UI flow, runner); fuzzy match is limited to key/city candidates; two existing directory records cannot be merged with each other
- Directory permissions enforced: PASS on PGlite

**Maps and discovery**
- Google Maps works with configured credentials: BLOCKED (no key)
- Current location where permitted: PASS (unit/UI); not on a real device
- Manual location selection: PASS (coordinates, state centre opt-in); map-click path untested without a key
- Radius searches return appropriate records: PASS on PGlite (boundary exactness tested)
- List and map selection synchronised: PARTIAL. Parent-owned state tested via the list; marker side untested without a key
- Distance labels accurate: PASS (always "straight-line")
- External results distinguished from directory records: PASS by construction (no external results are mixed in; legacy live search is a separate tab, unchanged)
- Discovery does not create field activities: PASS (UI repository surface is read-only; database test)
- Results exported safely: PARTIAL. Safe CSV; permission gate is UI only

**Company and representative management**
- Company membership enforced server-side: PASS on PGlite
- Representatives managed through authorised workflows: PARTIAL. Existing Staff and Territories reused; privilege guard (S8) tested but unapplied
- Managers see only permitted staff information: PASS on PGlite (audited RPC)
- Check-in and login separate: PASS (distinct tables, event types)
- Location failures handled honestly: PASS
- Location history cannot be forged across companies: PASS on PGlite

**Live field activity**
- Existing functionality intact: PASS for the automated suite (141 files); manual regression of voice notes, exports and territories not performed
- Nearby suggestions optional: PASS (UI and payload test)
- Representatives confirm links: PASS (UI explicit Select; database refuses unconfirmed)
- Submitted activities appear to authorised managers: PARTIAL. Visibility tested in the database; live delivery untested
- Realtime verified: NOT DONE on real Supabase. JWT, honest status, reconnect and live reaction/comment refresh are tested with mocks only, and the tables must be in the publication
- Filters and pagination work: PARTIAL. Keyset paging tested; filters unchanged
- Voice notes, reactions, comments, exports functional: PARTIAL. Unchanged code, existing tests pass; not exercised manually

**Security**
- Cross-company tests pass: PASS on PGlite
- Directory modification permissions pass: PASS on PGlite
- Location access restrictions pass: PASS on PGlite
- Credentials server-side: PASS (none added; the browser Maps key is public by design)
- Migrations tested in isolation: PARTIAL. PGlite, not Supabase
- No production changes without authorisation: PASS (nothing applied, nothing pushed)

**Quality**
- Unit, integration (database), security tests pass: PASS as listed in section 1
- Builds pass: PASS (CareHub). CareFind not built
- Documentation reflects implementation: PASS at time of writing
- Remaining blockers explicit: PASS (section 7)

The feature is **not complete** by the brief's own definition: it has code and tests, but lacks the Google credentials, a Supabase run, a browser and responsive check, the realtime two-session test, and product decisions.
