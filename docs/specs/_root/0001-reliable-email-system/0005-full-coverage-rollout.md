# 0005. Full Coverage Rollout

## Summary

Every user operation that should produce an email produces one, and every produced email is
governed by the database catalog rather than by hardcoded call sites. New mail is proven in a
canary inbox before any real customer receives it, and the entire system can be stopped with one
setting.

This child does not replace the catalog authority established in 0001. It closes the gap between
the catalog (25 events, fully described) and the application code (1 event wired, 10 producers
bypassing the catalog, 10 operations with no mail at all).

## Evidence

Audit performed against project `szdybxmgmhndoytqanfb` on 2026-09-28.

1. Only 1 of 25 catalog events has a live producer. `trg_shop_order_status_history_email` is the
   single catalog-driven path. The other 24 events have no trigger and no code caller, so flipping
   `enabled` would change nothing.
2. 10 producers call `EmailService.enqueue` directly and bypass the catalog entirely. For these,
   `enabled = false` provides no protection. The catalog reads as a kill switch but is not one.
3. `apps/carefind/api/cron/check-subscription-expiry.js` inserts into `email_outbox` with raw SQL
   and omits `app` and `event_key`. `guard_email_outbox_quarantine` therefore sets
   `quarantine_reason = 'legacy_mapping_unproven'` and `next_retry_at = 'infinity'`. Every row this
   cron produces is silently undeliverable. This is the only raw outbox writer outside the service.
4. The same file defaults `from_email` to `support@mail.carefind.app`, which is not a verified
   Resend sender.
5. Encoding corruption is confined to three files. `apps/carefind/api/_handlers/paystack-webhook.js`
   holds 15 U+FFFD replacement characters, `charge-subscription.js` holds 2 and
   `verify-subscription-payment.js` holds 2, where emoji and arrows were destroyed by a bad decode.
   One of these is in a subject string (`paystack-webhook.js:80`) and several are in in-app
   notification bodies, so customers see the garbage directly. Verified by scanning every `.js`
   and `.jsx` under `apps/` and `packages/` for U+FFFD.
   `notify-registration.js` and `notify-business-status.js` were initially suspected but contain no
   U+FFFD; the odd characters there are correctly encoded em-dashes that a terminal misrendered.
   The scan is now pinned by `deliveryContracts.test.js`.
6. The same handler's `allowed` list omits `revoked`, so `business_revoked` and
   `business_reactivated` are unreachable. Both also lack a template in
   `packages/shared-email/src/templates/`.
7. `email_system_settings.dispatch_paused` exists in the schema and is described in three
   specifications, but no code reads it. The documented rollback lever is not implemented.
8. `processBatch` selects pending rows without claiming them. Two workers are configured against
   one outbox table (`carehub` at 00:00 and `carefind` at 02:00 daily), and `claim_token`,
   `claimed_at` and `claim_expires_at` are never written, so a row can be sent twice.
9. Both outbox crons run once daily while the retry backoff begins at 60 seconds. The retry
   schedule and the dispatch cadence cannot both be honoured.
10. Three email service implementations exist: `packages/shared-email/src/EmailService.js`,
    `apps/carehub/src/lib/emailService.js` and `apps/carefind/api/_lib/emailService.js`.
    The `enqueueOutbox` identifier used by 8 CareFind call sites is only an import alias of the same
    `enqueue` function, not a fourth implementation, so the duplication is 3 copies rather than
    4 entry points.
11. `packages/shared-email/src/templates/index.js` line 55 falls back to the merged registry when an
    app-specific template is missing, and the merged registry prefers CareFind. A CareHub event with
    no CareHub template would render CareFind branding without erroring.
12. `email_templates` is empty and unused. Templates exist only in code.
13. `apps/carehub/src/lib/email.js` and `apps/carefind/src/lib/emailSequences.js` are not imported
    anywhere. The former emits `credit_reminder`, `agent_approved` and `agent_rejected`, none of
    which exist in the template registry or the catalog.
