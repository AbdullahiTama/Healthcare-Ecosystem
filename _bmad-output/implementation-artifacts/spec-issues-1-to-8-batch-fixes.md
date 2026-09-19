---
title: 'Field-reported issues #1–#8: ADR submit gate, expiry capture, notifications overhaul, territories bulk upload, consultation search, rep-activity dashboards, GPS place verification'
type: 'feature'
created: '2026-08-21'
status: 'done'
review_loop_iteration: 0
baseline_commit: '23a2204c0f229ceed4132cd644cb2ff3624d10c1'
context:
  - planning/CODE_AUDIT.md
  - planning/roadmap.md
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Eight field-reported defects/gaps: (1) ADR submission blocks with a vague message and false "empty" flags; (2) Record Purchase lacked Expiry Date — ALREADY RESOLVED by commit `b95404e` (per-item input, stock-batch persistence, live migration); only the reminder remains, folded into (4); (3) inventory bulk-upload template lacks an Expiry Date column; (4) notifications show only appointment kinds in one unsorted list with unreliable read/unread; no low-stock/expiry/contact-lead/sales-digest triggers; (5) Territories have no bulk upload; (6) Consultation product search never shows results; (7) managers cannot review field-rep activity logs in aggregate; (8) Log Activity has no Place of Visit verified against GPS.

**Approach:** Fix each as an independently shippable unit, sequenced #1 → #3 → #6 → #5 → #8 → #7 → #4, one commit per issue. Reuse established house patterns: repository seam + in-memory adapter tests, inline-modal bulk upload (Inventory), `notify()` fan-out + `NotificationBell`, existing GPS capture in LiveActivity.

## Boundaries & Constraints

**Always:**
- New data access goes through module repositories with injected transport (`createXRepository(request = sbFetch)`); unit-test against `src/test/inMemoryClient.js`.
- Every write tenant-scoped (`business_id`); RLS untouched except where a migration explicitly adds policies.
- Loading/error/empty states on every new UI surface; no native `alert()`/`confirm()`.
- Red-green-refactor: failing test first for every pure helper and repository change.
- Live-DB DDL only via tracked `.sql` file + MCP `apply_migration`, then re-run security advisors.
- `notify()` stays fire-and-forget (never breaks the triggering action).

**Ask First:**
- Applying the three named migrations to the live DB: `field_activities` columns (issue 8), `contact_leads` table + owner-notification trigger (issue 4), reviews→notification trigger (issue 4).
- Manager detection rule for issue 7/8 surfaces: Owner OR staff role containing "Manager" (case-insensitive) — enterprise roles are free text.
- Sales-digest delivery is client-side compute-on-read with daily dedupe (no scheduler infra exists). Server-side cron deferred.

**Never:**
- No new scheduler infrastructure (pg_cron / edge functions / Vercel cron) in this pass.
- No migration of NotificationBell onto `@care-ecosystem/shared-notifications` (package is unwired; adoption is separately tracked debt).
- No wholesale repository-seam migration of live-activity beyond what issues 7–8 require.
- No TypeScript, no new UI libraries, no SECURITY DEFINER beyond the one contact-leads/reviews trigger helper (pinned `search_path = public`).
- No backfill of historical sales or activities.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| ADR age 0 (neonate) | `patient_age = 0`, no DOB/age group | Age gate passes (not flagged missing) | N/A |
| ADR child row with blank enum/date | reaction draft has `severity:''`, `onset_date:''` | Save coerces `''`→null; row persists; no silent throw | Repo failure → toast naming section |
| ADR missing list tap | validator returns structured `{id,label}` items | Banner items are buttons; tap scrolls to + focuses field anchor | Unknown id renders plain text |
| Inventory CSV row without expiry | 9-column legacy row | Uploads successfully; `expiry_date` null | Malformed date → null, row still imports |
| Consultation search failure | transport throws (e.g. bad column) | Picker renders visible error state, not silence | Retry on next keystroke |
| Territory CSV unknown parent | Sits Under name matches nothing | Row reported failed with message; others import | Partial-success summary toast |
| Territory CSV parent defined later in file | Child row precedes parent row | Two-pass import resolves parent after creation | Cycle → both rows fail with message |
| Place of Visit mismatch | geocoded place >500 m from GPS | Inline warning "Location does not match…"; log still submittable, `place_verified=false` | Geocode no result → `place_verified=null`, neutral note |
| Low-stock alert dedupe | Dashboard loaded twice same day | One notification per kind per day (localStorage date key) | notify failure swallowed |
| Contact lead anonymous tap | Not logged-in buyer taps WhatsApp on drug card | Fire-and-forget POST; business owner notified "[A buyer] found [Drug]… via WhatsApp" | POST failure never blocks navigation |
| Velocity digest, no sales | Business with zero sales in window | Digest skipped entirely | N/A |

