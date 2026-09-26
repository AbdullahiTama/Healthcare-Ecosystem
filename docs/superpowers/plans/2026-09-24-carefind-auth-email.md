# CareFind Auth Email Implementation Plan

> **For agentic workers:** REQUIRED SUB SKILL: Use `subagent-driven-development` or `executing-plans` to implement this plan task by task.

**Goal:** Give CareFind one trusted Auth mail path for verification and welcome, password recovery, email changes, and security notices.

**Architecture:** A protected membership table is the normal app identity source. A narrow public signup bridge creates a short lived intent before normal Supabase Auth signup. The shared signed Auth hook resolves the membership, creates a temporary protected payload, and enqueues through the Auth only database function. The minute worker sends the message.

**Tech Stack:** Supabase Auth, Supabase Postgres, Deno Edge Functions, Standard Webhooks, Supabase Auth email confirmation, React 18, Vitest.

**Spec:** `docs/specs/_root/0001-reliable-email-system/0002-carefind-auth-email.md`

## Global Constraints

1. Do not commit unless the engineer explicitly asks.
2. The public signup bridge must not receive a service role key.
3. User metadata, local storage, and an arbitrary redirect cannot establish app ownership.
4. The shared hook verifies the raw Standard Webhooks signature before parsing.
5. Raw token and token hash values never enter a database field, event key, log, response, or client bundle. A time limited signed action link may exist only in the protected outbox payload.
6. Auth event keys use an HMAC derived from `AUTH_EVENT_KEY_SECRET`.
7. CareFind uses `https://carefind.app`, the CareFind wordmark, and the CareFind sender identity.
8. Supabase Auth email confirmation stays enabled until the hook and `/verify-email` path pass real inbox checks.
9. Run SQL tests, Deno tests, CareFind tests and build, database checks, Supabase advisors, and real inbox checks before completion.

---

### Task 1: Add Membership And Signup Intent Tables

**Files:**

* Create: `supabase/migrations/20260924_carefind_auth_identity.sql`
* Create: `supabase/tests/carefind_auth_identity.sql`

**Interfaces:**

* Consumes: `auth.users`, `businesses`, `staff`, approved claim records, and the existing profile tables
* Produces: `account_app_memberships` and `account_signup_intents`

* [ ] **Step 1: Write failing schema and RLS checks**

Assert both tables exist with the fields and constraints in the child spec. Assert RLS is enabled and anon or authenticated have no direct policies. Assert membership has primary key user id plus app and signup intent has email, fingerprint, state, expiry, and indexes.

* [ ] **Step 2: Run the check and confirm failure**

Run: `supabase test db supabase/tests/carefind_auth_identity.sql`

Expected: missing tables.

* [ ] **Step 3: Create the tables and fixed path functions**

Create `account_app_memberships` with `user_id` referencing `auth.users` on delete cascade, app and state checks, source check, timestamps, and unique user id plus app. Create `account_signup_intents` with normalized email, hashed request fingerprint, fixed CareFind app, state, redirect, expiry, timestamps, and the three indexes from the spec. Use fixed search path on every function.

* [ ] **Step 4: Add protected membership writes**

Create service role functions for membership insert, state change, and CareFind intent consumption. Do not grant direct table writes to anon or authenticated.

* [ ] **Step 5: Apply and verify**

Run the migration and SQL checks. Query `pg_policies`, `pg_indexes`, and `information_schema` to prove the private boundary.

---

### Task 2: Add Reviewed Backfill And Auth App Resolution

**Files:**

* Modify: `supabase/migrations/20260924_carefind_auth_identity.sql`
* Create: `supabase/tests/carefind_auth_backfill.sql`

**Interfaces:**

* Consumes: exact trusted ownership records and an operator reviewed CareFind user id list
* Produces: `backfill_account_app_memberships(user_ids uuid[])`, `resolve_auth_app`, and a dry run ambiguity report

* [ ] **Step 1: Write failing backfill tests**

Cover exact CareHub owner membership, exact staff membership, exact approved claim membership, an explicitly listed CareFind user, a user with no trusted source, and a user listed in both products. Prove no profile absence heuristic creates membership.

* [ ] **Step 2: Run tests and confirm failure**

Run: `supabase test db supabase/tests/carefind_auth_backfill.sql`

Expected: missing backfill and resolution functions.

* [ ] **Step 3: Implement the backfill**

The function accepts an explicit CareFind user id list. It inserts only exact matches from businesses, staff ownership, approved claims, and the supplied list. It records source and writes a dry run report for ambiguous users. It is safe to run again.

