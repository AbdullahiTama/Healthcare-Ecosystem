-- ============================================================================
-- 20260906_carefindhub_foundation_fixup.sql
--
-- Fixup for 20260906_carefindhub_foundation: advisor hardening + legacy
-- column defaults. See parent migration for full context.
-- ============================================================================

-- 1. Legacy agents columns: city/area were NOT NULL without default, blocking
--    new inserts via spec path (full_name/email). Make them permissive.
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='agents' and column_name='city' and is_nullable='NO') then
    execute 'alter table public.agents alter column city drop not null';
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='agents' and column_name='area' and is_nullable='NO') then
    execute 'alter table public.agents alter column area drop not null';
  end if;
end $$;

alter table public.agents alter column city set default '';
alter table public.agents alter column area set default '';
alter table public.agents alter column name set default '';
alter table public.agents alter column contact_email set default '';
alter table public.agents alter column contact_phone set default '';

-- 2. Pin search_path for update_updated_at_column (advisor: function_search_path_mutable)
create or replace function public.update_updated_at_column()
returns trigger
language plpgsql
set search_path = public
as $$
begin new.updated_at = now(); return new; end; $$;

-- 3. Revoke EXECUTE on trigger helpers that should not be RPC-exposed
revoke execute on function public.enforce_agent_tier_limit() from public, anon, authenticated;
revoke execute on function public.generate_agent_referral_code() from public, anon, authenticated;
revoke execute on function public.prevent_agent_self_parent() from public, anon, authenticated;
revoke execute on function public.update_updated_at_column() from public, anon, authenticated;
