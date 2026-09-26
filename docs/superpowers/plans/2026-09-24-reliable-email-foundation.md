# Reliable Email Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB SKILL: Use `subagent-driven-development` or `executing-plans` to implement this plan task by task.

**Goal:** Build the shared Supabase outbox, database catalog, private minute worker, Resend event receiver, protected operations API, and compatibility adapter for CareHub and CareFind.

**Architecture:** Supabase Postgres owns event definitions, atomic enqueue, leases, provider state, health, settings, and retention. Private Deno Edge Functions own Auth mail, sending, Resend events, and platform operations. Vercel remains a business producer and uses a thin Node enqueue adapter with no direct provider call.

**Tech Stack:** PostgreSQL 17, Supabase Auth, Supabase Cron, `pg_net`, Supabase Vault, Deno Edge Functions, Resend, Vitest, Vite, React 18.

**Spec:** `docs/specs/_root/0001-reliable-email-system/index.md` and `docs/specs/_root/0001-reliable-email-system/0001-delivery-foundation.md`

## Global Constraints

1. Do not commit unless the engineer explicitly asks.
2. Never expose `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, `SEND_EMAIL_HOOK_SECRET`, `AUTH_EVENT_KEY_SECRET`, `RESEND_WEBHOOK_SECRET`, or worker secrets.
3. Apply every migration and verify the live schema before marking its task complete.
4. Keep all email tables service role only with RLS enabled and no anon or authenticated policies.
5. Use the database catalog as the only runtime source for sender, reply address, and subject.
6. Reject unknown payload fields, oversized values, and clinical field names.
7. Keep required events enabled during rollback. Pause provider dispatch through `email_system_settings.dispatch_paused`.
8. Do not send clinical details, patient identifiers, free text review reasons, raw tokens, full recipient addresses in logs, or open tracking data.
9. Run the shared package tests, both app test suites, both builds, database checks, Supabase advisors, and dead code searches before completion.

---

### Task 1: Expand And Map The Existing Outbox

**Files:**

* Create: `supabase/migrations/20260924_reliable_email_expand.sql`
* Create: `supabase/tests/reliable_email_expand.sql`

**Interfaces:**

* Consumes: existing `public.email_outbox` and `public.email_logs` from `20260919094900_email_outbox_logsformalize.sql`
* Produces: nullable catalog, lease, state time, reply, and quarantine columns plus a repeatable mapping report

* [ ] **Step 1: Write the failing database check**

Create `supabase/tests/reliable_email_expand.sql` with assertions that `email_outbox` has `app`, `event_key`, `reply_to`, claim fields, accepted and terminal state times, `quarantine_reason`, and `payload_schema_snapshot`, while `email_logs.outbox_id` uses `ON DELETE SET NULL`.

* [ ] **Step 2: Run the check and confirm failure**

Run: `supabase test db supabase/tests/reliable_email_expand.sql`

Expected: failure because the new columns and delete rule do not exist.

* [ ] **Step 3: Create the expand migration**

The migration must add nullable columns first, preserve all existing rows, add indexes for `status, next_retry_at`, `claim_expires_at`, and non null `provider_id`, and create this state for unclear rows:

```sql
alter table public.email_outbox
  add column if not exists app text,
  add column if not exists event_key text,
  add column if not exists reply_to text,
  add column if not exists claim_token uuid,
  add column if not exists claimed_at timestamptz,
  add column if not exists claim_expires_at timestamptz,
  add column if not exists accepted_at timestamptz,
  add column if not exists delivered_at timestamptz,
  add column if not exists bounced_at timestamptz,
  add column if not exists complained_at timestamptz,
  add column if not exists failed_at timestamptz,
  add column if not exists dead_at timestamptz,
  add column if not exists quarantine_reason text,
  add column if not exists payload_schema_snapshot jsonb;
