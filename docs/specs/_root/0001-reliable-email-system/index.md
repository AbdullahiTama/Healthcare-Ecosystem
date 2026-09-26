# 0001. Reliable Email System

**Date**: 2026-09-24
**Status**: Accepted

## Summary

CareHub and CareFind will share one reliable email system built on Supabase, Resend, and a protected outbox. The system will use one minute Supabase scheduling, trusted app identity, clear CareHub and CareFind branding, and proof from real inboxes. The work is split into four buildable children so database, Auth, and CareHub business mail can be checked one slice at a time.

## Structure

1. [0001 delivery foundation](0001-delivery-foundation.md) defines the database model, catalog, Deno worker, Resend events, protected operations, and removal of the old sending path.
2. [0002 CareFind Auth email](0002-carefind-auth-email.md) defines trusted app membership, the protected signup bridge, Supabase Auth mail, and client recovery behavior.
3. [0003 CareHub business email](0003-carehub-business-email.md) defines registration and business review mail inside the same database transaction as each business change.
4. [0004 CareHub Auth email](0004-carehub-auth-email.md) defines CareHub password recovery and security notices using the shared Auth hook and trusted membership.

## Cross Child Contract

1. The database event catalog is the only authority for allowed app names, event names, template keys, subjects, sender identities, required payload fields, enabled state, and whether an event is required for its business action.
2. Supabase owns Auth state and token validation. Resend is the only email provider.
3. One private `minute-email-worker` Edge Function is the only code that calls Resend for queued messages.
4. One `resend-webhook` Edge Function is the only code that accepts Resend delivery events.
5. One `send-email` Edge Function is the only Auth mail path. The old custom Auth mail routes and `admin.generateLink` mail flow must be removed after cutover.
6. Every outbox row has an explicit app and a unique event key. Sender text never selects an app.
7. Browser code never chooses a template, recipient, sender, or raw HTML.
8. CareHub uses `carefindhub.com`. CareFind uses `carefind.app`.
9. No patient identifier or clinical detail may appear in mail or logs.
10. Later activity groups may be present in the catalog with `enabled = false`. They must not send until their own child spec and rollout approval are complete.

## Requirements

**User stories**:

1. As a CareFind user, I want one branded verification and welcome message so I can confirm my account and start using CareFind.
2. As a CareHub owner or staff member, I want a branded password recovery message so I can regain access safely.
3. As a CareHub business owner, I want registration and review messages tied to the exact business decision so I know the result of my request.
4. As a platform administrator, I want safe queue health, masked message records, dead job replay, and setting changes so I can recover delivery without reading private message content.
5. As a support engineer, I want provider acceptance, delivery, bounce, and complaint states recorded so I can explain what happened without exposing secrets or clinical data.

**Acceptance criteria**:

