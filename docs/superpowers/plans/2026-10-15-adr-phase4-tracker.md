# Phase 4: Company PV Tracker — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Verified Importer/Manufacturer orgs get a PV Tracker inside the existing CareHub dashboard showing only cases routed to them (masked reporter identity), with summary counts, filters, source badges, read-only case detail, and versioned workflow actions. No company can edit case data; acknowledgement is labeled internal-only.

**Architecture:** One migration (responsible-company read axis, masked `adr_pv_case_view`, company workflow columns + assessment/follow-up tables, DEFINER workflow RPC, new audit event types, private-bucket read for routed attachments); CareHub repository + pure workflow helpers + two pages wired into existing nav/guards; docs.

**Tech Stack:** Postgres 15 RLS/DEFINER, React 18 + react-router 6, existing permissions/nav, Vitest 2.

**Spec:** Master prompt §§7.1–7.4 + §§4.3–4.4; authority: Phase 1–3 migrations, `AdrReportsList.jsx`, `AdrReportPage.jsx`, `exports.js`, `analytics.js`, `permissions.js`, `BusinessDashboard.jsx`.

## Global Constraints

- Responsible companies get ZERO writes on case rows (report/products/reactions/photos/meds); workflow mutates only route columns via RPC + new assessment/follow-up rows.
- Reporter identity/contact masked for responsible companies (interim, privacy-lead decision pending); qualification + clinical data visible.
- Every workflow mutation writes an audit event; ack copy states internal-only, never regulatory.
- Existing Hub lists/forms/exports untouched; new route key `pv-tracker` for enterprise Owner/Manager (+ platform admin via existing admin paths).
- No production migration apply; REVIEW ONLY.
- Report-source badge on list + detail; counts from authorized rows only.

## Review Focus

- Responsible company reading a non-routed report (guessed UUID) — expect denied at every layer (report/children/events/attachments).
- Responsible company PATCHing case data directly — expect denied (no write grant).
- Responsible company reading reporter phone/email via view, direct table read, or export builder — expect masked/denied in all three.
- Unverified (pending) route visible in Tracker — expect hidden until verified/routed.
- Duplicate acknowledge/follow-up retries — expect idempotent (status set + unique request key where applicable).
- Counts vs list mismatch under filters — expect same predicate both places.

---

### Task 1: Migration — routed read axis, masked view, workflow tables, RPC, events, bucket

**Files:**
- Create: `supabase/migrations/carehub_20261105_adr_pv_tracker.sql`
- Create (mirror): `apps/carehub/sql/20261105_adr_pv_tracker.sql` (byte-identical)

**Interfaces:**
- Consumes: Phase 1–3 objects, `current_business_ids()`.
- Produces: `can_access_adr_routed_report(uuid)`, `can_write_adr_route_company(uuid)`;
  SELECT branches on reports/children/events (+ storage `adr-private` routed-read policy);
  `adr_pv_case_view` (caller-dependent masking, security_invoker);
  `adr_product_company_routes.company_status|company_status_updated_at|acknowledged_at`;
  `adr_route_assessments`, `adr_followup_requests` + RLS + lifecycle triggers;
  `update_adr_route_workflow(uuid,text,text)` DEFINER with transition table;
  `request_adr_followup(uuid,text,text)` DEFINER (idempotency key);
  event CHECK += acknowledged|assessment_recorded|followup_requested|followup_addressed|workflow_updated.

- [ ] **Step 1: Write migration + mirror**
Helpers (DEFINER, hardened): routed-read EXISTS (my business holds a verified/routed
route for the report); route-company-write EXISTS (my business holds the route + routed/verified).
Reports/children/events SELECT: OR routed-read helper. No write changes.
Storage: `adr-private routed read` SELECT policy EXISTS photo↔route linkage for my business.
View `adr_pv_case_view`: explicit columns; reporter_name/phone/email/facility/license NULL
unless `is_platform_admin() OR can_access_adr_report(report_id)`; invoker; comment marks
interim masking.
Routes: `company_status` CHECK(new|acknowledged|under_assessment|follow_up_requested|closed)
DEFAULT 'new', timestamps.
Assessments (route FK, author auth uid+name, assessment, action_taken, created_at):
SELECT via chain OR routed-read(report); INSERT WITH CHECK via chain-write OR route-company-write;
trigger logs assessment_recorded.
Follow-up requests (report FK, route FK, message, idempotency_key UNIQUE, status open/addressed,
created/updated): SELECT same; INSERT route-company-write only; trigger logs followup_requested.
`update_adr_route_workflow(p_route_id, p_status, p_note)`: chain-or-company access;
transition table enforced (new→acknowledged|closed; acknowledged→under_assessment|
follow_up_requested|closed; under_assessment→follow_up_requested|closed;
follow_up_requested→under_assessment|closed; closed→under_assessment); sets acknowledged_at
on first acknowledge; updates company_status(+timestamp); logs workflow_updated (+acknowledged
on first ack); returns {route_id, company_status}. Idempotent (same-status = no-op success).
`request_adr_followup(p_route_id, p_message, p_key)`: company-write only; ON CONFLICT(key)
DO NOTHING → return existing; logs followup_requested (first write only).

