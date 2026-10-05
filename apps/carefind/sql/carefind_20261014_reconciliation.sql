-- Financial program, Phase 11: reconciliation and webhook recovery (database side).
--
-- Every engine already has its own reconcile function (coins, commissions, withdrawals, refunds, shop vendor credits). Until now
-- nothing RAN them, nothing KEPT their answers, and nobody was told. This migration adds:
--
--   reconciliation_findings   one row per (source, kind, subject); first/last seen, severity, status. A finding that stops being
--                             true is auto-resolved; one that comes back is reopened; a human can acknowledge or dismiss
--                             it (a dismissed finding is never reopened, so a known, explained row does not nag forever).
--   reconciliation_runs       one row per run: what ran, how many findings are open, any error.
--   sync_reconciliation_findings(source, current, scope)   the ONE writer (also used by the provider-side checks in Node).
--   run_db_reconciliation()   runs every database check and syncs the findings.
--   list_ / update_reconciliation_finding   what the admin API calls.
--   financial_config_history  who changed which commercial constant, from what, to what (the Phase 02 follow-up).
--
-- New database checks: coin wallets and the coin ledger chain, commissions, withdrawals, refunds, shop vendor credits (all the
-- existing reconcile functions), plus payment intents (needs_refund never refunded, settled without a provider transaction id,
-- settled shop order / appointment whose entity is not paid) and provider events (failed, stuck unprocessed, and every
-- successful charge no intent recognised: real money that nothing settled).
--
-- Server-only: the tables are readable and writable only through the functions below (service_role).

do $$
begin
  if to_regprocedure('public.reconcile_coin_wallets()') is null then raise exception 'apply carefind_20261005_coin_ledger first'; end if;
  if to_regprocedure('public.reconcile_commissions()') is null then raise exception 'apply carefind_20261007_commission_engine first'; end if;
  if to_regprocedure('public.reconcile_withdrawals(integer)') is null then raise exception 'apply carefind_20261008_withdrawal_engine first'; end if;
  if to_regprocedure('public.reconcile_refunds(integer)') is null then raise exception 'apply carefind_20261009_refund_engine first'; end if;
  if to_regprocedure('public.reconcile_shop_vendor_credits()') is null then raise exception 'apply carefind_20261012_shop_vendor_payouts first'; end if;
end $$;

-- ---------------------------------------------------------------------------------------------
-- financial_config_history
-- ---------------------------------------------------------------------------------------------
create table public.financial_config_history (
  id          bigint generated always as identity primary key,
  key         text not null,
  operation   text not null,
  old_value   numeric,
  new_value   numeric,
  changed_by  uuid,                              -- the signed-in user when the change came through the API, else null
  db_user     text not null default current_user,
  changed_at  timestamptz not null default now(),
  constraint financial_config_history_operation_check check (operation in ('baseline', 'insert', 'update', 'delete'))
);
comment on table public.financial_config_history is 'Append-only record of every change to financial_config. Server-only.';
create index financial_config_history_key_idx on public.financial_config_history (key, changed_at desc);

create or replace function public.financial_config_audit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_by uuid;
begin
  begin v_by := nullif(current_setting('request.jwt.claim.sub', true), '')::uuid; exception when others then v_by := null; end;
  if tg_op = 'INSERT' then
    insert into public.financial_config_history (key, operation, new_value, changed_by) values (new.key, 'insert', new.value, v_by);
  elsif tg_op = 'UPDATE' then
    if new.value is distinct from old.value then
      insert into public.financial_config_history (key, operation, old_value, new_value, changed_by) values (new.key, 'update', old.value, new.value, v_by);
    end if;
  else
    insert into public.financial_config_history (key, operation, old_value, changed_by) values (old.key, 'delete', old.value, v_by);
  end if;
  return null;
end;
$$;
create trigger financial_config_audit after insert or update or delete on public.financial_config for each row execute function public.financial_config_audit();

create or replace function public.financial_config_history_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'financial_config_history is append-only' using errcode = '42501';
end;
$$;
create trigger financial_config_history_guard before update or delete on public.financial_config_history for each row execute function public.financial_config_history_guard();
create trigger financial_config_history_no_truncate before truncate on public.financial_config_history for each statement execute function public.financial_no_truncate();

-- the state of every constant at the moment auditing began
insert into public.financial_config_history (key, operation, new_value) select key, 'baseline', value from public.financial_config;

