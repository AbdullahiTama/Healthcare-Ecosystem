-- ============================================================================
-- 2026-10-09 — Structured notifications + server-only payment notices
--
-- STATUS: WRITTEN, NOT YET APPLIED TO PRODUCTION.
--         Apply this BEFORE deploying the client/API that ships with it (the
--         Notifications page selects the new columns and the API writes them).
--         Rolling back = drop the policy created below, re-create the old one
--         (text in "ROLLBACK" at the end), and drop the three columns.
--
-- WHY
-- ---
-- 1. Notifications were a single sentence fragment ("liked your post") that the
--    UI glued to an actor's name — and to "Someone" when there was no actor,
--    which is every system event. Money events (a wallet top-up, a paid
--    consultation, a renewal charged to a wallet) need a headline, a detail
--    line and the facts (amount, reference), written once by the server that
--    verified the payment. That needs somewhere to put them: `title`, `metadata`.
--
-- 2. Idempotent announcements. Paystack's webhook and the browser redirect both
--    settle the same payment; whichever inserts the buyer's notification first
--    owns the receipt email. `dedupe_key` under a unique index
--    (recipient_id, dedupe_key) makes that race safe. NULL keys (every ordinary
--    activity notification) never conflict — NULLs are distinct in a unique
--    index — so a plain, non-partial index is enough and keeps
--    ON CONFLICT / unique_violation handling simple.
--
-- 3. SECURITY — this is the part that must not be skipped. The existing INSERT
--    policy ("notifications insertable by any logged-in actor", from
--    carefind_rls_hardening.sql) accepts `actor_id IS NULL` from ANY signed-in
--    user, so anyone could already write a system-looking notification into
--    anyone's inbox. That was merely rude while the UI prefixed every such row
--    with "Someone"; it becomes a phishing channel the moment the UI renders
--    "Payment received" notices as trusted system messages. Browser inserts are
--    therefore narrowed to exactly what the browser legitimately writes:
--      * actor_id = the signed-in user (always says WHO did it; cannot claim
--        to be another user, and cannot be NULL);
--      * no title, no metadata, no dedupe_key (those belong to server-authored
--        notices);
--      * a type that does not start with 'payment_' (reserved for the server).
--    The API writes with the service role, which bypasses RLS, so payment
--    notices are unaffected. Recipients can still SELECT/UPDATE their own rows
--    (policies untouched); editing your own row only changes what YOU see.
--
-- DROP BY CATALOG, NOT BY NAME (the C19 lesson, planning/CODE_AUDIT.md):
--    Postgres ORs permissive policies, so one leftover permissive INSERT policy
--    — whatever it is called live — would silently defeat the tightening, and
--    `DROP POLICY IF EXISTS <wrong name>` is a no-op that reports success. This
--    drops every INSERT policy on the table by reading pg_policies, refuses to
--    run if a blanket ALL policy exists (that needs a human decision), and the
--    final DO block asserts the end state.
--
-- Idempotent: safe to run twice.
-- ============================================================================

begin;

-- 1. Columns ------------------------------------------------------------------
alter table public.notifications
  add column if not exists title text,
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists dedupe_key text;

comment on column public.notifications.title is
  'Server-authored headline. Only set on payment_* notices; browsers cannot write it.';
comment on column public.notifications.metadata is
  'Facts for display (amount_kobo, coins, reference, method, counterpart_id). Server-written only.';
comment on column public.notifications.dedupe_key is
  'Idempotency key for server announcements, e.g. topup:<paystack reference>. Unique per recipient.';

-- 2. One announcement per (recipient, purchase) -------------------------------
create unique index if not exists notifications_recipient_dedupe_uniq
  on public.notifications (recipient_id, dedupe_key);

-- 3. Narrow browser INSERTs ---------------------------------------------------
do $$
declare
  p record;
begin
  if exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'notifications' and cmd = 'ALL'
  ) then
    raise exception
      'notifications has a FOR ALL policy; it would bypass the INSERT restrictions. Review it by hand before running this migration.';
  end if;

  for p in
    select policyname from pg_policies
     where schemaname = 'public' and tablename = 'notifications' and cmd = 'INSERT'
  loop
    execute format('drop policy %I on public.notifications', p.policyname);
  end loop;
end $$;

create policy "notifications insertable by their actor" on public.notifications
  for insert
  with check (
    auth.uid() is not null
    and actor_id = auth.uid()
    and title is null
    and dedupe_key is null
    and metadata = '{}'::jsonb
    and coalesce(left(type, 8), '') <> 'payment_'
  );

-- 4. Assert the end state (fails the whole migration if it is not true) -------
do $$
declare
  n int;
begin
  select count(*) into n from pg_policies
   where schemaname = 'public' and tablename = 'notifications' and cmd = 'INSERT';
  if n <> 1 then
    raise exception 'expected exactly 1 INSERT policy on notifications, found %', n;
  end if;

  if not (select relrowsecurity from pg_class where oid = 'public.notifications'::regclass) then
    raise exception 'RLS is not enabled on notifications';
  end if;

  select count(*) into n from information_schema.columns
   where table_schema = 'public' and table_name = 'notifications'
     and column_name in ('title', 'metadata', 'dedupe_key');
  if n <> 3 then
    raise exception 'expected the 3 new notifications columns, found %', n;
  end if;
end $$;

commit;

-- ============================================================================
-- VERIFY AFTER APPLYING (behaviour, not catalog — run in the SQL editor).
-- Every statement below is expected to behave as annotated. The block is
-- rolled back, so it leaves nothing behind. Replace the two uuids with real
-- profile ids first.
--
--   begin;
--   set local role authenticated;
--   select set_config('request.jwt.claims', '{"sub":"<USER_A_UUID>"}', true);
--
--   -- OK: ordinary activity from the signed-in user
--   insert into notifications (recipient_id, actor_id, type, message)
--     values ('<USER_B_UUID>', '<USER_A_UUID>', 'like', 'liked your post');
--
--   -- each of these must FAIL with 42501 (new row violates row-level security):
--   insert into notifications (recipient_id, actor_id, type, message)
--     values ('<USER_B_UUID>', null, 'like', 'forged system notice');            -- no actor
--   insert into notifications (recipient_id, actor_id, type, message)
--     values ('<USER_B_UUID>', '<USER_B_UUID>', 'like', 'pretend to be B');      -- someone else as actor
--   insert into notifications (recipient_id, actor_id, type, title, message)
--     values ('<USER_B_UUID>', '<USER_A_UUID>', 'payment_topup', 'Wallet top-up successful', 'x'); -- payment type
--   insert into notifications (recipient_id, actor_id, type, title, message)
--     values ('<USER_B_UUID>', '<USER_A_UUID>', 'like', 'Your account is suspended', 'x');        -- server-only title
--   insert into notifications (recipient_id, actor_id, type, message, dedupe_key)
--     values ('<USER_B_UUID>', '<USER_A_UUID>', 'like', 'x', 'topup:fake');                       -- server-only key
--   rollback;
--
-- ROLLBACK (only if this must be reverted):
--   drop policy "notifications insertable by their actor" on public.notifications;
--   create policy "notifications insertable by any logged-in actor" on public.notifications
--     for insert with check (auth.uid() is not null and (actor_id = auth.uid() or actor_id is null));
--   drop index if exists public.notifications_recipient_dedupe_uniq;
--   alter table public.notifications drop column if exists title,
--     drop column if exists metadata, drop column if exists dedupe_key;
-- ============================================================================
