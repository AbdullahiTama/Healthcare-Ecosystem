-- Phase 12: reconciliation at scale.
--
-- Found by loading 100,000 settled payments (200,000 webhook events, 160,000 ledger rows) into a real Postgres and timing
-- run_db_reconciliation():
--   * sync_reconciliation_findings handled each reported finding with a loop, a SELECT FOR UPDATE and a scan of the whole reported
--     array to decide what to resolve: quadratic in the number of findings. A systemic fault that produced 80,000 findings made one
--     run take more than four minutes (it never finished inside a 10-minute cadence and held locks the whole time). It is now
--     set-based (one upsert, one anti-join).
--   * A fault can still produce an unbounded number of findings, and a screen or an email cannot use 80,000 of them. Each source now
--     reports at most 500 (critical first) plus ONE summary finding saying how many were left out. Counting and ordering happen on the
--     rows (a temp table), so an 80,000-finding fault never becomes an 80,000-element json document.
--   * The unmatched-charge and settled-without-transaction-id checks scanned whole tables. Tiny partial indexes make them O(matches).
--   * The checks that grow with the whole history (coin wallets vs ledger, the ledger chain, settled intents vs their entities) are
--     "heavy"; run_db_reconciliation(false) skips them so the cheap checks can run every 10 minutes and the heavy ones hourly.

do $$
begin
  if to_regprocedure('public.sync_reconciliation_findings(text,jsonb,jsonb)') is null then raise exception 'apply carefind_20261014_reconciliation first'; end if;
  if to_regprocedure('public.claim_job_slot(text,integer)') is null then raise exception 'apply carefind_20261015_reconciliation_ops first'; end if;
end $$;

create index payment_provider_events_unmatched_idx on public.payment_provider_events (received_at)
  where event_type = 'charge.success' and outcome = 'ignored';
create index payment_intents_settled_no_txn_idx on public.payment_intents (id)
  where status = 'settled' and provider_transaction_id is null;
create index payment_intents_open_check_idx on public.payment_intents (updated_at)
  where status in ('created', 'pending', 'verified');

