# ADR Reporting — Business Domain

## Purpose
NAFDAC adverse event reporting module with four module types — Community Pharmacy, Hospital, Industry (manufacturer/importer & wholesale), and Skincare/Aesthetic Spa (which relabels itself "Adverse Cosmetic Event"). Drafts are always savable and never deleted; submission is gated by the Section 7 ICSR rules client-side *and* server-side in an RPC. Reporting deadlines are computed from the Section 6 rule table and read back as `on_track / due_soon / overdue` from the percentage of the window remaining.

## Files
- `apps/carehub/src/modules/adr/AdrReportPage.jsx` — full form + Timeline (audit trail) + offline draft restore banner (detail route `adr-reports/:reportId/detail`).
- `apps/carehub/src/modules/adr/AdrReportsList.jsx` — list + "New ADR Report" + `list | analytics` tab.
- `apps/carehub/src/modules/adr/repositories/index.js` — the repository (data access, submit RPC, upload, analytics, events, module-type mapping).
- `apps/carehub/src/modules/adr/services.js` — back-compat wrappers over the repository + pure `calculateDeadline` / `getDeadlineStatus` / status helpers.
- `apps/carehub/src/modules/adr/validation.js` — canonical `validateReportSubmit` (both `adrValidation.validateReportSubmit` and `validateForSubmit` delegate to it) + per-section validators + `computeIsSerious` + hospital gate.
- `apps/carehub/src/modules/adr/formEngine.js` — presentation config per module type, terminology, status/deadline helpers (delegates validation to `adrValidation`).
- `apps/carehub/src/modules/adr/types.js` — enum constants + human labels (note: `REACTION_EXPECTED` is boolean-keyed — the DB column is a boolean).
- `apps/carehub/src/modules/adr/analytics.js` — pure deadline-bucket / monthly-volume / seriousness helpers (UTC-deterministic via `Date.UTC`).
- `apps/carehub/src/modules/adr/exports.js` — E2B XML (`buildE2bXml`), NAFDAC print HTML (`buildPdfHtml`), download/print helpers.
- `apps/carehub/src/modules/adr/draftBackup.js` — localStorage offline draft mirror (`createDraftBackup`, `buildDraftSnapshot`, `isStale`) + `draftBackup` singleton.
- `apps/carehub/sql/20260816_adr_reports_basic.sql` (applied `adr_reports_basic`), `20260818_adr_reports_phase1.sql` (applied `adr_reports_phase1`), `20260818_adr_phase2_hospital.sql` (applied `adr_phase2_hospital`), `20260818_adr_phase2_reports_analytics.sql` (applied `adr_phase2_reports_analytics`), `20260818_adr_phase2_visibility.sql` (applied `adr_phase2_visibility` + `adr_phase2_restrict_function_execute`), `20260818_adr_phase2_events.sql` (applied `adr_phase2_events`), `20260819_adr_fix_returning_rls.sql` (applied `adr_fix_returning_rls`) — schema + gates + RLS.

## Components
`AdrReportPage` composes small section components: `ReporterSection`, `PatientSection`, `ProductsSection` (repeatable inline editor), `ConcomitantSection`, `ReactionsSection` (description, onset, duration, severity, outcome, six seriousness checkboxes, action taken, causality, de-challenge/re-challenge), `HospitalSection` (ward/department + attending physician, module gate), `IndustrySection`, `SkincareSection`, `EvidenceSection` (photo upload → `adr-evidence` bucket; `AttachmentField` for lab/discharge files), `DeadlineBanner`, `AuditTrailSection` (Timeline of `created`/`status_changed`/`exported` events), and an offline draft-restore banner.

