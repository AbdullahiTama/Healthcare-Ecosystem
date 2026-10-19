-- =============================================================================================
-- Wire the business-wallet check into the nightly scan (Rem-06).
--
-- WHY
--   carefind_20261115 added reconcile_business_wallets(): it DETECTS balances the wallet ledger cannot explain, and
--   corrects nothing on purpose. But nothing ever called it. run_db_reconciliation published coins, commissions,
--   withdrawals, refunds, shop_vendor, intents and events - business wallets were not a source at all, so the
--   1,000,000 kobo (NGN 10,000) it finds in production stayed invisible to the nightly scan and to admin Money
--   Checks; it surfaced only when somebody ran the function by hand.
--
-- WHAT
--   Adds one source to run_db_reconciliation: business_wallets, severity warning (a money inconsistency to review,
--   not a broken chain), subject 'business' keyed on the business id, so a finding follows the business as its delta
--   moves and resolves itself once balance and ledger agree. Non-heavy, so both the nightly scan and any light run
--   publish it. Detection only - this corrects nothing, by design (carefind_20261115).
--
--   The runner is otherwise re-created VERBATIM from its last definition (carefind_20261020_wallet_spend_and_topup),
--   so the only behavioural change is the new source. _apply_engine_timeouts() is then re-applied: a migration that
--   redefines an engine entry point must do that (carefind_20261017), and carefind_20261112 exists because it was
--   once missed.
-- =============================================================================================

do $do$
begin
  if to_regprocedure('public.run_db_reconciliation(boolean)') is null then return; end if;
  if to_regprocedure('public.reconcile_business_wallets()') is null then return; end if;
  execute $fn$
  create or replace function public.run_db_reconciliation(p_heavy boolean default true)
  returns jsonb
  language plpgsql
  security definer
  set search_path = public, pg_temp
  as $body$
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
          from public.verify_coin_ledger_chain()
        union all
        select 'untraceable_credit', 'user', p.user_id::text, 'critical',
               count(*) || ' credit(s) totalling ' || coalesce(sum(p.delta), 0) || ' coins do not trace to a settled payment or an allowed internal source and are quarantined from withdrawal'
          from public.reconcile_coin_provenance() p
         group by p.user_id;
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

    -- Business wallet balances (carefind_20261116): balances no ledger row explains. Both kinds are a
    -- warning - money a human has to decide on, never a movement by any engine.
    create temporary table _rs on commit drop as
      select kind, 'business'::text subject_type, business_id::text subject_id, 'warning'::text severity, detail
        from public.reconcile_business_wallets();
    v_results := v_results || public._recon_publish('business_wallets');

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
  $body$;
  $fn$;
end
$do$;

-- A later migration that redefines an engine entry point must call _apply_engine_timeouts() again
-- (carefind_20261017's own note - carefind_20261112 exists because it was once missed).
select public._apply_engine_timeouts();

-- Prove the ACL did not move when the runner was redefined.
do $$
begin
  if not has_function_privilege('service_role', 'public.run_db_reconciliation(boolean)', 'execute') then
    raise exception 'run_db_reconciliation lost its service_role grant';
  end if;
  if has_function_privilege('anon', 'public.run_db_reconciliation(boolean)', 'execute')
     or has_function_privilege('authenticated', 'public.run_db_reconciliation(boolean)', 'execute') then
    raise exception 'run_db_reconciliation must stay service_role only';
  end if;
end $$;
