-- Notifications: a browser may only write what one member does to another, and must say who did it.
--
-- STATUS: written and tested on PGlite (apps/carefind/src/test/payments/notificationsInsertPolicy.db.test.js). NOT applied to
-- production. Deploy ORDER matters: ship the client that sets actor_id on live-show invitations (UserGoLive.jsx) FIRST, then apply
-- this, otherwise "go live with guests" fails on the invitation insert until the client is updated (see "What this can break").
--
-- THE HOLE (same class as F-43 in docs/architecture/Red-Team-Audit.md, which closed it for record_shop_notification only)
--   The live INSERT policy, "notifications insertable by any logged-in actor", is
--       (select auth.uid()) is not null and (actor_id = (select auth.uid()) or actor_id is null)
--   so ANY signed-in user can insert a notification for ANY recipient with actor_id NULL, any type, any message and any link. The
--   shop's own notices ("Payment confirmed for order ...", "Refund processed", "Return approved") are written exactly that way, with
--   no actor, by SECURITY DEFINER functions - so a forged one is indistinguishable from a real one. The page then renders the link
--   it is given: a stranger can put a convincing "Payment confirmed" notice with a phishing link in someone's inbox.
--
-- THE FIX
--   A browser (the `authenticated` role) may insert a notification only if
--     1. it names itself as the actor (actor_id = auth.uid(), never NULL, never someone else), and
--     2. its type is one the app's browser code writes today (an ALLOWLIST: a new browser-written type needs a migration, which is
--        the point - the default is deny, so nobody can post as the platform by choosing a type like 'shop_payment').
--   Everything the platform writes is untouched: the shop and settlement functions are SECURITY DEFINER owned by postgres and the
--   table does not FORCE row level security, so they bypass the policy; the API's service role bypasses it as well.
--
-- WHAT THIS CAN BREAK (checked against the live database and main's code before writing it)
--   * Browser writers on main: notify() always passes the signed-in user as actor; every type it emits is in the list below
--     (like, comment, comment_like, reply, repost, follow, profile_view, gift, mention, news_like, news_comment, review,
--     consultation), and UserGoLive.jsx emits live_invite. UserGoLive did NOT set actor_id - that is the one writer that needs the
--     client change first.
--   * DB writers: all 11 functions that insert into notifications are SECURITY DEFINER (create_shop_order, _settle_shop_order,
--     update_shop_order_status, cancel_shop_order, cleanup_pending_shop_orders, expire_unpaid_shop_orders, quote_shop_order_delivery,
--     process_shop_return, settle_refund, notify_stock_alerts_on_restock, record_shop_notification). Unaffected.
--   * admin-auth.js inserts live_invite for platform-hosted shows with the service role. Unaffected.
--   * SELECT and UPDATE policies (recipient only) are not touched, so reading and marking read work as before.
--
-- IT DOES NOT, by design, stop a member from sending ANOTHER member an ordinary notification (a like, a follow): that is the
-- feature. It makes sure such a notification always carries the sender's own id, and can never pose as the platform.

begin;

do $$
declare
  p record;
begin
  -- Postgres ORs permissive policies: one leftover permissive INSERT (or ALL) policy, whatever it is called, would silently defeat
  -- this. `drop policy if exists <name>` is a no-op on a wrong name and reports success (the C19 lesson in the audit log), so the
  -- policies are found in the catalog, not by name.
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'notifications' and cmd = 'ALL') then
    raise exception 'notifications has a FOR ALL policy; it would bypass the INSERT restriction. Review it by hand first.';
  end if;
  for p in select policyname from pg_policies where schemaname = 'public' and tablename = 'notifications' and cmd = 'INSERT' loop
    execute format('drop policy %I on public.notifications', p.policyname);
  end loop;
end $$;

create policy "notifications insertable by their actor" on public.notifications
  for insert
  with check (
    (select auth.uid()) is not null
    and actor_id = (select auth.uid())
    and type in (
      'like', 'comment', 'comment_like', 'reply', 'repost', 'follow', 'profile_view', 'gift', 'mention',
      'news_like', 'news_comment', 'review', 'consultation', 'live_invite'
    )
  );

-- Fail the whole migration unless the end state is exactly what was intended.
do $$
declare
  n int;
begin
  select count(*) into n from pg_policies where schemaname = 'public' and tablename = 'notifications' and cmd = 'INSERT';
  if n <> 1 then raise exception 'expected exactly one INSERT policy on notifications, found %', n; end if;
  if not (select relrowsecurity from pg_class where oid = 'public.notifications'::regclass) then
    raise exception 'row level security is not enabled on notifications';
  end if;
  select count(*) into n from pg_policies where schemaname = 'public' and tablename = 'notifications' and cmd in ('SELECT', 'UPDATE');
  if n < 2 then raise exception 'the recipient SELECT/UPDATE policies are missing (found %)', n; end if;
end $$;

commit;

-- ROLLBACK (the previous behaviour, only if this must be undone):
--   drop policy "notifications insertable by their actor" on public.notifications;
--   create policy "notifications insertable by any logged-in actor" on public.notifications
--     for insert with check ((select auth.uid()) is not null and (actor_id = (select auth.uid()) or actor_id is null));