</frozen-after-approval>

## Code Map

**Issue 1 — ADR submit gate**
- `apps/carehub/src/modules/adr/validation.js` -- `validateReportSubmit` L36-157 returns `missing` string[]; age bug at L63 (`report.patient_age &&` fails for 0). Extend return with `missingFields:[{id,label}]`; fix age truthiness.
- `apps/carehub/src/modules/adr/AdrReportPage.jsx` -- toast L199; banner L410-417 (plain `<ul>`, no anchors/focus); server-path `setMissing(result.missing)` L211-213. ProductsSection.save L630-635 / ReactionsSection.save L761-766 post raw drafts (`''` dates/enums → DB CHECK rejection, **no try/catch** → silent unhandled rejection = top false-block cause); ConcomitantSection.add L709 shows the correct `|| null` coercion pattern. Duplicate labels: per-product batch L685 vs report-level L872; per-reaction causality L842 vs report-level L873.
- `apps/carehub/src/modules/adr/__tests__/` (existing validation tests) -- extend here.
- DB enums/CHECKs: `apps/carehub/sql/20260816_adr_reports_basic.sql` L158-169, `20260818_adr_reports_phase1.sql`.

**Issue 3 — Inventory template expiry column**
- `apps/carehub/src/modules/inventory/Inventory.jsx` -- `downloadTemplate()` L208-221 (headers verbatim 9 cols); parse L223-252 positional `cols[0..8]`, header discarded; `importProducts()` L254-315 builds `fresh` L274-286 (no expiry). Append col 10 `"Expiry Date"` → `cols[9]` → `expiry_date` (nullable; column exists live per `sql/20260819_add_product_expiry_date.sql`). Extract parse to pure helper for tests.
- `knowledge/modules/inventory.md` L24 -- observed-columns list predates expiry_date; update.

**Issue 5 — Territories bulk upload**
- `apps/carehub/src/modules/territories/Territories.jsx` -- PageHeader primaryAction L112; modal form L158-191; `LEVEL_SUGGESTIONS` L11; save() L53-74.
- `apps/carehub/src/modules/territories/repositories/index.js` -- factory L39; add `createMany(businessId, rows, batchSize=20)` mirroring `clients/repositories/index.js` L48-79 (`{added,skipped,failed[]}`, duplicate-classification).
- Pattern source: `Inventory.jsx` L208-315 (template/parse/import inline modals); `PageHeader` secondaryActions slot (`packages/design-system/src/components/layout/PageHeader.jsx` L153-161).
- Tests: `territories/repositories/index.test.js` seeded()/recording() pattern.

**Issue 6 — Consultation product search**
- ROOT CAUSE: `services/supabase.js` L199-203 `searchProducts` selects non-existent `sku` → PostgREST 400 → swallowed at `formParts.jsx` L94-96 → results always `[]`. `sku` exists nowhere else in repo.
- `apps/carehub/src/modules/consultation/formParts.jsx` L74-127 -- ProductSearchPicker debounce L81-102, dropdown render L113-124. Repoint to new `productRepository.search(businessId, q)` (`or=(name.ilike.*,generic_name.ilike.*)`, select real cols, limit 30); render error state instead of silent catch.
- `apps/carehub/src/modules/inventory/repositories/index.js` -- add `search()`; `src/test/inMemoryClient.js` L76-77 throws on unrecognized filters — extend with `ilike` + `or=` support first.
- Consumers: PharmacyForm.jsx L386-391, ConsultationForm.jsx L301.

