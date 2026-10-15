# Phase 8: Deadline Monitoring — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deadlines become versioned, explainable, and honestly labeled: a rule table owns the intervals (seeded with the brief's UNVERIFIED values), both submit RPCs stamp the rule version, and every deadline display names its rule plus the internal-only status. No new scheduler in this phase (infra decision deferred, documented).

**Architecture:** One migration (rules table + seed + calculator reads active row + version stamping + fallback); JS rule-aware calculator + repo reader; UI labels/escalation/due pills; one unverified copy fix; tests; docs.

**Tech Stack:** Postgres 15, existing ADR module, Vitest 2.

**Spec:** Master prompt §8 (Phase numbering §12); authority: `adr_compute_deadline`, `services.calculateDeadline`, `DeadlineBanner`, Tracker list/detail, `ReportsHub.jsx`.

## Global Constraints

- Brief timelines ship as ONE explicitly-unverified rule version, never as confirmed regulation; every display says internal.
- Rule changes are data (new version row), never code edits; history preserved (no UPDATE of past rows — new versions only; RLS writes admin-only).
- Fallback when no active row: brief constants + version `fallback-brief-unverified` (fail-open with honest label, never silent).
- Submission/ack/export/closure copy must never imply NAFDAC receipt; fix the ReportsHub window claim.
- No production migration apply; REVIEW ONLY.

## Review Focus

- Deadline computed from hardcoded intervals while an active rule row exists — expect table-driven.
- `deadline_rule_version` NULL on newly submitted reports — expect stamped.
- Tracker/Hub displays without rule version or internal-only label — expect both.
- Safety-signal cases without escalation display — expect banner.
- Copy implying regulatory submission or a confirmed window — expect none.

---

### Task 1: Migration — versioned rules, table-driven calculator, stamping, fallback

**Files:**
- Create: `supabase/migrations/carehub_20261108_adr_deadline_rules.sql`
- Create (mirror): `apps/carehub/sql/20261108_adr_deadline_rules.sql` (byte-identical)

- [ ] **Step 1: Write migration + mirror**
`adr_deadline_rules(rule_version PK, effective_from, is_active, rules jsonb
{serious_unexpected_hours, serious_expected_days, non_serious_unexpected_days,
non_serious_expected_days, safety_signal_days}, notes, created_by, created_at)`;
RLS read authenticated / write admin; seed `brief-2026-10-unverified` (72h/15d/
15d/90d/3d, notes: UNVERIFIED brief values — regulatory sign-off required).
`adr_active_deadline_rule()` → active version or `fallback-brief-unverified`.
Redefine `adr_compute_deadline` to read the active row (fallback constants);
both submit RPCs set `deadline_rule_version` from the helper (CREATE OR REPLACE
full bodies, all else identical).
- [ ] **Step 2: Self-review; hash-compare**
- [ ] **Step 3: Commit** (`feat(adr): phase8 versioned deadline rules`)

### Task 2: JS rule-aware calculator + repo reader + tests

**Files:**
- Modify: `services.js` (+ `calculateDeadlineWithRule`, `DEFAULT_BRIEF_RULE` marked unverified) — existing `calculateDeadline` untouched (draft projection, documented).
- Modify: `repositories/index.js` (+ `getActiveDeadlineRule`)
- Modify: `services.test.js`? (check name — else new `deadline.test.js`) + repo adapter test in `pvTracker.test.js`.

- [ ] **Step 1: Failing tests** (matrix over a custom rule set proves table-driven; repo RPC path).
- [ ] **Step 2: Implement**
- [ ] **Step 3: GREEN**
- [ ] **Step 4: Commit** (`feat(adr): phase8 rule-aware deadline helpers`)

### Task 3: UI labels, escalation, due pills, copy fix + tests

**Files:**
- Modify: `PvTracker.jsx` (row due-date + status pill)
- Modify: `PvCaseDetail.jsx` (rule/version line, internal-only label, safety-signal escalation banner)
- Modify: `AdrReportPage.jsx` or DeadlineBanner (version + internal label — read first, minimal touch)
- Modify: `ReportsHub.jsx` (remove unverified 24-hour window claim)
- Modify: `PvTracker.test.jsx` (due pill renders; escalation banner on signal; internal-only copy)

- [ ] **Step 1: Failing component tests** → FAIL.
- [ ] **Step 2: Implement**
- [ ] **Step 3: Full ADR + permissions suites GREEN; eslint clean**
- [ ] **Step 4: Commit** (`feat(adr): phase8 deadline displays`)

### Task 4: Docs + gate

**Files:**
- Create: `docs/architecture/ADR-Deadlines.md`
- **Interfaces:** rule table ops (new-version procedure), fallback doctrine, display contract, cron/scheduler follow-up, verification blockers, rollback, test evidence.

- [ ] **Step 1: Write doc**
- [ ] **Step 2: Commit + STOP** (`docs(adr): phase8 deadlines note`). Await Phase 9 approval.
