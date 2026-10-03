-- Drive the email outbox every minute from Postgres instead of once a day from
-- Vercel.
--
-- Why: the worker's backoff is this.baseDelayMs * 2^(attempts-1), whose base is
-- 60s. A retry scheduled for 60 seconds from now could not be picked up for up
-- to 24 hours, because both vercel.json files scheduled
-- /api/cron/process-email-outbox daily (carehub "0 0 * * *", carefind
-- "0 2 * * *"). A single transient Resend rejection therefore stretched a
-- designed 60 second retry into a day. Moving the schedule to every minute
-- makes the configured backoff and the actual retry cadence agree.
--
-- Both apps are scheduled. They drain the same shared email_outbox table, and
-- processBatch() now takes an exclusive claim per row, so two workers racing
-- over the same backlog is safe. The redundancy is the point: if one
-- deployment is down or wedged, the other still moves the queue.
--
-- Secrets are never stored in this file or in the repository. The URLs and the
-- bearer token are read from Supabase Vault at call time, so this migration
-- contains no credentials and applying it cannot leak one through history.
--
-- Required Vault secrets (create them locally, they are deliberately absent
-- here):
--   email_outbox_cron_carehub_url   full https URL of carehub's /api/cron/process-email-outbox
--   email_outbox_cron_carefind_url  full https URL of carefind's /api/cron/process-email-outbox
--   email_outbox_cron_secret        the CRON_SECRET both deployments expect
--
-- The job raises rather than silently doing nothing when configuration is
-- missing. A delivery system that quietly stops dispatching is the failure mode
-- this whole design exists to prevent, and cron.job_run_details records each
-- run either way.

-- pg_cron manages its own `cron` schema and is not relocatable, so it is
-- created without a schema clause. pg_net belongs in `extensions`, which is
-- where the rest of this project's extensions live.
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

-- Read one secret by name. Returns NULL rather than raising so the caller can
-- produce a message that names the missing key.
create or replace function public.vault_secret(p_name text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select decrypted_secret
  from vault.decrypted_secrets
  where name = p_name
  limit 1;
$$;

comment on function public.vault_secret(text) is
  'Reads a Supabase Vault secret by name, or NULL when absent. Used by the outbox cron dispatcher.';

revoke all on function public.vault_secret(text) from public, anon, authenticated;

create or replace function public.dispatch_email_outbox_cron(p_target text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url_key text;
  v_url     text;
  v_secret  text;
  v_request_id bigint;
begin
  if p_target not in ('carehub', 'carefind') then
    raise exception 'dispatch_email_outbox_cron: unknown target %', p_target;
  end if;

  v_url_key := 'email_outbox_cron_' || p_target || '_url';

  v_url := public.vault_secret(v_url_key);
  if v_url is null or v_url = '' then
    raise exception 'dispatch_email_outbox_cron: Vault secret % is not set, so the % outbox is not being drained', v_url_key, p_target;
  end if;

  v_secret := public.vault_secret('email_outbox_cron_secret');
  if v_secret is null or v_secret = '' then
    raise exception 'dispatch_email_outbox_cron: Vault secret email_outbox_cron_secret is not set, so the % outbox is not being drained', p_target;
  end if;

  -- The handler compares the bearer token to CRON_SECRET. pg_net returns the
  -- request id asynchronously; the response lands in net._http_response, and
  -- every run is recorded in cron.job_run_details.
  select net.http_get(
    url     := v_url,
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || v_secret
    )
  )
  into v_request_id;

  raise notice 'dispatch_email_outbox_cron: % dispatched, pg_net request id %', p_target, v_request_id;
end;
$$;

comment on function public.dispatch_email_outbox_cron(text) is
  'Triggers one deployment''s process-email-outbox endpoint over pg_net. Raises if Vault config is missing so a misconfiguration is loud rather than silent.';

revoke all on function public.dispatch_email_outbox_cron(text) from public, anon, authenticated;

-- One job per deployment, so each is observable and fails independently.
-- The inner command string uses a $cron$ tag rather than $$, because $$ nested
-- inside this do $$ block would close the outer dollar quote mid-statement and
-- fail to parse.
-- pg_cron.schedule is idempotent when a job of the same name exists: it
-- replaces the existing entry rather than adding a second one, which keeps this
-- migration safe to re-apply.
do $$
begin
  if not exists (select 1 from cron.job where jobname = 'email-outbox-carehub') then
    perform cron.schedule('email-outbox-carehub', '* * * * *',
      $cron$select public.dispatch_email_outbox_cron('carehub')$cron$);
  end if;

  if not exists (select 1 from cron.job where jobname = 'email-outbox-carefind') then
    perform cron.schedule('email-outbox-carefind', '* * * * *',
      $cron$select public.dispatch_email_outbox_cron('carefind')$cron$);
  end if;
end;
$$;