```

The mapping logic must update `sent_at` into `accepted_at`, classify rows with no proven app or event as `quarantined`, and never infer an app from sender text.

* [ ] **Step 4: Apply and verify the migration**

Run: `supabase migration up`

Then query `information_schema.columns`, `pg_indexes`, and `pg_constraint` for the new fields and delete rule.

Expected: every assertion from the failing check now passes and existing row count is unchanged except for state mapping.

---

### Task 2: Create Catalog, Provider Events, Settings, And Worker Runs

**Files:**

* Create: `supabase/migrations/20260924_reliable_email_core.sql`
* Create: `supabase/tests/reliable_email_core.sql`
* Modify: `supabase/migrations/20260924_reliable_email_expand.sql` only if a verified live constraint requires a staged correction

**Interfaces:**

* Consumes: expanded outbox columns from Task 1
* Produces: `email_event_catalog`, `email_provider_events`, `email_worker_runs`, settings storage, safe logs, and a complete disabled catalog seed

* [ ] **Step 1: Write failing catalog and privacy checks**

Test that every table has RLS enabled, no public policies, the required indexes, and a closed catalog payload schema. Test that seeded later events are `enabled = false` and `required_for_business = false`.

* [ ] **Step 2: Run the checks and confirm failure**

Run: `supabase test db supabase/tests/reliable_email_core.sql`

Expected: missing tables and policies.

* [ ] **Step 3: Create the core tables**

Use the exact fields in the child spec. `email_event_catalog` must have a unique key on app plus event key. `email_provider_events` must have unique `provider_event_id`. `email_outbox.provider_id` must receive a partial unique index. All `SECURITY DEFINER` functions must set `search_path = public, extensions, pg_temp`.

* [ ] **Step 4: Seed the catalog**

Seed these keys with their approved app, template, sender, subject, and closed payload schema:

```text
carehub: registration_owner, admin_new_registration, business_approved,
business_rejected, business_suspended, business_reactivated, business_revoked,
appointment_confirmed, subscription_created, subscription_expiry,
purchase_confirmed, order_status_update, password_reset, email_verification,
staff_welcome

