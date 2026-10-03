-- ============================================================================
-- CareFind RLS hardening — DRAFT ONLY. DO NOT RUN AGAINST PRODUCTION YET.
--
-- Companion to apps/carehub/sql/phase2_rls_pilot.sql's C14 fix, covering
-- CareFind's own ~35 tables (business_claims/businesses/consultations are
-- shared with CareHub and already handled in that file; staff_claims is
-- also already handled there).
--
-- Unlike CareHub's tables (which had exactly one blanket "Allow all" policy
-- each and nothing else), CareFind's tables mostly ALREADY have a real,
-- correctly-scoped policy set — self-ownership checks, public-read where
-- appropriate — sitting alongside a smaller number of dangerously broad
-- policies, usually named "Allow all" / "manage X" / "Admin can/update X".
-- Because Postgres ORs all PERMISSIVE policies together, those broad ones
-- fully defeat the correct ones next to them. This file's approach is
-- therefore surgical, not a wholesale rewrite: DROP the specific dangerous
-- policy, ADD a replacement only where dropping it leaves a real gap.
-- Every DROP below is a policy name/table verified directly against a live
-- `pg_policies` snapshot taken 2026-07-18, not guessed — re-verify before
-- running if time has passed, since a DROP POLICY IF EXISTS for a
-- since-renamed policy is a silent no-op, not an error.
--
-- Three categories of finding, by severity:
--   (1) Fake-admin policies (named "Admin ..." but qual:true, no real check)
--       — now genuinely fixable, because this same pass moved every
--       AdminPanel.jsx read AND write that needed these tables' full
--       visibility behind api/admin-auth.js's service-role client (which
--       bypasses RLS by design, the same way it already did for H11/C9).
--       Dropping these policies closes real holes without breaking the
--       admin dashboard, because the admin dashboard no longer depends on
--       them.
--   (2) Blanket "Allow all"/"manage X" policies with zero ownership check
--       on tables with real per-user data (playlists, playlist_parts,
--       live_shows, live_participants, creator_subscriptions, products,
--       product_subscriptions, user_reviews) — replaced with real
--       ownership-scoped policies matching actual application behavior,
--       researched directly against every non-admin call site.
--   (3) Missing policies entirely — three tables (`subscriptions`,
--       `user_subscriptions`, and `wallets`' INSERT, `task_submissions`'
--       INSERT, `live_messages`' DELETE) have RLS enabled with either zero
--       policies or a missing command, meaning the underlying feature is
--       ALREADY silently broken in production today, independent of
--       anything in this file. Adding the correct policy both closes no
--       new gap (there was none — it was already default-deny) and
--       restores the feature. Not a security fix, a bug fix found along
--       the way.
--
-- Also fixed here, found during the gifting research: GiftPanel.jsx and
-- LiveSession.jsx used to perform raw client-side writes to *other users'*
-- wallets/transactions (crediting a recipient's balance directly from the
-- sender's browser session, no ownership check at all — worse than C11's
-- already-tracked non-atomicity, this had no authorization check
-- whatsoever). Fixed with a new `send_gift` SECURITY DEFINER RPC (mirrors
-- the existing `pay_creator_subscription` pattern) — already applied to
-- the live database and wired into both client files, ahead of this SQL
-- file, since it was a self-contained fix with no RLS dependency. Because
-- gifting no longer does raw wallet/transaction/gifts writes, this file's
-- wallets/transactions policies can safely be owner-only with no
-- cross-user exception.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. Social feed — posts, news: drop the fake-admin policies. Everything
--    else on these two tables (and post_comments/post_reactions/saved_posts/
--    follows/news_comments/news_reactions/saved_news, none listed below)
--    was already correctly scoped — nothing to change there.
-- ----------------------------------------------------------------------------

-- "Admin can read all posts" was redundant (posts are already publicly
-- readable via the real "Posts are publicly readable" policy) but "Admin
-- delete posts" (qual:true, no actual admin check) let anyone delete any
-- post — deletePost() now goes through api/admin-auth.js regardless.
DROP POLICY IF EXISTS "Admin can read all posts" ON posts;
DROP POLICY IF EXISTS "Admin delete posts" ON posts;

-- "Manage news update" (qual:true, with_check:true) let ANY user forge
-- `status: 'approved'` on any news article via a raw client update,
-- bypassing moderation entirely — a real, exploitable bypass, not just an
-- admin-impersonation risk. "Manage news delete" let anyone delete any
-- article. Both admin actions now go through approve_news/reject_news/
-- delete_news on api/admin-auth.js.
DROP POLICY IF EXISTS "Manage news update" ON news;
DROP POLICY IF EXISTS "Manage news delete" ON news;

-- "Admin read reports" (qual:true) exposed every report — including who
-- reported what — to anyone with the anon key. "Admin update reports"
-- (qual:true) let anyone mark any report resolved. Both now go through
-- resolve_report on api/admin-auth.js; "Users can see their own reports"
-- and "Users can submit reports" (already correctly scoped) are untouched.
DROP POLICY IF EXISTS "Admin read reports" ON reports;
DROP POLICY IF EXISTS "Admin update reports" ON reports;


-- ----------------------------------------------------------------------------
-- 2. stories — INSERT/DELETE both currently check `is_platform = true OR
--    user_id = auth.uid()`, but `is_platform` is a column on the ROW BEING
--    WRITTEN, not a check on who's writing it — any authenticated (or even
--    anon, since these policies apply to role `public`) user can insert a
--    story with `is_platform: true` and have it appear as an official
--    platform story to everyone, or delete any platform story. Since
--    create_story/delete_story now go through api/admin-auth.js, the
--    client should never be allowed to set/target is_platform stories at
--    all — replaced with plain self-ownership, no bypass clause.
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Insert own or platform story" ON stories;
DROP POLICY IF EXISTS "Delete own or platform story" ON stories;

