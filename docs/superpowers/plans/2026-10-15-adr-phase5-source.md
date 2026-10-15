# Phase 5: Report Source Classification — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make report source truthful and tamper-evident everywhere it surfaces: lock `report_source` against silent changes (admin-only corrections, audited), surface it in Hub analytics/exports/lists, and document the evidence basis for every classified row.

**Architecture:** One small migration (source-correction RPC + immutability trigger + `source_corrected` event type); UI surfacing via existing helpers (`sourceBadge`, analytics buckets, export builders); tests; docs.

**Tech Stack:** Postgres 15, existing CareHub ADR module, Vitest 2.

**Spec:** Master prompt §5 (Phases: §9 in numbering); authority: Phase 1–4 migrations, `AdrReportsAnalytics.jsx`, `analytics.js`, `exports.js`, `AdrReportsList.jsx`, `AdrReportPage.jsx`.

## Global Constraints

- Source is recorded channel, never inferred (no job-title/company/name heuristics anywhere).
- `report_source` immutable to non-admins (trigger); corrections admin-only + audited.
- `health_facility` exists but no flow sets it yet (approved-facility workflow is future) — never backfill it without evidence.
- Existing backfill stands on evidence: pre-Phase-1 rows all carry non-NULL `business_id` from authenticated business sessions → `business_facility`.
- No production migration apply; REVIEW ONLY.

## Review Focus

- Hub user PATCHing `report_source` to `public`/`unknown` — expect trigger rejection.
- Admin correction without audit event — expect `source_corrected` event row.
- Analytics counting unknown as a guessed category — expect an explicit "not recorded" bucket.
- Export omitting source — expect NAFDAC HTML source line; E2B unchanged (no standard field; documented).
- Tracker already shows badges — expect untouched.

---

### Task 1: Migration — correction RPC + immutability trigger + event type

**Files:**
- Create: `supabase/migrations/carehub_20261106_adr_source_governance.sql`
- Create (mirror): `apps/carehub/sql/20261106_adr_source_governance.sql` (byte-identical)

- [ ] **Step 1: Write migration + mirror**
`adr_lock_report_source()` BEFORE UPDATE trigger (DEFINER): raises unless
`OLD.report_source IS NOT DISTINCT FROM NEW.report_source` or `is_platform_admin()`.
`correct_adr_report_source(p_report_id, p_source, p_reason)` DEFINER, admin-only:
validates 4 categories, updates, inserts `source_corrected` event
(from/to/reason) directly; returns {report_id, report_source}.
Event CHECK += `source_corrected`.
- [ ] **Step 2: Self-review; hash-compare mirrors**
- [ ] **Step 3: Commit** (`feat(adr): phase5 source governance migration`)

### Task 2: Surfacing — analytics buckets, export line, Hub badges, repo + tests

**Files:**
- Modify: `apps/carehub/src/modules/adr/analytics.js` (+ `countBySource`) + `analytics.test.js`
- Modify: `apps/carehub/src/modules/adr/AdrReportsAnalytics.jsx` (source breakdown row)
- Modify: `apps/carehub/src/modules/adr/exports.js` (+ source line in NAFDAC HTML) + `exports.test.js`
- Modify: `apps/carehub/src/modules/adr/AdrReportsList.jsx` (source badge per row via `sourceBadge`)
- Modify: `apps/carehub/src/modules/adr/AdrReportPage.jsx` (source line in header)
- Modify: `repositories/index.js` (+ `correctReportSource`) + `pvTracker.test.js` (adapter shape)

- [ ] **Step 1: Failing tests** (source buckets incl. unknown-not-recorded; export HTML contains source label; repo RPC path/body).
- [ ] **Step 2: Implement** (reuse `sourceBadge`; analytics reads `adr_report_analytics.report_source`).
- [ ] **Step 3: Full ADR + permissions suites GREEN; eslint clean**
- [ ] **Step 4: Commit** (`feat(adr): phase5 source surfacing`)

### Task 3: Docs + gate

**Files:**
- Create: `docs/architecture/ADR-Source-Classification.md`
- **Interfaces:** evidence basis per category, correction procedure, where source surfaces, health_facility reserved, rollback, test evidence.

- [ ] **Step 1: Write doc**
- [ ] **Step 2: Commit + STOP** (`docs(adr): phase5 source classification note`). Await Phase 6 approval.