**Issues 7+8 — LiveActivity**
- `apps/carehub/src/modules/live-activity/LiveActivity.jsx` (1204 lines) -- GPS capture L356-369 (`getCurrentPosition`, silent-fail); reverseGeocode service `services/supabase.js` L526; form modal L946 (Location banner L951, Territory select L966); submit L372 → `logActivity` (`services/supabase.js` L566, writes lat/lng/location_label); filter card L653-721 (DATE_RANGES chips + `inRange()` L459 + Rep/Territory selects + Export — reuse for team view); visibility predicate L500-505 is viewer-based, NOT role-based; identity via localStorage `carehub_auth` L44.
- Data: `field_activities(business_id, staff_id, rep_name, territory_id, values_json, voice_url, lat, lng, location_label, created_at)`; RLS allows whole-business SELECT for members (`phase2_rls_pilot.sql` §13) — team view is a client-side filter change only. `getFieldActivities` limit 100 → add limit param + exact-count read.
- Issue 8 needs: editable Place of Visit input; forward geocode (`geocodePlace(query)` next to reverseGeocode, Nominatim `/search`); pure `haversineMeters` + radius constant (500 m); migration adds `place_of_visit text, place_verified boolean, place_distance_m double precision`; feed/table show verified badge.
- Role gating refs: `lib/permissions.js` L13/L26/L135 ('activity' in nav perms); route `BusinessDashboard.jsx` L218.

**Issue 4 — Notifications**
- UI: `components/layout/NotificationBell.jsx` -- load L49-57 (errors silently swallowed), realtime INSERT-only L36-47, unread L59, openItem L61-77 (PATCH then optimistic set; catch swallows failures = likely read-state bug path), flat list L95-172, badge L103-107. Mounted in Sidebar L69.
- Services: `notify()` L393-411; `getMyNotifications` L384-389; `markNotificationRead` L413-415; `markAllNotificationsRead` L417-424. Table `staff_notifications(id,business_id,staff_id,is_owner,kind,title,body,link,read_at,created_at)`; RLS recipient-scoped (`phase2_rls_pilot.sql` L273-315) — cross-user inserts impossible from client, hence server-side trigger for leads/reviews.
- Existing kinds: activity, activity_comment, order_approval/copy/update, message, product_expiring_soon (Stock.jsx L58), booking_confirmed (Appointments.jsx L115), booking_created/paid (carefind api handlers).
- Trigger sources: low/out/expiring filters `DashboardHome.jsx` L75-79 + `Inventory.jsx` L453-501 (reorder_level pattern); products.expiry_date days-left `Inventory.jsx` L479-494; deep-link target = Inventory query-param filter (new).
- Contact-lead surfaces (all bare `<a>`, zero writes today): DrugProfile.jsx L440-466 (seller cards, waLinkFor L133-137), Search.jsx L470-483 (product cards); viewer optional (`useAuth().user` may be null). New `contact_leads` table (anon/authenticated INSERT policy) + AFTER INSERT trigger → SECURITY DEFINER helper inserts owner `staff_notifications` row kind `contact_lead`.
- Reviews: find carefind review insert path (`modules/business-profiles-reviews`) during implementation; trigger → kind `review_created`.
- Velocity: sales.items jsonb often double-encoded string — parsing rules documented `sql/20260804_sale_stock_movement.sql` L75-84; pure `classifySalesVelocity(products, sales, {days:30})` → fast(≥10 units)/medium(1-9)/slow(0 among stocked); digest effect in DashboardHome with daily dedupe, links `/dashboard/reports`.

## Tasks & Acceptance

**Execution (commit per issue):**

*Issue 1 — ADR*
- [x] `validation.js` -- fix age-0 truthiness; return `missingFields:[{id,label}]` alongside `missing` strings -- structured, anchorable errors.
- [x] `AdrReportPage.jsx` -- banner items become buttons calling scrollIntoView+focus on `data-adr-field` anchors added to sections/inputs; label Regulatory batch/causality distinctly from per-product/per-reaction fields; ProductsSection/ReactionsSection coerce `''`→null on date+enum keys (extract shared pure `normalizeChildRow`) and wrap repo calls in try/catch with section-naming toast.
- [x] validation tests -- red-first: age 0 passes; every missing item carries stable id; normalizeChildRow matrix.

*Issue 3 — Inventory template*
- [x] `Inventory.jsx` -- extract `parseInventoryCsv(text)` pure helper; append `"Expiry Date"` header + sample value; map `cols[9]` → `expiry_date` (invalid/blank → null); extend template instructions line.
- [x] `knowledge/modules/inventory.md` -- document column.
- [x] helper tests -- legacy 9-col rows still import; expiry parsed; malformed date nulled.