CREATE POLICY "stories insertable by their own user" ON stories
  FOR INSERT
  WITH CHECK (user_id = auth.uid() AND is_platform = false);

CREATE POLICY "stories deletable by their own user" ON stories
  FOR DELETE
  USING (user_id = auth.uid());

-- "Public can read active stories" and "Anyone can update story views" are
-- left as-is — the update policy only ever bumps view_count in practice
-- (increment_story_view RPC) and Postgres RLS can't scope to a single
-- column without a trigger; not part of this pass's scope.


-- ----------------------------------------------------------------------------
-- 3. Live streaming — the sharpest finding in this file. Several tables
--    have a blanket "manage X"/qual:true policy that lets ANY user hide any
--    live comment, end/edit any other host's show, or claim any sender_id
--    on a live item — all currently exploitable directly via the Supabase
--    REST API even though the UI only exposes these actions to the actual
--    host. live_sessions already has a correctly host-scoped policy
--    (`Host can manage session`, qual: auth.uid() = host_id) — confirmed
--    directly against the live policy definition, not assumed from the
--    client code (which itself has an unscoped query) — so it needed no
--    change.
-- ----------------------------------------------------------------------------

-- live_shows: "manage live shows" (qual:true/with_check:true) let anyone
-- start/end/edit any show, including shows they don't host. LiveDashboard
-- .jsx's own queries are unscoped (`.eq('id', showId)` only), so this is
-- the only enforcement. AdminPanel.jsx's platform-show actions
-- (schedule_show/start_live_show/start_scheduled_show/cancel_scheduled_show
-- /end_live_show) already go through api/admin-auth.js's service role, so
-- they're unaffected by tightening this.
DROP POLICY IF EXISTS "manage live shows" ON live_shows;

CREATE POLICY "live_shows insertable by their host" ON live_shows
  FOR INSERT
  WITH CHECK (host_id = auth.uid());

CREATE POLICY "live_shows updatable by their host" ON live_shows
  FOR UPDATE
  USING (host_id = auth.uid())
  WITH CHECK (host_id = auth.uid());

-- live_items: INSERT check was unconditionally `true` — anyone could post
-- a chat/reaction item claiming any sender_id. LiveDashboard.jsx's own
-- inserts always set sender_id to the caller's own id; this just makes
-- that the enforced rule, not just the convention. AdminPanel.jsx's
-- platform-show posting (post_live_item) is unaffected — service role.
DROP POLICY IF EXISTS "insert live items" ON live_items;

