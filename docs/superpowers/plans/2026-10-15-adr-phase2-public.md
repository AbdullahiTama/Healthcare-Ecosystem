# Phase 2: Public CareFind ADR Reporting Journey — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add "Safety Report" to the CareFind Create selector opening a 6-step confidential ADR wizard at `/report-side-effect` (welcome → reporter → patient → products+company → reactions → additional → review → success), backed by server-side drafts, the Phase 1 routing RPCs, and a new public submit RPC. Nothing ever writes to `posts`.

**Architecture:** One follow-up migration (public-draft access, `seriousness_unknown`, `gate_validated_at`, `adr-private` bucket, shared gate core + public submit RPC; Hub `submit_adr_report` keeps INVOKER + identical behavior via the shared core); one new CareFind module `safety-report/` (constants, client twin validator, supabase-js repository, wizard UI + autosave hook); one-line Create-selector entry + one route.

**Tech Stack:** Postgres 15 RLS, supabase-js, React 18 + react-router 6, design-system primitives, Vitest 2 + testing-library.

**Spec:** Master prompt §§5.1–5.8 + Phase 1 (`carehub_20261102_adr_routing_foundation.sql`, `routing.js`).

## Global Constraints

- ADR submissions NEVER touch `posts`/feed; no patient/reporter/attachment data in feed queries.
- Login required (RequireAuth); no guest reporting in this phase (CareFind posting is login-gated; Ruling 1).
- Server is authoritative: client validators are twins; `submit_adr_public_report` enforces contact route + ternary seriousness server-side for public rows only.
- Unknown seriousness NEVER coerced to No: stored in `seriousness_unknown[]`; Hub booleans untouched.
- Internal acknowledgement ≠ regulatory submission in all copy; no NAFDAC-submission claims.
- No production migration apply; migration marked REVIEW ONLY.
- Public label verbatim: "Company responsible for this medicine/product in your country (if known)".
- Welcome heading verbatim: "Report a suspected side effect". Collapsed section verbatim: "Additional Information (Optional)".

## Review Focus

- Wizard write reaching `posts` or feed invalidation — expect zero `posts` references in the module.
- Draft readable by another user (guessed UUID) — expect denied by reporter-owner RLS.
- Direct PATCH flipping own draft to `submitted` — expect denied (WITH CHECK draft-only); only the RPC flips.
- Direct RPC submit of a contact-less public draft — expect `missing` contains contact route.
- "Not sure" seriousness arriving as false without array entry — expect rejected until array present.
- Unverified typed company name granting the company access — expect no grant (Phase 1 policy).
- Attachments publicly readable (URL guessing) — expect private bucket, owner-only SELECT.

---

### Task 1: Migration — public drafts, ternary seriousness, validity stamp, private bucket

**Files:**
- Create: `supabase/migrations/carehub_20261103_adr_public_access.sql`
- Create (mirror): `apps/carehub/sql/20261103_adr_public_access.sql` (byte-identical)
- Test: static review vs Review Focus; JS suites unaffected (no JS changed)

**Interfaces:**
- Consumes: Phase 1 objects + `adr_report_products/product_id`, `auth.uid()`.
- Produces: `adr_reports.reporter_auth_user_id`, `adr_report_reactions.seriousness_unknown text[]`,
  `adr_reports.gate_validated_at`; helpers `can_access_adr_public_draft_row`,
  `can_access_adr_public_draft(uuid)`, `can_write_adr_public_draft(uuid)`,
  `adr_icsr_missing(uuid)`, `adr_compute_deadline(...)`; RPC `submit_adr_public_report(uuid)`;
  bucket `adr-private`; extended policies; analytics + `gate_validated_at`.

