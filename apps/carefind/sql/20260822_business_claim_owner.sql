-- ============================================================================
-- 20260822_business_claim_owner.sql
--
-- Follow-up to issue #7 (missing review notifications), found in review.
--
-- `notifyReview` resolves a business review's recipient by reading
-- `business_claims` for the approved claim. That read runs as the REVIEWER,
-- and `business_claims`' SELECT policy is:
--
--   is_platform_admin()
--   OR user_id = auth.uid()
--   OR business_id IN (select current_business_ids())
--
-- A reviewer is none of those for a business they do not own, so the read
-- returns zero rows and the notification is silently skipped — the exact
-- failure the issue is about, moved one layer down.
--
-- PROVEN, not assumed: impersonating a real authenticated user who is not the
-- claimant, `select count(*) from business_claims where business_id = <a real
-- claimed business> and status='approved'` returned **0**. (The product path
-- needs no equivalent: `products` carries a `public can view listed products`
-- SELECT policy on `list_on_carefind = true`, and the same probe read 6 owner
-- ids fine.)
--
-- FIX. A SECURITY DEFINER function that answers exactly one question — "who
-- owns this business?" — rather than opening the table. It returns a single
-- uuid and nothing else: no claim rows, no status history, no other business.
-- The claimant's identity is already public in practice (their business
-- dashboard and profile are), so this exposes nothing new; it just stops the
-- notification path depending on a policy written for a different purpose.
-- ============================================================================

begin;

create or replace function public.business_claim_owner(p_business_id uuid)
returns uuid
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select bc.user_id
    from public.business_claims bc
   where bc.business_id = p_business_id
     and bc.status = 'approved'
   order by bc.created_at asc
   limit 1;
$$;

comment on function public.business_claim_owner(uuid) is
  'Approved claimant of a business, for addressing review notifications. SECURITY DEFINER because business_claims SELECT is scoped to the claimant; returns a single uuid and no other claim data.';

-- ACL. Supabase grants EXECUTE to anon+authenticated by default at creation,
-- and `REVOKE ... FROM public` does NOT remove those direct role grants — the
-- trap documented in architecture/Security-Risks.md that has bitten this
-- project three times. Revoke the roles explicitly, then re-grant only the one
-- that needs it.
revoke all on function public.business_claim_owner(uuid) from public, anon, authenticated;
grant execute on function public.business_claim_owner(uuid) to authenticated;

commit;

-- ============================================================================
-- VERIFICATION — run these, do not trust the statements above.
--
--   -- (a) the ACL is what we think it is
--   select has_function_privilege('anon',          'public.business_claim_owner(uuid)', 'execute') as anon_exec,
--          has_function_privilege('authenticated', 'public.business_claim_owner(uuid)', 'execute') as auth_exec;
--   -- expect: anon_exec = false, auth_exec = true
--
--   -- (b) a non-claimant reviewer can now resolve the owner
--   set local role authenticated;
--   select set_config('request.jwt.claims',
--     json_build_object('sub', '<some other user>', 'role','authenticated')::text, true);
--   select public.business_claim_owner('<a claimed business id>');
--   -- expect: the claimant's uuid (was: 0 rows via a direct business_claims read)
--   reset role;
--
--   -- (c) it still returns null for an unclaimed business
--   select public.business_claim_owner('00000000-0000-0000-0000-000000000000');
--   -- expect: null
-- ============================================================================
