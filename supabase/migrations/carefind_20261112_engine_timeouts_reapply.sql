-- =============================================================================================
-- Re-apply engine lock/statement timeouts, and assert them over the WHOLE list.
--
-- WHY THIS EXISTS
--   carefind_20261017_engine_timeouts_and_hot_paths.sql set `lock_timeout=10s, statement_timeout=30s`
--   on every engine entry point and warned, in its own header, that "CREATE OR REPLACE FUNCTION
--   REPLACES proconfig: a later migration that redefines one of these functions must call
--   public._apply_engine_timeouts() again".
--
--   That caveat was never honoured. `_apply_engine_timeouts()` was last called on 2026-10-19
--   (carefind_20261019_red_team_fixes.sql). After that:
--     carefind_20261020_wallet_spend_part6   redefined create_withdrawal
--     carefind_20261031_withdrawal_attempt_and_conflicts redefined settle_withdrawal and
--                                             settle_business_withdrawal
--     carefind_20261020_wallet_spend_part4   redefined settle_payment_intent
--   None of them re-applied the timeouts, so those four functions went back to unbounded waits
--   on a locked `wallets` row or a contended settlement. Verified in production 2026-10-15:
--     settle_payment_intent / create_withdrawal / settle_withdrawal / settle_business_withdrawal
--     had proconfig = [search_path] only.
--
--   The old assertion only checked SIX of the twenty-two names in the applier's own list, so the
--   regression could not have been caught even by re-running that migration. The assertion below
--   covers every name the applier knows about, which makes the invariant fail loudly at apply time
--   from now on. apps/carefind/src/test/payments/engineTimeouts.db.test.js asserts the same set,
--   so CI catches it before a migration ever reaches production.
--
-- STATUS: written 2026-10-15. NOT APPLIED to production - applying it needs the owner's explicit
-- authorisation. Apply BEFORE the next withdrawal release; it is forward-only and reversible with
-- a plain `alter function ... reset lock_timeout`.
-- =============================================================================================

select public._apply_engine_timeouts();

do $$
declare
  v_missing text;
begin
  -- The single list of engine entry points. Keep this and _apply_engine_timeouts() in step: the
  -- applier sets the timeouts, this block proves it happened.
  if exists (
    select 1 from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.proname in (
         'settle_payment_intent', 'request_refund', 'settle_refund', 'mark_refund_processing',
         'settle_withdrawal', 'settle_business_withdrawal', 'create_withdrawal',
         'create_business_withdrawal', 'release_shop_vendor_credits',
         'sync_reconciliation_findings', 'run_db_reconciliation', '_settle_wallet_topup',
         '_settle_creator_subscription', '_settle_consultation', '_settle_booking',
         '_settle_plan_renewal', '_settle_shop_order', '_post_coin_entry', '_post_coin_transfer',
         '_post_coin_split')
       and not (coalesce(p.proconfig, '{}') @> array['lock_timeout=10s'])
  ) then
    select string_agg(p.oid::regprocedure::text, ', ') into v_missing
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.proname in (
         'settle_payment_intent', 'request_refund', 'settle_refund', 'mark_refund_processing',
         'settle_withdrawal', 'settle_business_withdrawal', 'create_withdrawal',
         'create_business_withdrawal', 'release_shop_vendor_credits',
         'sync_reconciliation_findings', 'run_db_reconciliation', '_settle_wallet_topup',
         '_settle_creator_subscription', '_settle_consultation', '_settle_booking',
         '_settle_plan_renewal', '_settle_shop_order', '_post_coin_entry', '_post_coin_transfer',
         '_post_coin_split')
       and not (coalesce(p.proconfig, '{}') @> array['lock_timeout=10s']);
    raise exception 'engine timeouts missing on %', v_missing;
  end if;
end $$;