*Issue 6 — Consultation search*
- [x] `inMemoryClient.js` -- support `ilike` patterns and `or=(col.ilike.*,…)` filters (throw-free) -- mechanical gap that hid this bug class.
- [x] `inventory/repositories/index.js` -- `search(businessId, query)` with tenant eq + name/generic_name ilike + order/limit; query-shape + tenant tests.
- [x] `formParts.jsx` -- call repo search; replace silent catch with rendered error state + retry-on-input; keep debounce/min-chars.

*Issue 5 — Territories bulk upload*
- [x] `territories/repositories/index.js` -- `createMany` mirroring clients' contract; in-memory tests (batching, tenant scope, failure classification).
- [x] `Territories.jsx` -- "Bulk upload" secondaryAction + modal (template download `Territory Name,Level,Sits Under` + samples; positional parse; preview; import). Pure helpers `parseTerritoryCsv` + `resolveTerritoryUpload(rows, existingByName)` returning creates (parent-null first pass), parent PATCHes (second pass by name), skipped dupes, failed rows w/ reasons (unknown parent, cycle, missing name); level guidance mirrors LEVEL_SUGGESTIONS.
- [x] helper tests -- parent-later-in-file, unknown parent, cycle, dupe-vs-existing.

*Issue 8 — Place of Visit + GPS verify*
- [x] `sql/20260821_field_activity_place_of_visit.sql` -- ALTER `field_activities` ADD `place_of_visit text, place_verified boolean, place_distance_m double precision` (IF NOT EXISTS); apply via MCP (Ask First gate).
- [x] `lib/geo.js` -- pure `haversineMeters(a,b)` + `verifyPlaceMatch(placeCoords,gpsCoords,radiusM=500)` → `'verified'|'mismatch'|'unverifiable'`; unit tests incl. antipodal/zero-distance.
- [x] `services/supabase.js` -- `geocodePlace(query)` (Nominatim `/search`, limit 1, null-safe) beside reverseGeocode.
- [x] `LiveActivity.jsx` -- editable Place of Visit input before Territory; on submit resolve+compare vs captured gps; inline chip Verified ✓ / warning "Location does not match — this appears to be the wrong location" (submit still allowed, `place_verified=false`) / neutral unverifiable; persist 3 new columns via logActivity payload; feed cards + table show Place of Visit + verified badge.
- [x] `logActivity` service -- pass-through new fields.

*Issue 7 — Manager dashboard*
- [x] `services/supabase.js` -- `getFieldActivities(businessId, {limit=100})` param + `countFieldActivities(businessId, staffId?)` (Prefer count=exact).
- [x] `LiveActivity.jsx` -- view tabs "My Feed" (current behavior) / "Team Reports" gated `isOwner || /manager/i.test(role)`: full-business list bypassing viewer predicate, reusing filter card (+Yesterday chip), Rep drill-down showing selected rep's history + per-day counts, summary strip Today/Yesterday/Total (exact counts); reps get personal summary strip (today/yesterday/exact total) atop My Feed.
- [x] tests -- count/limit service functions against in-memory client if harness permits; else manual verification notes.

*Issue 4 — Notifications*
- [x] `lib/notificationCategories.js` -- pure `categoryForKind(kind)` → appointments | inventory | social | general; maps existing + new kinds; unit tests.
- [x] `NotificationBell.jsx` -- tabs All/Appointments/Inventory & Expiry/CareFind Social with per-tab unread counts; diagnose read/unread bug: stop swallowing openItem/markAll failures (surface toast + revert optimistic state), verify live PATCH works for owner and staff; component test (JSX harness proven by `modal.focus.test.jsx`) asserting tap marks read + badge decrements.
- [x] `DashboardHome.jsx` -- daily-deduped effects notifying owner: low-stock, out-of-stock, expiring≤60d, expired (bodies list up to 5 product names + "+N more"; links `/dashboard/inventory?stock=low|out&expiry=expiring|expired`); velocity digest via new pure `classifySalesVelocity` (skip when zero sales; link `/dashboard/reports`).
- [x] `Inventory.jsx` -- read `stock`/`expiry` query params on mount → apply matching filter chip (tap-through opens full affected list).
- [x] `velocity.test.js` -- classification thresholds, double-encoded items parsing, empty-sales skip.
- [x] `sql/20260821_contact_leads.sql` -- `contact_leads(id,business_id,product_id,product_name,channel,viewer_id,created_at)` + anon/authenticated INSERT policy + owner/platform-admin SELECT; AFTER INSERT trigger → SECURITY DEFINER `notify_business_contact_lead()` (pinned search_path) inserting owner `staff_notifications` row `[Name] found [Drug] on your CareFind profile and contacted you via WhatsApp/Call — please follow up.` link `/dashboard/carefind`; apply via MCP (Ask First gate); advisors re-run.
- [x] CareFind `DrugProfile.jsx` + `Search.jsx` product-card contact buttons -- onClick fire-and-forget POST to `contact_leads` (sessionStorage throttle ≥1h per business+product+channel; anonymous OK; never blocks navigation).
- [x] reviews trigger -- locate carefind review insert path/table; trigger → owner notification kind `review_created` (same definer-helper shape); migration + advisors.