alter table public.financial_config_history enable row level security;
revoke all on table public.financial_config_history from public, anon, authenticated, service_role;
revoke all on function public.financial_config_audit() from public, anon, authenticated, service_role;
revoke all on function public.financial_config_history_guard() from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- Findings and runs
-- ---------------------------------------------------------------------------------------------
create table public.reconciliation_findings (
  id            uuid primary key default gen_random_uuid(),
  source        text not null,          -- which check family: coins, commissions, withdrawals, refunds, shop_vendor, intents, events, provider
  kind          text not null,
  subject_type  text not null,
  subject_id    text not null,
  severity      text not null,
  detail        text not null,
  status        text not null default 'open',
  occurrences   integer not null default 1,
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  resolved_at   timestamptz,
  resolved_by   uuid,
  note          text,
  constraint reconciliation_findings_subject_key unique (source, kind, subject_type, subject_id),
  constraint reconciliation_findings_severity_check check (severity in ('info', 'warning', 'critical')),
  constraint reconciliation_findings_status_check check (status in ('open', 'acknowledged', 'resolved', 'dismissed')),
  constraint reconciliation_findings_dismissed_has_note check (status <> 'dismissed' or length(coalesce(note, '')) >= 5)
);
comment on table public.reconciliation_findings is 'Open money inconsistencies found by reconciliation. resolved = the condition cleared by itself; dismissed = a human decided it is explained (never reopened).';
create index reconciliation_findings_open_idx on public.reconciliation_findings (severity, last_seen_at desc) where status in ('open', 'acknowledged');

create table public.reconciliation_runs (
  id            uuid primary key default gen_random_uuid(),
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  summary       jsonb,
  error         text
);
comment on table public.reconciliation_runs is 'One row per database reconciliation run.';

create or replace function public.reconciliation_findings_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then raise exception 'reconciliation findings are never deleted' using errcode = '42501'; end if;
  if (new.source, new.kind, new.subject_type, new.subject_id, new.first_seen_at, new.id) is distinct from (old.source, old.kind, old.subject_type, old.subject_id, old.first_seen_at, old.id) then
    raise exception 'a finding''s identity is immutable' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger reconciliation_findings_guard before update or delete on public.reconciliation_findings for each row execute function public.reconciliation_findings_guard();
create trigger reconciliation_findings_no_truncate before truncate on public.reconciliation_findings for each statement execute function public.financial_no_truncate();

