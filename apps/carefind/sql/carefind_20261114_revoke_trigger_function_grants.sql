-- Trigger functions are not directly callable ("trigger functions can only be called as triggers"), so neither of
-- these is exploitable today. They are still wrong: PostgreSQL grants EXECUTE to PUBLIC on every new function unless
-- revoked, the Supabase security advisor flags "Public Can Execute SECURITY DEFINER Function", and a guard that a role
-- can name is a guard that a future migration might accidentally make callable.
--
-- release_vendor_credit_on_delivery is SECURITY DEFINER and fires on the delivery transition - the exact trigger that
-- moves a vendor's money. shop_order_receipts_guard protects the pickup-station audit trail.
--
-- Precedent: append_only_guard, coin_ledger_guard and financial_no_truncate are all already revoked this way.

revoke all on function public.release_vendor_credit_on_delivery() from public, anon, authenticated, service_role;
revoke all on function public.shop_order_receipts_guard() from public, anon, authenticated, service_role;

-- Prove the fire path survived: revoking EXECUTE does not affect a trigger's ability to invoke its function.
do $$
declare v_missing text;
begin
  if not exists (
    select 1 from pg_trigger
     where tgrelid = 'public.shop_orders'::regclass
       and tgname = 'trg_shop_order_release_on_delivery'
       and not tgisinternal
  ) then
    raise exception 'trg_shop_order_release_on_delivery is missing: revoking EXECUTE must not remove the trigger';
  end if;

  select string_agg(p.proname, ', ') into v_missing
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('release_vendor_credit_on_delivery', 'shop_order_receipts_guard')
     and (has_function_privilege('anon', p.oid, 'execute')
       or has_function_privilege('authenticated', p.oid, 'execute')
       or has_function_privilege('service_role', p.oid, 'execute')
       or has_function_privilege('public', p.oid, 'execute'));
  if v_missing is not null then
    raise exception 'trigger functions are still executable by an API role: %', v_missing;
  end if;
end $$;