- [ ] **Step 1: Write migration + mirror**
Columns (all `IF NOT EXISTS`, additive): reporter_auth_user_id uuid NULL;
seriousness_unknown text[] NULL (no default; presence proves ternary UI use);
gate_validated_at timestamptz NULL.
Helpers (DEFINER, pinned search_path, EXECUTE hardened):
row-helper from columns (no self-read for adr_reports policies);
report-helper EXISTS (public + owner, any status) for child/routes/events + RPCs;
write-helper EXISTS (public + owner + draft) for mutations.
Extract `adr_icsr_missing(p_report_id)` with gates 1–15 byte-identical to live
`submit_adr_report` (reporter qual/name+anon/consent/patient id/age trio/gender/
products+brand/reactions+desc+severity+outcome+seriousness non-null/industry/hospital);
extract `adr_compute_deadline(created,serious,expected,signal)`.
Rewrite `submit_adr_report` (still SECURITY INVOKER) to call both helpers;
UPDATE also sets `gate_validated_at=now()`; returns identical shape.
New `submit_adr_public_report` (DEFINER): owner-of-public-draft check else
'Report not found or not accessible'; public extras (contact route: phone or
email-with-@; name or anon+facility+facility-contact; every reaction row
`seriousness_unknown IS NOT NULL`); shared gate; shared deadline; sets
status/deadline/`gate_validated_at`; returns same shape.
Policies: adr_reports SELECT +row-helper; INSERT +reporter branch
(NULL business, public, draft, owner=me); UPDATE USING (row-helper OR owner-any)
WITH CHECK (row-helper OR owner+NULL-biz+public+draft); DELETE owner+draft only.
Child tables (products/meds/reactions/photos): split `via report` FOR ALL into
SELECT (old OR read-helper) + write policies (old OR write-helper).
Routes table: same split (SELECT old-second-branch kept; INSERT/UPDATE/DELETE
old OR write-helper). Events read: old OR read-helper.
`create_adr_product_route` check becomes (can_access_adr_report OR
can_write_adr_public_draft) — Hub unchanged, public reporters draft-only.
Bucket `adr-private` (private, 10MB, jpg/png/webp) + storage policies:
INSERT/SELECT/DELETE TO authenticated on own first-folder (`foldername(name)[1] = uid`).
Analytics view: + `gate_validated_at`, invoker kept.

- [ ] **Step 2: Self-review vs the 7 Review Focus lines; verify mirror identical**
Run: compare hashes of the two files.
Expected: identical; each focus line answered.

- [ ] **Step 3: Commit**
```bash
git add supabase/migrations/carehub_20261103_adr_public_access.sql apps/carehub/sql/20261103_adr_public_access.sql
git commit -m "feat(adr): phase2 public-draft access, ternary seriousness, validity stamp, private bucket"
```

### Task 2: CareFind safety-report module — constants, validator, repository + tests

**Files:**
- Create: `apps/carefind/src/modules/safety-report/constants.js`
- Create: `apps/carefind/src/modules/safety-report/validation.js`
- Create: `apps/carefind/src/modules/safety-report/validation.test.js`
- Create: `apps/carefind/src/modules/safety-report/repository.js`
- Test: same two test files (+ repo adapter tests inside `repository.test.js` if supabase mock pattern exists, else recording-adapter tests for key builders in validation.test.js)

**Interfaces:**
- Consumes: `supabase` client, `PUBLIC_COMPANY_LABEL` (twinned from CareHub routing.js with comment).
- Produces: step ids/labels, qualification/gender/age-group/severity/outcome/seriousness-question constants;
  `validatePublicReport(draft) -> {valid, missing, missingFields}` mirroring the public RPC extras;
  `normalizeCompanyName`, `buildRouteKey` (twins, same rule); repository `{createDraft, getMyDrafts,
  getDraftWithDetails, updateDraft, deleteDraft, saveProduct(s), saveReaction(s), saveMeds,
  uploadAttachment, removeAttachment, signedUrl, searchCompanies, createRoutes, submit}`.

- [ ] **Step 1: Write failing validation tests**
Cases: valid basic report passes; missing reporter name (no anon) fails; anon without
facility name/contact fails; missing contact route fails (no phone AND no email);
consent null fails; missing patient id/gender/age-trio fails; no product / product w/o
brand fails; no reaction / reaction w/o desc/severity/outcome fails; any seriousness
criterion unanswered fails; Not-sure recorded in unknown array passes (not coerced);
unknown array missing fails. Twins of RPC strings where applicable.
Run: `npx vitest run src/modules/safety-report/validation.test.js` in apps/carefind.
Expected: FAIL (module missing).

- [ ] **Step 2: Implement constants.js + validation.js**
Ternary seriousness: answers per criterion `yes|no|not_sure`; `not_sure` entries listed in
`seriousness_unknown`, booleans true only for `yes`. Verbatim labels where spec fixes them.

- [ ] **Step 3: Run tests GREEN**
Expected: PASS.

- [ ] **Step 4: Implement repository.js (thin supabase-js wrappers, no feed imports)**
Draft rows carry `report_source:'public'`, `status:'draft'`, `business_id:null`;
attachments to `adr-private/<uid>/<reportId>/…` + `createSignedUrl` for display;
routes via `rpc/create_adr_product_route` with twin idempotency keys;
submit via `rpc/submit_adr_public_report`. Zero imports from social-feed/posts.

