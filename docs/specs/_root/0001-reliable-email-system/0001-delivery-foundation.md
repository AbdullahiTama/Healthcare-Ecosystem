# 0001. Delivery Foundation

## Summary

This child builds the shared delivery engine that every CareHub and CareFind email uses. It creates the protected data model, database catalog, Deno renderer, one minute worker, Resend event receiver, operations API, and compatibility adapter for existing Vercel business handlers. It ends with every producer using the new outbox while later email groups remain disabled.

## Requirements

1. **AC-F-1**: Every message producer can enqueue only an event defined in the database catalog.
2. **AC-F-2**: A minute worker can claim each due row once and record Resend acceptance within sixty seconds under normal operation.
3. **AC-F-3**: Resend delivery events are verified, stored once, and applied once even when they arrive out of order.
4. **AC-F-4**: Public callers cannot read, change, preview, test, or manually process email rows.
5. **AC-F-5**: Existing Vercel business handlers no longer call a direct provider or a Vercel email worker.
6. **AC-F-6**: A disabled non required event creates no outbox row and does not fail its business action.
7. **AC-F-7**: Queue health, worker runs, dead jobs, provider failures, and retention are visible without exposing full addresses or message payloads.
8. **AC-F-8**: The foundation passes package tests, app builds, database checks, Supabase advisors, and signed function fixtures before any new user event is enabled.

## Decision

Use Supabase Postgres for the catalog, outbox, leases, provider events, logs, settings, and worker records. Use private Deno Edge Functions for sending, Resend events, and operations. Keep `@care-ecosystem/shared-email` only as a server side enqueue adapter until all Vercel producers use it, then remove its sender and template code.

## Feature Design

### Data Model

1. `email_event_catalog`
   1. `id uuid` primary key.
   2. `app text` required, limited to `carehub` or `carefind`.
   3. `event_key text` required.
   4. `template_key text` required.
   5. `subject_template text` required.
   6. `from_email text` required.
   7. `reply_to text` required.
    8. `payload_schema jsonb` required with `additionalProperties = false`, required fields, and length limits.
    9. `enabled boolean` required with default false.
   10. `required_for_business boolean` required with default false.
   11. `category text` required.
   12. `created_at timestamptz` and `updated_at timestamptz` required.
   13. Unique constraint on app plus event key.
   14. Foreign key from outbox app plus event key.
2. `email_outbox`
   1. Existing identity, recipient, sender, subject, template, payload, status, attempts, error, provider id, and timestamps remain.
   2. Add app, event key, reply address, claim token, claim time, claim expiry, accepted time, delivered time, bounced time, complained time, failed time, dead time, and quarantine reason.
   3. Status values are `pending`, `processing`, `accepted`, `delivered`, `bounced`, `complained`, `failed`, `dead`, and `quarantined`.
   4. The row stores the catalog snapshot for subject, sender, reply address, template key, and payload limits so later catalog edits do not change an already queued message.
   5. Unique constraint on app plus event key.
   6. Partial unique index on provider id when provider id is present.
   7. Claim index on status, next retry time, and claim expiry.
   8. Existing `sent` rows become `accepted`, and `sent_at` becomes `accepted_at` before the old status constraint is removed.
5. `email_provider_events`
   1. `id uuid` primary key.
   2. `provider_event_id text` required and unique.
   3. `provider_message_id text` required.
   4. `event_type text` required.
   5. `outbox_id uuid` nullable with `ON DELETE SET NULL`.
   6. `safe_metadata jsonb` required with default empty object.
   7. `received_at`, `applied_at`, `apply_error`, and `created_at` required as applicable.
   8. Index on provider message id and applied time.
6. `email_logs`
   1. Change outbox deletion to `ON DELETE SET NULL`.
   2. Expand safe event types for claimed, accepted, delivered, bounced, complained, failed, dead, replayed, and cleaned.
   3. Keep the table append only.
7. `email_worker_runs`
   1. `id uuid` primary key.
   2. `worker_name text` required.
   3. `started_at` and `completed_at timestamptz` required as applicable.
   4. `status text` required.
   5. `claimed_count`, `accepted_count`, `failed_count`, and `dead_count integer` required with default zero.
   6. `duration_ms integer` nullable.
   7. `error_summary text` nullable and safe.