-- ---------------------------------------------------------------------------------------------
-- The one writer, set-based
-- ---------------------------------------------------------------------------------------------
create or replace function public.sync_reconciliation_findings(p_source text, p_current jsonb, p_scope jsonb default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_scope text[];
  v_bad jsonb;
  v_inserted integer;
  v_reopened integer;
  v_resolved integer;
  v_open integer;
begin
  if p_source is null or p_source !~ '^[a-z][a-z0-9_]{1,40}$' then raise exception 'invalid reconciliation source'; end if;
  if p_current is null or jsonb_typeof(p_current) <> 'array' then raise exception 'p_current must be a json array'; end if;
  if p_scope is not null and jsonb_typeof(p_scope) <> 'array' then raise exception 'p_scope must be a json array or null'; end if;

  -- one writer per source at a time: two overlapping runs cannot resolve what the other just reported
  perform pg_advisory_xact_lock(hashtextextended('reconciliation:' || p_source, 0));

  -- every element must be a well-formed finding (any bad element rejects the whole call)
  select e into v_bad from jsonb_array_elements(p_current) e
   where jsonb_typeof(e) <> 'object'
      or coalesce(e ->> 'kind', '') = '' or coalesce(e ->> 'subject_type', '') = '' or coalesce(e ->> 'subject_id', '') = ''
      or coalesce(e ->> 'severity', '') not in ('info', 'warning', 'critical')
   limit 1;
  if v_bad is not null then raise exception 'invalid finding %', v_bad; end if;

  if p_scope is not null then select coalesce(array_agg(s), '{}') into v_scope from jsonb_array_elements_text(p_scope) s; end if;

  create temporary table _recon_cur on commit drop as
    select distinct on (kind, subject_type, subject_id) kind, subject_type, subject_id, severity, left(coalesce(detail, ''), 1000) as detail
      from jsonb_to_recordset(p_current) as x(kind text, subject_type text, subject_id text, severity text, detail text)
     order by kind, subject_type, subject_id;
  -- an index and statistics only pay for themselves on a big report (for three findings they cost more than the whole sync did);
  -- without them the anti-join below would be a nested loop, which is why a big report gets both
  if jsonb_array_length(p_current) > 500 then
    create unique index on _recon_cur (kind, subject_type, subject_id);
    analyze _recon_cur;
  end if;

  select count(*) into v_inserted from _recon_cur c
   where not exists (select 1 from public.reconciliation_findings f
                      where f.source = p_source and f.kind = c.kind and f.subject_type = c.subject_type and f.subject_id = c.subject_id);
  select count(*) into v_reopened from _recon_cur c
    join public.reconciliation_findings f on f.source = p_source and f.kind = c.kind and f.subject_type = c.subject_type and f.subject_id = c.subject_id
   where f.status = 'resolved';

  insert into public.reconciliation_findings as f (source, kind, subject_type, subject_id, severity, detail)
    select p_source, c.kind, c.subject_type, c.subject_id, c.severity, c.detail from _recon_cur c
  on conflict (source, kind, subject_type, subject_id) do update
    set last_seen_at = now(), occurrences = f.occurrences + 1, severity = excluded.severity, detail = excluded.detail,
        status = case when f.status = 'resolved' then 'open' else f.status end,
        resolved_at = case when f.status = 'resolved' then null else f.resolved_at end;

  update public.reconciliation_findings r
     set status = 'resolved', resolved_at = now()
   where r.source = p_source and r.status in ('open', 'acknowledged')
     and not exists (select 1 from _recon_cur c where c.kind = r.kind and c.subject_type = r.subject_type and c.subject_id = r.subject_id)
     and (v_scope is null or r.subject_id = any (v_scope));
  get diagnostics v_resolved = row_count;

  drop table _recon_cur;
  select count(*) into v_open from public.reconciliation_findings where source = p_source and status in ('open', 'acknowledged');
  return jsonb_build_object('source', p_source, 'inserted', v_inserted, 'reopened', v_reopened, 'resolved', v_resolved, 'open', v_open);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Cap a json report (used by callers that already hold json, e.g. the provider comparison)
-- ---------------------------------------------------------------------------------------------
create or replace function public._recon_cap(p_source text, p_current jsonb, p_cap integer default 500)
returns jsonb
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare v_n integer := jsonb_array_length(p_current);
begin
  if v_n <= p_cap then return p_current; end if;
  return (
    select coalesce(jsonb_agg(e order by rank, ord), '[]'::jsonb)
      from (select e, ord, case e ->> 'severity' when 'critical' then 0 when 'warning' then 1 else 2 end as rank,
                   row_number() over (order by case e ->> 'severity' when 'critical' then 0 when 'warning' then 1 else 2 end, ord) as rn
              from jsonb_array_elements(p_current) with ordinality as t(e, ord)) ranked
     where rn <= p_cap
  ) || jsonb_build_array(jsonb_build_object(
         'kind', 'too_many_findings', 'subject_type', 'source', 'subject_id', p_source, 'severity', 'critical',
         'detail', format('%s checks reported %s findings; only the %s worst are listed. Something systemic is wrong: look at the cause, not the rows.', p_source, v_n, p_cap)));
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- _recon_publish: what one source found is collected into the temp table _rs (kind, subject_type, subject_id, severity, detail) and
-- published capped, counting and ordering on the rows.
-- ---------------------------------------------------------------------------------------------
create or replace function public._recon_publish(p_source text, p_cap integer default 500)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_n bigint;
  v_current jsonb;
begin
  select count(*) into v_n from _rs;
  select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) into v_current from (
    select kind, subject_type, subject_id, severity, detail from _rs
     order by case severity when 'critical' then 0 when 'warning' then 1 else 2 end, subject_id, kind
     limit p_cap) r;
  if v_n > p_cap then
    v_current := v_current || jsonb_build_array(jsonb_build_object(
      'kind', 'too_many_findings', 'subject_type', 'source', 'subject_id', p_source, 'severity', 'critical',
      'detail', format('%s checks reported %s findings; only the %s worst are listed. Something systemic is wrong: look at the cause, not the rows.', p_source, v_n, p_cap)));
  end if;
  drop table _rs;
  return public.sync_reconciliation_findings(p_source, v_current);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- run_db_reconciliation(p_heavy): the history-sized checks only when asked
