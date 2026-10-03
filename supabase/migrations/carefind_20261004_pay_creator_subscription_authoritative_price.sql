-- Financial audit F-04 (coin path): pay_creator_subscription(p_creator, p_price) charged whatever
-- price the CALLER passed, so a creator listing 12 CareCoins could be subscribed to for 1.
--
-- The price is now whatever the creator's profile lists (profiles.subscription_price); the argument
-- is kept for signature compatibility but must equal it, otherwise nothing moves and the caller is
-- told 'price_mismatch'. Subscribing to yourself and to a creator with nothing for sale are refused.
-- The body is otherwise unchanged. Same signature => CREATE OR REPLACE swaps the function in place,
-- keeping its grants and leaving no overload behind (asserted at the bottom).

create or replace function public.pay_creator_subscription(p_creator uuid, p_price integer)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_subscriber uuid := auth.uid();
  v_balance numeric;
  v_current timestamptz;
  v_listed integer;
begin
  if v_subscriber is null then
    return 'not_signed_in';
  end if;
  if p_creator is null or p_price is null or p_price <= 0 then
    return 'invalid_args';
  end if;
  if p_creator = v_subscriber then
    return 'self_subscription';
  end if;

  -- The creator's own listed price is the only price there is.
  select subscription_price into v_listed from public.profiles where id = p_creator;
  if v_listed is null or v_listed <= 0 then
    return 'not_for_sale';
  end if;
  if p_price <> v_listed then
    return 'price_mismatch';
  end if;

  select balance into v_balance from public.wallets where user_id = v_subscriber for update;
  if v_balance is null or v_balance < v_listed then
    return 'insufficient';
  end if;

  update public.wallets set balance = balance - v_listed where user_id = v_subscriber;

  insert into public.wallets (user_id, balance)
  values (p_creator, v_listed)
  on conflict (user_id) do update set balance = public.wallets.balance + v_listed;

  select expires_at into v_current
    from public.creator_subscriptions
   where subscriber_id = v_subscriber and creator_id = p_creator;

  insert into public.creator_subscriptions (subscriber_id, creator_id, price, expires_at, auto_renew)
  values (v_subscriber, p_creator, v_listed, now() + interval '30 days', true)
  on conflict (subscriber_id, creator_id) do update
    set expires_at = greatest(coalesce(v_current, now()), now()) + interval '30 days',
        price = v_listed,
        auto_renew = true;

  insert into public.transactions (user_id, type, amount, status)
  values (v_subscriber, 'subscription', -v_listed, 'success'),
         (p_creator, 'subscription_earning', v_listed, 'success');

  return 'ok';
end;
$function$;

do $$
declare n integer; bad text;
begin
  select count(*) into n from pg_proc where pronamespace = 'public'::regnamespace and proname = 'pay_creator_subscription';
  if n <> 1 then raise exception 'expected exactly one pay_creator_subscription, found %', n; end if;

  select string_agg(p.proname, ', ') into bad from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname = 'pay_creator_subscription'
     and has_function_privilege('anon', p.oid, 'execute');
  if bad is not null then raise exception 'anon can execute %', bad; end if;
end $$;
