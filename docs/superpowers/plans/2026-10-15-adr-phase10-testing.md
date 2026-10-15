# Phase 10: Automated Testing & Release Documentation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the program with honest, runnable evidence: fill the remaining locally-runnable test gaps, re-verify the live database read-only end-to-end, attempt both production builds, and publish the master release record (change summary, permissions, evidence, risks, rollback, sign-offs). No new features; no production writes.

**Architecture:** One static separation test (CareFind, runs anywhere); live read-only verification snapshot; lint sweep + build attempts with truthful reporting; one master release doc.

## Global Constraints

- Zero production writes (probes are SELECT-only; no test rows, no test users).
- Never claim an unrun result; environment-blocked items stay explicitly CI-bound with reasons.
- Pre-existing failures are reported as pre-existing (proven via stash where claimed).

## Review Focus

- Separation test that passes vacuously (matches nothing) — expect assertions on known-present markers too.
- Build failure blamed on ADR code when design-system absence is the cause — expect pre-existing proof.
- Release doc claiming compliance or submission capability — expect blocked-item honesty.

---

### Task 1: Test gaps (runnable) + live read-only snapshot

**Files:**
- Create: `apps/carefind/src/modules/safety-report/separation.test.js`
- Test: static source scan (module tree contains no `posts` table access; entry route exists in `main.jsx`; CREATE_OPTIONS contains the safety entry in `Feed.jsx`).

- [ ] **Step 1: Failing test** (assert markers that exist + forbidden patterns that must not) → FAIL (file missing).
- [ ] **Step 2: Implement** (node:fs reads, mirroring `mainSourceOrder.test.js` precedent).
- [ ] **Step 3: GREEN** (`npx vitest run src/modules/safety-report/separation.test.js`).
- [ ] **Step 4: Live snapshot** (read-only): ADR object inventory (tables/views/functions/triggers/policies counts), data counts, active rule version, advisors delta vs Phase 9 (new findings attributable to this phase: none expected — no migrations in Phase 10).
- [ ] **Step 5: Commit** (`test(adr): phase10 separation test`)

### Task 2: Lint sweep + build attempts

- [ ] **Step 1: ESLint** over every ADR-touched file (both apps) → 0 errors or pre-existing-only warnings with proof.
- [ ] **Step 2: Builds** `npm run build` in `apps/carehub` and `apps/carefind` → report real outcomes (pre-existing design-system absence is the expected blocker; prove via failure text, do not fix unrelated breakage in this phase).
- [ ] **Step 3: Record** exact commands + outputs in the release doc.

### Task 3: Master release documentation + close

**Files:**
- Create: `docs/architecture/ADR-Release-Record.md`
- **Interfaces:** what existed / implemented+tested / implemented-not-deployed / migrations applied / blocked-by-approval list / unverified facts / file-by-file changes / permission deltas / test evidence table / security implications / risks / rollback / required sign-offs (PV/regulatory, privacy).

- [ ] **Step 1: Write doc**
- [ ] **Step 2: Commit + STOP** (`docs(adr): phase10 release record`). Program complete pending sign-offs; no further phases.