CREATE POLICY "live_items insertable by their sender" ON live_items
  FOR INSERT
  WITH CHECK (sender_id = auth.uid());

-- live_comments: "moderate live comments" (qual:true/with_check:true) let
-- anyone hide/unhide any comment on any show — host-only in the UI, not
-- enforced anywhere else. AdminPanel.jsx's hide_live_comment already goes
-- through service role.
DROP POLICY IF EXISTS "moderate live comments" ON live_comments;

CREATE POLICY "live_comments moderatable by the show host" ON live_comments
  FOR UPDATE
  USING (show_id IN (SELECT id FROM live_shows WHERE host_id = auth.uid()))
  WITH CHECK (show_id IN (SELECT id FROM live_shows WHERE host_id = auth.uid()));

-- live_participants: "manage live participants" (qual:true/with_check:true)
-- let anyone insert/update/delete any participant row for any show. Real
-- shape: a show's host invites guests (inserting rows for OTHER users, by
-- design — UserGoLive.jsx's inviteGuests), and a guest marks themselves
-- joined (LiveDashboard.jsx, self-scoped). Two separate policies for two
-- separate actors, neither of which is "anyone."
DROP POLICY IF EXISTS "manage live participants" ON live_participants;

CREATE POLICY "live_participants insertable by the show host" ON live_participants
  FOR INSERT
  WITH CHECK (show_id IN (SELECT id FROM live_shows WHERE host_id = auth.uid()));

CREATE POLICY "live_participants updatable by themselves" ON live_participants
  FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- live_reactions/live_shares/live_views: INSERT checks were unconditionally
-- `true`, so any request could claim any user_id (identity spoofing in
-- engagement counts). The app allows genuinely anonymous engagement
-- (`user_id: user?.id || null`), so NULL still needs to be allowed — the
-- fix is only that a non-null user_id must match the real caller.
DROP POLICY IF EXISTS "lr_insert_all" ON live_reactions;
CREATE POLICY "live_reactions insertable by self or anon" ON live_reactions
  FOR INSERT
  WITH CHECK (user_id IS NULL OR user_id = auth.uid());

DROP POLICY IF EXISTS "insert live shares" ON live_shares;
CREATE POLICY "live_shares insertable by self or anon" ON live_shares
  FOR INSERT
  WITH CHECK (user_id IS NULL OR user_id = auth.uid());

DROP POLICY IF EXISTS "insert live views" ON live_views;
CREATE POLICY "live_views insertable by self or anon" ON live_views
  FOR INSERT
  WITH CHECK (user_id IS NULL OR user_id = auth.uid());

-- live_messages: no DELETE policy exists at all today, meaning
-- LiveSession.jsx's endSession() bulk-delete of session chat is currently
-- silently failing in production (RLS enabled, no matching policy =
-- default deny) — a pre-existing broken-feature bug, not a security hole.
-- Adding the correctly host-scoped policy both closes no new gap and
-- restores the feature.
CREATE POLICY "live_messages deletable by the session host" ON live_messages
  FOR DELETE
  USING (session_id IN (SELECT id FROM live_sessions WHERE host_id = auth.uid()));


-- ----------------------------------------------------------------------------
-- 4. Playlists — playlist_parts had literally zero ownership check
--    anywhere (not in the client query, not in the RLS policy) for
--    insert/update/delete — any authenticated user could edit or delete
--    any part of any playlist. playlists itself allowed the same via its
--    own blanket policy, though nothing in the UI currently exercises
--    update/delete on playlists directly.
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "manage playlists" ON playlists;

CREATE POLICY "playlists manageable by their owner" ON playlists
  FOR ALL
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

DROP POLICY IF EXISTS "manage playlist parts" ON playlist_parts;

CREATE POLICY "playlist_parts manageable by the playlist owner" ON playlist_parts
  FOR ALL
  USING (playlist_id IN (SELECT id FROM playlists WHERE owner_id = auth.uid()))
  WITH CHECK (playlist_id IN (SELECT id FROM playlists WHERE owner_id = auth.uid()));