1. **AC-1**: An enabled business action and its required email job are written in one database transaction. If either write fails, the business action does not remain committed.
2. **AC-2**: Every queued message has an explicit app, catalog event key, unique event identity, correct sender, subject, and validated payload.
3. **AC-3**: Concurrent workers cannot send one outbox row more than once, and a new enabled message begins processing within sixty seconds under normal operation.
4. **AC-4**: Resend acceptance and inbox delivery are separate states. A retry uses the same Resend duplicate send key.
5. **AC-5**: Repeated or out of order Resend events update the correct row once and never reverse a terminal delivery, bounce, or complaint state.
6. **AC-6**: Each supported Supabase Auth action creates exactly one correctly branded message. No built in Auth sender competes with the custom path.
7. **AC-7**: Auth mail branding comes from trusted app membership or a short lived trusted signup intent. Editable user metadata and an arbitrary redirect never establish ownership.
8. **AC-8**: CareHub mail uses the CareHub wordmark, sender, links, and support details on `carefindhub.com`. CareFind mail uses the CareFind wordmark, sender, links, and support details on `carefind.app`.
9. **AC-9**: Public callers cannot list or change the outbox, choose arbitrary templates or recipients, send test mail, preview private templates, or process the queue.
10. **AC-10**: Auth hooks, Resend webhooks, the minute worker, and operations routes fail closed when their required secret or signature is missing or invalid.
11. **AC-11**: Email content and logs contain no clinical detail. Raw Auth links exist only in protected temporary payloads and are cleared within the approved retention window.
12. **AC-12**: Provider failure, expired claims, dead jobs, configuration errors, delayed workers, bounces, and complaints are visible through safe health data and structured logs.
13. **AC-13**: Existing payment, booking, order, subscription, and appointment call sites no longer use the old direct sender or immediate Vercel flush. Their catalog entries stay disabled until their later rollout.
14. **AC-14**: Automated tests, database checks, Supabase advisors, builds, and real inbox checks pass before wider use.
15. **AC-15**: CareHub and CareFind messages render correctly in Gmail and Outlook on web and mobile, with readable logos, working links, correct sender identity, and usable plain text.
16. **AC-16**: Operations documentation covers domains, DNS, Supabase secrets, Auth hook setup, Resend setup, scheduling, health, dead jobs, safe replay, retention, and rollback.

## Decision

**Chosen option**: One Supabase owned email system with a database catalog, private Deno Edge Functions, and phased cutover from the existing Vercel sending paths.

Supabase Cron runs the minute worker through `pg_cron`, `pg_net`, and Vault. The Auth hook, minute worker, Resend webhook, and operations API live in Supabase Edge Functions. The existing Node package becomes a thin enqueue adapter for Vercel business handlers and no longer renders or sends mail.

## Feature Design

### Architecture

1. A trusted database function, SQL business function, Auth hook, signup bridge, or approved server adapter creates a catalog event.
2. `enqueue_business_email_event` validates the catalog, derives sender and subject values, inserts the outbox row, and writes a safe enqueue log.
3. Supabase Cron invokes `minute-email-worker` every minute through `pg_net`. A named secret key authenticates the private function.
4. `minute-email-worker` claims due rows through a lease function, renders through the Deno template registry, sends to Resend with the event key as the duplicate send key, and records the provider message id.
5. `resend-webhook` verifies the Svix signature, stores the provider event first, and applies it when the provider message id is linked. Reconciliation handles an event that arrived first.
6. `email-operations` verifies a user session and platform administrator role before returning masked health or outbox data, replaying a dead non Auth job, or changing a protected setting.
7. Vercel routes remain only as business producers during migration. They cannot send, process, preview, or mutate email rows.

### Data Model

1. `email_event_catalog` stores app, event key, template key, subject template, sender, reply address, a closed payload schema with length limits, enabled state, and whether the event is required.
2. `account_app_memberships` stores user id, app, state, trusted source, and timestamps. Its primary key is user id plus app.
3. `account_signup_intents` stores a short lived CareFind signup intent, normalized email, hashed request fingerprint, state, expiry, and consumption time.
4. `email_system_settings` stores protected non secret operator settings, including the CareHub admin address and a global `dispatch_paused` switch. Pausing dispatch does not disable required events or roll back business writes.
5. `business_registration_attempts` stores registration id, original business id, safe result, and creation time.
6. `business_status_transitions` stores transition id, request id, business id, previous status, new status, reason, platform actor, unique event key, and creation time.
7. `email_outbox` stores the validated message, claim lease, attempts, provider id, state times, temporary payload, and safe error summary.
8. `email_provider_events` stores a unique verified provider event, safe metadata, optional outbox link, receipt time, applied time, and apply error.
9. `email_logs` stores append only safe state history. Its outbox reference uses `ON DELETE SET NULL` so safe logs survive outbox retention cleanup.
10. `email_worker_runs` stores worker name, start, completion, state, counts, duration, and safe error summary.

### State Transitions