- [ ] **Step 5: Commit**
```bash
git add apps/carefind/src/modules/safety-report/constants.js apps/carefind/src/modules/safety-report/validation.js apps/carefind/src/modules/safety-report/validation.test.js apps/carefind/src/modules/safety-report/repository.js
git commit -m "feat(carefind): phase2 safety-report validator and repository"
```

### Task 3: Wizard UI + entry point + route + tests

**Files:**
- Create: `apps/carefind/src/modules/safety-report/SafetyReportPage.jsx` (+ step components
  colocated or `steps/` if >200 lines each — keep each step its own file)
- Create: `apps/carefind/src/modules/safety-report/useSafetyDraft.js`
- Create: `apps/carefind/src/modules/safety-report/SafetyReport.test.jsx`
- Modify: `apps/carefind/src/modules/social-feed/Feed.jsx` (one CREATE_OPTIONS line)
- Modify: `apps/carefind/src/main.jsx` (lazy import + `/report-side-effect` RequireAuth route)
- Test: `SafetyReport.test.jsx` (welcome copy, step flow, review-missing edit links, never-posts assertion)

**Interfaces:**
- Consumes: Task 2 module, `useAuth`, design-system primitives, theme.
- Produces: `/report-side-effect` page; `safety` Create option navigating there.

- [ ] **Step 1: Failing component tests**
Welcome heading verbatim; Start begins step 1; Continue draft appears with a draft;
completing required fields advances; review lists missing with edit links; success shows
reference; module contains no `from '…posts…'`/`.from('posts')` (static grep assertion
over module source in test? No — assert via `git grep` run manually; test the behavior).
Run: `npx vitest run src/modules/safety-report/SafetyReport.test.jsx`.
Expected: FAIL.

- [ ] **Step 2: Implement wizard**
Welcome (heading + safety-not-proof + not-emergency + Start/Continue) → S1 reporter
(prefill profile name + auth email, qualification select, phone/email, consent radio,
facility-anon branch) → S2 patient (identifier + interim initials guidance, gender,
age/DOB/age-group trio) → S3 products (repeatable rows: brand search/manual, company
type-ahead verified|I-don't-know|can't-find+text, optional batch/expiry/dose/route/
frequency/indication/dates) → S4 reactions (repeatable: description, severity, outcome,
six ternary seriousness questions, onset/duration optional here) → S5 additional
(collapsed section, concomitant meds, history, weight/height, attachments w/ signed-URL
previews) → S6 review (summary + missing/edit links + Submit) → success (reference +
internal-acknowledgement next-steps). Progress indicator, Back/Next, debounced server
autosave (`useSafetyDraft`, in-memory pending + retry, no sensitive data in localStorage),
loading/error/empty states, mobile-first single column, labelled inputs + focus
management + aria-live progress/errors.

- [ ] **Step 3: Wire entry + route; verify icon exists**
Feed.jsx CREATE_OPTIONS += `{ key:'safety', Icon:ShieldAlert, label:'Safety Report',
run: () => navigate('/report-side-effect') }` (verify ShieldAlert export in lucide-react;
fallback TriangleAlert/AlertTriangle). main.jsx lazy + RequireAuth route.

- [ ] **Step 4: Run module tests + grep proof of feed separation**
Run: `npx vitest run src/modules/safety-report`; `grep -rn "posts" src/modules/safety-report`
Expected: PASS; grep empty (except comments).

- [ ] **Step 5: Regression — CareHub ADR suite + CareFind touched suites**
Run: carehub `npx vitest run src/modules/adr`; carefind social-feed selector tests if any
reference CREATE_OPTIONS (BottomNav/createSelector tests).
Expected: PASS, no count changes except +1 option.

- [ ] **Step 6: Commit**
```bash
git add apps/carefind/src/modules/safety-report apps/carefind/src/modules/social-feed/Feed.jsx apps/carefind/src/main.jsx
git commit -m "feat(carefind): phase2 safety-report wizard, entry point and route"
```

### Task 4: Docs + gate

**Files:**
- Create: `docs/architecture/ADR-Public-Reporting.md`
- Test: `git status --short` shows only intended files.

- [ ] **Step 1: Doc** (change summary, RLS delta, rollback, test evidence, interim
  decisions: login-required, initials-guidance, ternary storage, internal-ack copy;
  blocked-from-prod list).

- [ ] **Step 2: Commit + STOP**
```bash
git add docs/architecture/ADR-Public-Reporting.md docs/superpowers/plans/2026-10-15-adr-phase2-public.md
git commit -m "docs(adr): phase2 public reporting plan and architecture note"
```
Then STOP — report, await Phase 3 approval.