-- ----------------------------------------------------------------------------
-- 5. Marketplace — products needs a CareFind-specific ownership policy
--    layered alongside CareHub's own business_id-scoped one (in
--    phase2_rls_pilot.sql) — Postgres ORs them together, which is exactly
--    what's wanted here: a CareHub business manages its own products via
--    business_id, a CareFind user manages products they personally list or
--    that belong to a business they've claimed and been approved for, via
--    a separate policy. Not touching CareHub's existing policy.
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Allow all products" ON products;
DROP POLICY IF EXISTS "manage own products" ON products;

CREATE POLICY "products insertable by owner or approved claimant" ON products
  FOR INSERT
  WITH CHECK (
    owner_id = auth.uid()
    OR business_id IN (SELECT business_id FROM business_claims WHERE user_id = auth.uid() AND status = 'approved')
  );

CREATE POLICY "products updatable by owner or approved claimant" ON products
  FOR UPDATE
  USING (
    owner_id = auth.uid()
    OR business_id IN (SELECT business_id FROM business_claims WHERE user_id = auth.uid() AND status = 'approved')
  )
  WITH CHECK (
    owner_id = auth.uid()
    OR business_id IN (SELECT business_id FROM business_claims WHERE user_id = auth.uid() AND status = 'approved')
  );

-- "read products" (public, qual:true) is left as-is — marketplace browsing
-- is meant to be public.

-- user_reviews: "manage user reviews" (qual:true/with_check:true) let
-- anyone insert/edit/delete a review of any person, claiming any user_id
-- as the reviewer.
DROP POLICY IF EXISTS "manage user reviews" ON user_reviews;

CREATE POLICY "user_reviews insertable by the reviewer" ON user_reviews
  FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- reviews: "write reviews" (with_check:true) was a second, unrestricted
-- INSERT policy sitting alongside the already-correct "Logged in users can
-- add reviews" (auth.uid() = user_id) — permissive policies OR together,
-- so the unrestricted one fully defeated the correct one. Just drop the
-- bad one; the good one (and the read/delete policies) are untouched.
DROP POLICY IF EXISTS "write reviews" ON reviews;

-- product_subscriptions: "manage product subs" (qual:true/with_check:true)
-- — not currently exercised by any wired-up UI (the button is a
-- placeholder), but directly exploitable via the API regardless. Folding
-- SELECT into the same self-scoped policy; "read product subs" (also
-- qual:true) is redundant with it and dropped too.
DROP POLICY IF EXISTS "manage product subs" ON product_subscriptions;
DROP POLICY IF EXISTS "read product subs" ON product_subscriptions;

CREATE POLICY "product_subscriptions manageable by their own user" ON product_subscriptions
  FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());


-- ----------------------------------------------------------------------------
-- 6. Monetization — the highest-severity group. Several "Admin ..." named
--    policies expose real PII/financial data (verification credentials,
--    bank account numbers, transaction history) to anyone with the anon
--    key; creator_subscriptions has a fully unrestricted policy that would
--    let anyone edit anyone else's paid subscription; and three
--    tables/columns are missing a policy entirely, meaning the underlying
--    feature is currently silently broken (not a security gap — the
--    opposite: over-restrictive by accident).
-- ----------------------------------------------------------------------------

-- verification_requests: both "Admin ..." SELECT policies (qual:true)
-- exposed every user's phone number, workplace, and credential URL to
-- anyone. "Admin update verifications" (qual:true) let anyone approve/
-- reject any request. All three admin actions now go through
-- approve_verification/reject_verification/list_verification_requests on
-- api/admin-auth.js. "Users can read their own request" and "Users can
-- submit a request" (already correctly scoped) are untouched — after these
-- drops, verification_requests has no admin-facing policy at all for
-- regular sessions, which is correct: there shouldn't be one.
DROP POLICY IF EXISTS "Admin can read verifications" ON verification_requests;
DROP POLICY IF EXISTS "Admin read verifications" ON verification_requests;
DROP POLICY IF EXISTS "Admin update verifications" ON verification_requests;

