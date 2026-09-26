# Reliable Email For CareHub And CareFind

Date: 2026-09-24

Status: Design approved in conversation. Written review is pending.

## Purpose

CareHub and CareFind will use one reliable email system for verification, password recovery, security notices, account decisions, and important business activity. Every message will show the correct app identity, logo, links, sender address, and support address.

The first release will repair the shared delivery foundation and prove it with real inbox checks. Later releases will add approved activity groups. Social activity will remain in the apps.

## Current Evidence

The active Supabase project has the `email_outbox` and `email_logs` tables, but both contain zero rows. This proves that the current shared email flow has not placed any work in the live queue.

The current code also has proven delivery defects:

1. `apps/carehub/api/_handlers/cron-handler.js` imports `process-email-outbox.js`, but the actual file is `cron-process-email-outbox.js`.
2. `apps/carehub/api/_handlers/cron-process-email-outbox.js` rejects the GET request used by Vercel Cron.
3. The CareHub cron secret check accepts a request when the secret is missing.
4. `packages/shared-email/src/authEmail.js` starts queue processing without waiting for it, then reports success.
5. Several routes report success even when queueing or provider delivery fails.
6. `packages/shared-email/src/EmailService.js` selects work without claiming it, so two workers can send the same row.
7. App selection depends on whether the sender text contains `CareHub`. A CareHub message processed by CareFind can therefore use the wrong template.
8. Resend webhook signature handling, event names, payload fields, and provider identification do not match the current Resend service.
9. The CareHub and CareFind public outbox routes expose service role backed data without proper access checks.
10. Repository defaults and public links mix `carehub.ng`, `carefindhub.com`, `carefind.app`, and `carefind.ng`.
11. The shared logo renderer displays wide wordmark images inside a narrow icon box, which can clip or shrink the logo.
12. The auth email endpoints and Supabase built in Auth mail can create duplicate messages for the same action.

These findings explain why the presence of email code has not produced reliable user mail.

## Goals

1. Deliver every enabled email through one traceable path.
2. Use the correct CareHub or CareFind brand for every message.
3. Never lose an email job after its business action succeeds.
4. Prevent duplicate sends from retries, browser requests, payment hooks, and concurrent workers.
5. Record queued, accepted, delivered, bounced, complained, failed, and dead outcomes.
6. Keep account existence and private links hidden from callers.
7. Keep privileged keys and recipient data out of client code and public logs.
8. Prove delivery in Gmail and Outlook before wider use.
9. Add important activity mail in small, approved groups.
10. Keep ordinary social activity in the apps.
11. Send only the minimum personal data needed for each message and never send clinical details.

## Not In Scope

1. Email for likes, comments, follows, mentions, reposts, and other low value social activity.
2. Marketing campaigns, bulk newsletters, and the dormant `email_sequence_progress` workflow.
3. A second email provider.
4. A separate email database for each app.
5. A new frontend framework or state library.
6. Patient names, diagnoses, prescriptions, test results, medical images, or other clinical details in email content.
7. Changes to product pricing, payments, subscriptions, or booking rules except where an approved event must be recorded with its business change.

## Canonical Domains

CareHub will use `carefindhub.com` for its web app, installable app, email links, support address, reply address, and sending identity. Its sender will be `CareHub <support@carefindhub.com>`. Its email logo will be `https://carefindhub.com/logo-wordmark.png`.

CareFind will use `carefind.app` for its web app, installable app, email links, support address, reply address, and sending identity. Its sender will be `CareFind <support@carefind.app>`. Its email logo will be `https://carefind.app/logo-wordmark.png`.

Both domains must be verified in Resend before any production rollout. DNS records for SPF, DKIM, and DMARC must be correct. The Supabase Auth redirect allowlist must contain only the approved CareHub and CareFind origins and their required callback routes.

