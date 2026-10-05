-- Phase 11 follow-up (owner decisions 2026-10-05: email alerts, an admin screen, a sensible cadence) and the groundwork for Phase 12.
--
--   * Alerts: a CRITICAL finding is emailed to the platform admins once, then reminded every 24 hours while it stays open and
--     unacknowledged (acknowledging a finding silences the reminders). claim_findings_to_alert() hands each finding to exactly one
--     caller and stamps it; if the email cannot be queued, release_finding_alerts() puts the claim back so the next pass retries.
--   * Cadence: the CareFind cron endpoint is driven EVERY MINUTE by Supabase Cron (not daily: see carefind_20260928_email_outbox_cron),
--     so the reconciliation pass must not call Paystack every minute. claim_job_slot(job, minutes) is an atomic "is this job due?"
--     gate shared by every instance.
--   * Sweep backoff: an open payment attempt is re-checked with Paystack every 10 minutes in its first hour, hourly in its first
--     day, then twice a day (payment_intent_checks), instead of every minute for a week.

do $$
begin
  if to_regclass('public.reconciliation_findings') is null then raise exception 'apply carefind_20261014_reconciliation first'; end if;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Alerts
-- ---------------------------------------------------------------------------------------------
alter table public.reconciliation_findings add column alerted_at timestamptz;

-- alerted_at is bookkeeping, not identity: the guard already allows every non-identity column.

create or replace function public.claim_findings_to_alert(p_remind_hours integer default 24, p_limit integer default 100)
returns setof public.reconciliation_findings
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  return query
  with due as (
    select f.id
      from public.reconciliation_findings f
     where f.severity = 'critical' and f.status = 'open'
       and (f.alerted_at is null or f.alerted_at < now() - make_interval(hours => greatest(1, coalesce(p_remind_hours, 24))))
     order by f.first_seen_at
     limit greatest(1, least(coalesce(p_limit, 100), 500))
     for update skip locked)
  update public.reconciliation_findings f
     set alerted_at = now()
    from due
   where f.id = due.id
  returning f.*;
end;
$$;

-- the email could not be queued: the findings were not alerted after all
create or replace function public.release_finding_alerts(p_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_n integer;
begin
  update public.reconciliation_findings set alerted_at = null where id = any (p_ids);
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Job gate: true for exactly ONE caller per interval, however many instances call at once
-- ---------------------------------------------------------------------------------------------
create table public.job_slots (
  job              text primary key,
  last_started_at  timestamptz not null
);
comment on table public.job_slots is 'When each scheduled job last started. Written only by claim_job_slot. Server-only.';
alter table public.job_slots enable row level security;
revoke all on table public.job_slots from public, anon, authenticated, service_role;

create or replace function public.claim_job_slot(p_job text, p_min_minutes integer)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_got boolean;
begin
  if p_job is null or p_job !~ '^[a-z][a-z0-9_:]{1,60}$' then raise exception 'invalid job name'; end if;
  if p_min_minutes is null or p_min_minutes < 0 then raise exception 'invalid interval'; end if;
  insert into public.job_slots (job, last_started_at) values (p_job, now())
  on conflict (job) do update set last_started_at = now()
   where public.job_slots.last_started_at <= now() - make_interval(mins => p_min_minutes)
  returning true into v_got;
  return coalesce(v_got, false);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Sweep backoff
-- ---------------------------------------------------------------------------------------------
create table public.payment_intent_checks (
  intent_id        uuid primary key references public.payment_intents(id),
  last_checked_at  timestamptz not null,
  checks           integer not null default 1
);
comment on table public.payment_intent_checks is 'When the sweep last asked the provider about an open payment intent. Server-only.';
alter table public.payment_intent_checks enable row level security;
revoke all on table public.payment_intent_checks from public, anon, authenticated, service_role;

create or replace function public.mark_intents_checked(p_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_n integer;
begin
  insert into public.payment_intent_checks (intent_id, last_checked_at)
  select unnest(p_ids), now()
  on conflict (intent_id) do update set last_checked_at = now(), checks = public.payment_intent_checks.checks + 1;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- same signature and result as before; now each intent is due only after its backoff has elapsed
create or replace function public.list_open_intents_to_check(p_older_than_minutes integer default 15, p_limit integer default 50)
returns table (id uuid, reference text, status text, expires_at timestamptz, created_at timestamptz)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select i.id, i.reference, i.status, i.expires_at, i.created_at
    from public.payment_intents i
    left join public.payment_intent_checks c on c.intent_id = i.id
   where i.status in ('created', 'pending', 'verified')
     and i.updated_at < now() - make_interval(mins => greatest(1, coalesce(p_older_than_minutes, 15)))
     and i.created_at > now() - interval '7 days'
     and (c.last_checked_at is null
          or c.last_checked_at < now() - case when now() - i.created_at < interval '1 hour'  then interval '10 minutes'
                                              when now() - i.created_at < interval '1 day'   then interval '1 hour'
                                              else interval '12 hours' end)
   order by coalesce(c.last_checked_at, i.created_at)
   limit greatest(1, least(coalesce(p_limit, 50), 200))
$$;

revoke all on function public.claim_findings_to_alert(integer, integer), public.release_finding_alerts(uuid[]),
  public.claim_job_slot(text, integer), public.mark_intents_checked(uuid[]) from public, anon, authenticated, service_role;
grant execute on function public.claim_findings_to_alert(integer, integer), public.release_finding_alerts(uuid[]),
  public.claim_job_slot(text, integer), public.mark_intents_checked(uuid[]) to service_role;
revoke all on function public.list_open_intents_to_check(integer, integer) from public, anon, authenticated, service_role;
grant execute on function public.list_open_intents_to_check(integer, integer) to service_role;

-- ---------------------------------------------------------------------------------------------
-- The alert email is a catalog event (so the catalog's subject, sender and rollout switch govern it, and the email
-- system's "no call site chooses a subject" rule holds). Skipped where the email system is not installed (tests).
-- ---------------------------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.email_event_catalog') is not null then
    insert into public.email_event_catalog (app, event_key, template_key, subject_template, from_email, reply_to, payload_schema, enabled, required_for_business, category, rollout_mode)
    values ('carefind', 'finance_alert', 'finance_alert', 'CareFind: {{critical_count}} critical finance finding(s) need attention',
            'CareFind <support@mail.carefind.app>', 'support@mail.carefind.app',
            '{"type":"object","required":["critical_count","lines"],"properties":{"critical_count":{"type":"string","maxLength":6},"lines":{"type":"string","maxLength":4000},"more_count":{"type":"string","maxLength":6}},"additionalProperties":false}'::jsonb,
            true, false, 'transactional', 'live')
    on conflict (app, event_key) do nothing;
  end if;
end $$;

do $$
declare v_n integer;
begin
  select count(*) into v_n from pg_proc p where p.pronamespace = 'public'::regnamespace
     and p.proname in ('claim_findings_to_alert', 'release_finding_alerts', 'claim_job_slot', 'mark_intents_checked', 'list_open_intents_to_check')
     and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'));
  if v_n > 0 then raise exception 'an operations function is executable by an API role'; end if;
  if has_table_privilege('service_role', 'public.job_slots', 'select') or has_table_privilege('service_role', 'public.payment_intent_checks', 'select') then
    raise exception 'operations tables must be server-only';
  end if;
end $$;
