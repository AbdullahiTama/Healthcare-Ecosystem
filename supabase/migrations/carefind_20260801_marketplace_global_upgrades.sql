-- ============================================================================
-- CareFind global marketplace upgrades — one idempotent script covering:
--
--   1. Price visibility toggle  (products.show_price, default true)
--   2. Location coordinates for distance calculation
--      (profiles/businesses/products .latitude/.longitude)
--   3. Followers-list visibility setting (profiles.show_followers)
--   4. fk_posts_user hardening: backfill profiles rows for existing auth
--      users that have none (the FK references profiles(id), so an account
--      without a profile row cannot post) and install the auto-create
--      trigger going forward.
--
-- Applies to the shared Supabase project. Run once via the Supabase SQL
-- editor; every statement is idempotent so re-running is safe.
-- ============================================================================

-- 1. Price visibility toggle — off means "Ask for price" in buyer views
alter table products
  add column if not exists show_price boolean not null default true;

-- 2. Coordinates for distance calculation (haversine), each level falling
--    back to the next: product -> business -> profile (owner/seller)
alter table products
  add column if not exists latitude double precision,
  add column if not exists longitude double precision;

alter table businesses
  add column if not exists latitude double precision,
  add column if not exists longitude double precision;

alter table profiles
  add column if not exists latitude double precision,
  add column if not exists longitude double precision;

-- 3. Owner can hide their followers/following lists (tappable counts show
--    "Private" instead when this is off)
alter table profiles
  add column if not exists show_followers boolean not null default true;

-- 4. fk_posts_user hardening -------------------------------------------------
--    Backfill: any auth.users row without a profiles row gets a bare one.
--    (display_name defaults to the email's local part, same as the trigger;
--    location comes from what the user typed at signup, if anything.)
insert into public.profiles (id, display_name, location)
select u.id,
       coalesce(split_part(u.email, '@', 1), ''),
       nullif(u.raw_user_meta_data ->> 'location', '')
from auth.users u
left join public.profiles p on p.id = u.id
where p.id is null;

--    Trigger going forward: install only if missing (the live database
--    already has an on_auth_user_created trigger, so never overwrite it).
--    NOTE: the inner function uses $func$ tags so it nests safely inside the
--    outer do $do$ block (same-tag dollar quotes would end the block early).
do $do$
begin
  if not exists (select 1 from pg_trigger where tgname = 'on_auth_user_created') then
    create or replace function public.handle_new_user()
    returns trigger
    language plpgsql
    security definer set search_path = public
    as $func$
    begin
      insert into public.profiles (id, display_name, location)
      values (
        new.id,
        coalesce(split_part(new.email, '@', 1), ''),
        nullif(new.raw_user_meta_data ->> 'location', '')
      )
      on conflict (id) do nothing;
      return new;
    end;
    $func$;

    create trigger on_auth_user_created
      after insert on auth.users
      for each row execute function public.handle_new_user();
  end if;
end $do$;