Environment examples, application links, canonical metadata, and operational documentation must use these same domains. The older `carehub.ng` and `carefind.ng` domains may keep approved web redirects, but they must not appear in new email links or sender identities.

## Architecture

The existing `packages/shared-email` package remains the shared mail core. The existing `public.email_outbox` and `public.email_logs` tables remain the durable record.

Every approved server route, payment handler, database function, and Supabase Auth hook will enqueue a named event. Clients will not choose a template, sender, recipient, or arbitrary message.

Each outbox row will store the app explicitly. The worker will use that value to select the brand. Sender text will never decide the app.

One or more workers may run safely. The database will claim each row before processing it. This allows both app deployments to run the worker schedule without sending the same row twice.

Both deployments will run the worker every minute. Under normal operation, a new message must begin processing within sixty seconds. If the hosting plan cannot run a one minute schedule, rollout stops until an equivalent scheduler is available.

The Supabase Send Email hook will replace Supabase built in Auth email sending. It will place verification, recovery, invitation, email change, and security messages into the same outbox. Supabase will continue to own account state and token validation.

The hook will select the app in this order: trusted `app_metadata` set by a server, the exact approved redirect host for a user initiated action, or an existing trusted profile or business ownership record. It will never trust editable `user_metadata` for authorization or brand ownership. If none of these sources identifies the app, the job will fail visibly instead of guessing.

CareHub business owners and staff are currently created as confirmed accounts. They do not need a separate verification link. CareHub will send registration received, invitation, and account decision messages instead. CareFind consumer accounts will use the normal Auth verification flow.

## Event Catalog

The event catalog will be the only list of allowed templates. Each entry will define its event name, allowed apps, required payload fields, subject, and brand.

The first release will include:

1. One CareFind message that combines account verification and welcome.
2. Password recovery for CareHub and CareFind.
3. Supabase notices for password changes, email changes, phone changes, identity links, identity removals, multi factor enrollment, multi factor removal, and reauthentication.
4. CareHub registration received.
5. CareHub admin new registration alert.
6. CareHub business approval, rejection, suspension, reactivation, and revocation messages.

Later approved groups will include:

1. Professional verification decisions.
2. Business claim decisions.
3. Staff claim decisions.
4. Staff invitation, role change, and deactivation.
5. Referral agent approval and rejection.
6. Booking confirmations and changes.
7. Order confirmations and status changes.
8. Payment confirmations.
9. Appointment confirmations, changes, completion, and cancellation.
10. Subscription purchase, renewal, expiry, and failed renewal.
11. Withdrawal submission, decision, and settlement.
12. Return request and decision.
13. Vendor new order notice.
14. Saved product back in stock notice.

Each later group receives its own tests, canary checks, and rollout approval. A group will not be enabled merely because its template exists.

## Data Contract

The outbox will gain or formalize these fields:

1. `app` with only `carehub` or `carefind`.
2. `event_key` with a unique value for the business event. Repeatable events also include the source version or scheduled occurrence.
3. `template_key` selected from the event catalog.
4. `to_email`, `from_email`, `reply_to`, `subject`, and `payload`.
5. `status`, `attempts`, `max_attempts`, and `next_retry_at`.
6. `claimed_at`, `claim_token`, and `claim_expires_at`.
7. `provider_id`, `accepted_at`, `delivered_at`, `bounced_at`, `complained_at`, `failed_at`, and `dead_at`.
8. `last_error`, `created_at`, and `updated_at`.

The supported status values will be `pending`, `processing`, `accepted`, `delivered`, `bounced`, `complained`, `failed`, and `dead`.

`accepted` means Resend accepted the request. It does not mean the message reached the inbox. Only a verified Resend delivery event may set `delivered`.

`email_logs` will remain append only. Each state change will record the outbox id, event type, safe detail, timestamp, and safe metadata. Logs will not contain passwords, action links, tokens, webhook secrets, full recipient addresses, or full request bodies.