14. 10 user operations complete with no email and no error: shop return requested, withdrawal
    initiated, booking interest submitted, appointment cancelled, CareHub staff invited, CareHub
    subscription expiring, agent approved, agent rejected, credit reminder, and CareFind password
    reset (the endpoint works but no request UI exists).
15. One account is registered as `gmail,com` (comma) and is permanently undeliverable.
16. The catalog's brand check requires a subject to begin `CareHub:` or `CareFind:`, but all 9
    producers supply their own subject at the call site and not one of them complies. Real subjects
    are `Your appointment is confirmed`, `Order Confirmed - <ref>`, `You're subscribed to ...`. So
    the brand constraint is currently 0% enforced in production, and the catalog's
    `subject_template` is dead metadata. Pinned by `deliveryContracts.test.js`.
17. `enqueue_business_email_event` returned `null` with no error and no record when an event was
    disabled or paused and was not `required_for_business`. A producer on the catalog would have
    read that as success, so a customer would silently receive nothing. Fixed in batch 1: a
    `suppressed` row is now written to `email_logs` and the return contract is unchanged.
18. `email_logs.event_type` is CHECK constrained to a fixed list with no value meaning "deliberately
    not queued". `'failed'` was rejected as a substitute because it already means "send attempted
    and did not succeed". `'suppressed'` was added to the constraint.
19. The canary `is_canary` stamp is verified by unit test and by reading the applied function, but
    has not been exercised end to end against the database. Doing so requires enabling an event,
    which the dark rollout forbids. Deferred to batch 5, deliberately.

## Requirements

1. **AC-5-1**: Every enqueue path resolves through the catalog, and no code outside the email
   service inserts into `email_outbox`.
2. **AC-5-2**: Each catalog event carries a rollout state of `live`, `canary` or `paused`. A
   `paused` event produces no mail. A `canary` event produces a real rendered message addressed to
   the canary recipient with sensitive payload values redacted.
3. **AC-5-3**: A canary row whose canary recipient is unset fails closed. It is never delivered to
   the real recipient.
4. **AC-5-4**: Setting `dispatch_paused` to true stops the worker from claiming or sending while
   business writes continue to enqueue.
5. **AC-5-5**: A row is claimed atomically. Two concurrent workers never send the same row.
6. **AC-5-6**: Template resolution fails closed. A missing template for an app marks the row failed
   with a diagnostic instead of falling back to the other app's branding.
7. **AC-5-7**: Subjects and sender addresses come from the catalog, never from the call site.
8. **AC-5-8**: Retry honours the row's own `max_attempts`.
9. **AC-5-9**: The worker runs at a cadence consistent with the retry backoff.
10. **AC-5-10**: A repeated producer call for the same source produces exactly one outbox row.
11. **AC-5-11**: Events already delivering to real users today continue to deliver. Rollout changes
    must not regress a working path.
12. **AC-5-12**: Each of the 10 silent operations in evidence item 14 has a catalog event, a
    template, a payload schema and a producer, or is explicitly deferred with a recorded reason.

## Decision

Govern every producer with `enqueue_business_email_event`, which already validates the catalog,
enforces the payload schema, renders the subject from the catalog, stamps `app` and `event_key`,
and deduplicates on `(app, event_key, source_id)`. It is executable only by `service_role`;
`anon` and `authenticated` have no execute privilege.

Rollout state is per event rather than global. A single global canary recipient would redirect
password reset and verification mail, which carry live single use tokens, away from the real users
who receive them correctly today. That would trade a working flow for a test one. Events that work
today move to `live`; every new producer starts at `canary`.

Transactional producers move to the catalog now. Moving producers into business write transactions
deferred to 0003, because that changes business write paths and should not share a change with a
delivery fix.

## Feature Design

### Data Model

1. `email_event_catalog`
   1. Add `rollout_mode text not null default 'paused'`.
   2. Add a check constraint limiting it to `live`, `canary`, `paused`.
   3. `enabled` is retained. A disabled event remains a hard block, so `rollout_mode` cannot
      re-enable something deliberately switched off.
   4. Every existing event is set to `live` so no currently working path regresses.
2. `email_outbox`
   1. Add `is_canary boolean not null default false`.
   2. Existing rows are `false`.