1. `quarantined` is a non sending state for existing rows whose app or event cannot be proven. An operator maps or removes the row before it can be claimed.
2. `pending` becomes `processing` after a valid claim.
3. `processing` becomes `accepted` after Resend returns a message id.
4. `accepted` becomes `delivered`, `bounced`, or `complained` only after a verified provider event.
5. `processing` becomes `failed` after a safe provider or rendering failure.
6. `failed` returns to `pending` when the next retry time is due.
7. `failed` becomes `dead` when attempts reach the row limit.
8. A dead non Auth row returns to `pending` only through an audited platform administrator replay.
9. A dead Auth row is not replayed. The user requests a new message.
10. A processing row with an expired claim lease returns to `pending` without consuming a new attempt, then can be claimed again.
11. A provider event received before provider id linking remains unapplied until reconciliation links it.
12. A provider `sent` event is idempotent with worker acceptance. `delivery_delayed` keeps the row accepted and records a safe event. `failed` can move only pending or processing to failed. `bounced` and `complained` are terminal provider outcomes and never reverse one another. A later duplicate cannot reverse any terminal state.
13. The worker checks Resend configuration before claiming rows. A global configuration failure does not consume message attempts.

### API Surface

1. `carefind-signup` is a public Edge Function. `POST` accepts email, password, display name, and the exact CareFind callback URL. It creates a rate limited signup intent, calls normal Supabase Auth signup, and returns a generic Auth result. Errors are `400`, `409`, `429`, or `500` without account details.
2. `send-email` is a private Auth hook Edge Function. Supabase calls it with a signed standard webhook payload. It accepts no user JWT and no browser selected app. It handles CareFind and CareHub recovery plus the supported security actions. Errors fail the Auth mail request without logging tokens.
3. `minute-email-worker` is a private Edge Function. `POST` accepts no public input. A named secret key authenticates it. It returns safe processing counts.
4. `resend-webhook` is an Edge Function protected by Svix signature verification. `POST` accepts the raw Resend event. Invalid signatures return `401`.
5. `email-operations` is a user authenticated Edge Function. Platform administrators may read health, list masked outbox rows with a cursor, replay a dead non Auth row, and update allowed settings. Other users receive `403`.
6. `register_business_atomic` is a Postgres function. It accepts registration id, the existing safe business payload, and password. It returns the original business id and result for a repeated registration id.
7. `review_business_status` is a Postgres function available to authenticated platform administrators. It accepts request id, business id, target status, and optional reason. It returns transition id, previous status, new status, and event key.
8. `enqueue_business_email_event` is service role only. It accepts app, event key, recipient, closed payload, and an optional source reference. It rejects Auth event keys. It returns the outbox id, or null when a disabled non required event is safely suppressed.
9. `enqueue_auth_email_event` is callable only by the signed Auth hook path with a short proof derived from `AUTH_EVENT_KEY_SECRET`. The database verifies the proof against its Vault copy. It accepts the trusted app, action event key, recipient, closed payload, and event key. The generic Node adapter cannot call it.
10. `claim_email_batch`, `complete_email_accepted`, `complete_email_failure`, `record_email_provider_event`, `reconcile_email_provider_events`, `cleanup_email_retention`, and `replay_dead_email` are service role only database functions.
11. Existing Vercel public email send, outbox, preview, test send, Auth mail, registration notice, and business status notice routes return `410` during migration and are deleted after all callers move.

### Value Sourcing