8. `email_system_settings`
   1. `key text` primary key.
   2. `value jsonb` required.
   3. `updated_by uuid` nullable with `ON DELETE SET NULL`.
   4. `updated_at timestamptz` required.
   5. Approved keys include `carehub_admin_email` and `dispatch_paused`.
   6. Only the operations function may write approved settings.

All tables use RLS with no policies for anon or authenticated roles.

### Database Functions

1. `enqueue_business_email_event(p_app text, p_event_key text, p_to_email text, p_payload jsonb, p_source_id uuid default null)` returns the outbox id or null for a disabled non required event. A disabled required event returns a safe configuration error. It is service role only and rejects Auth event keys.
2. `enqueue_auth_email_event(p_app text, p_event_key text, p_to_email text, p_payload jsonb, p_idempotency_event_key text, p_auth_proof text)` returns the outbox id. It verifies the proof against the Vault copy of `AUTH_EVENT_KEY_SECRET`, rejects business event keys, and is not callable by the generic Node adapter.
3. `claim_email_batch(p_limit integer default 20, p_lease_seconds integer default 300)` returns claimed rows. It first reclaims processing rows with expired leases to pending without consuming an attempt, then uses row locking with skipped locked rows and a unique claim token.
4. `complete_email_accepted(p_outbox_id uuid, p_claim_token uuid, p_provider_id text)` returns true only when the claim matches.
5. `complete_email_failure(p_outbox_id uuid, p_claim_token uuid, p_error_summary text)` calculates retry time from the row attempt count and sets dead at the row limit. It refuses to increment attempts for global configuration errors.
6. `record_email_provider_event(...)` stores a verified provider event once and links it when the provider id exists. It uses `data.email_id` as the provider message id.
7. `reconcile_email_provider_events()` applies unprocessed events whose provider id is now linked.
8. `cleanup_email_retention()` clears Auth payloads after twenty four hours, removes terminal outbox and provider rows after thirty days, removes safe logs after ninety days, and removes worker runs after thirty days.
9. `replay_dead_email(p_outbox_id uuid)` rejects Auth templates, requires platform administrator authority, writes an audit record, and returns the same row to pending.
10. `get_email_health()` and `list_email_outbox(...)` require platform administrator authority and return masked values.
11. `update_email_system_setting(...)` accepts approved keys only, including `dispatch_paused`, and records the platform administrator actor.
12. `check_email_worker_config()` returns a safe failure before any row is claimed when the Resend key, catalog, brand configuration, or required secret is missing.

### Shared Runtime

1. `supabase/functions/_shared/email/brands.ts` defines allowed app domains, wordmark URLs, and link origins. The database catalog remains the only source of sender, reply address, and subject at runtime.
2. `supabase/functions/_shared/email/catalog.ts` validates catalog responses, closed payload schemas, length limits, and sender values against the app brand policy. Subject templates use `{{field}}` placeholders and fail when a required field is absent.
3. `supabase/functions/_shared/email/templates.ts` maps approved template keys to pure render functions that return HTML and plain text. It does not choose sender or subject.
4. `supabase/functions/_shared/email/provider.ts` calls Resend with `to`, `from`, `reply_to`, `subject`, `html`, `text`, and `Idempotency-Key`.
5. `supabase/functions/_shared/email/safeLog.ts` masks addresses and removes tokens, links, secrets, and clinical fields.
6. The Deno modules contain no Node only import and are shared by the worker, Auth hook, and operations function.

### Edge Functions

1. `minute-email-worker` uses a named Supabase secret key, accepts `POST`, runs `check_email_worker_config()` before claiming, claims at most twenty rows, sends with concurrency five, records one worker run, and reconciles provider events after the batch.
2. `resend-webhook` uses `verify_jwt = false`, reads the raw body, verifies the Svix signature, calls `record_email_provider_event`, and returns an empty success response only after storage succeeds.
3. `resend-webhook` accepts `email.sent`, `email.delivery_delayed`, `email.delivered`, `email.bounced`, `email.complained`, `email.failed`, and `email.opened`. Unknown events are stored as safe provider evidence and do not change outbox state. `email.sent` and `email.opened` do not change state. `email.delivery_delayed` keeps accepted rows accepted. `email.failed` changes only pending or processing rows. Bounce and complaint events are terminal and never reverse one another.
4. `email-operations` uses normal user JWT verification, then calls protected database functions for platform administrator access. It supports health, cursor based outbox reads, replay, and setting updates.