-- withdrawal_requests: "Admin read withdrawals" (qual:true) exposed every
-- user's bank name/account number/account name to anyone. "Admin update
-- withdrawals" (qual:true) let anyone approve their own (or anyone's)
-- withdrawal. Both now go through approve_withdrawal/reject_withdrawal/
-- list_withdrawal_requests on api/admin-auth.js.
DROP POLICY IF EXISTS "Admin read withdrawals" ON withdrawal_requests;
DROP POLICY IF EXISTS "Admin update withdrawals" ON withdrawal_requests;

-- transactions: both "Admin ..." SELECT policies (qual:true, duplicated)
-- exposed every user's full transaction history to anyone. Now via
-- list_transactions on api/admin-auth.js.
DROP POLICY IF EXISTS "Admin can read all transactions" ON transactions;
DROP POLICY IF EXISTS "Admin read transactions" ON transactions;

-- task_submissions: "Admin can read task submissions" (qual:true) exposed
-- every professional's task application to anyone. Now via
-- list_task_submissions. There was ALSO no INSERT policy at all —
-- ProfessionalMonetization.jsx's acceptTask() has been silently failing in
-- production (default deny), a pre-existing bug this closes.
DROP POLICY IF EXISTS "Admin can read task submissions" ON task_submissions;

CREATE POLICY "task_submissions visible to their own professional" ON task_submissions
  FOR SELECT
  USING (professional_id = auth.uid());

CREATE POLICY "task_submissions insertable by their own professional" ON task_submissions
  FOR INSERT
  WITH CHECK (professional_id = auth.uid());

-- creator_subscriptions: "manage subs" (qual:true/with_check:true) let
-- anyone read/edit/cancel anyone's paid subscription. The only real write
-- path is pay_creator_subscription (SECURITY DEFINER RPC, bypasses RLS —
-- already exists, unrelated to this pass), plus a legitimate self-scoped
-- cancelAutoRenew update. "read subs" (also qual:true) is redundant with
-- the too-broad policy and dropped too.
DROP POLICY IF EXISTS "manage subs" ON creator_subscriptions;
DROP POLICY IF EXISTS "read subs" ON creator_subscriptions;

CREATE POLICY "creator_subscriptions visible to their own subscriber" ON creator_subscriptions
  FOR SELECT
  USING (subscriber_id = auth.uid());

CREATE POLICY "creator_subscriptions updatable by their own subscriber" ON creator_subscriptions
  FOR UPDATE
  USING (subscriber_id = auth.uid())
  WITH CHECK (subscriber_id = auth.uid());

-- wallets: SELECT/UPDATE are already correctly self-scoped. There is NO
-- INSERT policy at all today — Wallet.jsx/GiftPanel.jsx's first-time
-- self-provisioning insert (`{user_id: user.id, balance: 0}`) has been
-- silently failing in production, a pre-existing bug this closes. The
-- send_gift RPC (already applied, SECURITY DEFINER) handles the
-- cross-user recipient-wallet case separately and bypasses RLS, so this
-- INSERT policy only needs to cover a user creating their own row.
CREATE POLICY "wallets insertable by their own user" ON wallets
  FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- subscriptions and user_subscriptions currently have ZERO policies despite
-- RLS being enabled — meaning both are under total default-deny right now,
-- and both features (a professional setting their own subscription price,
-- and either side viewing an active subscription) are completely broken in
-- production today, independent of anything else in this file.
CREATE POLICY "subscriptions manageable by their own professional" ON subscriptions
  FOR ALL
  USING (professional_id = auth.uid())
  WITH CHECK (professional_id = auth.uid());

CREATE POLICY "user_subscriptions visible to either party" ON user_subscriptions
  FOR SELECT
  USING (subscriber_id = auth.uid() OR professional_id = auth.uid());
-- No write policy added: no INSERT/UPDATE/DELETE call site was found
-- anywhere in the app (admin included) — this table's write path is
-- unknown (possibly a future RPC, possibly dead). Flagged, not guessed at.


-- ----------------------------------------------------------------------------
-- 7. profiles, notifications, search_logs — cross-cutting.
-- ----------------------------------------------------------------------------

