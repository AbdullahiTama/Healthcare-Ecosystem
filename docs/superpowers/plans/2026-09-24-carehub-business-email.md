# CareHub Business Email Implementation Plan

> **For agentic workers:** REQUIRED SUB SKILL: Use `subagent-driven-development` or `executing-plans` to implement this plan task by task.

**Goal:** Make CareHub registration and business review messages atomic with the business change and correctly branded.

**Architecture:** Postgres functions own registration and status review. The existing project owned `mint_confirmed_auth_user` primitive remains the only Auth user write path. The foundation catalog and closed payload schemas supply the CareHub events. The client calls one function and never sends a second notification request.

**Tech Stack:** PostgreSQL 17, Supabase Auth, Supabase Postgres RPC, shared catalog, Deno templates, React 18, Vitest.

**Spec:** `docs/specs/_root/0001-reliable-email-system/0003-carehub-business-email.md`

## Global Constraints

1. Do not commit unless the engineer explicitly asks.
2. A required registration or review enqueue failure rolls back the business action.
3. Keep passwords out of every result, payload, log, and message.
4. Use the existing `mint_confirmed_auth_user` primitive. Do not add a new direct `auth.users` insert.
5. The admin recipient is `admin@carefindhub.com` from the protected database setting. The browser cannot supply it.
6. Free text review reasons remain internal. External messages use only fixed reason codes and generic copy.
7. The live business status constraint must include `rejected` before the function is enabled.
8. Run database tests, CareHub tests and build, Supabase advisors, and real inbox checks before completion.

---

### Task 1: Add Registration Attempts And Status Transitions

**Files:**

* Create: `supabase/migrations/20260924_carehub_business_email_core.sql`
* Create: `supabase/tests/carehub_business_email_core.sql`
* Modify: `supabase/migrations/20260924_reliable_email_core.sql` only through a new ordered migration if catalog seeding needs a later change

**Interfaces:**

* Consumes: `businesses`, `auth.users`, `email_system_settings`, and the existing audit table
* Produces: `business_registration_attempts`, `business_status_transitions`, and fixed protected setting seed

* [ ] **Step 1: Write failing schema tests**

Assert registration attempt primary key, safe result shape, transition request id uniqueness, event key uniqueness, nullable deleted actor, allowed statuses, and RLS with no public policies.

* [ ] **Step 2: Run tests and confirm failure**

Run: `supabase test db supabase/tests/carehub_business_email_core.sql`

Expected: missing tables and constraints.

* [ ] **Step 3: Create the tables**

Create `business_registration_attempts` with registration id primary key, business id restrict, safe result JSON, and created time. Create `business_status_transitions` with transition id, request id unique, business id, previous and new status, internal reason, nullable changed by with delete set null, unique event key, and created time. Add indexes for business, status, and created time.

* [ ] **Step 4: Seed the protected setting**

Insert `carehub_admin_email` as `admin@carefindhub.com`. Reject a missing or invalid value during registration. Keep the setting writable only through the platform operations function.

* [ ] **Step 5: Apply and verify**

Run the migration and SQL tests. Inspect constraints, foreign keys, RLS, and grants.

---

### Task 2: Seed CareHub Events And Build Closed Templates

**Files:**

* Create: `supabase/migrations/20260924_carehub_business_catalog.sql`
* Create: `supabase/functions/_shared/email/carehubBusinessTemplates.ts`
* Create: `supabase/functions/_shared/email/carehubBusinessTemplates.test.ts`
* Modify: `supabase/functions/_shared/email/templates.ts` to register the approved template keys
* Modify: `supabase/functions/_shared/email/catalog.ts` only if its registry needs the new keys

**Interfaces:**

* Consumes: foundation catalog and brand modules
* Produces: `registration_owner`, `admin_new_registration`, `business_approved`, `business_rejected`, `business_suspended`, `business_reactivated`, and `business_revoked`