### Node Adapter

1. `@care-ecosystem/shared-email` exports `enqueueBusinessEmailEvent` and no public template, Auth enqueue, or direct send function.
2. The adapter accepts app, business event key, recipient, closed payload, and optional source id, then calls `enqueue_business_email_event` through the server service role.
3. It rejects Auth event keys and cannot call `enqueue_auth_email_event`.
4. It does not flush a worker. Supabase Cron owns timing.
5. Every current Vercel caller supplies an explicit app and catalog event. Later events are seeded disabled and non required.
6. The old `sendEmail`, `sendAuthEmail`, `processBatch`, template registries, and Vercel email workers are deleted after caller migration.

### Routing Changes

1. CareHub cron and Resend webhook routes return `410 Gone` after the Supabase functions are proven, then their handlers are deleted.
2. CareFind cron and Resend webhook routes return `410 Gone` after the Supabase functions are proven, then their handlers are deleted.
3. Public Auth mail, generic send, outbox, preview, test send, registration notice, and business status notice routes return `410 Gone` during their child cutovers, then are deleted.
4. Vercel `vercel.json` cron entries are removed after Supabase Cron owns the schedule.
5. The Resend webhook URL is changed to the Supabase Edge Function URL only after signature fixtures pass.

### Value Sourcing

1. Catalog sender, subject, closed payload schema, enabled state, and required state come from `email_event_catalog`.
2. App identity comes from the explicit adapter input for business events. Auth ownership comes from the Auth child membership rules.
3. Retry count and limit come from the outbox row. Default maximum is five.
4. Retry delays are one, five, fifteen, and sixty minutes.
5. Claim lease is five minutes. Provider request timeout is ten seconds. Worker batch size is twenty. Send concurrency is five.
6. Health counts come from aggregate database queries and `email_worker_runs`.
7. Admin list cursors come from the outbox creation time plus id cursor supplied by the caller.
8. Masked addresses are derived inside `get_email_health` and `list_email_outbox` from stored addresses.
9. Global dispatch pause comes from `email_system_settings.dispatch_paused`; the worker checks it before claiming.
10. Existing rows with unknown app or event mapping move to `quarantined` and are never guessed.

### Security Model

1. Public routes have no service role email access.
2. The public signup bridge receives no service role key. It calls only the narrow rate limited intent RPC and normal Supabase Auth signup with the publishable key.
3. Database functions use fixed `search_path` and explicit grants.
4. `SECURITY DEFINER` functions check the required role and use trusted inputs only.
5. The worker secret is a named Supabase key with only the permissions needed for email tables and Auth membership reads.
6. The Resend key exists only in the minute worker.
7. The Resend webhook stores no raw body after signature verification and safe extraction.
8. Outbox administration returns masked addresses and never returns payload, links, or provider secrets.
9. Catalog payload validation rejects unknown fields, oversized values, and clinical field names before enqueue.
10. Later event calls are safe no ops while disabled, so payment and booking actions do not fail.

### Configuration Required

1. Supabase extensions `pg_cron`, `pg_net`, and Vault must be enabled and verified.
2. Cron job `email-minute-worker` runs `* * * * *` and calls the private worker with the Vault named secret `email_worker`.
3. Cron job `email-retention` runs daily and calls retention cleanup.
4. `RESEND_API_KEY` and `RESEND_WEBHOOK_SECRET` are Supabase Edge Function secrets.
5. `resend-webhook` has `verify_jwt = false` because Svix is its authentication method.
6. `AUTH_EVENT_KEY_SECRET` is available only to the Auth hook. A protected Vault copy lets the database verify the Auth enqueue proof without exposing the secret to Vercel.
7. `carefindhub.com` and `carefind.app` must be verified in Resend before events are enabled.