## Repository
`createAdrReportRepository({ request = sbFetch, upload = sbUpload } = {})` + singleton `adrReportRepository`. Report reads: `getReports(businessId, filters)`, `getReport(reportId)` (single row or `null`), `getReportWithDetails(reportId)` (assembles the aggregate: `adr_products`, `adr_concomitant_meds`, `adr_reactions`, `adr_evidence_photos`), `getAnalytics(businessId)`, `getReportEvents(reportId)`. Report writes: `createReport` (stamps `business_id` **and** `created_by_user_id` from the authed staff row), `updateReport` (scoped by `report_id`), `submitReport` (POST `rpc/submit_adr_report` with `{ p_report_id }`), `logEvent(reportId, eventType, metadata)` (POST `rpc/adr_log_event`), `uploadEvidencePhoto`/`uploadAttachment` (storage). Child rows (products, meds, reactions, photos) have no `business_id` — every child write is scoped by its PK **and** `report_id`, mirroring the "via parent report" RLS boundary. `createFollowUp` inserts a `draft` chained via `follow_up_of_report_id`, passing the source's `created_by_user_id` through. Tests bind an in-memory adapter for scoping; a recording adapter asserts RPC call shapes.

## Database Tables
- `adr_reports` — report row (reporter, patient incl. `patient_medical_history`, module fields, `status`, `reaction_expected` boolean, `new_safety_signal`, `submission_deadline`, `follow_up_of_report_id`, `follow_up_version_number`, `created_by_user_id`, hospital fields `ward_department`/`attending_physician`/`lab_investigation_notes`/`lab_attachment_url`/`comorbidities`/`icu_admission`/`treatment_given_for_reaction`/`discharge_summary_attachment_url`, auto `report_number` `ADR-YYYY-######` per business/module).
- `adr_report_products` / `adr_report_concomitant_meds` / `adr_report_reactions` (six `seriousness_*` booleans, `action_taken`) / `adr_report_evidence_photos` — children scoped to the parent report via RLS.
- `adr_report_events` — **append-only** audit trail: SELECT-only RLS through `can_access_adr_report` (no client INSERT/UPDATE/DELETE policy); lifecycle events are written server-side by `adr_report_events_trigger` (`created` on INSERT, `status_changed` on UPDATE with `from`/`to` metadata) and client-initiated `exported`/`note` events go through the `adr_log_event` RPC, which re-checks visibility and rejects any other event type.
- `adr_report_analytics` — reporting view created **`WITH (security_invoker = true)`** (a definer view would bypass RLS and leak every business's rows); per-report `report_number`, `submission_deadline`, `reaction_expected`, `new_safety_signal`, and `is_serious` = `bool_or` over the six seriousness flags.
- RPC `submit_adr_report(p_report_id uuid)` — `SECURITY INVOKER`, `set search_path = public`; enforces the full Section 7 gate server-side (plus the hospital gate: `ward_department` + `attending_physician` mandatory when `module_type='hospital'`), computes `is_serious` via `bool_or`, computes + stores `submission_deadline`, blocks anything but `draft`.

## Visibility model (RLS)
`can_access_adr_report(p_report_id uuid)` is a `SECURITY DEFINER` helper (`search_path = public`) used by every ADR child-table and events policy. It grants: platform admin → all rows; the owning business's owner (email match) and staff with `role IN ('Manager','Owner')` → all of that business's reports; every other active staff member → only reports they created (`created_by_user_id = their staff.id`, matched by `staff.auth_user_id` or email). Child tables scope through the same helper, so a reporter's read/write on children is bounded by their visibility of the parent. New-report INSERT uses the tenant + platform-admin `WITH CHECK` (a brand-new row has no `created_by_user_id` yet); the repository stamps `created_by_user_id` so the reporter's own-row visibility works. **Legacy rows:** pre-feature drafts (`created_by_user_id IS NULL`) remain visible to owners/managers/admins only; they were not backfilled because the creator is unknowable.

**`adr_reports`'s own SELECT/UPDATE/DELETE policies do NOT use `can_access_adr_report(report_id)`** — they use `can_access_adr_report_row(business_id, created_by_user_id)`, an identical helper that evaluates visibility from the row's own columns. This is deliberate and load-bearing: `sbFetch` always sends `Prefer: return=representation`, so PostgREST wraps INSERT in `INSERT … RETURNING`, and PostgreSQL applies the table's SELECT policy to the returned row — a policy that reads `adr_reports` back cannot see the just-inserted row (command snapshot precedes the insert) and denies everyone (`42501`, fixed 2026-08-19 by `adr_fix_returning_rls`). The row helper avoids the self-referencing read entirely. `can_access_adr_report(p_report_id)` now delegates to the row helper so the report row and its children/events can never disagree.

**ACL note:** these SECURITY DEFINER functions are revoked from `PUBLIC, anon` and re-granted to `authenticated`. `REVOKE ... FROM anon` alone is ineffective — PUBLIC's implicit EXECUTE re-grants it. Trigger-function EXECUTE is safe to revoke from PUBLIC because Postgres does not check it for the user firing the DML.

## Deadline rules (Section 6)
`calculateDeadline(createdAt, isSerious, reactionExpected, newSafetySignal)`:
- new safety signal → **+3 days** (industry)
- serious + unexpected → **+72 hours**
- serious + expected → **+15 days**
- non-serious + unexpected → **+15 days**
- non-serious + expected → **+90 days**

`getDeadlineStatus(deadline, createdAt)`: remaining <20% of window or past → `overdue`; 20–50% → `due_soon`; >50% → `on_track`.

## Validation (Section 7 gate)
`validateReportSubmit(report)` requires: reporter qualification; reporter name *or* facility-confirmed anonymity; explicit consent true/false; patient identifier; one of age/DOB/age group; valid gender; ≥1 product with a brand name; ≥1 reaction with description, valid severity, valid outcome, and all six seriousness fields non-null on at least one reaction. Hospital module additionally requires `ward_department` and `attending_physician`; industry additionally requires `batch_lot_number`, `causality_assessment`, `case_narrative_summary`. Enum checks use `Object.values(...).includes(...)` — the constants are SCREAMING-keyed so value-key lookups (`REACTION_SEVERITY['severe']`) silently return `undefined` and must never be used.

## Exports (Section 8)
`exports.js` is pure + tested (12 tests). Industry reports export **E2B XML** (`buildE2bXml`, ICH-E2B-flavoured `ichicsr`, coded sex/outcome/qualification maps, `xmlEscape`, empty elements omitted) downloaded as a `.xml` file. All other modules export a **NAFDAC print view** (`buildPdfHtml`, module-aware headers, print-triggered) via `openPrintView`. `handleExport` on the detail page downloads/opens then best-effort logs an `exported` event (`{ format: 'e2b' | 'pdf' }`) to the audit trail.

## Offline draft backup
`draftBackup.js` mirrors the live form to `localStorage` under `carehub_adr_draft_<reportId>` — debounced 800 ms autosave (skipped while the report is locked/submitted), snapshot includes scoped child rows and a `savedAt` stamp. On load, if the local copy is **newer** than the server (`isStale` compares `savedAt` vs `report.updated_at`), a banner offers Restore or Discard. Locked reports never shadow the server. Full PWA offline sync (queueing + replay of submissions) is **deliberately deferred** pending product decisions on conflict handling.

## Current State
Phase 1 + Phase 2 complete: full core form, working Save Draft, client + server submission gates in lockstep (incl. hospital gate), live deadline banner, module-aware industry/skincare sections, evidence photo + attachment upload, follow-up creation, per-user report visibility + reporter-role nav (`adr-reports` added to Pharmacist/Nurse/Doctor in `lib/permissions.js`), NAFDAC PDF / E2B XML exports, reports/analytics tab, append-only audit trail, and offline draft backup. The old `AdrNav.js` is dead code (nav flows through `lib/permissions.js`). 78 ADR module tests + 447 total pass; production build clean.

## Missing Documentation / Deferred
- **Full offline sync (Section 10)** — queueing + replay of submissions/edits made while offline is not implemented; only the per-draft localStorage backup above exists. Needs a product decision on conflict handling before building.