- [ ] **Step 2: Self-review vs 6 Review Focus lines; hash-compare mirrors**
- [ ] **Step 3: Commit** (`feat(adr): phase4 pv tracker backend`)

### Task 2: Repository + pure workflow helpers + tests

**Files:**
- Create: `apps/carehub/src/modules/adr/pvWorkflow.js`
- Create: `apps/carehub/src/modules/adr/pvWorkflow.test.js`
- Modify: `apps/carehub/src/modules/adr/repositories/index.js` (append Tracker methods)
- Test: extend `repositories/index.test.js`? No — new `pvTracker.test.js` for repo adapter shapes (keep existing file untouched).

**Interfaces:**
- Consumes: existing repository factory, `analytics.js` buckets, `services` deadline helpers.
- Produces: `PV_COMPANY_STATUSES`, `allowedCompanyTransitions(from)`, `sourceBadge(source)->{label,tone}`,
  `bucketTrackerCounts(cases)` (same predicate for cards + list), `companyStatusLabel`;
  repo: `getRoutedRoutes(businessId)`, `getPvCase(reportId)` (view + children + routes + assessments +
  followups + events), `updateRouteWorkflow(routeId,status,note)`, `requestRouteFollowup(routeId,message,key)`,
  `addRouteAssessment(routeId,assessment,actionTaken)`, `searchCompanies` reuse.

- [ ] **Step 1: Failing tests** (transitions table incl. illegal jump rejected; badge labels for 4 sources;
  counts reconcile on fixture; repo RPC paths/bodies incl. idempotency passthrough).
Run: `npx vitest run src/modules/adr/pvWorkflow.test.js src/modules/adr/pvTracker.test.js` → FAIL (missing).
- [ ] **Step 2: Implement pure + repo methods** (thin wrappers; exports reuse for case export in Task 3).
- [ ] **Step 3: GREEN run**
- [ ] **Step 4: Commit** (`feat(adr): phase4 tracker repository and workflow helpers`)

### Task 3: Tracker UI + nav/route wiring + tests

**Files:**
- Create: `apps/carehub/src/modules/adr/PvTracker.jsx` (summary + filters + list + badges)
- Create: `apps/carehub/src/modules/adr/PvCaseDetail.jsx` (masked case + routes rationale + timeline + actions)
- Create: `apps/carehub/src/modules/adr/PvTracker.test.jsx` (mocked repo: badges, counts reconcile, acknowledge calls RPC, no case-edit controls)
- Modify: `apps/carehub/src/lib/permissions.js` (MODULES `pv-tracker` + enterprise nav; Owner/Manager preset nav)
- Modify: `apps/carehub/src/pages/dashboard/BusinessDashboard.jsx` (guarded routes list + detail)
- Modify: `apps/carehub/src/modules/adr/AdrNav.js` (industry item PV Tracker)

**Interfaces:**
- Consumes: Task 2 repo/helpers, existing `exports.js` builders (case export on masked data), `getDeadlineStatus`.
- Produces: `/dashboard/reports/pv-tracker` + `:reportId/pv-case` routes; read-only detail (zero PATCH paths to case tables); ack/follow-up/assess/status/close actions with internal-only copy; export via existing builders.

- [ ] **Step 1: Failing component tests** (list renders fixture rows + source badges; cards match list length;
  acknowledge button calls updateRouteWorkflow; no inputs bound to case tables; internal-only ack copy present).
Run → FAIL.
- [ ] **Step 2: Implement pages** (loading/error/empty per AGENTS.md bar; responsive; focus management;
  filters: text/date/product/reaction/seriousness/outcome/source/status/deadline; detail: masked notice,
  routing rationale per product, timeline from events, actions gated by allowed transitions).
- [ ] **Step 3: Wire nav + routes; GREEN runs** (new tests + full `src/modules/adr` + permissions-affected suites)
- [ ] **Step 4: Commit** (`feat(adr): phase4 pv tracker ui and nav`)

### Task 4: Docs + gate

**Files:**
- Create: `docs/architecture/ADR-PV-Tracker.md`
- **Interfaces:** change summary, masking interim + privacy block, ack-copy, RLS delta table, rollback, test evidence, Phase 5+ outlook.

- [ ] **Step 1: Write doc**
- [ ] **Step 2: Commit + STOP** (`docs(adr): phase4 pv tracker note`). Await Phase 5 approval.