A new `email_provider_events` table will store each verified Resend event before it changes an outbox row. Its provider event id will be unique. This protects against duplicate webhook delivery and allows an event that arrived before the provider id link to be applied later.

Raw Auth action links may exist only in the protected outbox payload while the message is waiting or retrying. The payload will be cleared as soon as the message reaches a final state. A scheduled cleanup will clear any leftover Auth payload after twenty four hours. Dead Auth jobs will not be replayed because their links may be stale. The user must request a new message.

Terminal outbox rows and provider event records will be removed after thirty days. Email logs that contain only safe metadata will be removed after ninety days. When an incident is documented, cleanup will be paused for the affected records until the incident is closed.

## Reliable Write Boundary

A business change and its email job must be written in one database transaction. If either write fails, the transaction rolls back. The caller may retry with the same event key, and the database function must return the original result instead of applying the business change twice.

Database triggers may enqueue mail when the source table and event can be expressed safely in Postgres. Server routes will use matching database functions for important actions such as registration, account status changes, payment settlement, and order status changes.

A browser will not perform a successful business write and then depend on a separate best effort request for mail. This prevents the current gap where a status change succeeds but the mail request fails.

## Queue Processing

The worker will use a short numbered process:

1. Select due rows with a database lease.
2. Mark selected rows as `processing` with a unique claim token.
3. Render the template using the row's app brand.
4. Send through Resend with the outbox `event_key` as Resend's duplicate send key.
5. Store the Resend message id and mark the row `accepted`.
6. Release the claim.

A crashed worker leaves a claim that expires. Another worker can then retry the row. Resend's duplicate send key protects against a second send when the first request succeeded but the database update did not.

Retry delays will increase after each failed attempt. The final failed state will be `dead`, with a safe error summary and an alert. A dead job will not retry automatically. Only a platform administrator may use the replay action, which records an audit entry and returns the row to `pending` with the same `event_key`.

An unknown template or invalid payload will fail before provider contact. Empty HTML will never be sent.

Open tracking will not be enabled. It is unreliable, adds privacy risk, and does not prove inbox delivery.

## Provider Events

The Resend webhook will verify the raw request first, then store the provider event in `email_provider_events`. Repeated delivery of the same provider event id will be accepted without applying the state change twice.

If the event matches a stored `provider_id`, the webhook will update the outbox row and any pending logs. If the event arrives before the worker stores the provider id, the event remains unprocessed. A short reconciliation pass will apply it after the id is linked.

Delivery, bounce, and complaint events are terminal for tracking purposes. A later duplicate event cannot move a terminal row back to accepted or failed.

## Auth Email Hook

The Supabase Send Email hook will use the official token hash and redirect URL flow. It will support signup, recovery, invitation, magic link, secure email change, and security notices.

For secure email change, the hook will follow Supabase's documented recipient and token mapping. It will not guess based on field names.

The hook will enqueue first and return success only after the outbox write succeeds. It will not report that an inbox received mail.

The Auth event key will be derived from the app, Auth action, user id, and a SHA256 hash of the action token hash. The raw token and token hash will not be stored. If Supabase calls the hook again for the same action, the unique event key will return the existing outbox row instead of creating another message.

The hook endpoint will accept only requests with a valid Supabase standard webhook signature. Supabase calls this hook without a user session, so the function will not use a user JWT as its authority. Missing or invalid hook secrets will fail closed.

The existing custom `admin.generateLink` auth email API routes will be removed after the hook is active and proven, so one action cannot create two messages.

Clients will use the normal Supabase Auth methods for signup and recovery. The user interface will keep generic responses and will not reveal whether an account exists. Supabase and edge rate limits will apply to verification and recovery requests.

## Template And Brand Design

Brand configuration will be explicit and centralized.

CareHub brand values will use the `carefindhub.com` app domain, CareHub logo, CareHub sender, CareHub support address, and CareHub links.

