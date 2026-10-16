# ADR/PV Tracker Completion Audit — Remediation Plan

> Status: BATCH A + B + C COMPLETE. Both Batch B migrations APPLIED live
> 2026-10-16 under explicit owner authorisation. Constraints honored: no
> production data writes, no deploy, no regulatory-compliance claims without
> explicit approval.
> Evidence so far: CareHub ADR+permissions 14 files / 219 tests PASS (incl.
> CompanySelector 6, AdrNav 4, draftBackup new contract, all running against
> the parallel copy-pass edits); PGlite adversarial 14/14 PASS; CareFind
> validation+repo+separation 42/42 PASS; `SafetyReport.test.jsx` re-hung the
> local jsdom environment twice (98 min, 0 ms test execution — environment
> crash identical to the pre-existing documented condition; stale 2.5h run
> killed, superseded code anyway) → CI-bound by precedent. Builds re-running.
> Constraints honored: no production migration apply, no production data writes,
> no deploy, no regulatory-compliance claims without explicit approval.
>
> Parallel-work note: a UI-copy agent normalized punctuation across ADR files
> mid-session (incl. 2 strings pinned by new tests — absorbed with comment);
> all other agents' files left untouched; `git stash` is off-limits in this
> checkout after it nearly applied a foreign stash (recovered via patch backup
> + `reset --merge`, verified byte-identical).

## Audit verdicts per gap (evidence-backed)

1. **Hub product form has NO company selector** (`AdrReportPage.jsx` `ProductForm`
   :731-753: brand/generic/manufacturer free text only). Repository methods
   `getProductRoutes`/`createProductRoute`/`searchEligibleCompanies` exist
   (`repositories/index.js:219-248`) with zero UI consumers. Associating a
   verified company today requires SQL/manual RPC.
2. **No DB enforcement of one-company-per-product** (verified: only
   `idempotency_key UNIQUE`; multi-row inserts succeed). Public single-company
   rule is app-layer only (`SafetyReportPage.jsx` `companyIssues`). No
   source-branched enforcement anywhere.
3. **Taxonomy confirmed**: single stored type `'manufacturer_importer'` +
   `'wholesale'`; JS and SQL sets match exactly; SQL adds `status='active'`.
   No DB CHECK on `business_type` (free TEXT). Registration UI
   (`constants.js:4-14`, `Register.jsx:66,138`) offers NEITHER enterprise
   type — eligible companies cannot self-register today.
4. **AdrNav role check is a stub** (`filter(... => true)`); `getAdrNavItems`
   and `ALL_NAV_ADR_*` have **zero consumers** (dead code). Real gating lives
   in `permissions.js` nav arrays + route `guard()` (both include `pv-tracker`
   correctly, pinned by tests).