3. `email_system_settings`
   1. Add `canary_recipient`. A validated email address, writable only through the platform
      administrator settings function.
   2. `dispatch_paused` is already present and becomes enforced.
4. No table stores a rendered message body. Payloads remain in the protected outbox only.

### Enqueue Path

1. `enqueue_business_email_event` is extended to read `rollout_mode`.
2. `paused` behaves exactly as `enabled = false` does today: return null when the event is not
   required, raise when it is.
3. `canary` inserts the row with `is_canary = true`. The outbox records the real recipient so the
   audit trail is truthful, and the row is never sent to that address.
4. Auth category events continue to be rejected, because they use the separate path in
   `auth-email.js` and carry tokens.
5. `source_id` is required by the function and is the deduplication key. Each producer supplies a
   stable value: a payment reference, an outbox of the business status transition, a booking id, or
   a business id combined with the day for expiry notices.

### Worker

1. `processBatch` returns immediately when `dispatch_paused` is true, without claiming.
2. Claiming sets `claim_token`, `claimed_at` and `claim_expires_at`. A claim that has expired may be
   taken by another worker. Only the claim holder may send.
3. Retry uses the row's `max_attempts` rather than a service constant.
4. For a canary row, `to_email` is replaced with `canary_recipient` immediately before the provider
   call. If `canary_recipient` is unset or invalid, the row is marked failed with
   `canary_recipient_unset`. It is never delivered to the real recipient.
5. For a canary row, payload keys matching `link`, `token`, `otp`, `secret` or `password` are
   replaced with `[redacted]` before rendering, so no usable token reaches the canary inbox.
6. The real recipient, event key and source id remain on the row for audit.

### Templates

1. Remove the cross app fallback in `templates/index.js`. A key missing for an app returns null.
2. A null template marks the row failed with the app and key in the error, instead of silently
   rendering the other app's branding.
3. `business_reactivated` and `business_revoked` are implemented if the review path can reach those
   statuses, and are otherwise removed from the catalog with a recorded reason rather than left
   unreachable.
4. `email_templates` is documented as reserved. It is not populated, because templates are code.

### Single Service

1. `apps/carehub/src/lib/emailService.js` and `apps/carefind/api/_lib/emailService.js` become thin
   re-export shims over `packages/shared-email`. The CareHub shim keeps its lazy client proxy so the
   module scope import safety test continues to pass.
2. `apps/carehub/src/lib/email.js` and `apps/carefind/src/lib/emailSequences.js` are deleted as
   unreferenced. Git retains them.

### Scheduler

1. The worker runs on Supabase Cron at one minute cadence, which the catalog already assumes and
   which the sixty second backoff requires.
2. The Vercel daily crons are retained as a retry fallback during the transition and removed only
   after the new cadence is proven.

### Silent Operations

Each operation in evidence item 14 gains a catalog event, a code template, a payload schema, a
`source_id` strategy and a producer, and starts in `canary`.

Transactional and non token bearing operations are done first. CareHub staff welcome carries a
setup token and is canaried with that field redacted. The CareFind password reset request UI is
built last because it depends on the redirect allowlist fix in Out of Scope.

## Batches

The change is landed in five independently shippable batches. Each one is deployable and
reversible on its own, and no batch leaves the system without a working off switch.

1. **Off switch and safety.** `rollout_mode`, `is_canary`, `canary_recipient`, enforced
   `dispatch_paused`, fail closed template resolution, the `suppressed` audit record, and the
   three static guard tests. Nothing user visible changes. This batch is the prerequisite for
   trusting any later batch.
   **Landed 2026-09-28.** `dispatch_paused` is now read once per batch and short circuits before
   any claim, so a pause is loud (`{ paused: true }`) and the queue is left intact for resume. A
   canary row with no `canary_recipient` fails closed rather than falling through to its real
   recipient. `redactPayload` strips `link|token|otp|secret|password` keys at any depth for canary
   renders while leaving the stored payload intact. `getTemplate` returns `null` instead of
   borrowing from the other app, and the worker marks such a row `no_template:<app>:<key>` rather
   than sending an empty body. All 25 events remain `enabled = false`, so the batch changed no
   user visible behaviour.
