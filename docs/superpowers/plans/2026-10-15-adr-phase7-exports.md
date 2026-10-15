# Phase 7: Exports — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete, permission-aware export coverage for both ADR surfaces from already-authorized data: per-case CSV (Hub full / Tracker masked), filtered bulk PDF with cover, analytics print report, and an honestly-labeled E2B download. Every export carries timestamp, counts, filters, and an audit event; large sets are capped with explicit notes.

**Architecture:** Pure builder additions in `exports.js` (CSV + bulk-PDF refactor-extract + analytics HTML + E2B version note), UI buttons in Tracker list/analytics and Hub list, `exported` events with count/filter metadata. No migration (no schema change; XLSX deferred for lack of a safe client lib).

**Tech Stack:** Existing `exports.js`, `openPrintView`/`downloadTextFile`, Vitest 2.

**Spec:** Master prompt §7 (Phase numbering §11); authority: `exports.js`, `PvTracker.jsx`, `PvCaseDetail.jsx`, `AdrReportsList.jsx`, `AdrReportPage.jsx`.

## Global Constraints

- Builders render only passed-in rows (already permission-scoped by callers); Tracker calls pass masked view data with `includeReporter:false`, Hub passes own rows with `includeReporter:true` (parity with existing NAFDAC print).
- No new PII in any export beyond what the calling surface may already display.
- E2B is explicitly NOT a validated submission channel (version note + UI labels + docs); no XSD/gateway claims.
- Bulk PDF capped at 200 cases with truncation note; CSV via Blob; failures surface explicitly.
- No production migration; no backend change in this phase.

## Review Focus

- Tracker CSV containing reporter name/phone/email or patient identifier — expect absent.
- Hub CSV missing reporter PII the Hub already prints — expect present (parity).
- Bulk PDF without cover counts/filters/timestamp or silently dropping cases past the cap — expect all three present.
- Export buttons not logging `exported` events — expect event with format+count.
- E2B download labeled as submission — expect preparation-only language.

---

### Task 1: Builders + tests (CSV, bulk extract, analytics HTML, E2B note)

**Files:**
- Modify: `apps/carehub/src/modules/adr/exports.js` (+ `E2B_FORMAT_NOTE`, `buildAdrCsv(rows,{includeReporter})`, `caseBodyHtml` extract keeping `buildPdfHtml` output identical, `buildBulkPdfHtml({cases,filtersLabel,orgName,generatedAt,cap})`, `buildAnalyticsHtml({figures,filtersLabel,periodLabel,orgName,generatedAt})`)
- Modify: `apps/carehub/src/modules/adr/exports.test.js`

- [ ] **Step 1: Failing tests**
CSV: header row stable; commas/quotes/newlines escaped; missing optionals safe; Tracker mode excludes reporter+identifier; Hub mode includes them; one row per reaction (case columns repeated).
Bulk: cover has org, timestamp, count, filters, truncation note past cap; per-case source headers; empty set → explicit empty document (not a crash).
Analytics HTML: disclaimer, period, filters, denominators, suppression note, limitation lines.
E2B: `E2B_FORMAT_NOTE` exported and embedded as an XML comment; builders otherwise unchanged.
Run → FAIL.
- [ ] **Step 2: Implement** (extract keeps single-case bytes identical — prove via existing tests still passing unmodified).
- [ ] **Step 3: GREEN**
- [ ] **Step 4: Commit** (`feat(adr): phase7 export builders`)

### Task 2: UI wiring + audit events + labels + tests

**Files:**
- Modify: `PvTracker.jsx` (analytics tab: Download analytics report (print); list header: Export filtered CSV; bulk PDF button with cap note)
- Modify: `PvCaseDetail.jsx` (add per-case CSV download alongside print/E2B; relabel E2B button preparation-only)
- Modify: `AdrReportsList.jsx` (Export filtered CSV of own reports) and/or `AdrReportPage.jsx` (per-case CSV; relabel industry E2B button)
- Modify: `PvTracker.test.jsx` (renderToString: export buttons present; E2B preparation-only copy present)

- [ ] **Step 1: Failing component tests** → FAIL.
- [ ] **Step 2: Implement** (all exports call `logEvent(reportId|bulk-marker,'exported',{format,count,filters})`; bulk uses per-report events? No — one bulk event on... events require a report row; log one `note` per bulk on... simpler: log `exported` on each included report? N writes for 200 cases — heavy but auditable. Middle path: log a single `exported` event on the FIRST report with metadata {bulk:true,count,filters}? Misleading attribution. Decision: bulk/analytics exports log per-report `exported` events with shared batch id (accurate, countable; 200 RPC calls batched via Promise.allSettled with explicit partial-failure note). Record ruling.)
- [ ] **Step 3: Full ADR + permissions suites GREEN; eslint clean**
- [ ] **Step 4: Commit** (`feat(adr): phase7 export wiring`)

### Task 3: Docs + gate

**Files:**
- Create: `docs/architecture/ADR-Exports.md`
- **Interfaces:** matrix (surface × format × masking), E2B status, caps/failure behavior, audit scheme, XLSX deferral + CVE note, rollback, test evidence.

- [ ] **Step 1: Write doc**
- [ ] **Step 2: Commit + STOP** (`docs(adr): phase7 exports note`). Await Phase 8 approval.