-- ---------------------------------------------------------------------------------------------
drop function public.run_db_reconciliation();
create function public.run_db_reconciliation(p_heavy boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_run uuid := gen_random_uuid();
  v_results jsonb := '[]'::jsonb;
  v_totals jsonb;
begin
  insert into public.reconciliation_runs (id) values (v_run);

  if p_heavy then
    create temporary table _rs on commit drop as
      select 'wallet_differs_from_ledger'::text kind, 'user'::text subject_type, user_id::text subject_id, 'critical'::text severity,
             'balance ' || balance || ' but ledger sums to ' || ledger_sum || ' (difference ' || difference || ')' detail
        from public.reconcile_coin_wallets()
      union all
      select 'ledger_chain_broken', 'coin_ledger_entry', id::text, 'critical', 'entry ' || id || ' for user ' || user_id || ': balance_after ' || balance_after || ', expected ' || expected_balance
        from public.verify_coin_ledger_chain();
    v_results := v_results || public._recon_publish('coins');
  end if;

  create temporary table _rs on commit drop as
    select kind, case when payment_id is not null then 'plan_payment' when business_id is not null then 'business' else 'agent' end subject_type,
           coalesce(payment_id, business_id, agent_id)::text subject_id, public._recon_severity(kind) severity, detail
      from public.reconcile_commissions();
  v_results := v_results || public._recon_publish('commissions');

  create temporary table _rs on commit drop as
    select kind, app || '_withdrawal' subject_type, request_id::text subject_id, public._recon_severity(kind) severity, detail
      from public.reconcile_withdrawals();
  v_results := v_results || public._recon_publish('withdrawals');

  create temporary table _rs on commit drop as
    select kind, case when refund_id is not null then 'refund' else 'entity' end subject_type, coalesce(refund_id, entity_id)::text subject_id,
           public._recon_severity(kind) severity, detail
      from public.reconcile_refunds();
  v_results := v_results || public._recon_publish('refunds');

  create temporary table _rs on commit drop as
    select kind, 'shop_order' subject_type, order_id::text subject_id, public._recon_severity(kind) severity, detail
      from public.reconcile_shop_vendor_credits();
  v_results := v_results || public._recon_publish('shop_vendor');

  if p_heavy then
    create temporary table _rs on commit drop as
      select 'settled_without_transaction_id'::text kind, 'payment_intent'::text subject_type, i.id::text subject_id, 'critical'::text severity,
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
       where i.status = 'settled' and i.purpose in ('appointment', 'booking') and i.entity_type = 'appointment' and (a.id is null or a.payment_status not in ('paid', 'refunded'));
    v_results := v_results || public._recon_publish('intents');
  end if;

  create temporary table _rs on commit drop as
    select 'event_failed'::text kind, 'provider_event'::text subject_type, e.id::text subject_id,
           (case when e.received_at < now() - interval '1 day' then 'critical' else 'warning' end)::text severity,
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
       and not exists (select 1 from public.payment_intents i where i.reference = e.reference);
  v_results := v_results || public._recon_publish('events');

  select jsonb_build_object(
           'open_critical', count(*) filter (where severity = 'critical' and status in ('open', 'acknowledged')),
           'open_warning',  count(*) filter (where severity = 'warning'  and status in ('open', 'acknowledged')),
           'open_info',     count(*) filter (where severity = 'info'     and status in ('open', 'acknowledged')))
    into v_totals from public.reconciliation_findings;

  update public.reconciliation_runs set finished_at = now(), summary = jsonb_build_object('heavy', p_heavy, 'sources', v_results, 'totals', v_totals) where id = v_run;
  return jsonb_build_object('run_id', v_run, 'heavy', p_heavy, 'sources', v_results, 'totals', v_totals);
end;
$$;

revoke all on function public.sync_reconciliation_findings(text, jsonb, jsonb), public.run_db_reconciliation(boolean),
  public._recon_cap(text, jsonb, integer), public._recon_publish(text, integer) from public, anon, authenticated, service_role;
grant execute on function public.sync_reconciliation_findings(text, jsonb, jsonb), public.run_db_reconciliation(boolean) to service_role;

do $$
declare v_n integer;
begin
  select count(*) into v_n from pg_proc where pronamespace = 'public'::regnamespace and proname = 'run_db_reconciliation';
  if v_n <> 1 then raise exception 'run_db_reconciliation must exist exactly once, found %', v_n; end if;
  select count(*) into v_n from pg_proc p where p.pronamespace = 'public'::regnamespace
     and p.proname in ('sync_reconciliation_findings', 'run_db_reconciliation', '_recon_cap', '_recon_publish')
     and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'));
  if v_n > 0 then raise exception 'a reconciliation function is executable by an API role'; end if;
end $$;