2. **Single service and worker correctness.** Shims, dead code removal, atomic claiming, per row
   `max_attempts`, and the one minute Supabase Cron cadence.
3. **Producers onto the catalog.** The 10 existing direct enqueue call sites, plus
   `check-subscription-expiry`, which stops writing raw SQL. This batch removes evidence items 3, 4,
   5, 6, 7 and 16 because subjects come from the catalog and the review path is no longer hand
   written. **A producer must treat a `null` return from `enqueue_business_email_event` as a hard
   failure**, not as success: `null` means the event is dark, and the matching `suppressed` row in
   `email_logs` is the only trace. A producer that ignores the return is the silent non-delivery
   this design exists to prevent.
4. **New producers.** The 10 silent operations, each landing in `canary`, transactional first.
5. **Enablement.** Per event promotion from `canary` to `live`, beginning with non token bearing
   transactional events.

Batches 1 to 3 are correctness and safety work and are not optional. Batch 4 can be split further
per operation. Batch 5 is a sequence of one line catalog changes, each reviewed against the
canary baseline.

## Rollout

1. All code lands with every new event in `canary` and every previously working event in `live`.
2. `canary_recipient` is set to a reserved address to prove the pipeline without real delivery.
3. Each template is reviewed in a real inbox after the address is changed to one the platform
   controls.
4. Non token bearing events move to `live` per event, in batches, with the canary as the comparison
   baseline.
5. Token bearing auth mail is enabled last, after the redirect allowlist is corrected.

## Rollback

1. Set `dispatch_paused` to true. Claiming and sending stop. Business writes keep enqueueing.
2. Move an offending event from `live` to `paused`. Its rows stop being produced; existing rows are
   released by the operations view rather than by deleting them.
3. Resume only after provider, scheduler and queue health checks pass.

## Testing

1. A static guard asserts that no file outside the email service inserts into `email_outbox`. This
   is the test that would have caught evidence item 3 on the day it was written.
2. A static guard asserts no producer passes a subject, matching AC-5-7.
3. Each producer test asserts the catalog call carries a payload that satisfies the real schema and
   a non null `source_id`.
4. A database test asserts a schema mismatched payload raises `payload_schema_mismatch`.
5. Worker tests cover: pause stops claiming; a claim is exclusive; a canary row is addressed to the
   canary recipient; a canary row with no recipient fails closed; a canary row redacts a token;
   retry respects `max_attempts`.
6. A template test asserts a missing app template returns null and fails the row.
7. An idempotency test asserts two calls with the same source produce one row.
8. A live proof runs the pipeline against the reserved address, asserts the outbox reaches `sent`
   with a provider id, and asserts the real recipient never appears in any delivered row.

## Out of Scope

1. The Supabase redirect allowlist does not include `https://carefindhub.com/**`, so a CareHub
   recovery link is rewritten to the project Site URL. This needs a dashboard change or a
   Management API token that is not in the repository. The CareFind password reset UI is blocked
   behind it.
2. Correcting the `gmail,com` account requires the account holder. Signup domain validation should
   be added separately so the typo cannot recur.
3. Moving producers into business write transactions is 0003.
4. The Supabase Send Email hook and trusted app membership are 0002.
5. Private Deno Edge Functions replace the Vercel handlers in a later phase of 0001.

## Consequences

**Positive**

1. `enabled` and `rollout_mode` finally govern all mail, so a bad template has a per event and a
   global off switch.
2. Subject and sender stop being call site trivia; the catalog is the single authority.
3. Idempotency removes the double email risk on retried webhooks.
4. One service means one place where a delivery bug can exist.
5. Ten operations that currently notify nobody become observable.

**Negative**

1. Every producer needs a payload schema and a `source_id`, which is real work on the payment and
   webhook paths.
2. A canary proves rendering, subject, branding and delivery. It does not prove that an action link
   works, because tokens are redacted. Link correctness is proven by the Auth tests and by the live
   proof recorded for 0004.
3. Two workers on one table become a correctness concern the moment cadence is raised from daily to
   minute, so claiming is not optional.