* [ ] **Step 1: Write failing catalog and template tests**

Test all seven events have allowed app, template key, fixed sender, reply address, subject prefix, closed payload schema, and safe length limits. Test the rendered message has no password, free text reason, patient identifier, or clinical detail.

* [ ] **Step 2: Run tests and confirm failure**

Run: `deno test supabase/functions/_shared/email/carehubBusinessTemplates.test.ts`

Expected: templates and catalog rows do not exist.

* [ ] **Step 3: Seed the catalog**

Use these exact event keys and template keys:

```text
registration_owner -> carehub_registration_owner
admin_new_registration -> carehub_admin_registration
business_approved -> carehub_business_approved
business_rejected -> carehub_business_rejected
business_suspended -> carehub_business_suspended
business_reactivated -> carehub_business_reactivated
business_revoked -> carehub_business_revoked
```

Set all seven enabled and required only after function and template tests pass. Their payload schemas reject unknown fields and free text reason content.

* [ ] **Step 4: Implement the templates**

Use `CareHub <support@carefindhub.com>`, `https://carefindhub.com/logo-wordmark.png`, proportional 240 pixel width, 600 pixel layout, inline styles, hidden preview, plain text, and exact CareHub link validation. Approval and reactivation use different copy. Rejection uses a fixed reason code or generic copy.

* [ ] **Step 5: Apply and test**

Run the catalog migration, Deno tests, and a template render probe. Expected: all seven events pass branding and privacy checks.

---

### Task 3: Implement Atomic Business Registration

**Files:**

* Create: `supabase/migrations/20260924_register_business_atomic.sql`
* Create: `supabase/tests/register_business_atomic.sql`
* Modify: `apps/carehub/src/services/supabase.js`
* Modify: `apps/carehub/src/pages/auth/Register.jsx`
* Modify: `apps/carehub/src/pages/auth/__tests__/Register.test.jsx` or the existing registration test file

**Interfaces:**

* Consumes: existing `register_business` protections and `mint_confirmed_auth_user`
* Produces: `register_business_atomic(registration_id, business, password)` and a client safe result

* [ ] **Step 1: Write failing database behavior tests**

Cover valid registration, replay by registration id, duplicate email rejection, unsafe field rejection, short password rejection, missing admin setting rollback, owner enqueue failure rollback, Auth identity failure rollback, and no residue after every failure.

* [ ] **Step 2: Run tests and confirm failure**

Run: `supabase test db supabase/tests/register_business_atomic.sql`

Expected: missing function.

* [ ] **Step 3: Implement the function**

Use the existing safe business field allowlist and protected status values. Call `mint_confirmed_auth_user` as the only Auth user write. Insert membership, business, owner event, admin event, and attempt row in one transaction. Read the admin address from the protected setting. Use event keys `carehub-registration:<registration_id>:owner` and `carehub-registration:<registration_id>:admin`.

* [ ] **Step 4: Add client idempotency**

Generate one registration id before the request and retain it across retries. Call the new RPC. Treat a replayed result as success. Remove the separate notification request.

* [ ] **Step 5: Update the success and error states**

Say the request is recorded and a review message is queued. Never say the inbox received mail. Keep loading, error, responsive, and accessible states.

* [ ] **Step 6: Apply and verify**

Run the SQL tests, CareHub tests, and a rolled back live probe. Confirm a valid registration has one business, one Auth identity, one membership, two outbox rows, and one attempt row. A failed enqueue leaves none of them.

---

### Task 4: Implement Atomic Business Status Review

**Files:**

* Create: `supabase/migrations/20260924_review_business_status_atomic.sql`
* Create: `supabase/tests/review_business_status_atomic.sql`
* Modify: `apps/carehub/src/services/supabase.js`
* Modify: `apps/carehub/src/pages/admin/AdminDashboard.jsx`
* Create or modify: `apps/carehub/src/pages/admin/__tests__/AdminDashboard.email.test.jsx`

