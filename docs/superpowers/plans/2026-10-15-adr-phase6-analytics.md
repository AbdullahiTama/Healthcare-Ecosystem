# Phase 6: PV Analytics — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A PV analytics section in the Tracker built only from the company's authorized routed cases: trends, reaction terms, seriousness-criteria breakdown, outcomes, product/batch, source — every figure with period, denominator, active filters, limitations, insufficient-data and small-group-suppression states, a causation disclaimer, and access-logged drill-down. Hub analytics tab unchanged.

**Architecture:** One tiny migration (let routed companies log `note` events); shared pure helpers in `analytics.js`; `PvAnalytics.jsx` section + Cases/Analytics tabs in `PvTracker.jsx` sharing one filter predicate; drill-down reuses list filters; detail mount logs access.

**Tech Stack:** Existing CareHub ADR module, Vitest 2.

**Spec:** Master prompt §6 (Phase numbering §10); authority: Phase 4 Tracker, `analytics.js`, `PvTracker.jsx`, `PvCaseDetail.jsx`, `adr_log_event`.

## Global Constraints

- Real authorized rows only; no mocks, no hardcoded totals; unknown stays a bucket, never imputed.
- Every figure carries: reporting period, count + denominator, active filters, limitations, insufficient-data state where sparse.
- Small-group suppression (threshold 5, interim pending privacy sign-off) on terms/product/batch breakdowns.
- Causation disclaimer on the section; drill-down opens only authorized reports; detail views are access-logged.
- No production migration apply; REVIEW ONLY.

## Review Focus

- Company analytics including non-routed or pending-route cases — expect excluded (verified/routed only).
- Rare reaction term identifying a patient — expect suppressed below threshold.
- Drill-down opening an unauthorized report — expect impossible (list only contains authorized rows; detail RLS/view denies).
- Access log writable by unauthorized callers — expect `adr_log_event` still refuses non-visible reports.
- Totals disagreeing between cards, analytics, and list — expect one shared filtered set.

---

### Task 1: Migration — routed companies may log access notes

**Files:**
- Create: `supabase/migrations/carehub_20261107_adr_analytics_access.sql`
- Create (mirror): `apps/carehub/sql/20261107_adr_analytics_access.sql` (byte-identical)

- [ ] **Step 1: Write migration + mirror**
`CREATE OR REPLACE adr_log_event`:allow `exported|note` when
`can_access_adr_report OR can_access_adr_public_draft OR can_access_adr_routed_report`;
all else identical (raise otherwise, DEFINER event write).
- [ ] **Step 2: Self-review; hash-compare**
- [ ] **Step 3: Commit** (`feat(adr): phase6 analytics access logging`)

### Task 2: Pure analytics helpers + tests

**Files:**
- Modify: `apps/carehub/src/modules/adr/analytics.js` (+ trends/terms/criteria/outcomes/product/batch/suppression)
- Modify: `apps/carehub/src/modules/adr/analytics.test.js`
- Test: new cases below.

- [ ] **Step 1: Failing tests**
`trendsByMonth` (buckets by YYYY-MM over trailing months, zero-filled);
`topReactionTerms` (normalized grouping, ranked, limit);
`seriousnessBreakdown` (six criteria counts + any-serious denominator);
`outcomeCounts` (six outcomes + unknown bucket, no invention);
`byProductBrand` / `byBatchLot` (counts; blanks grouped as “Not recorded”, never guessed);
`suppressCounts(entries, 5)` (counts < 5 → suppressed flag, values withheld);
reporter-type counts use qualification only.
Run → FAIL (missing).
- [ ] **Step 2: Implement helpers** (`SMALL_GROUP_THRESHOLD = 5` exported, interim).
- [ ] **Step 3: GREEN**
- [ ] **Step 4: Commit** (`feat(adr): phase6 analytics helpers`)

### Task 3: Tracker analytics UI + tabs + filters + drill-down + access log + tests

**Files:**
- Create: `apps/carehub/src/modules/adr/PvAnalytics.jsx` (+ `PvAnalytics.test.jsx`, renderToString: insufficient states, suppression display, disclaimer, drill callback, denominator captions)
- Modify: `PvTracker.jsx` (Cases|Analytics tabs; extend filters: outcome, date from/to, reporter type; analytics consumes the same filtered set; drill sets query + tab)
- Modify: `PvCaseDetail.jsx` (log `note` access event once per mount)
- Test: component tests above.

- [ ] **Step 1: Failing component tests** → FAIL.
- [ ] **Step 2: Implement** (loading/error/empty per bar; responsive; captions with period+denominator+filters+limitations; insufficient-data per sparse section; drill-down via existing filters; no case edits).
- [ ] **Step 3: Full ADR + permissions suites GREEN; eslint clean**
- [ ] **Step 4: Commit** (`feat(adr): phase6 tracker analytics ui`)

### Task 4: Docs + gate

**Files:**
- Create: `docs/architecture/ADR-PV-Analytics.md`
- **Interfaces:** section inventory, suppression/limitation policy, drill-down + logging, geographic/reporter-type data notes, rollback, test evidence.

- [ ] **Step 1: Write doc**
- [ ] **Step 2: Commit + STOP** (`docs(adr): phase6 pv analytics note`). Await Phase 7 approval.
