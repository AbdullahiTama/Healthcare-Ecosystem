-- Financial audit F-24: money tables were writable straight from the browser.
--
-- Live catalog (2026-10-03) showed `authenticated` holding INSERT/UPDATE/DELETE on every
-- financial table, no triggers, and RLS policies that allowed e.g. a business owner to UPDATE
-- business_wallets.available_balance, a user to INSERT a wallet with any balance, to plant
-- withdrawal_requests rows (which makes the F-01 reference-reuse bug deterministic), to edit
-- their own withdrawal_trust tier and to rewrite their own CareCoin ledger.
--
-- After this migration every mutation of these tables goes through service-role code or
-- SECURITY DEFINER RPCs. Clients keep SELECT (existing policies untouched) plus two narrow
-- exceptions the app genuinely needs:
--   * wallets: INSERT own row with balance = 0 (ensureWallet in the client)
--   * creator_subscriptions: UPDATE auto_renew only (cancelAutoRenew in the client)
--
-- Policies are dropped by predicate (every non-SELECT policy on the listed tables), not by
-- name: a wrong-name DROP POLICY IF EXISTS is a silent no-op (see C14/C19).

do $$
declare
  t text;
  pol record;
  tables text[] := array[
    'wallets','transactions','gifts','withdrawal_requests','withdrawal_trust',
    'business_wallets','business_wallet_transactions','business_withdrawal_requests',
    'agent_earnings','creator_subscriptions'
  ];
begin
  foreach t in array tables loop
    if to_regclass('public.' || t) is null then
      raise exception 'expected table public.% is missing', t;
    end if;

    for pol in
      select policyname from pg_policies
       where schemaname = 'public' and tablename = t and cmd <> 'SELECT'
    loop
      execute format('drop policy %I on public.%I', pol.policyname, t);
    end loop;

    execute format('revoke insert, update, delete, truncate on public.%I from anon, authenticated', t);
  end loop;
end $$;

-- ALL policies were dropped above along with their read side. Restore read access with the
-- same predicates the old policies used, as SELECT-only.
-- business_* : owner/staff of the business, or platform admin.
-- agent_earnings : the agent matched by contact_email.
-- withdrawal_trust : the user themself.
create policy "business_wallets tenant read" on public.business_wallets
  for select using (business_id in (select public.current_business_ids()) or public.is_platform_admin());
create policy "business_wallet_transactions tenant read" on public.business_wallet_transactions
  for select using (business_id in (select public.current_business_ids()) or public.is_platform_admin());
create policy "business_withdrawal_requests tenant read" on public.business_withdrawal_requests
  for select using (business_id in (select public.current_business_ids()) or public.is_platform_admin());
create policy "agent_earnings own read" on public.agent_earnings
  for select to authenticated using (
    agent_id in (select id from public.agents where lower(contact_email) = lower(auth.email()))
  );
create policy "withdrawal_trust own read" on public.withdrawal_trust
  for select to authenticated using (user_id = auth.uid());

-- Narrow exceptions.
create policy "wallets insert own empty" on public.wallets
  for insert to authenticated
  with check (user_id = auth.uid() and balance = 0);
grant insert on public.wallets to authenticated;

grant update (auto_renew) on public.creator_subscriptions to authenticated;
create policy "creator_subscriptions subscriber can cancel auto renew" on public.creator_subscriptions
  for update to authenticated
  using (subscriber_id = auth.uid()) with check (subscriber_id = auth.uid());

-- Self-check: fail the migration if the end state is not what it claims.
do $$
declare bad text;
begin
  select string_agg(table_name || ':' || privilege_type, ', ') into bad
    from information_schema.role_table_grants
   where table_schema = 'public'
     and grantee in ('anon', 'authenticated')
     and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')
     and table_name in ('transactions','gifts','withdrawal_requests','withdrawal_trust',
                        'business_wallets','business_wallet_transactions',
                        'business_withdrawal_requests','agent_earnings','wallets','creator_subscriptions')
     and not (table_name = 'wallets' and grantee = 'authenticated' and privilege_type = 'INSERT');
  if bad is not null then raise exception 'table-level write grants remain: %', bad; end if;

  select string_agg(tablename || '.' || policyname, ', ') into bad
    from pg_policies
   where schemaname = 'public' and cmd <> 'SELECT'
     and tablename in ('transactions','gifts','withdrawal_requests','withdrawal_trust',
                       'business_wallets','business_wallet_transactions',
                       'business_withdrawal_requests','agent_earnings')
   ;
  if bad is not null then raise exception 'write policies remain: %', bad; end if;
end $$;