* [ ] **Step 4: Implement app resolution**

`resolve_auth_app` returns an active membership when one exists. For signup it may consume only an unexpired CareFind intent. For recovery it may use the requested origin only when that app is already a membership. It fails visibly for ambiguity.

* [ ] **Step 5: Apply and verify**

Run the SQL tests and inspect the report. No ambiguous user may receive a guessed membership.

---

### Task 3: Build Auth Mapping, HMAC Keys, And CareFind Templates

**Files:**

* Create: `supabase/functions/send-email/authPayload.ts`
* Create: `supabase/functions/send-email/authPayload.test.ts`
* Create: `supabase/functions/send-email/templates.ts`
* Create: `supabase/functions/send-email/templates.test.ts`
* Create: `supabase/functions/send-email/eventKey.ts`
* Create: `supabase/functions/send-email/eventKey.test.ts`

**Interfaces:**

* Consumes: signed Supabase Auth payload, `email_data`, `AUTH_EVENT_KEY_SECRET`, and catalog rows
* Produces: `parseAuthPayload`, `resolveAuthAction`, `buildAuthEventKey`, `carefind_auth_verification_welcome`, `carefind_password_reset`, `carefind_security_notice`, and `carefind_email_change`

* [ ] **Step 1: Write failing payload tests**

Test that `email_data` is required and the legacy `email` field is rejected. Test every supported action, secure email change token mapping, missing token behavior, and safe error messages.

* [ ] **Step 2: Write failing event key tests**

Test a token action uses an HMAC over app, action, user id, `updated_at`, and token hash. Test a tokenless action uses app, action, user id, and `updated_at`. Assert the raw secret and token never appear in the key.

* [ ] **Step 3: Write failing template tests**

Test CareFind sender, subject prefix, canonical links, 240 pixel wordmark, 600 pixel layout, plain text, safe payload fields, and rejection of clinical or unknown fields.

* [ ] **Step 4: Run tests and confirm failure**

Run: `deno test supabase/functions/send-email`

Expected: modules do not exist.

* [ ] **Step 5: Implement the modules**

Parse only the supported Auth action set. Use Web Crypto HMAC with `AUTH_EVENT_KEY_SECRET`. Use the official Supabase verify URL for signup and recovery. Use the current email token mapping for secure email change. Keep all rendering pure and escaped.

* [ ] **Step 6: Run tests and confirm pass**

Run: `deno test supabase/functions/send-email`

Expected: all mapping, key, and template tests pass.

---

### Task 4: Build And Deploy The Signed Auth Hook

**Files:**

* Create: `supabase/functions/send-email/index.ts`
* Create: `supabase/functions/send-email/index.test.ts`
* Modify: `supabase/config.toml`
* Modify: `supabase/migrations/20260924_carefind_auth_identity.sql`

**Interfaces:**

* Consumes: signed Auth hook payload, membership resolution, catalog, and Auth enqueue function
* Produces: one CareFind Auth mail outbox row per Auth action

* [ ] **Step 1: Write failing hook tests**

Test invalid signature, missing secret, legacy payload field, unknown action, missing membership, signup intent consumption, recovery origin validation, tokenless security notice, secure email change, enqueue failure, and exact one row replay.

* [ ] **Step 2: Run tests and confirm failure**

Run: `deno test supabase/functions/send-email`

Expected: handler does not exist.

* [ ] **Step 3: Implement raw signature verification**

Read the raw request once. Verify the Standard Webhooks signature before JSON parsing. Reject all unverified input. Do not log raw body, token, token hash, password, or full email.

* [ ] **Step 4: Implement membership and catalog resolution**

Resolve the app through `resolve_auth_app`. For first signup, consume the pending intent and create the CareFind membership. For later actions, use the existing membership. Load the catalog event and validate the closed payload.

* [ ] **Step 5: Implement Auth enqueue proof**

Create a short HMAC proof from `AUTH_EVENT_KEY_SECRET` over the event key and action. Pass it to `enqueue_auth_email_event`. The database verifies the proof against its protected Vault copy. A generic Node adapter cannot call this path.

* [ ] **Step 6: Configure and test**

Add `[functions.send-email]` with `verify_jwt = false`. Deploy only after the Supabase Auth hook secret and catalog are present. Run Deno tests and a signed local fixture.

---

### Task 5: Build The Protected CareFind Signup Bridge

**Files:**

* Create: `supabase/functions/carefind-signup/index.ts`
* Create: `supabase/functions/carefind-signup/index.test.ts`
* Modify: `supabase/config.toml`
* Modify: `supabase/migrations/20260924_carefind_auth_identity.sql`

