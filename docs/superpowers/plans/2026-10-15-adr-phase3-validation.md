# Phase 3: Server-Side ICSR Validation Hardening — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the remaining server-validation gaps so every channel's "valid basic ICSR" bar is identical and machine-checkable: contact-route coverage for Hub rows, machine-readable error codes from the RPCs, skincare module parity in the shared core, ternary-seriousness parity for Hub reactions, and no routing-to-verified without a passing gate.

**Architecture:** One migration (additive gate clauses + `missingFields` codes in RPC returns + `verify` requires `gate_validated_at`); twin updates in both client validators + tests; no form/UX changes.

**Tech Stack:** Postgres 15 (RLS/DEFINER as before), Vitest 2 in both apps.

**Spec:** Master prompt §6 + §§4–5; authority files: `carehub_20261103_adr_public_access.sql` (`adr_icsr_missing`, both submit RPCs, `verify_adr_product_route`), `apps/carehub/src/modules/adr/validation.js`, `apps/carefind/src/modules/safety-report/validation.js`.

## Global Constraints

- Hub UX preserved: no previously-submittable valid Hub report may newly fail except where §6 explicitly demands it (contact fallback, skincare parity) — each tightening gets its own test proving the old-valid case still passes or a documented ruling.
- RPC return shapes stay backward compatible: `{valid, missing}` unchanged; codes added as a new `missingFields: [{id, label}]` key (Hub client already consumes this shape).
- Unknown never coerced to No; conditional gates stay conditional.
- No production migration apply; REVIEW ONLY marking.
- No `submit` path may bypass `gate_validated_at`; no `routed` status without it.

## Review Focus

- Hub report with reporter-level contact blank but business-level contact present — expect PASS (facility fallback).
- Hub report with neither — expect FAIL with the contact label (new behavior; ruling).
- RPC `missing` strings changing — expect byte-identical strings, codes additive only.
- Skincare draft missing `application_site` previously submittable — expect FAIL after (parity ruling).
- `verify_adr_product_route` on an unvalidated report — expect rejection until `gate_validated_at` set.
- Public `unknown`-array requirement leaking into Hub gate — expect Hub rows never checked for it.

---

### Task 1: Migration — contact fallback, skincare parity, codes, verify-requires-valid

**Files:**
- Create: `supabase/migrations/carehub_20261104_adr_icsr_hardening.sql`
- Create (mirror): `apps/carehub/sql/20261104_adr_icsr_hardening.sql` (byte-identical)

**Interfaces:**
- Consumes: Phase 2 objects.
- Produces: extended `adr_icsr_missing` (contact-fallback clause returning label
  'Reporter phone or email (or facility contact)'; skincare clause for
  module_type='skincare': application_site/cosmetic_reaction_type/onset/discontinued/resolution),
  `adr_icsr_missing_coded(uuid)` returning `{missing, missingFields}` with stable field ids
  matching both clients' anchors; both submit RPCs attach `missingFields`; public RPC keeps
  its extras (contact strict, ternary) unchanged in outcome; `verify_adr_product_route`
  raises unless the parent report has `gate_validated_at NOT NULL`.

- [ ] **Step 1: Write migration + mirror**
Contact fallback inside shared core: pass only if reporter phone/email present OR
(submitting business row has phone/email — Hub rows only; public rows have NULL business
so the fallback can never fire for them, keeping the public strict rule intact).
Skincare clause mirrors `validateSkincareFields` mandatory set (application_site,
cosmetic_reaction_type, onset_timing, discontinued_use NOT NULL, resolution_status).
Field ids: reporter_qualification, reporter_name, reporter_consent_followup,
reporter_contact, patient_identifier, patient_age, patient_gender, products_section,
reaction_description, severity, outcome, seriousness_fields, regulatory_batch_lot_number,
regulatory_causality_assessment, case_narrative_summary, ward_department,
attending_physician, skincare_* (new ids, documented).
Verify gate: `IF parent.gate_validated_at IS NULL → RAISE 'report has not passed validation'`.
Keep all existing strings byte-identical.

- [ ] **Step 2: Self-review vs Review Focus; hash-compare mirrors**
- [ ] **Step 3: Commit** (`feat(adr): phase3 icsr hardening migration`)

### Task 2: Client twins + tests (both apps)

**Files:**
- Modify: `apps/carehub/src/modules/adr/validation.js` (+ contact-fallback note: client cannot see business contact — client keeps reporter-level check, server fallback documented; add skincare submit-gate parity + codes passthrough)
- Modify: `apps/carehub/src/modules/adr/validation.test.js` (skincare gates, codes shape)
- Modify: `apps/carefind/src/modules/safety-report/validation.js` (consume `missingFields` ids from server errors; no rule relaxation)
- Test: both suites green; carehub ADR full suite unchanged counts except additions.

- [ ] **Step 1: Failing tests first** (skincare missing fails; coded shape asserted)
- [ ] **Step 2: Implement twins**
- [ ] **Step 3: Run both suites green**
- [ ] **Step 4: Commit** (`feat(adr): phase3 validator twins and codes`)

### Task 3: Docs + gate

**Files:**
- Create: `docs/architecture/ADR-ICSR-Validation.md`
- **Interfaces:** change summary, contact-fallback ruling, skincare-parity ruling, verify-requires-valid, rollback, test evidence, still-blocked regulatory items.

- [ ] **Step 1: Write doc**
- [ ] **Step 2: Commit + STOP** (`docs(adr): phase3 icsr validation plan and note`). Await Phase 4 approval.