1. App identity comes from `account_app_memberships`, then an unexpired `account_signup_intents` row for first CareFind signup, then an exact approved user initiated redirect only when the account already has that membership. Otherwise the Auth job fails visibly.
2. Sender, reply address, subject, template key, closed payload schema, enabled state, and required state come from `email_event_catalog`.
3. Recipient comes from the approved server producer, Auth hook payload, signup intent, or CareHub business ownership record. Browser supplied recipients are not accepted.
4. Brand domain and logo come from the explicit app brand module. The worker environment does not choose the app.
5. Registration idempotency comes from the caller generated `registration_id` stored in `business_registration_attempts`.
6. Business review event identity comes from `business_status_transitions.id`. Approval versus reactivation comes from the stored previous status.
7. Worker timing comes from Supabase Cron schedule `* * * * *`. The worker claims at most twenty rows with five minute leases and sends with bounded concurrency of five.
8. Retry policy comes from the outbox row. Maximum attempts default to five. Retry delays are one, five, fifteen, and sixty minutes.
9. Raw Auth payload expiry comes from `account_signup_intents.expires_at` and the approved twenty four hour outbox cleanup ceiling.
10. Terminal outbox and provider event retention is thirty days. Safe log retention is ninety days.
11. Recipient masking is derived from `to_email` inside the operations function. Full addresses never enter response logs.
12. Worker health is derived from `email_worker_runs` and aggregate outbox counts.
13. Signup protection allows at most five intents for one normalized email and ten for one hashed request fingerprint in one hour. Supabase Auth signup limits still apply.
14. Real inbox proof uses two Gmail and two Outlook test accounts for each app before the eight account canary.
15. Auth event keys use an HMAC secret over app, action, user id, Auth updated time, and any available token hash. The HMAC secret never enters the database or logs.
16. Global dispatch pause comes from `email_system_settings.dispatch_paused`; it stops claiming without changing required catalog events.

### Key Invariants

1. A required enabled event and its business write commit or roll back together.
2. A disabled non required event cannot create an outbox row or fail its business action.
3. Every outbox row resolves to exactly one enabled catalog event at enqueue time.
4. A claim token must match before a worker can complete a row.
5. Only Resend acceptance code can set `accepted`.
6. Only a verified provider event can set `delivered`, `bounced`, or `complained`.
7. Auth raw tokens and token hashes are never stored in logs or event keys.
8. User metadata, browser storage, and an arbitrary redirect never establish app ownership.
9. Clinical fields are rejected by the payload contract and template tests.
10. No public route uses the service role for outbox access.

### Security Model

1. This feature processes health related account and business events, so data minimization applies even though clinical details are forbidden.
2. `email_outbox`, `email_logs`, `email_provider_events`, `email_worker_runs`, `email_event_catalog`, `email_system_settings`, `account_app_memberships`, `account_signup_intents`, `business_registration_attempts`, and `business_status_transitions` use RLS with no public policies.
3. Only service role functions and Edge Functions may read or change email tables.
4. The public CareFind signup bridge receives no service role key and uses only a narrow rate limited intent RPC.
5. `email-operations` requires a valid user session and a platform administrator check in the database. UI trust is not authorization.
6. The Auth hook accepts only a valid Supabase standard webhook signature.
7. The minute worker accepts only its named secret key and `POST`.
8. The Resend webhook accepts only a valid Svix signature over the raw body.
9. Public signup stores a hashed request fingerprint and a short lived normalized email. It never stores a raw IP address.
10. Catalog payload schemas reject unknown fields, oversized values, and clinical field names before enqueue.
11. Logs mask addresses and exclude passwords, tokens, action links, full request bodies, and clinical fields.
12. Resend receives only the data required to deliver the approved message. Open and click tracking remain disabled.
13. All action links use exact HTTPS origins from the app brand.
14. Dead Auth jobs cannot be replayed because their links may be stale.
15. Global dispatch pause stops provider sending without disabling required business events.

### Configuration Required