CareFind brand values will use the `carefind.app` app domain, CareFind logo, CareFind sender, CareFind support address, and CareFind links.

Every template will receive both the brand and safe payload as inputs. The shared worker will not read `APP_URL` to decide which app owns a queued message.

Every template must provide:

1. A short hidden preview line.
2. A subject that starts with `CareHub` or `CareFind`.
3. The existing full wordmark PNG at 240 pixels wide, with height calculated from the source ratio and a text alternative.
4. A maximum content width of 600 pixels.
5. Table based layout and inline styles.
6. A plain text version.
7. Text contrast of at least 4.5 to 1 and clearly visible links.
8. No scripts, external style files, or SVG logo dependency.
9. No reliance on emoji for meaning.
10. Correct app name, domain, support address, sender, logo, and action links.
11. No patient name, diagnosis, prescription, test result, medical image, or other clinical detail.

Messages that concern a patient will use a generic notice and direct the recipient to the signed in app for details. Subject lines and sender information must not reveal a patient or health condition.

Template tests will scan output for the expected brand and fail if the other app's name, domain, logo, sender, support address, link, or clinical field appears.

Logo files will be served over public HTTPS from the canonical app domains. Asset checks will confirm a successful response, the expected image type, a nonzero size, the source dimensions, and the 240 pixel proportional email size. The renderer will not force the wordmark into a square.

## Error Handling

User facing auth requests will use safe generic language. Internal records will distinguish queue failure, provider rejection, bounce, complaint, and successful delivery.

Business actions will not be undone because a later provider call fails. The durable queue will hold the message for retry or mark it dead for investigation.

The application will never use `sent: true` merely because a queue write returned. Internal success means an outbox row exists. Delivery means a verified provider event says delivered.

Health checks will report:

1. Oldest waiting message age.
2. Pending, processing, failed, and dead counts.
3. Last successful worker run.
4. Queue growth rate.
5. Provider acceptance failures.
6. Delivery, bounce, and complaint rates.
7. Messages stuck with expired claims.
8. Missing or invalid production configuration.

## Security

The `email_outbox`, `email_logs`, `email_provider_events`, and `email_templates` tables remain service role only. RLS stays enabled with no public policies.

Only platform administrators may list outbox rows, inspect safe delivery metadata, return dead rows to `pending`, or run the worker manually. Recipient addresses will be masked in admin screens and logs. There will be no public template preview or public test sender. Ordinary authenticated users cannot impersonate platform mail.

Cron routes will accept GET and POST. They will require an exact `Bearer` value matching `CRON_SECRET`. Missing configuration will fail closed.

Resend webhooks will verify the Svix signature against the raw request body before parsing or updating state. The webhook secret must exist in production.

The event catalog will validate recipients, template names, app names, redirect hosts, and payload fields. Callers cannot submit raw HTML.

All template values will be escaped for their correct context. Links will use allowlisted HTTPS origins.

Service role keys, Resend keys, cron secrets, and webhook secrets remain server only. No secret will enter a Vite bundle, log, database payload, or client response.

Resend receives only the recipient address, sender identity, subject, and rendered content needed for delivery. Clinical details and patient identifiers are forbidden. Open tracking is disabled. The privacy notice and operational guide will name Resend as the delivery processor.

The public test mail path will be removed. This design does not include a replacement test sender.

## Testing Strategy

The first release will use tests at several levels.

1. Pure unit tests will cover brand values, event catalog validation, subjects, text output, HTML output, unsafe values, and forbidden clinical fields.
2. Shared queue tests will cover enqueue, atomic claim, lease expiry, retry, dead state, provider idempotency, payload clearing, retention, and concurrent workers.
3. Auth hook tests will cover every supported Auth action, deterministic retry keys, token URL creation, approved redirect hosts, secure email change, rate limits, signature failures, and safe failures.
4. Route tests will cover successful business actions, failed queue writes, generic auth responses, and absence of false success claims.
5. Database tests will prove service role access, tenant safety, unique event keys, trigger behavior, and correct app values.
6. Webhook tests will cover valid signatures, invalid signatures, repeated events, events received before provider id linking, delivery, bounce, and complaint events.
7. End to end tests will cover CareFind signup and recovery plus CareHub registration and business review decisions.
8. Build checks will confirm that privileged values and server modules are absent from client bundles.