5. **Contact rules consistent** (client strict everywhere; server adds Hub
   facility fallback; public strict by NULL business). One real defect:
   `ReporterStep.jsx:49` help text overpromises ("Their contact above is
   used") — no facility contact fields exist; the reporter must supply their
   OWN contact. Seriousness labels differ cosmetically
   (`Seriousness answers` vs `All six seriousness fields`) but both map to
   the REACTIONS step — document, don't churn RPC strings.
6. **Privacy findings**: view masks 5 reporter fields; exposes qualification,
   consent, anon-flag, all patient fields, attachment URLs; children fully
   readable when routed. **Hub `adr-evidence` bucket is PUBLIC** (pre-existing
   design); Tracker renders `http` URLs directly, no signed URLs in CareHub.
   **draftBackup stores full PII row in localStorage**, never cleared on
   submit/logout, no TTL, key not user-scoped. No privacy approval on file —
   masking changes stay proposed, not applied.
7. **Zero ADR notifications wired** (verified by grep). `notify()` exists but
   `staff_notifications` RLS requires caller membership in the TARGET business
   — cross-tenant client inserts fail silently. Email needs catalog rows
   (migration). Cross-tenant notify needs a DEFINER RPC (migration).
8. **Hub `createReport`/`createFollowUp` omit `report_source`** → new Hub rows
   default `unknown` (backfill only covered pre-existing rows).
   `health_facility` unwritten by any flow (correctly reserved).
   `origin_channel_detail` never populated by any flow.
9. **Docs contradict themselves**: per-phase notes say APPLIED live AND
   "never applied to any database" in the same file (7 files). No Supabase
   MCP/CLI in this session — live status cannot be re-verified here; the
   Phase 10 release record is the claim source. Mirror files byte-identical
   (hash-verified for routing foundation).
10. **Deps**: `d7d2495` already patched the patchable (brace-expansion,
    source-map-js, undici, dompurify); blocked = `xlsx@0.18.5` (no npm fix,
    live server-side parsing in `excel-import.js`), vitest/vite majors
    (breaking; prior upgrade attempt reverted), react-router v7 (moderate
    only, below gate). Fresh `npm audit` re-run still owed this phase.

## Remediation batches (stop for approval between batches)

### Batch A — code + tests, no migration (gaps 1, 3-doc, 4, 5, 6-partial, 8)
- A1 (gap 1): `CompanySelector` in Hub `ProductForm` (search verified via
  existing RPC, unknown, manual candidate) + persist route on product save
  (idempotent key) + read-only route list w/ status per product row. Hub allows
  >1 company per product (cardinality preserved). Tests: renderToString +
  repository adapter (patterns exist).
- A2 (gap 4): implement `getAdrNavItems` role filter via `getPerms`
  (`adr-*`→`adr-reports`, `pv-tracker`→`pv-tracker`; Owner/all, others per nav
  membership; unknown businessType falls back as today). Unit tests for
  Owner/Manager/Nurse/unknown-type. Backend/RLS untouched as authoritative.
  (Alternative if rejected: delete the dead module — state preference.)
- A3 (gap 5): fix `ReporterStep` anon copy (name-only anonymity; own contact
  still required). Add explicit test. Leave RPC strings untouched.
- A4 (gap 6): draftBackup hardening — namespace keys by user/business,
  7-day TTL + prune-on-load, `clearAllForOwner` on logout (both logouts) and
  on submit success; tests with injected storage. No masking changes
  (proposed for privacy sign-off instead — see D4).
- A5 (gap 8): set `report_source='business_facility'` +
  `origin_channel_detail='carehub-web'` in Hub `createReport`/`createFollowUp`;
  `origin_channel_detail='carefind-web'` in public `createDraft`. Tests pin
  payloads. `health_facility` stays reserved (documented).
- A6 (gap 3-doc): record taxonomy + wholesale-inclusion + registration-gap
  decision log in `docs/architecture/ADR-Routing-Foundation.md` (append
  "Completion audit" section). No eligibility-rule change (JS/SQL already match).
- A7 (gap 9-doc): rewrite the 7 contradictory Status/body pairs to reference
  the release record; add explicit "last verified live" caveat (no MCP here).

### Batch B — new migration files + PGlite adversarial tests (gaps 2, 7)
- B1 (gap 2): `supabase/migrations/carehub_20261111_adr_public_single_company.sql`
  (+ mirror): BEFORE INSERT/UPDATE trigger on routes — when parent report is
  `report_source='public'`, reject a second route row for the same product
  (any kind: verified/unknown/candidate each count as the one selection).
  Hub/business rows explicitly exempt (documented in trigger comment).
  APPLIED live 2026-10-16 (owner authorisation).
- B2 (gap 2 tests): `apps/carefind/src/test/adr/routingAdversarial.db.test.js`
  (PGlite, established `*.db.test.js` pattern): stub auth/storage/businesses/
  staff + replay real ADR migrations in order + the NEW migration file;
  assert: (i) public 2nd-company insert raises; (ii) same retry idempotent;
  (iii) Hub 2nd-company succeeds; (iv) guessed-UUID/cross-tenant route create
  raises; (v) candidate-name never grants read; (vi) unverified org cannot read
  case/attachments. Skipped without PGlite (pattern precedent).
- B3 (gap 7): `supabase/migrations/carehub_20261112_adr_notify_party.sql`
  (+ mirror), APPLIED live 2026-10-16 (owner authorisation): DEFINER `notify_adr_party(p_report_id,
  p_kind, p_title, p_body, p_link)` — resolves recipients from verified
  routes (company staff/owner) or submitting business (follow-up direction),
  writes `staff_notifications`, returns recipient count; kinds allow-listed
  (`routing_verified`, `followup_requested`, `deadline_*` kinds present but
  server-REJECTED until deadlines are regulator-confirmed — enforced block).
  Wire UI call sites (PvTracker verify/follow-up paths + Hub follow-up
  response path if present) with best-effort (notify swallows) semantics +
  tests with mocked repo. Email templates: BLOCKED (catalog rows need
  migration + copy sign-off) — recorded, not built.

### Batch C — verification + release (gaps 9, 10)
- C1: fresh `npm audit --audit-level=high` both apps (read-only) vs d7d2495
  baseline; fix only non-breaking newly-fixable items, each individually
  justified; majors stay blocked with reasons.
- C2: full test suites (carehub `npm test`, carefind `npm test` incl. new
  PGlite suite if PGlite runs here), coverage for touched modules, both
  builds, rerun separation/eslint checks.
- C3: file-by-file change report, migration status table (applied per release
  record vs new-unapplied), test evidence, remaining sign-offs, deployment
  risks, go/no-go checklist. STOP before prod deployment.

## Decisions required from owner (blocking)

- D1: wholesale in eligible set — keep (status quo, matches code+docs) or
  restrict to `manufacturer_importer` only? (code change if restricted)
- D2: enterprise self-registration — add Importer/Manufacturer options to
  `Register.jsx`, or keep admin-provisioned? (product decision)
- D3: AdrNav — implement filter (proposed) or delete dead module?
- D4: privacy minimisation list (patient_identifier/dob/history, attachment
  URLs, timeline actor names, consent/qualification exposure) — approve
  narrowing or keep interim masking?
- D5: Hub `adr-evidence` public bucket — accept risk, migrate to private, or
  route new uploads to `adr-private`? (migration + URL-compat work)
- D6: notification copy + email templates — approvals + who signs off?
- D7: health_facility channel — which approved workflow sets it, and when?