**Interfaces:**

* Consumes: platform administrator session, locked business row, fixed status allowlist, and protected setting
* Produces: `review_business_status(request_id, business_id, to_status, reason)` and a safe transition result

* [ ] **Step 1: Write failing permission and state tests**

Cover ordinary owner denial, platform admin success, unknown status, no change rejection, pending to active approval, suspended to active reactivation, rejected, suspended, revoked, repeated request id replay, new request id no change rejection, and enqueue rollback.

* [ ] **Step 2: Run tests and confirm failure**

Run: `supabase test db supabase/tests/review_business_status_atomic.sql`

Expected: missing function.

* [ ] **Step 3: Implement the function**

Require `auth.uid()` and `is_platform_admin()`. Lock the business row, read previous status, write the status, insert the transition, write the existing audit record, and enqueue the owner event in one transaction. Use request id for replay. Derive the event from the transition id and previous status.

* [ ] **Step 4: Keep internal reasons internal**

Store free text reason in the protected transition table. Do not copy it to the outbox. Select only a fixed approved reason code for external copy, or use generic copy when no safe code exists.

* [ ] **Step 5: Update the admin client**

Create one request id per review action and retain it for retries. Replace the direct status patch and separate notification request with the RPC. Do not send a second request after success.

* [ ] **Step 6: Apply and verify**

Run SQL tests, CareHub tests, and live permission probes. Confirm approval and reactivation produce different events and repeated request ids do not duplicate mail.

---

### Task 5: Remove Old Business Notification Paths

**Files:**

* Delete: `apps/carehub/api/_handlers/notify-registration.js`
* Delete: `apps/carehub/api/_handlers/notify-business-status.js`
* Modify: `apps/carehub/api/router.js`
* Modify: `apps/carehub/src/lib/email.js` only to remove dead notification callers after search
* Modify: `apps/carehub/src/lib/emailService.js` only if the new business adapter import requires a server boundary change

**Interfaces:**

* Consumes: atomic client calls from Tasks 3 and 4
* Produces: one registration path and one review path

* [ ] **Step 1: Search all callers**

Search for `notify-registration`, `notify-business-status`, `updateBusiness`, `emailBusinessStatus`, and the old email service methods. Record every result before deleting code.

* [ ] **Step 2: Make the old routes return 410**

Keep temporary `410 Gone` responses during the controlled window. Do not leave a second notification request active.

* [ ] **Step 3: Delete dead code**

Remove the handlers, duplicate template builders, and imports only after the caller search is empty. Do not remove unrelated CareHub email call sites that belong to later catalog events.

* [ ] **Step 4: Run tests and build**

Run CareHub tests and build. Expected: no import errors and no old route references.

---

### Task 6: Verify CareHub Business Mail

**Files:**

* Create: `docs/operations/CAREHUB_BUSINESS_EMAIL.md`
* Modify: `docs/scope/_root/0001-reliable-email-system.md` only after verified milestones

**Interfaces:**

* Consumes: all CareHub business tasks
* Produces: verified live functions, catalog, templates, permissions, and inbox evidence

* [ ] **Step 1: Verify live schema and functions**

Check live status constraint, attempt and transition tables, catalog rows, setting, function grants, search paths, and audit writes.

* [ ] **Step 2: Run rollback and permission probes**

Use rolled back probes for missing setting, enqueue failure, ordinary owner, platform admin, replay, and no change. Confirm no residue.

* [ ] **Step 3: Run real inbox checks**

Register a test business, review it through each supported status, and open messages in Gmail and Outlook on web and mobile. Check logo, sender, safe copy, links, plain text, and absence of passwords and clinical details.

* [ ] **Step 4: Run Supabase advisors and document recovery**

Record findings with remediation links. Document registration retry, status request id, dead job behavior, dispatch pause, and the protected admin setting.
