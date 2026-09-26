# CareHub Auth Email Implementation Plan

> **For agentic workers:** REQUIRED SUB SKILL: Use `subagent-driven-development` or `executing-plans` to implement this plan task by step.

**Goal:** Deliver reliable CareHub password recovery and security notices through the shared Supabase Auth hook with the CareHub brand.

**Architecture:** CareHub uses the same signed Auth hook and private membership table as CareFind. The hook resolves an active `carehub` membership, renders a CareHub template, and calls the Auth only enqueue function with an Auth proof. The existing CareHub reset page remains the only page that changes a password.

**Tech Stack:** Supabase Auth, Deno Edge Functions, Standard Webhooks, React 18, Vitest, Resend.

**Spec:** `docs/specs/_root/0001-reliable-email-system/0004-carehub-auth-email.md`

## Global Constraints

1. Do not commit unless the engineer explicitly asks.
2. CareHub accounts remain server confirmed. Do not add a second verification link.
3. User metadata and an arbitrary callback cannot establish CareHub ownership.
4. The shared hook verifies the raw Standard Webhooks signature before parsing.
5. Raw tokens, token hashes, passwords, and full addresses never enter logs, responses, event keys, or client bundles.
6. CareHub uses `https://carefindhub.com`, `CareHub <support@carefindhub.com>`, and the CareHub wordmark.
7. The Resend key is not available to the Auth hook or client.
8. Run SQL tests, Deno tests, CareHub tests and build, Supabase advisors, and real inbox checks before completion.

---

### Task 1: Seed CareHub Auth Catalog And Membership Checks

**Files:**

* Create: `supabase/migrations/20260924_carehub_auth_catalog.sql`
* Create: `supabase/tests/carehub_auth_catalog.sql`
* Modify: `supabase/functions/_shared/email/catalog.ts` to register the CareHub Auth templates

**Interfaces:**

* Consumes: `account_app_memberships`, foundation catalog, and shared brand policy
* Produces: CareHub `password_reset` and security notice catalog entries

* [ ] **Step 1: Write failing catalog tests**

Assert CareHub app, event keys, template keys, sender, reply address, subject prefix, closed payload schema, and required callback fields. Assert an Auth event cannot be enqueued by the business adapter.

* [ ] **Step 2: Run tests and confirm failure**

Run: `supabase test db supabase/tests/carehub_auth_catalog.sql`

Expected: missing CareHub Auth catalog rows.

* [ ] **Step 3: Seed the catalog**

Add `password_reset` and CareHub security notice entries. Keep them disabled until the shared hook and CareHub client pass fixture tests. Use the canonical CareHub sender and reset callback.

* [ ] **Step 4: Apply and verify**

Run the migration and SQL checks. Inspect RLS, catalog payloads, event state, and grants.

---

### Task 2: Build CareHub Auth Templates And Tests

**Files:**

* Create: `supabase/functions/_shared/email/carehubAuthTemplates.ts`
* Create: `supabase/functions/_shared/email/carehubAuthTemplates.test.ts`
* Modify: `supabase/functions/_shared/email/templates.ts`

**Interfaces:**

* Consumes: catalog event and safe payload
* Produces: `carehub_password_reset` and `carehub_security_notice`

* [ ] **Step 1: Write failing template tests**

Test CareHub subject prefix, sender, reply address, wordmark URL and proportions, login link origin, plain text, hidden preview, safe action copy, no password, no clinical detail, and no CareFind string.

* [ ] **Step 2: Run tests and confirm failure**

Run: `deno test supabase/functions/_shared/email/carehubAuthTemplates.test.ts`

Expected: templates do not exist.

* [ ] **Step 3: Implement pure templates**

Use the shared table layout, inline styles, 240 pixel proportional wordmark, 600 pixel width, and exact CareHub origin validation. Return HTML and plain text only. Catalog code supplies subject and sender.

* [ ] **Step 4: Run tests and confirm pass**

Run: `deno test supabase/functions/_shared/email/carehubAuthTemplates.test.ts`

Expected: all CareHub template tests pass.

---

### Task 3: Extend And Test The Shared Auth Hook For CareHub

**Files:**

* Modify: `supabase/functions/send-email/authPayload.ts`
* Modify: `supabase/functions/send-email/eventKey.ts`
* Modify: `supabase/functions/send-email/index.ts`
* Modify: `supabase/functions/send-email/index.test.ts`
* Modify: `supabase/config.toml`

**Interfaces:**

