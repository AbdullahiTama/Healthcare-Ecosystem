-- ============================================================================
-- 2026-11-01 - Payment e-mail events and the notification backfill (H05 of the payment-security hardening track)
--
-- 1. THE CATALOG. Every payment, withdrawal, refund and wallet event the apps send is registered and ENABLED, for the
--    brand that sends it. Before this, 39 of the 40 catalog events were enabled = false (including every payment and
--    withdrawal event) and several events (refund_*, business_wallet_topup, wallet_needs_attention, payout_account_review,
--    withdrawal_processing) were not registered at all. The application's own sender inserts into email_outbox directly and
--    so never consulted the catalog, which is why mail flowed anyway; but any catalog-governed (database-side) producer would
--    have been suppressed, and the catalog said "off" for mail that is on. New rows copy the withdrawal_requested row of the
--    same app, so sender, reply-to, category and rollout mode satisfy the catalog's own constraints.
--
-- 2. THE BACKFILL. list_unnotified_money_events(p_since, p_limit) lists money events that SETTLED recently and have no outbox
--    row under the idempotency key their e-mail uses (completed / failed withdrawals of both apps, completed / failed refunds,
--    settled top-ups). The API's best-effort effects run once, in the call that changed the state; if that call died or the
--    enqueue failed, a later replay reports "already settled" and nothing ever re-sent it. The cron step payment_notifications
--    now sends exactly those, through the same effects and the same keys, so a lost enqueue becomes a late e-mail and a
--    replay can never make a duplicate. Read-only, service_role only.
--
-- NOT APPLIED to production. Safe at any time (additive; no application code depends on it before it is deployed).
-- After applying, re-read the catalog and the ACL:
--   select app, event_key, enabled from public.email_event_catalog
--    where event_key in ('withdrawal_processing','refund_requested','refund_failed','payment_failed') order by 1,2;   -- enabled = true
--   select proname, proacl from pg_proc where proname = 'list_unnotified_money_events';   -- {postgres=X/postgres,service_role=X/postgres}
-- Re-runnable.
-- ============================================================================

-- ---------------------------------------------------------------------------------------------
-- 1. Catalog (skipped where the e-mail system is not installed, e.g. the PGlite fixtures)
-- payload_schema: production's CHECK (email_catalog_schema_is_valid) requires additionalProperties = false with explicit
-- properties, so new rows use the same empty strict schema the existing rows have. (The application's sender does not
-- validate against it; it writes the outbox directly.)
-- ---------------------------------------------------------------------------------------------
do $$
declare
  v_app text;
  v_key text;
  v_found integer;
begin
  if to_regclass('public.email_event_catalog') is null then return; end if;

  for v_app, v_key in
    select * from (values
      ('carefind', 'payment_success'), ('carefind', 'payment_failed'), ('carefind', 'withdrawal_requested'), ('carefind', 'withdrawal_processing'),
      ('carefind', 'withdrawal_completed'), ('carefind', 'withdrawal_failed'), ('carefind', 'refund_requested'), ('carefind', 'refund_completed'),
      ('carefind', 'refund_failed'), ('carefind', 'wallet_needs_attention'), ('carefind', 'payout_account_review'),
      ('carehub', 'payment_failed'), ('carehub', 'withdrawal_requested'), ('carehub', 'withdrawal_processing'), ('carehub', 'withdrawal_completed'),
      ('carehub', 'withdrawal_failed'), ('carehub', 'refund_requested'), ('carehub', 'refund_completed'), ('carehub', 'refund_failed'),
      ('carehub', 'business_wallet_topup'), ('carehub', 'payout_account_review')
    ) as t(app, event_key)
  loop
    -- register what is missing, modelled on the app's own withdrawal_requested row
    insert into public.email_event_catalog (app, event_key, template_key, subject_template, from_email, reply_to, payload_schema, enabled, required_for_business, category, rollout_mode)
    select c.app, v_key, v_key,
           c.app_name || ': ' || replace(v_key, '_', ' '),
           c.from_email, c.reply_to, '{"type":"object","required":[],"properties":{},"additionalProperties":false}'::jsonb, true, false, 'transactional', c.rollout_mode
      from (select app, from_email, reply_to, rollout_mode, case app when 'carehub' then 'CareHub' else 'CareFind' end as app_name
              from public.email_event_catalog where app = v_app and event_key = 'withdrawal_requested') c
    on conflict (app, event_key) do nothing;
    get diagnostics v_found = row_count;

    -- and switch on what exists
    update public.email_event_catalog set enabled = true where app = v_app and event_key = v_key and enabled is distinct from true;
  end loop;
