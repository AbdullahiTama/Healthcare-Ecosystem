-- =============================================================================================
-- Business wallet reconciliation — the check CareCoin wallets have had since Phase 05, and business wallets never got.
--
-- WHY THIS EXISTS
--   `wallets` (CareCoin) is guarded by wallets_guard: a balance may only change while the ledger posting primitive is
--   running, so balance and coin_ledger cannot drift. `business_wallets` has NO such guard. It is protected only by
--   privileges, which stops anon/authenticated but does nothing about service_role or a plain UPDATE, and nothing at
--   all detects the result.
--
--   Confirmed in production on 2026-10-15, before this migration:
--     business fdba0136  balance 1,840,000 kobo, its ledger explains 1,340,000  -> 500,000 unexplained
--     business d8663307  balance   500,000 kobo, its ledger has ZERO rows       -> 500,000 unexplained
--   1,000,000 kobo (NGN 10,000) of business balance with nothing behind it.
--
--   THIS MIGRATION ONLY DETECTS. It corrects nothing. Adjusting a real balance needs the owner's sign-off, because the
--   correct figure is a judgement (was the money topped up outside the ledger? was a legacy path wrong?) and not a
--   mechanical fix. The findings surface in reconciliation_findings so they are visible and acknowledged rather than
--   living in someone's head.
--
-- THE MODEL, and why it is what it is
--   business_wallet_transactions.amount is SIGNED: credits positive (shop_credit, topup, refund, withdrawal_refund),
--   debits negative (withdrawal).
--   'shop_release' is the exception and the trap: it records a POSITIVE amount for a movement that is purely
--   held -> available and changes the total by nothing. Counting it as income double-counts every released order, so it
--   is excluded from the total and used separately to derive `held`.
--   Rows with status 'pending' are excluded: a pending withdrawal has reserved nothing yet (two such rows exist, a
--   2026-09-29 withdrawal and its 2026-10-04 refund, that net to zero and never moved the balance).
--
-- STATUS: written 2026-10-15. NOT APPLIED until the owner authorises it.
-- =============================================================================================

create or replace function public.reconcile_business_wallets()
returns table (
  business_id uuid,
  kind text,
  detail text,
  balance_total bigint,
  ledger_total bigint,
  delta bigint
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  return query
  with ledger as (
    select b.business_id,
           coalesce(sum(case when t.status is distinct from 'pending' and t.type <> 'shop_release' then t.amount else 0 end), 0)::bigint as total,
           coalesce(sum(case when t.status is distinct from 'pending' and t.type = 'shop_release' then t.amount else 0 end), 0)::bigint as released,
           count(t.id)::int as rows
      from public.business_wallets b
      left join public.business_wallet_transactions t on t.business_id = b.business_id
     group by b.business_id
  )
  select b.business_id,
         case
           when l.rows = 0 then 'no_ledger_rows'
           when (b.held_balance + b.available_balance) <> l.total then 'balance_not_derivable'
           else 'ok'
         end as kind,
         case
           when l.rows = 0 then 'Wallet holds ' || ((b.held_balance + b.available_balance)::text) || ' kobo and has no ledger row at all'
           else 'Wallet holds ' || ((b.held_balance + b.available_balance)::text) || ' kobo, ledger explains ' || l.total::text
                || ' (delta ' || ((b.held_balance + b.available_balance) - l.total)::text || ', ' || l.rows || ' rows, ' || l.released::text || ' released)'
         end as detail,
         (b.held_balance + b.available_balance)::bigint,
         l.total,
         ((b.held_balance + b.available_balance)::bigint - l.total)
    from public.business_wallets b
    join ledger l on l.business_id = b.business_id
   where l.rows = 0
      or (b.held_balance + b.available_balance) <> l.total
   order by b.business_id;
end;
$$;

-- Read-only reporting, so it is safe to expose to service_role only (the reconciliation job) and nobody else.
revoke all on function public.reconcile_business_wallets() from public, anon, authenticated;
grant execute on function public.reconcile_business_wallets() to service_role;

-- ── Close the legacy release path ────────────────────────────────────────────────────────────────────────────
-- confirm_appointment moves held -> available by a hard-coded fee-sized amount, with no per-credit tracking, and is
-- granted to `authenticated`. It has ZERO callers in the repo (verified 2026-10-15) and is superseded by
-- complete_appointment_and_release. Left executable, it is a second way to move business money with no ledger
-- discipline - the exact leak that reconcile_shop_vendor_credits detects as held_below_open_credits.
revoke execute on function public.confirm_appointment(uuid) from authenticated, anon, public;

-- Prove nothing about the grant was assumed: the function must still exist and still be callable by service_role.
do $$
begin
  if to_regprocedure('public.confirm_appointment(uuid)') is null then
    raise exception 'confirm_appointment vanished; this migration only revokes a grant';
  end if;
  if not has_function_privilege('service_role', 'public.confirm_appointment(uuid)', 'execute') then
    raise exception 'confirm_appointment must stay callable by service_role';
  end if;
  if has_function_privilege('authenticated', 'public.confirm_appointment(uuid)', 'execute') then
    raise exception 'confirm_appointment is still executable by authenticated';
  end if;
end $$;