-- profiles: "Admin can read all profiles" (qual:true) was redundant with
-- the already-public "Anyone can read profiles" — harmless on its own,
-- dropped for clarity. "Admin update profiles" (qual:true) let anyone
-- update ANY profile's ANY column, including is_verified/suspended_until —
-- a real, serious bypass. suspend_user/delete_user/approve_verification/
-- manual_verify all now go through api/admin-auth.js. "Users can update
-- their own profile" (auth.uid() = id, already correct) is untouched.
DROP POLICY IF EXISTS "Admin can read all profiles" ON profiles;
DROP POLICY IF EXISTS "Admin update profiles" ON profiles;

-- notifications: all four existing policies were misleadingly named
-- ("read own notifications", "update own notifications") but had
-- qual:true — actually unrestricted, letting anyone read or mark-read
-- ANY user's notifications (a real privacy leak: who liked/followed/
-- messaged whom). The two INSERT policies ("create notifications",
-- "insert notifications") were also both unrestricted duplicates. Rebuilt
-- correctly: SELECT/UPDATE genuinely self-scoped; INSERT allows
-- `recipient_id != auth.uid()` by design (notifying someone else is the
-- whole point) but requires the actor to be a real logged-in user and,
-- if actor_id is set, that it's genuinely them — not a free-form claim.
DROP POLICY IF EXISTS "read own notifications" ON notifications;
DROP POLICY IF EXISTS "update own notifications" ON notifications;
DROP POLICY IF EXISTS "create notifications" ON notifications;
DROP POLICY IF EXISTS "insert notifications" ON notifications;

CREATE POLICY "notifications visible to their recipient" ON notifications
  FOR SELECT
  USING (recipient_id = auth.uid());

CREATE POLICY "notifications updatable by their recipient" ON notifications
  FOR UPDATE
  USING (recipient_id = auth.uid())
  WITH CHECK (recipient_id = auth.uid());

CREATE POLICY "notifications insertable by any logged-in actor" ON notifications
  FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL AND (actor_id = auth.uid() OR actor_id IS NULL));

-- search_logs: "read search logs" (qual:true) exposed every user's search
-- history — potentially sensitive (symptom/condition searches) — to
-- anyone. Now via list_search_logs on api/admin-auth.js; no client-facing
-- read need exists otherwise. "anyone can log searches" (with_check:true)
-- allowed claiming any user_id; tightened to match the app's actual
-- anon-allowed-but-must-be-honest pattern.
DROP POLICY IF EXISTS "read search logs" ON search_logs;
DROP POLICY IF EXISTS "anyone can log searches" ON search_logs;

CREATE POLICY "search_logs insertable by self or anon" ON search_logs
  FOR INSERT
  WITH CHECK (user_id IS NULL OR user_id = auth.uid());


-- ============================================================================
-- What's still NOT covered by this file:
--   - gifts' "Logged in users can send gifts" INSERT policy is now unused
--     (send_gift RPC handles all real gift-record inserts as SECURITY
--     DEFINER) but harmless as-is — left alone rather than dropped, since
--     it's correctly self-scoped and removing working things isn't this
--     file's goal.
--   - tasks' "Admin can read all tasks" (qual:true) is broader than what
--     the app currently needs (any authenticated professional browsing
--     open tasks), but not a real vulnerability — job postings aren't
--     sensitive data. Left as-is; revisit only if tasks ever carry
--     non-public fields.
--   - Column-level restriction on stories' "Anyone can update story views"
--     (technically allows updating any column, not just view_count, though
--     nothing in the app does) — not addressed; would need a trigger or
--     column-level grants, out of scope for this pass.
--   - Every policy in this file has been checked against the exact
--     application code that exercises it, but none have been run against
--     real traffic — this is still a draft, not a verified one, same
--     caveat as phase2_rls_pilot.sql carries.
--   - This file does not touch businesses/business_claims/consultations/
--     staff_claims (CareHub's phase2_rls_pilot.sql already covers all
--     four) or admin_users/admin_teams (already RLS'd per Phase 0/C9,
--     their remaining qual:true "Allow admin login check"/"...update their
--     own record" policies are a known open item, not fixed here — the
--     login flow itself needs the service-role client to read admin_users
--     regardless of what SELECT policy exists for regular sessions, so
--     tightening those specifically needs its own careful pass, not a
--     drop-in-place fix like the others in this file).
-- ============================================================================