carefind: customer_registration, order_confirmation, booking_confirmed,
order_status_update, appointment_confirmed, subscription_created,
subscription_expiry, purchase_confirmed, password_reset, email_verification
```

Enable none of the Auth or business events in the foundation child. Later producers can call disabled non required events and receive null without failing their business action.

* [ ] **Step 5: Seed safe settings**

Insert `carehub_admin_email = admin@carefindhub.com` and `dispatch_paused = false`. Reject all other setting keys in the operations function.

* [ ] **Step 6: Apply and verify**

Run: `supabase migration up` and `supabase test db supabase/tests/reliable_email_core.sql`

Expected: tables, RLS, indexes, catalog rows, and settings exist with no public policy.

---

### Task 3: Implement Closed Business Enqueue

**Files:**

* Create: `supabase/migrations/20260924_reliable_email_enqueue.sql`
* Create: `supabase/tests/reliable_email_enqueue.sql`
* Modify: `supabase/migrations/carefind_20260919_shop_orders_status_email_trigger.sql` or add a replacement migration without editing applied history

**Interfaces:**

* Consumes: catalog from Task 2
* Produces: `enqueue_business_email_event(app, event_key, to_email, payload, source_id)` for Vercel producers

* [ ] **Step 1: Write failing behavior tests**

Cover enabled event insertion, disabled non required null return, disabled required error, unknown event error, Auth event rejection, unknown payload field rejection, length limit rejection, clinical key rejection, and event key replay.

* [ ] **Step 2: Run tests and confirm failure**

Run: `supabase test db supabase/tests/reliable_email_enqueue.sql`

Expected: missing function.

* [ ] **Step 3: Implement the function**

The function must validate recipient format, load the enabled catalog row, validate the closed payload, snapshot catalog values, insert the outbox row, and append one `enqueued` log. It must use `ON CONFLICT (app, event_key) DO NOTHING` and return the existing id for a safe replay.

* [ ] **Step 4: Update the order status trigger**

Create a new migration that changes `enqueue_shop_order_status_email` to call `enqueue_business_email_event` with app `carefind`, event `order_status_update`, a closed payload, and a deterministic source key based on order id, status history id, and status. Keep the existing status allowlist.

* [ ] **Step 5: Apply and verify**

Run the SQL tests and a rolled back probe that changes one `shop_orders` row. Expected: business change and disabled outbox behavior are correct with no residue.

---

### Task 4: Implement Claims, Lease Recovery, Pause, And Completion

**Files:**

* Create: `supabase/migrations/20260924_reliable_email_claims.sql`
* Create: `supabase/tests/reliable_email_claims.sql`

**Interfaces:**

* Consumes: outbox and settings from Tasks 1 and 2
* Produces: `check_email_worker_config`, `claim_email_batch`, `complete_email_accepted`, and `complete_email_failure`

* [ ] **Step 1: Write failing concurrency tests**

Use two rolled back sessions to prove that two claim calls return disjoint rows. Prove an expired processing claim returns to pending without increasing attempts. Prove dispatch pause returns zero rows.

* [ ] **Step 2: Run tests and confirm failure**

Run: `supabase test db supabase/tests/reliable_email_claims.sql`

Expected: missing functions.

* [ ] **Step 3: Implement configuration preflight**

`check_email_worker_config()` must return safe booleans for catalog presence, Resend configuration presence in the Edge environment, dispatch pause, and critical setting validity. Database configuration checks must not read Edge secrets.

* [ ] **Step 4: Implement atomic claim**

`claim_email_batch` must first return expired processing claims to pending, then select due pending or failed rows with `FOR UPDATE SKIP LOCKED`, set one claim token and five minute lease, and return only claimed rows.

* [ ] **Step 5: Implement completion functions**

Accepted requires a matching claim token and provider id. Failure increments attempts only for row or provider errors, uses delays of one, five, fifteen, and sixty minutes, and sets dead at five attempts. Global configuration errors do not increment attempts.

* [ ] **Step 6: Apply and verify**

Run the SQL tests and inspect claim tokens, lease times, attempt counts, and rollback residue.

---

### Task 5: Implement Provider Events, Operations, Replay, And Retention

**Files:**

* Create: `supabase/migrations/20260924_reliable_email_operations.sql`
* Create: `supabase/tests/reliable_email_operations.sql`

**Interfaces:**

* Consumes: outbox, provider events, settings, logs, and worker runs
* Produces: provider event storage, reconciliation, masked admin reads, replay, health, and retention functions

* [ ] **Step 1: Write failing tests**

Cover duplicate provider events, provider event before id link, delayed event, failed event, bounce and complaint ordering, masked outbox reads, non admin denial, Auth replay denial, dead business replay, and retention boundaries.

* [ ] **Step 2: Run tests and confirm failure**

Run: `supabase test db supabase/tests/reliable_email_operations.sql`

Expected: missing functions.

* [ ] **Step 3: Implement provider event storage**

`record_email_provider_event` stores first and returns the existing row for a duplicate id. It links by `provider_message_id` when possible and otherwise leaves `applied_at` null. `reconcile_email_provider_events` applies only safe unprocessed rows.

* [ ] **Step 4: Implement the state matrix**

Use the exact matrix from the child spec. Unknown provider events are evidence only. `email.opened` never changes state.

* [ ] **Step 5: Implement platform authorization and masking**

Every operations function must call the existing `is_platform_admin()` predicate. Outbox lists return a masked address, status, safe event key prefix, state times, and safe error summary. They never return payload, links, or a full address.

* [ ] **Step 6: Implement replay and retention**

Reject Auth template replay. Record an admin audit entry before returning a dead business row to pending. Clear Auth payload after twenty four hours, remove terminal rows after thirty days, safe logs after ninety days, and worker runs after thirty days.

* [ ] **Step 7: Apply and verify**

Run the SQL tests and inspect grants with `has_function_privilege` for anon, authenticated, and service role.

---

### Task 6: Build Shared Deno Email Modules

**Files:**

* Create: `supabase/functions/_shared/email/brands.ts`
* Create: `supabase/functions/_shared/email/catalog.ts`
* Create: `supabase/functions/_shared/email/templates.ts`
* Create: `supabase/functions/_shared/email/provider.ts`
* Create: `supabase/functions/_shared/email/safeLog.ts`
* Create: `supabase/functions/_shared/email/brands.test.ts`
* Create: `supabase/functions/_shared/email/catalog.test.ts`
* Create: `supabase/functions/_shared/email/templates.test.ts`
* Create: `supabase/functions/_shared/email/provider.test.ts`

**Interfaces:**

* Consumes: catalog rows from Task 2
* Produces: `getBrand(app)`, `validateCatalogEvent`, `renderTemplate`, `sendWithResend`, and `safeEmailLog`

* [ ] **Step 1: Write failing Deno tests**

Test exact CareHub and CareFind domains, sender policy, catalog source of subject, 240 pixel proportional wordmark, 600 pixel layout, plain text, unknown field rejection, clinical field rejection, Resend `Idempotency-Key`, and masked logs.

* [ ] **Step 2: Run tests and confirm failure**

Run: `deno test supabase/functions/_shared/email`

Expected: modules do not exist.

* [ ] **Step 3: Implement brands and catalog validation**

The brand module contains names, allowed origins, and wordmark URLs only. Catalog validation verifies sender, reply, subject, template, closed schema, and app origin.

* [ ] **Step 4: Implement template and provider modules**

Templates return HTML and plain text. The provider function accepts the catalog subject, sender, and reply values, passes the event key as `idempotencyKey`, and returns the provider message id string.

* [ ] **Step 5: Run tests and confirm pass**

Run: `deno test supabase/functions/_shared/email`

Expected: all shared module tests pass.

---

### Task 7: Build And Schedule The Minute Worker

**Files:**

* Create: `supabase/functions/minute-email-worker/index.ts`
* Create: `supabase/functions/minute-email-worker/index.test.ts`
* Modify: `supabase/config.toml`
* Create: `supabase/migrations/20260924_reliable_email_schedule.sql`

**Interfaces:**

* Consumes: Tasks 4 through 6
* Produces: private `minute-email-worker` and one minute Supabase Cron schedule

* [ ] **Step 1: Write failing worker tests**

Test non POST rejection, invalid named secret, configuration preflight before claim, dispatch pause, batch size twenty, concurrency five, accepted provider id storage, safe failure count, and worker run recording.

* [ ] **Step 2: Run tests and confirm failure**

Run: `deno test supabase/functions/minute-email-worker`

Expected: function does not exist.

* [ ] **Step 3: Implement the worker**

Use the Supabase named secret wrapper or an exact equivalent that validates `secret:email_worker`. Call config preflight, claim rows, render from catalog, send with Resend, complete each row, reconcile provider events, and write one safe worker run.

* [ ] **Step 4: Configure the function**

Add `[functions.minute-email-worker]` with `verify_jwt = false`. The named key is the only authority.

* [ ] **Step 5: Add the schedule**

Enable and verify `pg_cron` and `pg_net`. Store project URL and named worker key in Vault. Schedule `invoke-email-minute-worker` with `* * * * *`, a five second timeout, and safe headers. Do not depend on Vercel cron.

* [ ] **Step 6: Test locally and apply the schedule migration**

Run the Deno tests, `supabase functions serve minute-email-worker --no-verify-jwt`, and `supabase migration up`. Verify `cron.job` and the function health result.

---

### Task 8: Build The Resend Webhook

**Files:**

* Create: `supabase/functions/resend-webhook/index.ts`
* Create: `supabase/functions/resend-webhook/index.test.ts`
* Modify: `supabase/config.toml`

**Interfaces:**

* Consumes: provider event functions from Task 5
* Produces: signed Resend event receiver

* [ ] **Step 1: Write failing signature and state tests**

Use a fixed valid Svix fixture and an invalid fixture. Test raw body preservation, `401` on invalid signature, duplicate event id, event before provider id, delayed, delivered, failed, bounced, complained, opened, and unknown events.

* [ ] **Step 2: Run tests and confirm failure**

Run: `deno test supabase/functions/resend-webhook`

Expected: function does not exist.

* [ ] **Step 3: Implement raw body verification**

Read `await request.text()` once. Verify with Svix before parsing. Extract `data.email_id`, event type, and safe metadata only. Never log the raw body.

* [ ] **Step 4: Configure and test the function**

Add `[functions.resend-webhook]` with `verify_jwt = false`. Svix is the authentication method. Run tests and a local signed fixture request.

---

### Task 9: Build The Protected Operations Function

**Files:**

* Create: `supabase/functions/email-operations/index.ts`
* Create: `supabase/functions/email-operations/index.test.ts`
* Modify: `supabase/config.toml`

**Interfaces:**

* Consumes: operations functions from Task 5
* Produces: platform admin health, masked outbox list, replay, and settings API

* [ ] **Step 1: Write failing permission tests**

Test no token, ordinary user, platform admin health, cursor paging, masked address, dead Auth replay denial, dead business replay, allowed setting update, and rejected setting key.

* [ ] **Step 2: Run tests and confirm failure**

Run: `deno test supabase/functions/email-operations`

Expected: function does not exist.

* [ ] **Step 3: Implement the function**

Keep normal Supabase JWT verification. After identity resolution, call the protected database functions for platform admin authorization. Return only safe fields and cursor data.

* [ ] **Step 4: Configure and test**

Keep `verify_jwt = true`. Run Deno tests and verify the function never receives a service role key from a public client.

---

### Task 10: Convert The Node Package And Migrate Producers

**Files:**

* Modify: `packages/shared-email/src/index.js`
* Replace: `packages/shared-email/src/EmailService.js` with `packages/shared-email/src/enqueueBusinessEmailEvent.js`
* Delete after migration: `packages/shared-email/src/sendEmail.js`
* Delete after Auth child: `packages/shared-email/src/authEmail.js`
* Modify: all Vercel files returned by the email caller search
* Test: `packages/shared-email/src/enqueueBusinessEmailEvent.test.js`

**Interfaces:**

* Consumes: `enqueue_business_email_event` from Task 3
* Produces: `enqueueBusinessEmailEvent({ app, eventKey, toEmail, payload, sourceId })`

* [ ] **Step 1: Write the failing adapter test**

Mock Supabase RPC and assert explicit app and event values are passed. Assert Auth event keys are rejected before RPC and no full address is logged.

* [ ] **Step 2: Run the test and confirm failure**

Run from `packages/shared-email`: `npm test -- enqueueBusinessEmailEvent.test.js`

Expected: export does not exist.

* [ ] **Step 3: Implement the adapter**

The adapter creates a server Supabase client from environment variables and calls only `enqueue_business_email_event`. It exports no template, Auth, worker, or direct send function.

* [ ] **Step 4: Migrate every producer**

Use the repository search for `emailService.enqueue`, `enqueueOutbox`, `flushOutbox`, and `sendTemplatedEmail`. Give each call an explicit app and catalog key. Remove every immediate flush. Later events stay disabled and non required.

* [ ] **Step 5: Run shared and app tests**

Run shared package tests, CareHub tests, and CareFind tests. Expected: all pass with no old direct sender reference.

---

### Task 11: Retire Old Vercel Email Paths

**Files:**

* Modify: `apps/carehub/api/router.js`
* Modify: `apps/carefind/api/router.js`
* Modify: `apps/carehub/vercel.json`
* Modify: `apps/carefind/vercel.json`
* Delete after the Auth and business children: old email route handlers and duplicate email libraries
* Modify: both `.env.example` files

**Interfaces:**

* Consumes: completed Supabase cutovers
* Produces: no public Vercel send, cron, webhook, preview, test, outbox, or Auth mail path

* [ ] **Step 1: Add failing route tests**

For paths not yet cut over, assert `410 Gone`. After child cutovers, assert removed routes return the router's safe not found response.

* [ ] **Step 2: Make tests fail**

Run CareHub and CareFind API tests. Expected: old routes still respond.

* [ ] **Step 3: Remove route registrations and cron entries**

Delete email cron and webhook routing after the Supabase endpoints are live. Do not remove unrelated payment and business routes.

* [ ] **Step 4: Remove superseded files**

Search every removed symbol and import path. Delete direct senders, old workers, old generic routes, and duplicate template libraries after callers are gone.

* [ ] **Step 5: Update environment examples**

Remove email sender variables used to choose branding. Document Supabase function secrets, Vault values, canonical domains, Auth redirects, Resend setup, and the operations endpoint.

---

### Task 12: Full Verification And Live Proof

**Files:**

* Create: `docs/operations/EMAIL_DELIVERY.md`
* Modify: `planning/CODE_AUDIT.md` only if a tracked finding is closed or discovered
* Modify: `docs/scope/_root/0001-reliable-email-system.md` only for verified milestone status

**Interfaces:**

* Consumes: all foundation tasks
* Produces: verified live schema, worker, webhook, operations, disabled producers, and operations guide

* [ ] **Step 1: Run all automated checks**

Run shared package tests, CareHub tests and build, CareFind tests and build, Deno tests, and database tests.

* [ ] **Step 2: Verify the live database**

Query tables, columns, constraints, indexes, RLS policies, function grants, catalog rows, settings, Cron job, and Vault key names. Confirm no required event is disabled.

* [ ] **Step 3: Run Supabase advisors**

Run security and performance advisors. Review every new finding and include clickable remediation links in the report.

* [ ] **Step 4: Prove worker behavior**

Create test rows through approved business functions. Confirm claim, Resend acceptance, provider event, reconciliation, lease recovery, pause, and masked operations output. Remove or retain test evidence according to retention policy.

* [ ] **Step 5: Prove security**

Attempt public outbox access, arbitrary send, preview, test send, manual processing, invalid worker secret, invalid Resend signature, and ordinary user operations access. Every attempt must fail safely.

* [ ] **Step 6: Document and report**

Document normal operation, health, dead jobs, safe replay, pause, resume, retention, domain setup, and rollback. Report exact test and build evidence before claiming completion.
