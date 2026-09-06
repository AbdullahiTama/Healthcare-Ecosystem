-- 20260907_admin_roles_description_and_platform_view.sql
-- Adds missing description column to admin_roles, creates platform_team_members view
-- for Dashboard spec compatibility (spec says platform_team_members, schema says admin_team_members)
-- Also adds bank_* cols to payout_requests for spec bank_name/account_number/account_name

alter table public.admin_roles add column if not exists description text;

do $$
begin
  if not exists (select 1 from information_schema.tables where table_schema='public' and table_name='platform_team_members') then
    execute 'create view public.platform_team_members as select * from public.admin_team_members';
  end if;
end $$;

alter table public.payout_requests add column if not exists bank_name text;
alter table public.payout_requests add column if not exists account_number text;
alter table public.payout_requests add column if not exists account_name text;

update public.payout_requests set bank_name = bank_details->>'bank_name' where bank_name is null and bank_details is not null;
update public.payout_requests set account_number = bank_details->>'account_number' where account_number is null and bank_details is not null;
update public.payout_requests set account_name = bank_details->>'account_name' where account_name is null and bank_details is not null;