**Interfaces:**

* Consumes: public signup input, publishable Supabase key, narrow intent RPC, and normal Supabase Auth signup
* Produces: generic CareFind signup response and a pending intent consumed by the Auth hook

* [ ] **Step 1: Write failing bridge tests**

Test valid input, invalid email, short password, invalid callback, email rate limit, fingerprint rate limit, duplicate account response, Supabase error, and proof that no service role key is read.

* [ ] **Step 2: Run tests and confirm failure**

Run: `deno test supabase/functions/carefind-signup`

Expected: bridge does not exist.

* [ ] **Step 3: Implement the narrow intent call**

Normalize the email, validate `https://carefind.app/verify-email`, hash trusted request context, and call only `create_carefind_signup_intent`. The function has a fixed public grant and no table privileges.

* [ ] **Step 4: Implement normal Auth signup**

Call `supabase.auth.signUp` with the publishable key and exact callback. Return the normal generic Auth result. Do not call Admin create user and do not call private membership or outbox tables.

* [ ] **Step 5: Configure and test**

Add `[functions.carefind-signup]` with `verify_jwt = false`. Run tests and verify the deployed function environment has no service role key.

---

### Task 6: Move The CareFind Client And Remove The Old Auth Path

**Files:**

* Modify: `apps/carefind/src/providers/AuthContext.jsx`
* Modify: `apps/carefind/src/providers/__tests__/AuthContext.test.jsx`
* Modify: `apps/carefind/src/modules/account/ForgotPassword.jsx` or the existing recovery module
* Modify: `apps/carefind/src/modules/account/__tests__/forgotReset.test.jsx`
* Modify: `apps/carefind/src/main.jsx` only if the canonical callback route changes
* Delete: `apps/carefind/api/_handlers/auth-email.js`
* Modify: `apps/carefind/api/router.js`
* Delete: `packages/shared-email/src/authEmail.js`
* Modify: `packages/shared-email/src/index.js`

**Interfaces:**

* Consumes: `carefind-signup` and normal Supabase Auth recovery
* Produces: one client Auth flow with no custom Auth mail requests

* [ ] **Step 1: Write failing client tests**

Assert signup calls `carefind-signup`, recovery calls `resetPasswordForEmail`, no client request uses `/api/auth-email`, and success and error states remain generic and accessible.

* [ ] **Step 2: Run tests and confirm failure**

Run from `apps/carefind`: `npm test -- src/providers/__tests__/AuthContext.test.jsx src/modules/account/__tests__/forgotReset.test.jsx`

Expected: tests still describe custom Auth mail requests or fail on the new contract.

* [ ] **Step 3: Update the client**

Use the exact `https://carefind.app/verify-email` and `https://carefind.app/reset-password` callbacks. Keep the existing verification landing page and reset page behavior. Keep loading, error, success, responsive, and accessible states.

* [ ] **Step 4: Remove old routes and exports**

Remove the CareFind Auth mail route, handler, old package export, and custom fetches. Make the old route return `410` during the controlled cutover, then remove the registration after callers are clean.

* [ ] **Step 5: Run client tests and build**

Run: `npm test` and `npm run build` from `apps/carefind`.

Expected: all tests pass, the build is clean, and no `/api/auth-email` reference remains.

---

### Task 7: Verify Live Auth And Real Inboxes

**Files:**

* Create: `docs/operations/CAREFIND_AUTH_EMAIL.md`
* Modify: `docs/scope/_root/0001-reliable-email-system.md` only after verified milestones

**Interfaces:**

* Consumes: all Auth child tasks
* Produces: enabled Auth hook, reviewed membership backfill, and real inbox evidence

* [ ] **Step 1: Verify the live database and grants**

Check membership and intent tables, fixed search paths, grants, RLS, Vault secret names, and catalog rows. Prove the public bridge has no service role privilege.

* [ ] **Step 2: Run Auth hook fixtures**

Use signed fixtures for signup, recovery, security notices, secure email change, duplicate calls, invalid signatures, and ambiguous ownership.

* [ ] **Step 3: Run controlled Auth actions**

Create a new CareFind test account, verify one membership and one outbox row, then test recovery and a tokenless security notice. Inspect only masked metadata.

* [ ] **Step 4: Run real inbox checks**

Open the messages in Gmail and Outlook on web and mobile. Check logo, sender, subject, link, plain text, and callback destination.

* [ ] **Step 5: Run Supabase advisors and document recovery**

Record security and performance findings with links. Document hook disable, dispatch pause, intent cleanup, and how to resolve ambiguous memberships.