* Consumes: signed Supabase Auth hook payload, membership table, CareHub catalog, and Auth enqueue proof
* Produces: one correctly branded CareHub recovery or security outbox row

* [ ] **Step 1: Add failing CareHub hook cases**

Test CareHub recovery membership, CareFind only membership, forged metadata, exact callback validation, tokenless security notice, duplicate Auth request, invalid signature, missing membership, invalid proof, and enqueue failure.

* [ ] **Step 2: Run tests and confirm failure**

Run: `deno test supabase/functions/send-email`

Expected: new CareHub cases fail because the hook only resolves CareFind.

* [ ] **Step 3: Extend app resolution**

Use active `account_app_memberships`. A recovery callback can select CareHub only when the account already has CareHub membership. An ambiguous or absent membership fails visibly.

* [ ] **Step 4: Add the Auth enqueue proof**

Compute a short proof from `AUTH_EVENT_KEY_SECRET`. Pass it to `enqueue_auth_email_event`, which verifies the protected Vault copy. Do not expose the proof to the Vercel Node adapter.

* [ ] **Step 5: Keep the shared hook contract**

Accept only `email_data`, retain raw body signature verification, and keep the Supabase built in sender disabled after cutover. Never log raw body or token data.

* [ ] **Step 6: Run tests and confirm pass**

Run: `deno test supabase/functions/send-email`

Expected: CareFind and CareHub Auth cases pass.

---

### Task 4: Move The CareHub Client Recovery Flow

**Files:**

* Modify: `apps/carehub/src/pages/auth/ForgotPassword.jsx`
* Modify: `apps/carehub/src/pages/auth/__tests__/forgotReset.test.jsx`
* Modify: `apps/carehub/src/pages/auth/ResetPassword.jsx` only if callback handling needs a focused test
* Modify: `apps/carehub/src/pages/auth/Login.jsx` only if the reset link copy needs a focused update
* Delete: `apps/carehub/api/_handlers/auth-email.js`
* Modify: `apps/carehub/api/router.js`
* Delete: `packages/shared-email/src/authEmail.js` after the shared hook is proven
* Modify: `packages/shared-email/src/index.js`

**Interfaces:**

* Consumes: normal Supabase `resetPasswordForEmail` and shared hook
* Produces: one CareHub client recovery path with no custom Auth mail request

* [ ] **Step 1: Write failing client tests**

Assert the client calls `resetPasswordForEmail` with `https://carefindhub.com/reset-password`, does not call `/api/auth-email`, keeps generic success copy, and preserves loading, error, success, responsive, and accessible states.

* [ ] **Step 2: Run tests and confirm failure**

Run from `apps/carehub`: `npm test -- src/pages/auth/__tests__/forgotReset.test.jsx`

Expected: tests still describe the custom route or fail on the new contract.

* [ ] **Step 3: Update the client**

Use the canonical CareHub callback. Keep the existing reset page as the only password update surface. Do not add a second mail request after the Supabase call.

* [ ] **Step 4: Remove the old route and export**

Remove the CareHub Auth mail route, handler, old package export, and custom client fetch. Return `410` during the controlled cutover, then remove the route registration after caller searches are clean.

* [ ] **Step 5: Run tests and build**

Run: `npm test` and `npm run build` from `apps/carehub`.

Expected: all tests pass, the build is clean, and no custom Auth mail reference remains.

---

### Task 5: Verify CareHub Auth Mail

**Files:**

* Create: `docs/operations/CAREHUB_AUTH_EMAIL.md`
* Modify: `docs/scope/_root/0001-reliable-email-system.md` only after verified milestones

**Interfaces:**

* Consumes: the shared hook, CareHub membership backfill, CareHub templates, and client flow
* Produces: verified CareHub recovery and security mail

* [ ] **Step 1: Verify membership and catalog**

Check that test CareHub owners and staff have active CareHub membership, the CareFind only account cannot use CareHub recovery, and catalog payloads are closed.

* [ ] **Step 2: Run signed hook fixtures**

Test recovery, password change, email change, identity change, MFA change, reauthentication, duplicate request, invalid signature, invalid proof, and missing membership.

* [ ] **Step 3: Run a live recovery request**

Use a CareHub test account, open the Gmail and Outlook messages on web and mobile, follow the link, and complete the existing reset flow. Confirm the sender, logo, link origin, and plain text.

* [ ] **Step 4: Run Supabase advisors and document recovery**

Record findings with remediation links. Document hook disable, dispatch pause, membership resolution, and safe handling of ambiguous accounts.