### Critical Test Scenarios

1. Two simultaneous claim calls return disjoint rows. Verifies **AC-F-2**.
2. A repeated Resend event id applies one state change. Verifies **AC-F-3**.
3. A delivery event stored before provider id linking is reconciled later. Verifies **AC-F-3**.
4. An ordinary authenticated user cannot list or replay email rows. Verifies **AC-F-4**.
5. A disabled booking event does not create a row and does not fail payment settlement. Verifies **AC-F-6**.
6. A missing Resend key leaves rows failed and visible. Verifies **AC-F-7**.
7. No Vercel source still calls a direct provider or Vercel worker after cutover. Verifies **AC-F-5**.
8. A missing Resend key is detected before claim, leaves attempts unchanged, and raises a safe worker health error. Verifies **AC-F-7**.
9. An expired processing claim returns to pending and can be claimed again without a second send. Verifies **AC-F-2** and **AC-F-7**.
10. A Resend delayed, sent, failed, bounced, and complained event follows the defined state matrix. Verifies **AC-F-3**.
11. An unknown payload field or a free text clinical reason is rejected before enqueue. Verifies **AC-F-1** and **AC-F-4**.

## Build Plan

1. Add and apply the additive schema migration, backfill sent rows, create catalog tables, constraints, indexes, RLS, and fixed path functions. Satisfies **AC-F-1**, **AC-F-3**, **AC-F-4**, and **AC-F-6**.
2. Build the pure Deno brand, catalog, template, provider, and safe logging modules with unit tests. Satisfies **AC-F-1**.
3. Build and deploy the minute worker, Supabase Cron schedule, Vault secrets, and worker run recording. Satisfies **AC-F-2** and **AC-F-7**.
4. Build and deploy the Resend webhook and reconciliation path with raw body signature fixtures. Satisfies **AC-F-3**.
5. Build the protected operations function for health, masked listing, replay, and settings. Satisfies **AC-F-4** and **AC-F-7**.
6. Convert the Node package into the enqueue adapter, migrate every Vercel producer, seed disabled later events, and remove old Vercel sending paths. Satisfies **AC-F-5** and **AC-F-6**.
7. Run package tests, app tests and builds, database behavior checks, Supabase advisors, signed webhook fixtures, and dead code searches. Satisfies **AC-F-8**.

## Migration Plan

**Strategy**: expand, map, validate, then contract

**Phases**:

1. Add nullable app, event key, reply, claim, state time, and quarantine columns. Create provider events, worker runs, catalog, and settings without changing the old status constraint.
2. Produce a mapping report for every existing outbox row. Rows with a known app and catalog event are mapped. Unclear rows become `quarantined` and are not sent.
3. Verify provider id duplicates, status values, event keys, and payload sizes. Reconcile or quarantine before adding constraints.
4. Add the new status constraint, catalog foreign key, unique event key, and provider indexes after the report is clean.
5. Deploy the new functions and move producers. Keep the old routes available only during the controlled cutover.
6. After stable provider events, remove old columns, routes, and functions in a later contract migration.

**Rollback**: Keep the expanded columns and evidence, set `dispatch_paused` to true, and stop the new worker. Do not disable required catalog events. The old status constraint returns only after all new rows are removed or mapped.

**Risks**: Existing rows may have no app or event identity. Provider ids may already be duplicated. A partial migration can leave the old and new status rules disagreeing. Each risk has a report and a verification query before constraints are added.

## Consequences

1. The first migration is large because the old outbox shape did not support explicit app ownership, leases, provider reconciliation, or closed payload rules.
2. Deno becomes the only rendering and sending runtime. Node keeps only event production.
3. Supabase usage increases by one private worker invocation each minute and one Resend webhook invocation per provider event.
4. The migration is staged through expand, map, validate, and contract phases. Unclear existing rows are quarantined instead of guessed.
5. Rollback pauses dispatch through a protected setting while required business events remain enabled.

## Rationale

The database is the only place that can atomically join a business change to its email job. Supabase Cron and Deno remove the Vercel plan limit and keep Auth, sending, provider events, and operations in one runtime. The old Node sender remains only long enough to move producers safely.
