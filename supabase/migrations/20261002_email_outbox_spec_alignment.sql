-- Migration: email_outbox spec alignment (2026-10-02)
--
-- PURPOSE
-- Formalize the durable email outbox columns the production email
-- architecture requires, without breaking the shared-email worker, which
-- already depends on: id, to_email, from_email, subject, template_key,
-- payload, status, attempts, max_attempts, last_error, provider_id,
-- next_retry_at, app, event_key, reply_to, claim_token, claimed_at,
-- claim_expires_at, accepted_at/delivered_at/failed_at/dead_at,
-- quarantine_reason, payload_schema_snapshot, source_id, is_canary.
--
-- ADDED
--   recipient_name        display name for the recipient (optional)
--   entity_type           owning aggregate, e.g. 'business', 'appointment'
--   entity_id             owning aggregate id
--   scheduled_at          first-send time; mirrors next_retry_at
--   provider_message_id   Resend message id; mirrors provider_id
--
-- STATUS LIFECYCLE (replaces the old narrower check)
--   pending -> processing -> sent
--                        -> failed -> retrying -> pending (with backoff via
--                            next_retry_at) -> dead | cancelled
--   bounced/complained kept from the previous constraint for webhook use.
--
-- IDEMPOTENCY
--   The live uniqueness contract remains UNIQUE(app, event_key, source_id)
--   (email_outbox_app_event_source_unique). New producers must set
--   (app, event_key, source_id) deterministically so a retry of the same
--   business event cannot enqueue a second email.
--
-- SECURITY
--   RLS stays enabled with ZERO public policies (verified: pg_policies
--   count = 0). Only the service role (server-side API handlers and the
--   shared-email worker) can read or write these rows. Browser clients can
--   enqueue no rows directly; business code enqueues through trusted
--   server handlers.
--
-- RETRY METADATA
--   attempts, max_attempts, next_retry_at, last_error, claim_expires_at
--   already model exponential backoff and lease expiry; no schema change
--   required. The worker (not this migration) computes backoff.
--
-- NOTE: no existing business table was modified.

alter table public.email_outbox
  add column if not exists recipient_name text,
  add column if not exists entity_type text,
  add column if not exists entity_id uuid,
  add column if not exists scheduled_at timestamptz not null default now(),
  add column if not exists provider_message_id text;

update public.email_outbox set scheduled_at = next_retry_at where scheduled_at is null;
update public.email_outbox set provider_message_id = provider_id where provider_message_id is null;

alter table public.email_outbox drop constraint if exists email_outbox_status_check;
alter table public.email_outbox add constraint email_outbox_status_check
  check (status in ('pending','processing','retrying','sent','failed','bounced','complained','dead','cancelled'));

create index if not exists idx_outbox_status_scheduled on public.email_outbox(status, scheduled_at);
create index if not exists idx_outbox_entity on public.email_outbox(entity_type, entity_id) where entity_id is not null;
create index if not exists idx_outbox_provider_message on public.email_outbox(provider_message_id) where provider_message_id is not null;