After automated checks pass, both apps will be tested with real accounts in Gmail and Outlook on web and mobile. The test matrix will include verification, recovery, registration, one important activity message, sender identity, logo rendering, links, plain text display, retry behavior, and failure reporting.

Supabase security and performance advisors will run after every schema change. Any new finding must be reviewed before rollout.

## Rollout

1. Verify `carefindhub.com` and `carefind.app` in Resend and complete DNS checks.
2. Deploy the new queue schema without enabling new event groups.
3. Deploy the shared worker and verified Resend webhook while mail volume remains controlled.
4. Deploy the Supabase Auth hook with its Auth hook status disabled, run signed fixture tests, then enable it and verify one message for every supported Auth action.
5. Enable CareFind verification and recovery for internal test accounts.
6. Enable CareHub registration and review messages for internal test accounts.
7. Run the real inbox matrix in Gmail and Outlook on web and mobile.
8. Enable eight canary recipients, with two Gmail accounts and two Outlook accounts for each app, then observe queue health and provider events for twenty four hours.
9. Enable the first approved users.
10. Add later activity groups one at a time with the same proof standard.

A failed canary stops that group. Existing business data and authentication are not rolled back. The event group is disabled while queued work is inspected and retried safely.

## Delivery Groups

Phase 1 repairs the shared foundation and covers Auth, registration, and business review messages.

Phase 2 adds professional, business claim, staff claim, staff lifecycle, and referral decisions.

Phase 3 adds bookings, orders, payments, appointments, subscriptions, withdrawals, returns, vendor notices, and saved stock alerts.

Phase 4 is outside this design. Optional preferences and scheduled reminders require a later approved design after the transactional system has stable delivery data.

## Acceptance Criteria

The design is complete when all of the following are true:

1. An approved business action and its email job are recorded together or neither is recorded.
2. Each outbox row has an explicit app and unique event key.
3. Concurrent workers cannot send the same row more than once.
4. Resend acceptance and inbox delivery are separate recorded states.
5. Delivery, bounce, and complaint events update the correct row.
6. Supabase Auth produces exactly one branded message for each action.
7. CareHub messages never use CareFind branding and CareFind messages never use CareHub branding.
8. CareHub links and sending identity use `carefindhub.com`.
9. CareFind links and sending identity use `carefind.app`.
10. Logos remain readable in Gmail and Outlook on web and mobile.
11. Missing configuration and provider failure are visible and never reported as successful delivery.
12. Public users cannot read the outbox, choose arbitrary templates, send to arbitrary recipients, or process the queue.
13. Automated tests, builds, database checks, and real inbox checks pass before each wider rollout.
14. Operations documentation explains domain setup, environment values, queue recovery, dead jobs, webhook setup, and safe replay.
15. A new enabled message begins processing within sixty seconds under normal operation.
16. Duplicate and out of order provider events cannot duplicate mail or reverse a terminal state.
17. Raw Auth links are removed from stored payloads within the stated cleanup window.
18. No email, subject, sender, or log contains patient identifiers or clinical details.

## Security Implications

This design reduces duplicate mail, mail loss, sender spoofing, recipient disclosure, arbitrary mail abuse, incorrect account links, and accidental clinical data exposure. It adds a privileged Auth hook, a durable worker, provider event storage, and a third party delivery processor, so each requires restricted secrets, exact signature checks, service role isolation, short payload retention, append only logs, and tested recovery procedures. The new design does not weaken Supabase Auth, RLS, or tenant boundaries.