**Acceptance Criteria:**
- Given a fully-filled ADR report including patient age 0, when submitting, then submission proceeds and no false "missing" item appears; given a genuinely missing field, the banner lists its exact name and tapping it scrolls to and focuses that field.
- Given a reaction/product draft saved with blank enum/date inputs, when the section saves, then the row persists (empties stored as null) and any failure surfaces a named-section toast instead of silence.
- Given a legacy 9-column inventory CSV row, when uploaded, then it imports with null expiry; given a 10-column row, expiry lands on the product.
- Given any text ≥2 chars typed in the Consultation products field, when the debounce fires, then matching inventory products render as selectable options; when the query fails, an error state renders.
- Given a territories CSV whose child rows precede parents, when imported, then all rows land with correct hierarchy; unknown-parent rows fail with a clear message and the rest succeed.
- Given a rep logs an activity with a Place of Visit ≥500 m from their GPS, when submitted, then the record stores `place_verified=false` and the form showed the mismatch warning; within radius stores true.
- Given a manager opens Team Reports, when filtering by today/yesterday/range and selecting a rep, then all business activities for that scope render with counts; a rep sees only their own summary and feed.
- Given low stock/expiry conditions exist, when the dashboard loads on a new day, then exactly one notification per condition kind arrives and its tap opens Inventory pre-filtered to the affected products.
- Given an anonymous buyer taps WhatsApp on a CareFind drug card, when the deep-link opens, then the business owner receives the contact-lead notification wording verbatim.
- Given all suites, when run, then carehub + carefind tests pass and both builds succeed.

## Design Notes

- Manager heuristic: enterprise role names are free text (`ROLES_FOR_TYPE.enterprise = []`), so "Manager" substring + Owner is the pragmatic gate; revisit when custom-role permissions gain granular flags.
- Contact-lead cross-boundary notification requires the definer trigger because `staff_notifications` RLS binds inserts to the recipient's own auth identity — a buyer can never insert directly.
- Place-of-visit verification is advisory (warning + persisted flag), never a block: GPS denial and geocode gaps must not trap reps mid-field.
- Read-unread diagnosis order: reproduce PATCH via live probe as owner + staff → check RLS UPDATE path → only then suspect client state.

## Implementation Notes (post-build deviations)

- **Issue 8 schema**: migration adds `place_of_visit text`, `place_coords jsonb`, `place_verified boolean NOT NULL DEFAULT false` � NOT `place_distance_m`. Distance is computed at log time via `haversineMeters`; resolved coordinates are persisted instead so the check is auditable. The feed's render guard (`place_of_visit || place_verified`) keeps legacy rows badge-free despite the non-null default.
- **Issue 5 semantics**: rows that can never link (unknown parent, circular hierarchy) are excluded from import entirely � stricter than importing them top-level. Second-pass linking lives in `Territories.jsx` (`getAll` ? name?id map ? per-child `update`) because `createMany` returns counts, not inserted rows.
- **Issue 4 trigger**: viewer display name resolves from `auth.users.raw_user_meta_data` (full_name ? name ? email) with `'Someone'` fallback; subject falls back to `'your business'` for business-level leads.

## Verification

**Commands:**
- `npm test` (apps/carehub) -- expected: all suites pass incl. new adr/inventory/territories/geo/velocity/categories/notification tests.
- `npm test` (apps/carefind) -- expected: all suites pass (contact-button wiring compiles; no regressions).
- `npm run build` (both apps) -- expected: clean production builds.
- Supabase `get_advisors(security)` after each applied migration -- expected: no new findings beyond accepted baseline WARNs.