end $$;

-- ---------------------------------------------------------------------------------------------
-- 2. Money events that settled but whose e-mail was never queued
-- ---------------------------------------------------------------------------------------------
create or replace function public.list_unnotified_money_events(p_since interval default interval '48 hours', p_limit integer default 100)
returns table (kind text, app text, subject_id uuid, reference text, user_id uuid, business_id uuid, entity_type text, entity_id uuid, amount_kobo bigint, coins integer)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select * from (
    -- CareFind withdrawals
    select 'withdrawal_completed'::text, 'carefind'::text, w.id, w.paystack_reference, w.user_id, null::uuid, null::text, null::uuid, w.payout_kobo, w.amount
      from public.withdrawal_requests w
     where w.status = 'completed' and w.paystack_reference is not null and w.completed_at > now() - p_since
       and not exists (select 1 from public.email_outbox o where o.idempotency_key = 'withdrawal-completed:' || w.paystack_reference)
    union all
    select 'withdrawal_failed', 'carefind', w.id, w.paystack_reference, w.user_id, null, null, null, w.payout_kobo, w.amount
      from public.withdrawal_requests w
     where w.status = 'refunded' and w.paystack_reference is not null and w.refunded_at > now() - p_since
       and not exists (select 1 from public.email_outbox o where o.idempotency_key = 'withdrawal-failed:' || w.paystack_reference)
    union all
    -- CareHub business withdrawals
    select 'business_withdrawal_completed', 'carehub', w.id, w.paystack_reference, null, w.business_id, null, null, w.amount::bigint, null
      from public.business_withdrawal_requests w
     where w.status = 'completed' and w.paystack_reference is not null and w.completed_at > now() - p_since
       and not exists (select 1 from public.email_outbox o where o.idempotency_key = 'business-withdrawal-completed:' || w.paystack_reference)
    union all
    select 'business_withdrawal_failed', 'carehub', w.id, w.paystack_reference, null, w.business_id, null, null, w.amount::bigint, null
      from public.business_withdrawal_requests w
     where w.status = 'refunded' and w.paystack_reference is not null and w.refunded_at > now() - p_since
       and not exists (select 1 from public.email_outbox o where o.idempotency_key = 'business-withdrawal-failed:' || w.paystack_reference)
    union all
    -- refunds (card and CareCoin)
    select 'refund_completed', 'carefind', r.id, r.reference, r.customer_id, null, r.entity_type, r.entity_id, r.amount_kobo, r.coins
      from public.refunds r
     where r.status = 'completed' and r.completed_at > now() - p_since
       and not exists (select 1 from public.email_outbox o where o.idempotency_key = 'refund-completed:' || r.id)
    union all
    select 'refund_failed', 'carefind', r.id, r.reference, r.customer_id, null, r.entity_type, r.entity_id, r.amount_kobo, r.coins
      from public.refunds r
     where r.status = 'failed' and r.failed_at > now() - p_since
       and not exists (select 1 from public.email_outbox o where o.idempotency_key = 'refund-failed:' || r.id)
    union all
    -- settled top-ups (the receipt)
    select 'wallet_topup', 'carefind', i.id, i.reference, i.customer_id, null, null, null, i.expected_amount, null
      from public.payment_intents i
     where i.purpose = 'wallet_topup' and i.status = 'settled' and i.updated_at > now() - p_since
       and not exists (select 1 from public.email_outbox o where o.idempotency_key = 'payment-success:' || i.reference)
    union all
    select 'business_wallet_topup', 'carehub', i.id, i.reference, null, i.business_id, null, null, i.expected_amount, null
      from public.payment_intents i
     where i.purpose = 'business_wallet_topup' and i.status = 'settled' and i.updated_at > now() - p_since
       and not exists (select 1 from public.email_outbox o where o.idempotency_key = 'wallet-topped-up:' || i.reference)
  ) e
  order by 1, 3
  limit greatest(1, least(p_limit, 500))
$$;

revoke execute on function public.list_unnotified_money_events(interval, integer) from public, anon, authenticated;
grant  execute on function public.list_unnotified_money_events(interval, integer) to service_role;