1. `SUPABASE_URL`: shared project URL for Edge Functions and Vercel server code.
2. `SUPABASE_SERVICE_ROLE_KEY`: server only database and Auth administration key.
3. `SUPABASE_PUBLISHABLE_KEY`: server side signup bridge key used only for normal Supabase Auth signup.
4. `SEND_EMAIL_HOOK_SECRET`: verifies Supabase Auth hook requests.
5. `AUTH_EVENT_KEY_SECRET`: creates non reversible Auth event keys without storing token material.
6. `SUPABASE_WORKER_SECRET_KEY`: named key that authenticates the minute worker.
7. `RESEND_API_KEY`: used only by the minute worker.
8. `RESEND_WEBHOOK_SECRET`: verifies Resend events.
9. `APP_URL`: deprecated as a brand selector. It may remain for unrelated web behavior but email code must not use it to choose an app.
10. Vault secrets `email_project_url` and `email_worker_secret_key`: used by Supabase Cron and `pg_net`.
11. Resend verified domains `carefindhub.com` and `carefind.app` with SPF, DKIM, and DMARC.
12. Supabase Auth redirect origins `https://carefindhub.com` and `https://carefind.app` with required callback routes.
13. Supabase Auth email confirmation stays enabled for CareFind consumer signups until the Auth hook and verification landing page are proven. CareHub owner and staff accounts remain server confirmed by their business function.

### Critical Test Scenarios

1. Happy Auth path: a new CareFind account creates one trusted membership, one combined verification and welcome outbox row, one Resend acceptance, and one delivery event. This verifies **AC-2**, **AC-6**, **AC-7**, and **AC-15**.
2. Concurrent workers: two minute workers claim the same twenty rows but no row is sent twice. This verifies **AC-3** and **AC-4**.
3. Provider event race: a delivery webhook arrives before the worker stores the provider id, then reconciliation applies it once. This verifies **AC-5**.
4. Business rollback: a required CareHub registration enqueue failure leaves no business row, Auth user, attempt row, or outbox residue. This verifies **AC-1**.
5. Repeated status change: two separate approval transitions for one business receive separate transition ids and event keys. This verifies **AC-1** and **AC-2**.
6. Permission attack: an ordinary user calls `email-operations` and cannot read or replay mail. This verifies **AC-9** and **AC-10**.
7. Signature attack: missing or invalid Supabase, worker, or Resend credentials receive `401` and create no state. This verifies **AC-10**.
8. Privacy test: rendered output and logs contain neither clinical fields nor raw Auth links after cleanup. This verifies **AC-11**.
9. Disabled later event: a booking or payment flow records its business result while its disabled email event creates no row and does not fail the action. This verifies **AC-13**.
10. Real inbox test: both apps render in Gmail and Outlook on web and mobile with the correct wordmark and working link. This verifies **AC-8** and **AC-15**.
11. CareHub recovery: an existing CareHub member requests a reset, the shared hook resolves the CareHub membership, and the CareHub template sends one working link. This verifies **AC-6**, **AC-7**, and **AC-8**.
12. Global pause: required business events remain enabled while dispatch is paused, and queued rows resume after the worker health check passes. This verifies **AC-1**, **AC-3**, and **AC-12**.

## Build Plan

The project has no recorded delivery strategy, so this plan uses an end to end tracer bullet. Each child leaves one working path and removes the old path only after the replacement passes.

1. Build and apply the delivery foundation migration, catalog, protected functions, Deno renderer, minute worker, Resend webhook, and operations API. Satisfies **AC-2**, **AC-3**, **AC-4**, **AC-5**, **AC-9**, **AC-10**, **AC-12**, **AC-13**, and **AC-16**.
2. Move every existing Vercel producer to the database business enqueue adapter, seed later events as disabled, and remove direct Vercel sending, cron, preview, and test routes. Satisfies **AC-2** and **AC-13**.
3. Build trusted app membership, signup intents, the CareFind signup bridge, the shared Supabase Auth hook, CareFind Auth templates, and CareFind client recovery flow. Satisfies **AC-6**, **AC-7**, **AC-8**, **AC-11**, **AC-14**, and **AC-15**.
4. Build CareHub recovery and security templates plus the CareHub client recovery flow through the shared Auth hook. Satisfies **AC-6**, **AC-7**, **AC-8**, **AC-11**, **AC-14**, and **AC-15**.
5. Build the protected admin setting, registration attempts, business status transitions, atomic CareHub functions, templates, and client calls. Satisfies **AC-1**, **AC-8**, **AC-11**, **AC-14**, and **AC-15**.
6. Run migrations, advisors, all tests and builds, the eight account canary, real inbox checks, and operations documentation review. Satisfies **AC-12**, **AC-14**, **AC-15**, and **AC-16**.

