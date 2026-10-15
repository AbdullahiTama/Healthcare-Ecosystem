# Phase 9: Privacy, Security & Auditability Hardening — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove the running system enforces its own rules (adversarial probes from this session), close the hard-delete and rule-change audit gaps, and bring every architecture doc to live-state accuracy. No new features; notifications get designed-not-wired honesty.

**Architecture:** Probes via MCP SQL (anon-role reads, grant inventory, search_path audit, transactional trigger tests if the tool honors ROLLBACK); one small migration (non-draft hard-delete guards); docs status pass; explicit deferrals (notifications wiring, column encryption, staging RLS-as-user tests).

**Tech Stack:** Live Postgres 17, Supabase advisors, existing test suites (unchanged code → no reruns needed).

## Global Constraints

- Zero production data writes except schema + probes rolled back; no test users, no test rows left behind.
- Non-admin hard delete of non-draft cases (and their children, verified routes) becomes impossible; admin break-glass stays platform-audited.
- Every check names its evidence (query output) or its absence honestly.

## Review Focus

- Submitted case deletable by its owner via direct API — expect trigger rejection.
- Verified route deletable by submitter — expect trigger rejection.
- Deadline-rule change without audit — expect admin_audit_log trigger or documented platform control.
- Anon reads on any ADR object — expect zero rows + RPC denial/safe-noop.
- New DEFINER function without pinned search_path — expect none.

---

### Task 1: Adversarial probes (live, read-only + rolled-back)

**Files:** none (evidence goes to the docs note + closure report).

- [ ] **Step 1: Grant + surface inventory**
`accesstypes`: EXECUTE grants on all `adr_*`/routing/verify/search/correct/log functions by role; SELECT grants on ADR tables/views; storage bucket policies for adr-private (anon excluded).
Expected: authenticated-only (+ service_role), anon denied everywhere.
- [ ] **Step 2: search_path audit**
All new plpgsql/sql functions have `SET search_path = public`.
Expected: zero mutable-search_path findings attributable to Phases 1–8 (create_shop_order is pre-existing).
- [ ] **Step 3: Anon-role reads**
`SET ROLE anon` (transaction-local): counts on adr_reports/routes/events/view/aliases → all 0; `adr-private` storage listing denied.
Expected: zeros + denial (note: service_role tooling; anon role approximates logged-out).
- [ ] **Step 4: Transactional trigger probe (only if ROLLBACK verifies)**
Canary: temp table write + rollback proves transactional control; then scratch draft lifecycle probes (delete-draft-allowed, delete-submitted-denied) fully rolled back.
Expected: trigger allows draft delete, raises otherwise; zero residue (count check after).

### Task 2: Delete-guard migration + rules-change audit

**Files:**
- Create: `supabase/migrations/carehub_20261110_adr_delete_guards.sql` (+ mirror)
- Check first: `admin_audit_log` columns for the rules-change trigger target.

- [ ] **Step 1: Write migration + mirror**
`adr_guard_case_delete()` BEFORE DELETE on adr_reports: non-draft + non-admin → raise.
Same guard on 4 child tables (parent non-draft + non-admin → raise).
`adr_guard_route_delete()`: verified/routed + non-admin → raise.
Deadline-rule changes: trigger into `admin_audit_log` if shape fits, else documented platform-DDL control (decide after inspection).
- [ ] **Step 2: Apply live + verify** (trigger presence; transactional probe per Task 1.4).
- [ ] **Step 3: Commit** (`feat(adr): phase9 delete guards`)

### Task 3: Docs live-state pass + validation test-count correction

**Files:** all 8 `docs/architecture/ADR-*.md` (Status sections → applied state + migration names + dates); fix `validation.test.js` 18→17 count in the Phase 2 note.

- [ ] **Step 1: Edit + commit** (`docs(adr): phase9 live-state pass`)

### Task 4: Close (no code => no suite reruns; state why)

- [ ] STOP + report. Await Phase 10 approval. Residual: notifications wiring design, column-level encryption decision, staging RLS-as-user matrix, CareFind component suite in CI.