**Manual checks:**
- Live probes for the two migrations: insert contact_lead as anon → owner notification row appears; field_activities accepts new columns; cross-tenant SELECT still denied.
- NotificationBell: mark-read round-trip as owner and as staff against live data.

## Suggested Review Order

**Notification pipeline (issue #4 — the widest-reaching concern)**

- Entry point: pure kind→tab mapping with a safe 'general' fallback for future kinds
  [`notificationCategories.js:26`](../../apps/carehub/src/lib/notificationCategories.js#L26)

- Bell gains category tabs and an honest mark-as-read (revert on PATCH failure)
  [`NotificationBell.jsx:68`](../../apps/carehub/src/components/layout/NotificationBell.jsx#L68)

- Owner-only daily digest: stock/expiry/velocity alerts raised once per kind per day
  [`DashboardHome.jsx:90`](../../apps/carehub/src/modules/dashboard-home/DashboardHome.jsx#L90)

- SECURITY DEFINER trigger lets an anonymous buyer notify the business owner
  [`20260821_contact_leads.sql:106`](../../apps/carehub/sql/20260821_contact_leads.sql#L106)

**Consultation product search (issue #6 — root-cause fix)**

- Repository search replaces the broken service call: name OR generic, real columns only
  [`repositories/index.js:39`](../../apps/carehub/src/modules/inventory/repositories/index.js#L39)

- Picker gains error/retry state and generic-name display; aria-live status region
  [`formParts.jsx:117`](../../apps/carehub/src/modules/consultation/formParts.jsx#L117)

**Territories bulk upload (issue #5)**

- Pure resolver: two-pass creates + parent links, cycle detection, per-row failure reasons
  [`territoryImport.js:48`](../../apps/carehub/src/modules/territories/territoryImport.js#L48)

- Consumer performs second-pass linking via name→id map after createMany
  [`Territories.jsx:136`](../../apps/carehub/src/modules/territories/Territories.jsx#L136)

**Place of Visit GPS verification (issue #8)**

- Verification computed once at log time; advisory, never blocks the log
  [`LiveActivity.jsx:474`](../../apps/carehub/src/modules/live-activity/LiveActivity.jsx#L474)

- Haversine distance with 500 m consumer-GPS tolerance; null-safe by contract
  [`geo.js:33`](../../apps/carehub/src/lib/geo.js#L33)

- Forward geocoding via OSM; throws on transport failure so UI can offer retry
  [`supabase.js:570`](../../apps/carehub/src/services/supabase.js#L570)

**Manager team reports (issue #7)**

- My Feed / Team Reports scope split; owner starts on team, counts are non-fatal
  [`LiveActivity.jsx:108`](../../apps/carehub/src/modules/live-activity/LiveActivity.jsx#L108)

- Lightweight server-side count, capped at the platform's 1000-row clamp ("1000+")
  [`supabase.js:516`](../../apps/carehub/src/services/supabase.js#L516)

**Inventory expiry capture (issue #3) + alert deep-links (#4)**

- Pure CSV parsing extracted from the component; impossible dates rejected, not rolled
  [`csvImport.js:49`](../../apps/carehub/src/modules/inventory/csvImport.js#L49)

- Deep-link filters (?stock=low|out, ?expiry=expiring|expired) with removable chips
  [`Inventory.jsx:49`](../../apps/carehub/src/modules/inventory/Inventory.jsx#L49)

**ADR submit gate (issue #1)**

- Missing-field gate now reads the client's own flags instead of guessing emptiness
  [`AdrReportPage.jsx:200`](../../apps/carehub/src/modules/adr/AdrReportPage.jsx#L200)

**Velocity digest math (supports #4)**

- Handles double-encoded jsonb items strings measured in production data
  [`velocity.js:41`](../../apps/carehub/src/lib/velocity.js#L41)

**Peripherals**

- inMemoryClient learns ilike.*literal* so repository tests mirror PostgREST
  [`inMemoryClient.js:55`](../../apps/carehub/src/test/inMemoryClient.js#L55)

- Module doc updated with the 10-column CSV contract
  [`inventory.md:29`](../../knowledge/modules/inventory.md#L29)