alter table public.reconciliation_findings enable row level security;
alter table public.reconciliation_runs enable row level security;
revoke all on table public.reconciliation_findings, public.reconciliation_runs from public, anon, authenticated, service_role;
revoke all on function public.reconciliation_findings_guard() from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- The one writer
-- p_current: [{kind, subject_type, subject_id, severity, detail}] - everything that is wrong NOW for this source.
-- p_scope:   null = the whole source was evaluated (open findings not in p_current are resolved);
--            ["id", ...] = only those subject ids were evaluated (only they can be resolved).
-- ---------------------------------------------------------------------------------------------
create or replace function public.sync_reconciliation_findings(p_source text, p_current jsonb, p_scope jsonb default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  it jsonb;
  f public.reconciliation_findings%rowtype;
  v_inserted integer := 0;
  v_reopened integer := 0;
  v_resolved integer := 0;
  v_open integer;
begin
  if p_source is null or p_source !~ '^[a-z][a-z0-9_]{1,40}$' then raise exception 'invalid reconciliation source'; end if;
  if p_current is null or jsonb_typeof(p_current) <> 'array' then raise exception 'p_current must be a json array'; end if;
  if p_scope is not null and jsonb_typeof(p_scope) <> 'array' then raise exception 'p_scope must be a json array or null'; end if;

  -- one writer per source at a time: two overlapping runs cannot resolve what the other just reported
  perform pg_advisory_xact_lock(hashtextextended('reconciliation:' || p_source, 0));

  for it in select * from jsonb_array_elements(p_current) loop
    if coalesce(it ->> 'kind', '') = '' or coalesce(it ->> 'subject_type', '') = '' or coalesce(it ->> 'subject_id', '') = ''
       or coalesce(it ->> 'severity', '') not in ('info', 'warning', 'critical') then
      raise exception 'invalid finding %', it;
    end if;
    select * into f from public.reconciliation_findings
     where source = p_source and kind = it ->> 'kind' and subject_type = it ->> 'subject_type' and subject_id = it ->> 'subject_id' for update;
    if not found then
      insert into public.reconciliation_findings (source, kind, subject_type, subject_id, severity, detail)
      values (p_source, it ->> 'kind', it ->> 'subject_type', it ->> 'subject_id', it ->> 'severity', left(coalesce(it ->> 'detail', ''), 1000));
      v_inserted := v_inserted + 1;
    else
      update public.reconciliation_findings
         set last_seen_at = now(), occurrences = occurrences + 1, severity = it ->> 'severity', detail = left(coalesce(it ->> 'detail', ''), 1000),
             status = case when f.status = 'resolved' then 'open' else f.status end,
             resolved_at = case when f.status = 'resolved' then null else f.resolved_at end
       where id = f.id;
      if f.status = 'resolved' then v_reopened := v_reopened + 1; end if;
    end if;
  end loop;

  update public.reconciliation_findings r
     set status = 'resolved', resolved_at = now()
   where r.source = p_source and r.status in ('open', 'acknowledged')
     and not exists (select 1 from jsonb_array_elements(p_current) c
                      where c ->> 'kind' = r.kind and c ->> 'subject_type' = r.subject_type and c ->> 'subject_id' = r.subject_id)
     and (p_scope is null or exists (select 1 from jsonb_array_elements_text(p_scope) s where s = r.subject_id));
  get diagnostics v_resolved = row_count;

  select count(*) into v_open from public.reconciliation_findings where source = p_source and status in ('open', 'acknowledged');
  return jsonb_build_object('source', p_source, 'inserted', v_inserted, 'reopened', v_reopened, 'resolved', v_resolved, 'open', v_open);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- The database checks
-- ---------------------------------------------------------------------------------------------
create or replace function public._recon_severity(p_kind text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select case when p_kind like 'legacy%' then 'info'
              when p_kind in ('stuck', 'business_shortfall', 'refund_shortfall', 'release_shortfall', 'missing_commission') then 'warning'
              else 'critical' end
$$;

create or replace function public.run_db_reconciliation()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_run uuid := gen_random_uuid();
  v_results jsonb := '[]'::jsonb;
  v_current jsonb;
  v_totals jsonb;
begin
  insert into public.reconciliation_runs (id) values (v_run);

  -- coins
  select coalesce(jsonb_agg(x), '[]') into v_current from (
    select 'wallet_differs_from_ledger' kind, 'user' subject_type, user_id::text subject_id, 'critical' severity,
           'balance ' || balance || ' but ledger sums to ' || ledger_sum || ' (difference ' || difference || ')' detail
      from public.reconcile_coin_wallets()
    union all
    select 'ledger_chain_broken', 'coin_ledger_entry', id::text, 'critical', 'entry ' || id || ' for user ' || user_id || ': balance_after ' || balance_after || ', expected ' || expected_balance
      from public.verify_coin_ledger_chain()) x;
  v_results := v_results || public.sync_reconciliation_findings('coins', v_current);

  -- commissions
  select coalesce(jsonb_agg(x), '[]') into v_current from (
    select kind, case when payment_id is not null then 'plan_payment' when business_id is not null then 'business' else 'agent' end subject_type,
           coalesce(payment_id, business_id, agent_id)::text subject_id, public._recon_severity(kind) severity, detail
      from public.reconcile_commissions()) x;
  v_results := v_results || public.sync_reconciliation_findings('commissions', v_current);

  -- withdrawals
  select coalesce(jsonb_agg(x), '[]') into v_current from (
    select kind, app || '_withdrawal' subject_type, request_id::text subject_id, public._recon_severity(kind) severity, detail
      from public.reconcile_withdrawals()) x;
  v_results := v_results || public.sync_reconciliation_findings('withdrawals', v_current);

  -- refunds
  select coalesce(jsonb_agg(x), '[]') into v_current from (
    select kind, case when refund_id is not null then 'refund' else 'entity' end subject_type, coalesce(refund_id, entity_id)::text subject_id,
           public._recon_severity(kind) severity, detail
      from public.reconcile_refunds()) x;
  v_results := v_results || public.sync_reconciliation_findings('refunds', v_current);

  -- shop vendor credits
  select coalesce(jsonb_agg(x), '[]') into v_current from (
    select kind, 'shop_order' subject_type, order_id::text subject_id, public._recon_severity(kind) severity, detail
      from public.reconcile_shop_vendor_credits()) x;
  v_results := v_results || public.sync_reconciliation_findings('shop_vendor', v_current);

  -- payment intents
  select coalesce(jsonb_agg(x), '[]') into v_current from (
    select 'settled_without_transaction_id' kind, 'payment_intent' subject_type, i.id::text subject_id, 'critical' severity,
           'intent ' || i.reference || ' is settled but no provider transaction id was recorded' detail
      from public.payment_intents i where i.status = 'settled' and i.provider_transaction_id is null
    union all
    select 'shop_order_settled_but_unpaid', 'payment_intent', i.id::text, 'critical',
           'intent ' || i.reference || ' settled but order ' || i.entity_id || ' is ' || coalesce(o.payment_status, 'missing')
      from public.payment_intents i left join public.shop_orders o on o.id = i.entity_id
     where i.status = 'settled' and i.purpose = 'shop_order' and (o.id is null or o.payment_status not in ('paid', 'refunded'))
    union all
    select 'appointment_settled_but_unpaid', 'payment_intent', i.id::text, 'critical',
           'intent ' || i.reference || ' settled but appointment ' || i.entity_id || ' is ' || coalesce(a.payment_status, 'missing')
      from public.payment_intents i left join public.appointments a on a.id = i.entity_id
     where i.status = 'settled' and i.purpose in ('appointment', 'booking') and i.entity_type = 'appointment' and (a.id is null or a.payment_status not in ('paid', 'refunded'))
) x;   -- (needs_refund intents without a refund are already reported by reconcile_refunds)
  v_results := v_results || public.sync_reconciliation_findings('intents', v_current);

  -- provider events (webhooks)
  select coalesce(jsonb_agg(x), '[]') into v_current from (
    select 'event_failed' kind, 'provider_event' subject_type, e.id::text subject_id,
           case when e.received_at < now() - interval '1 day' then 'critical' else 'warning' end severity,
           e.event_type || ' ' || coalesce(e.reference, e.event_id) || ' failed ' || e.attempts || ' time(s): ' || coalesce(e.last_error, '?') detail
      from public.payment_provider_events e where e.outcome = 'failed' and e.processed_at is null and e.received_at < now() - interval '30 minutes'
    union all
    select 'event_unprocessed', 'provider_event', e.id::text, 'warning', e.event_type || ' ' || coalesce(e.reference, e.event_id) || ' was stored at ' || e.received_at || ' and never processed'
      from public.payment_provider_events e where e.outcome is null and e.processed_at is null and e.received_at < now() - interval '15 minutes'
    union all
    select 'unmatched_charge', 'payment_reference', coalesce(e.reference, e.event_id), 'critical',
           'Paystack reported a successful charge of ' || coalesce(round((e.payload -> 'data' ->> 'amount')::numeric / 100, 2)::text, '?') || ' NGN that no payment intent recognises (received ' || e.received_at || ')'
      from public.payment_provider_events e
     where e.event_type = 'charge.success' and e.outcome = 'ignored'
       and not exists (select 1 from public.payment_intents i where i.reference = e.reference)) x;
  v_results := v_results || public.sync_reconciliation_findings('events', v_current);

  select jsonb_build_object(
           'open_critical', count(*) filter (where severity = 'critical' and status in ('open', 'acknowledged')),
           'open_warning',  count(*) filter (where severity = 'warning'  and status in ('open', 'acknowledged')),
           'open_info',     count(*) filter (where severity = 'info'     and status in ('open', 'acknowledged')))
    into v_totals from public.reconciliation_findings;

  update public.reconciliation_runs set finished_at = now(), summary = jsonb_build_object('sources', v_results, 'totals', v_totals) where id = v_run;
  return jsonb_build_object('run_id', v_run, 'sources', v_results, 'totals', v_totals);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- What the admin API calls
-- ---------------------------------------------------------------------------------------------
create or replace function public.list_reconciliation_findings(p_status text default null, p_limit integer default 200)
returns setof public.reconciliation_findings
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select * from public.reconciliation_findings
   where (p_status is null and status in ('open', 'acknowledged')) or status = p_status
   order by case severity when 'critical' then 0 when 'warning' then 1 else 2 end, last_seen_at desc
   limit greatest(1, least(coalesce(p_limit, 200), 500))
$$;

create or replace function public.update_reconciliation_finding(p_id uuid, p_action text, p_note text default null, p_by uuid default null)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare f public.reconciliation_findings%rowtype;
begin
  if p_action not in ('acknowledge', 'dismiss', 'reopen') then raise exception 'unknown action %', p_action; end if;
  select * into f from public.reconciliation_findings where id = p_id for update;
  if not found then return 'not_found'; end if;
  if p_action = 'acknowledge' then
    if f.status <> 'open' then return 'not_open'; end if;
    update public.reconciliation_findings set status = 'acknowledged', note = coalesce(p_note, note), resolved_by = p_by where id = p_id;
  elsif p_action = 'dismiss' then
    if f.status = 'dismissed' then return 'already_dismissed'; end if;
    if length(coalesce(p_note, '')) < 5 then raise exception 'a dismissal needs a note explaining why (at least 5 characters)'; end if;
    update public.reconciliation_findings set status = 'dismissed', note = p_note, resolved_by = p_by, resolved_at = now() where id = p_id;
  else
    if f.status not in ('dismissed', 'resolved', 'acknowledged') then return 'not_closed'; end if;
    update public.reconciliation_findings set status = 'open', resolved_at = null where id = p_id;
  end if;
  return 'ok';
end;
$$;

-- events the replay sweep may process again: failed (Paystack stopped retrying) or stored and never processed
create or replace function public.list_replayable_provider_events(p_older_than_minutes integer default 10, p_max_attempts integer default 20, p_limit integer default 50)
returns setof public.payment_provider_events
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select * from public.payment_provider_events
   where processed_at is null and signature_ok and attempts < p_max_attempts
     and received_at < now() - make_interval(mins => greatest(1, coalesce(p_older_than_minutes, 10)))
   order by received_at
   limit greatest(1, least(coalesce(p_limit, 50), 200))
$$;

-- intents a customer may have paid whose redirect and webhook never settled them
create or replace function public.list_open_intents_to_check(p_older_than_minutes integer default 15, p_limit integer default 50)
returns table (id uuid, reference text, status text, expires_at timestamptz, created_at timestamptz)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select i.id, i.reference, i.status, i.expires_at, i.created_at
    from public.payment_intents i
   where i.status in ('created', 'pending', 'verified')
     and i.updated_at < now() - make_interval(mins => greatest(1, coalesce(p_older_than_minutes, 15)))
     and i.created_at > now() - interval '7 days'
   order by i.updated_at
   limit greatest(1, least(coalesce(p_limit, 50), 200))
$$;

revoke all on function public.sync_reconciliation_findings(text, jsonb, jsonb), public.run_db_reconciliation(),
  public.list_reconciliation_findings(text, integer), public.update_reconciliation_finding(uuid, text, text, uuid),
  public.list_replayable_provider_events(integer, integer, integer), public.list_open_intents_to_check(integer, integer),
  public._recon_severity(text) from public, anon, authenticated, service_role;
grant execute on function public.sync_reconciliation_findings(text, jsonb, jsonb), public.run_db_reconciliation(),
  public.list_reconciliation_findings(text, integer), public.update_reconciliation_finding(uuid, text, text, uuid),
  public.list_replayable_provider_events(integer, integer, integer), public.list_open_intents_to_check(integer, integer) to service_role;

-- ---------------------------------------------------------------------------------------------
-- The migration verifies itself
-- ---------------------------------------------------------------------------------------------
do $$
declare v_n integer;
begin
  select count(*) into v_n from pg_proc p where p.pronamespace = 'public'::regnamespace
     and p.proname in ('sync_reconciliation_findings', 'run_db_reconciliation', 'list_reconciliation_findings', 'update_reconciliation_finding',
                       'list_replayable_provider_events', 'list_open_intents_to_check', 'financial_config_audit')
     and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'));
  if v_n > 0 then raise exception 'a reconciliation function is executable by an API role'; end if;
  if has_table_privilege('service_role', 'public.reconciliation_findings', 'select') or has_table_privilege('authenticated', 'public.reconciliation_findings', 'select') then
    raise exception 'reconciliation_findings must be readable only through its functions';
  end if;
end $$;