## Migration Plan

**Strategy**: feature flagged strangler cutover

**Phases**:

1. Add new columns as nullable, add the catalog, claim functions, provider event table, and worker records without changing the old status constraint. The old code remains callable only inside the existing deployment.
2. Classify every existing outbox row. Rows with an unambiguous app and event are mapped and verified. Unclear rows move to a safe quarantine state and are never guessed or sent.
3. Add the catalog foreign key, unique event key constraints, new status constraint, and required fields only after the mapping report is clean.
4. Deploy the database catalog, Deno functions, Supabase Cron, and operations API. Verify them with test rows and signed fixtures.
5. Move all existing producers to `enqueue_business_email_event`. Keep later event groups disabled so business actions continue without unapproved mail.
6. Activate CareFind Auth mail for test accounts, run real inbox checks, then enable the eight account canary.
7. Activate CareHub Auth, registration, and review mail for test accounts, then the same canary.
8. Remove old Vercel Auth mail, direct sender, cron, webhook, outbox, preview, and test routes after seven days of stable provider events.

**Rollback**: Set `dispatch_paused` to true, stop the Supabase Auth hook, and leave required catalog events enabled. Business actions continue to write durable jobs while the worker sends nothing. Resume only after provider, scheduler, and queue health checks pass. The additive columns and evidence remain during rollback.

**Risks**: The first CareFind verification could be misbranded if the signup intent is not created before Auth signup. A provider event could arrive before the provider id link. An expired worker claim could strand a row. A missed caller could still use an old route. Domain verification or Supabase secret setup may be incomplete. Each risk has a database or deployment check before cutover.

## Consequences

**Positive**:

1. Mail loss, duplicate sends, wrong branding, and false success claims become measurable failures.
2. Auth and business events share one retry, audit, retention, and provider state model.
3. One minute scheduling no longer depends on the Vercel plan.
4. Platform administrators can recover dead jobs without exposing private payloads.
5. Clinical details are blocked before rendering and logging.

**Negative / tradeoffs**:

1. The system adds five Supabase Edge Functions, ten service protected tables, Vault, Cron, `pg_net`, and provider event reconciliation.
2. Deno templates replace the current Node template runtime, so the first cutover is substantial.
3. The database catalog adds a deployment step whenever event fields change.
4. Supabase Cron requests are not guaranteed retries, but the durable outbox makes the next minute a safe retry.
5. First CareFind signup now passes through a protected bridge and must preserve normal Supabase confirmation behavior.
6. CareHub password recovery and security notices are a separate child so the shared Auth hook can be proven for both apps before business mail is enabled.

**Neutral**:

1. Vercel remains the web and business handler host, but it no longer sends email.
2. Later email activity stays visible in code and catalog but disabled until its own approved slice.
3. Existing in app notifications are unchanged.

## Follow-up

1. Run `/sync` after implementation to add the new email and Auth hook conventions to the nearest area instructions.
2. Add a dedicated `supabase/functions/_shared/email/AGENTS.md` only if the area gains more local rules after implementation.
3. Create later child specs for professional decisions, staff lifecycle, commerce, payments, appointments, subscriptions, withdrawals, returns, and stock alerts.
4. Verify the active Vercel plan is no longer a requirement because Supabase Cron owns the one minute schedule.

## Rationale

Reasoning, options, evidence, and references are recorded in [rationale.md](rationale.md).
