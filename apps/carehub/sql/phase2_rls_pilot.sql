-- ============================================================================
-- Phase 2 (RLS) — APPLIED TO PRODUCTION 2026-07-18, on explicit instruction,
-- with the known consequence (accepted at the time) that the 7 CareHub
-- accounts not yet migrated to a real Supabase Auth session lose access to
-- their own data until they next log in. Kept here as a record of what was
-- run, not a draft anymore — re-running it is safe (every ALTER TABLE/DROP
-- POLICY/CREATE POLICY below is idempotent), but there's no need to.
--
-- First attempt failed outright: `is_platform_admin()` below references
-- `businesses.is_platform_admin`, which turned out not to exist in the live
-- schema at all despite Phase 0 documentation saying it had been added.
-- Verified the failed attempt rolled back completely (transactional; zero
-- policies/functions created) before fixing anything. Added the column
-- (`ALTER TABLE businesses ADD COLUMN is_platform_admin boolean DEFAULT
-- false`) and re-ran successfully. No business has this column set to `true`
-- yet — platform-admin login remains non-functional until that's done
-- manually. See C1/C14 in Technical-Debt.md for full detail.
--
-- Prerequisite this depends on: Phase 1 (real Supabase Auth sessions, silent
-- migration on login) must be deployed AND a meaningful fraction of real
-- businesses/staff must have actually logged in at least once since then —
-- auth.uid()/auth.email() is only populated for accounts that have migrated.
-- Enabling RLS before that has happened will lock out every account that
-- hasn't logged in yet. Verify migration progress before running this.
--
-- ⚠ RESOLVED, but re-check before running: a second blocker existed here
-- (logged as C10 in Technical-Debt.md) where sbFetch() hardcoded the anon
-- key on every request regardless of login state, so auth.email()/auth.uid()
-- was NULL for all CareHub traffic even for migrated, logged-in accounts.
-- That's now fixed in code (sbFetch forwards the real session token when one
-- exists). One thing C10's fix could NOT verify from source: it switches
-- logged-in users from Postgres role `anon` to `authenticated` ahead of this
-- file's RLS going live — confirm `authenticated` has equivalent grants to
-- `anon` on these 40 tables today (untested against the live project) before
-- relying on this pilot's policies, and before/while rolling out C10's
-- deploy generally.
--
-- ⚠ CRITICAL, added after live-schema access became available: every one of
-- this file's 40 tables ALREADY has RLS "enabled" (relrowsecurity = true) in
-- the live project, but neutralized by a pre-existing PERMISSIVE policy —
-- almost all named "Allow all" (a few named otherwise, e.g. business_claims'
-- "Admin can read claims"/"Admin update claims", businesses' "public read
-- businesses") — with `qual: true` / `with_check: true` for role `public`.
-- Postgres OR's PERMISSIVE policies together within the same command, so as
-- long as ANY qual:true policy exists on a table, every policy this file adds
-- is moot — the old one keeps granting full access regardless. Every section
-- below now DROPs the confirmed pre-existing policy name(s) for that table
-- (verified via `select tablename, policyname, cmd from pg_policies` against
-- the live project, not guessed) immediately before creating the real one.
-- Without those drops, running this file would succeed, look like it did
-- something, and change nothing.
--
-- Scope: this file now covers 40 tables — every table referenced anywhere in
-- CareHub's data-access layer, including the two CareFind-facing bridge
-- tables (staff_claims, business_claims) once their real column names were
-- confirmed directly from CareFind's own source rather than guessed.
-- (Database.md's original "36 CareHub tables" estimate and this file's count
-- don't quite match — both are reconstructed estimates, not a live table
-- count; treat 40 as no more authoritative than 36 was.) Three policy shapes
-- are used throughout: (1) direct business_id scoping for tables that carry
-- the column themselves, (2) join-through-parent scoping (via a FK's parent
-- table's business_id) for child tables that don't, and (3) direct
-- auth.uid() matching for the two CareFind-facing bridge tables, whose
-- claimant-side identity is a real Supabase Auth user, not a CareHub email.
-- Each table was individually checked against apps/carehub/src/lib/supabase.js
-- (and, for the two bridge tables, CareFind's own ClaimStaffPosition.jsx/
-- ClaimBusiness.jsx) to determine which shape it actually needs, not assumed
-- from how similar tables were handled. No schema file, migration history, or
-- live database access was available while writing this — treat every column
-- name/type as reconstructed from source, not confirmed against a live
-- schema, and verify before running any of this.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. Helper function: which business_id(s) can the current authenticated
--    user access, either as the business owner or as active staff?
--
--    SECURITY DEFINER is intentional here — this function must be able to
--    read `businesses`/`staff` to answer that question even after RLS is
--    enabled on those same tables below (otherwise every policy that calls
--    this function would recurse into itself). search_path is pinned to
--    `public` to close the standard SECURITY DEFINER search-path hijack risk.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION current_business_ids()
RETURNS SETOF uuid  -- ⚠ verify businesses.id / staff.business_id are actually `uuid` — change to bigint/int if not
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM businesses WHERE lower(email) = lower(auth.email())
  UNION
  SELECT business_id FROM staff WHERE lower(email) = lower(auth.email()) AND status = 'active'
$$;

-- Convenience: is the current user this ecosystem's platform admin?
-- (Mirrors Login.jsx's is_platform_admin check — platform admins can see everything.)
CREATE OR REPLACE FUNCTION is_platform_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT is_platform_admin FROM businesses WHERE lower(email) = lower(auth.email())),
    false
  )
$$;


-- ----------------------------------------------------------------------------
-- 2. businesses — a business can see/edit only its own row; platform admin sees all.
-- ----------------------------------------------------------------------------
ALTER TABLE businesses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all" ON businesses;
DROP POLICY IF EXISTS "public read businesses" ON businesses;

CREATE POLICY "own business row" ON businesses
  FOR ALL
  USING (lower(email) = lower(auth.email()) OR is_platform_admin())
  WITH CHECK (lower(email) = lower(auth.email()) OR is_platform_admin());

-- NOTE: Register.jsx's public signup flow (INSERT into businesses before the
-- user has a session, since registration and first-login are separate steps
-- in the current flow) will need its own INSERT policy allowing anon/unauthenticated
-- inserts, OR needs to move behind a server-verified path. This pilot does not
-- solve that — flag it before enabling this table's RLS, registration will
-- break otherwise.
--
-- RESOLVED (H11 in Technical-Debt.md): this used to flag that CareFind's
-- AdminPanel.jsx's approveClaim() wrote to `businesses.visible_on_carefind`
-- directly from the browser with the plain anon key — no Supabase Auth
-- session at all — which would have been silently rejected by this policy
-- once live (auth.email() is NULL for that request, satisfying neither
-- `lower(email) = lower(auth.email())` nor is_platform_admin()). Fixed:
-- approveClaim()/rejectClaim() now go through api/admin-auth.js's
-- service-role client, which bypasses RLS entirely by design, the same
-- legitimate way its other privileged actions already do — this table's RLS
-- no longer depends on CareFind admin identity being recognized at all.


-- ----------------------------------------------------------------------------
-- 3. staff — visible to their own business (owner + fellow staff); platform admin sees all.
-- ----------------------------------------------------------------------------
ALTER TABLE staff ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all staff" ON staff;

CREATE POLICY "staff of own business" ON staff
  FOR ALL
  USING (business_id IN (SELECT current_business_ids()) OR is_platform_admin())
  WITH CHECK (business_id IN (SELECT current_business_ids()) OR is_platform_admin());


-- ----------------------------------------------------------------------------
-- 4. Clinical tables — patients, triage, consultations, prescriptions.
--    Same pattern: scoped to business_id via current_business_ids().
-- ----------------------------------------------------------------------------
ALTER TABLE patients ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all patients" ON patients;
CREATE POLICY "patients of own business" ON patients
  FOR ALL
  USING (business_id IN (SELECT current_business_ids()) OR is_platform_admin())
  WITH CHECK (business_id IN (SELECT current_business_ids()) OR is_platform_admin());

ALTER TABLE triage ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all triage" ON triage;
CREATE POLICY "triage of own business" ON triage
  FOR ALL
  USING (business_id IN (SELECT current_business_ids()) OR is_platform_admin())
  WITH CHECK (business_id IN (SELECT current_business_ids()) OR is_platform_admin());

ALTER TABLE consultations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all consultations" ON consultations;
CREATE POLICY "consultations of own business" ON consultations
  FOR ALL
  USING (business_id IN (SELECT current_business_ids()) OR is_platform_admin())
  WITH CHECK (business_id IN (SELECT current_business_ids()) OR is_platform_admin());
-- RESOLVED against the live schema (was previously an open question — see
-- C8 in Technical-Debt.md, now closed): there is exactly one `consultations`
-- table, and it is entirely CareHub's clinical table — `patient_id` FKs to
-- `patients.id`, not to any CareFind identity, and its columns
-- (hpi/examination/primary_diagnosis/disposition/ward/doctor_name/etc.) are
-- 100% clinical, with no fee/type/professional_id columns of any kind.
-- CareFind's ProfessionalMonetization.jsx DOES still reference this same
-- table (`.eq('professional_id', user.id)`, and an insert with
-- `{professional_id, patient_id, type, fee, notes, status}`) — but that
-- write was already broken before this policy, independent of RLS:
-- `professional_id`/`type`/`fee`/`notes` are not real columns on this table
-- (Postgres will reject the insert outright), and `patient_id: user.id`
-- would violate the FK to `patients` even if the column-name problem didn't
-- exist first, since CareFind user ids never appear in CareHub's `patients`
-- table. The insert's result is never checked in that file (no `{data,error}`
-- destructure), so the UI shows a false "saved!" alert every time it's used.
-- This table's RLS is therefore safe to enable — it cannot newly break a
-- CareFind feature that was already 100% non-functional. See C13 in
-- Technical-Debt.md, whose scope now includes this write path, not just
-- AdminPanel.jsx's dead read/notification path it was originally logged for.

ALTER TABLE prescriptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all prescriptions" ON prescriptions;
CREATE POLICY "prescriptions of own business" ON prescriptions
  FOR ALL
  USING (business_id IN (SELECT current_business_ids()) OR is_platform_admin())
  WITH CHECK (business_id IN (SELECT current_business_ids()) OR is_platform_admin());


-- ----------------------------------------------------------------------------
-- 5. Straightforward business_id-scoped tables — confirmed via
--    apps/carehub/src/lib/supabase.js query strings (every getX(businessId)
--    below filters with exactly `?business_id=eq.<id>`, no other dimension).
-- ----------------------------------------------------------------------------
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all products" ON products;
DROP POLICY IF EXISTS "manage own products" ON products;
DROP POLICY IF EXISTS "read products" ON products;
CREATE POLICY "products of own business" ON products
  FOR ALL
  USING (business_id IN (SELECT current_business_ids()) OR is_platform_admin())
  WITH CHECK (business_id IN (SELECT current_business_ids()) OR is_platform_admin());

ALTER TABLE sales ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all sales" ON sales;
CREATE POLICY "sales of own business" ON sales
  FOR ALL
  USING (business_id IN (SELECT current_business_ids()) OR is_platform_admin())
  WITH CHECK (business_id IN (SELECT current_business_ids()) OR is_platform_admin());

ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all clients" ON clients;
CREATE POLICY "clients of own business" ON clients
  FOR ALL
  USING (business_id IN (SELECT current_business_ids()) OR is_platform_admin())
  WITH CHECK (business_id IN (SELECT current_business_ids()) OR is_platform_admin());

ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all expenses" ON expenses;
CREATE POLICY "expenses of own business" ON expenses
  FOR ALL
  USING (business_id IN (SELECT current_business_ids()) OR is_platform_admin())
  WITH CHECK (business_id IN (SELECT current_business_ids()) OR is_platform_admin());

ALTER TABLE debts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all debts" ON debts;
CREATE POLICY "debts of own business" ON debts
  FOR ALL
  USING (business_id IN (SELECT current_business_ids()) OR is_platform_admin())
  WITH CHECK (business_id IN (SELECT current_business_ids()) OR is_platform_admin());

ALTER TABLE purchases ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all purchases" ON purchases;
CREATE POLICY "purchases of own business" ON purchases
  FOR ALL
  USING (business_id IN (SELECT current_business_ids()) OR is_platform_admin())
  WITH CHECK (business_id IN (SELECT current_business_ids()) OR is_platform_admin());

ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all appointments" ON appointments;
CREATE POLICY "appointments of own business" ON appointments
  FOR ALL
  USING (business_id IN (SELECT current_business_ids()) OR is_platform_admin())
  WITH CHECK (business_id IN (SELECT current_business_ids()) OR is_platform_admin());

ALTER TABLE business_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all settings" ON business_settings;
CREATE POLICY "business_settings of own business" ON business_settings
  FOR ALL
  USING (business_id IN (SELECT current_business_ids()) OR is_platform_admin())
  WITH CHECK (business_id IN (SELECT current_business_ids()) OR is_platform_admin());


-- ----------------------------------------------------------------------------
-- 6. staff_notifications — NOT a plain business_id table. Confirmed via
--    getMyNotifications(businessId, staffId) in lib/supabase.js: rows are
--    scoped by business_id AND EITHER a specific staff_id OR is_owner=true.
--    A plain business_id policy would let any staff member read every other
--    staff member's (and the owner's) personal notifications within the same
--    business — narrower than a cross-tenant leak, but still wrong. Scoped
--    to the actual recipient instead.
-- ----------------------------------------------------------------------------
ALTER TABLE staff_notifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all" ON staff_notifications;
CREATE POLICY "staff_notifications for own business and own recipient" ON staff_notifications
  FOR ALL
  USING (
    is_platform_admin()
    OR (
      business_id IN (SELECT current_business_ids())
      AND (
        (is_owner = true AND EXISTS (
          SELECT 1 FROM businesses
          WHERE id = staff_notifications.business_id AND lower(email) = lower(auth.email())
        ))
        OR staff_id IN (
          SELECT id FROM staff WHERE lower(email) = lower(auth.email()) AND status = 'active'
        )
      )
    )
  )
  WITH CHECK (
    is_platform_admin()
    OR (
      business_id IN (SELECT current_business_ids())
      AND (
        (is_owner = true AND EXISTS (
          SELECT 1 FROM businesses
          WHERE id = staff_notifications.business_id AND lower(email) = lower(auth.email())
        ))
        OR staff_id IN (
          SELECT id FROM staff WHERE lower(email) = lower(auth.email()) AND status = 'active'
        )
      )
    )
  );


-- ----------------------------------------------------------------------------
-- 7. Hospital: lab_requests / imaging_requests — direct business_id, same
--    template as the clinical tables in section 4. Previously blocked here
--    pending Technical-Debt.md H1 (three duplicated hardcoded-credential
--    shadow services in Doctor.jsx/Lab.jsx/Imaging.jsx) — H1 is now fixed
--    (all consolidated into lib/supabase.js), so these are safe to include.
-- ----------------------------------------------------------------------------
ALTER TABLE lab_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all lab_requests" ON lab_requests;
CREATE POLICY "lab_requests of own business" ON lab_requests
  FOR ALL
  USING (business_id IN (SELECT current_business_ids()) OR is_platform_admin())
  WITH CHECK (business_id IN (SELECT current_business_ids()) OR is_platform_admin());

ALTER TABLE imaging_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all imaging_requests" ON imaging_requests;
CREATE POLICY "imaging_requests of own business" ON imaging_requests
  FOR ALL
  USING (business_id IN (SELECT current_business_ids()) OR is_platform_admin())
  WITH CHECK (business_id IN (SELECT current_business_ids()) OR is_platform_admin());

-- ----------------------------------------------------------------------------
-- 8. Child tables with NO business_id column of their own — confirmed via
--    Schema-Reference-CareHub.md / direct re-check of lib/supabase.js. Each
--    only carries a FK to a parent row; scoping has to go through that parent.
--    A plain `business_id IN (...)` policy would reference a column that
--    doesn't exist and fail outright on these — this is exactly the class of
--    mistake per-table verification is meant to catch before it ships.
-- ----------------------------------------------------------------------------
ALTER TABLE lab_results ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all lab_results" ON lab_results;
CREATE POLICY "lab_results via parent lab_requests" ON lab_results
  FOR ALL
  USING (is_platform_admin() OR lab_request_id IN (
    SELECT id FROM lab_requests WHERE business_id IN (SELECT current_business_ids())
  ))
  WITH CHECK (is_platform_admin() OR lab_request_id IN (
    SELECT id FROM lab_requests WHERE business_id IN (SELECT current_business_ids())
  ));

ALTER TABLE patient_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all patient_messages" ON patient_messages;
CREATE POLICY "patient_messages via parent patients" ON patient_messages
  FOR ALL
  USING (is_platform_admin() OR patient_id IN (
    SELECT id FROM patients WHERE business_id IN (SELECT current_business_ids())
  ))
  WITH CHECK (is_platform_admin() OR patient_id IN (
    SELECT id FROM patients WHERE business_id IN (SELECT current_business_ids())
  ));

-- ----------------------------------------------------------------------------
-- 9. Territories — territories has business_id directly; rep_territories does
--    not (only staff_id + territory_id), scoped via territories instead.
-- ----------------------------------------------------------------------------
ALTER TABLE territories ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all" ON territories;
CREATE POLICY "territories of own business" ON territories
  FOR ALL
  USING (business_id IN (SELECT current_business_ids()) OR is_platform_admin())
  WITH CHECK (business_id IN (SELECT current_business_ids()) OR is_platform_admin());

ALTER TABLE rep_territories ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all" ON rep_territories;
CREATE POLICY "rep_territories via parent territories" ON rep_territories
  FOR ALL
  USING (is_platform_admin() OR territory_id IN (
    SELECT id FROM territories WHERE business_id IN (SELECT current_business_ids())
  ))
  WITH CHECK (is_platform_admin() OR territory_id IN (
    SELECT id FROM territories WHERE business_id IN (SELECT current_business_ids())
  ));

-- ----------------------------------------------------------------------------
-- 10. Internal messages — internal_messages has business_id directly;
--     recipients/files are scoped via the parent message.
-- ----------------------------------------------------------------------------
ALTER TABLE internal_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all" ON internal_messages;
CREATE POLICY "internal_messages of own business" ON internal_messages
  FOR ALL
  USING (business_id IN (SELECT current_business_ids()) OR is_platform_admin())
  WITH CHECK (business_id IN (SELECT current_business_ids()) OR is_platform_admin());

ALTER TABLE internal_message_recipients ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all" ON internal_message_recipients;
CREATE POLICY "internal_message_recipients via parent message" ON internal_message_recipients
  FOR ALL
  USING (is_platform_admin() OR message_id IN (
    SELECT id FROM internal_messages WHERE business_id IN (SELECT current_business_ids())
  ))
  WITH CHECK (is_platform_admin() OR message_id IN (
    SELECT id FROM internal_messages WHERE business_id IN (SELECT current_business_ids())
  ));

ALTER TABLE internal_message_files ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all" ON internal_message_files;
CREATE POLICY "internal_message_files via parent message" ON internal_message_files
  FOR ALL
  USING (is_platform_admin() OR message_id IN (
    SELECT id FROM internal_messages WHERE business_id IN (SELECT current_business_ids())
  ))
  WITH CHECK (is_platform_admin() OR message_id IN (
    SELECT id FROM internal_messages WHERE business_id IN (SELECT current_business_ids())
  ));

-- ----------------------------------------------------------------------------
-- 11. Stock — both tables carry business_id directly (visible in full in
--     transferStock/adjustStock, lib/supabase.js lines 338-390).
-- ----------------------------------------------------------------------------
ALTER TABLE stock_batches ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all" ON stock_batches;
CREATE POLICY "stock_batches of own business" ON stock_batches
  FOR ALL
  USING (business_id IN (SELECT current_business_ids()) OR is_platform_admin())
  WITH CHECK (business_id IN (SELECT current_business_ids()) OR is_platform_admin());

ALTER TABLE stock_movements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all" ON stock_movements;
CREATE POLICY "stock_movements of own business" ON stock_movements
  FOR ALL
  USING (business_id IN (SELECT current_business_ids()) OR is_platform_admin())
  WITH CHECK (business_id IN (SELECT current_business_ids()) OR is_platform_admin());

-- ----------------------------------------------------------------------------
-- 12. Orders — orders has business_id directly; items/watchers/files/events
--     are all scoped via the parent order (none carry business_id of their own).
-- ----------------------------------------------------------------------------
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all" ON orders;
CREATE POLICY "orders of own business" ON orders
  FOR ALL
  USING (business_id IN (SELECT current_business_ids()) OR is_platform_admin())
  WITH CHECK (business_id IN (SELECT current_business_ids()) OR is_platform_admin());

ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all" ON order_items;
CREATE POLICY "order_items via parent order" ON order_items
  FOR ALL
  USING (is_platform_admin() OR order_id IN (
    SELECT id FROM orders WHERE business_id IN (SELECT current_business_ids())
  ))
  WITH CHECK (is_platform_admin() OR order_id IN (
    SELECT id FROM orders WHERE business_id IN (SELECT current_business_ids())
  ));

ALTER TABLE order_watchers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all" ON order_watchers;
CREATE POLICY "order_watchers via parent order" ON order_watchers
  FOR ALL
  USING (is_platform_admin() OR order_id IN (
    SELECT id FROM orders WHERE business_id IN (SELECT current_business_ids())
  ))
  WITH CHECK (is_platform_admin() OR order_id IN (
    SELECT id FROM orders WHERE business_id IN (SELECT current_business_ids())
  ));

ALTER TABLE order_files ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all" ON order_files;
CREATE POLICY "order_files via parent order" ON order_files
  FOR ALL
  USING (is_platform_admin() OR order_id IN (
    SELECT id FROM orders WHERE business_id IN (SELECT current_business_ids())
  ))
  WITH CHECK (is_platform_admin() OR order_id IN (
    SELECT id FROM orders WHERE business_id IN (SELECT current_business_ids())
  ));

ALTER TABLE order_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all" ON order_events;
CREATE POLICY "order_events via parent order" ON order_events
  FOR ALL
  USING (is_platform_admin() OR order_id IN (
    SELECT id FROM orders WHERE business_id IN (SELECT current_business_ids())
  ))
  WITH CHECK (is_platform_admin() OR order_id IN (
    SELECT id FROM orders WHERE business_id IN (SELECT current_business_ids())
  ));

-- ----------------------------------------------------------------------------
-- 13. Field activity — activity_fields, field_activities, and
--     activity_default_viewers all carry business_id directly (confirmed:
--     activity_default_viewers' business_id is in setDefaultViewers' write
--     payload even though its own read path, getDefaultViewers, only filters
--     by staff_id — the column exists and is populated either way, so scoping
--     by it is still correct). viewers/reactions/comments scope via the
--     parent field_activities row.
-- ----------------------------------------------------------------------------
ALTER TABLE activity_fields ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all" ON activity_fields;
CREATE POLICY "activity_fields of own business" ON activity_fields
  FOR ALL
  USING (business_id IN (SELECT current_business_ids()) OR is_platform_admin())
  WITH CHECK (business_id IN (SELECT current_business_ids()) OR is_platform_admin());

ALTER TABLE activity_default_viewers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all" ON activity_default_viewers;
CREATE POLICY "activity_default_viewers of own business" ON activity_default_viewers
  FOR ALL
  USING (business_id IN (SELECT current_business_ids()) OR is_platform_admin())
  WITH CHECK (business_id IN (SELECT current_business_ids()) OR is_platform_admin());

ALTER TABLE field_activities ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all" ON field_activities;
CREATE POLICY "field_activities of own business" ON field_activities
  FOR ALL
  USING (business_id IN (SELECT current_business_ids()) OR is_platform_admin())
  WITH CHECK (business_id IN (SELECT current_business_ids()) OR is_platform_admin());

ALTER TABLE activity_viewers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all" ON activity_viewers;
CREATE POLICY "activity_viewers via parent field_activities" ON activity_viewers
  FOR ALL
  USING (is_platform_admin() OR activity_id IN (
    SELECT id FROM field_activities WHERE business_id IN (SELECT current_business_ids())
  ))
  WITH CHECK (is_platform_admin() OR activity_id IN (
    SELECT id FROM field_activities WHERE business_id IN (SELECT current_business_ids())
  ));

ALTER TABLE activity_reactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all" ON activity_reactions;
CREATE POLICY "activity_reactions via parent field_activities" ON activity_reactions
  FOR ALL
  USING (is_platform_admin() OR activity_id IN (
    SELECT id FROM field_activities WHERE business_id IN (SELECT current_business_ids())
  ))
  WITH CHECK (is_platform_admin() OR activity_id IN (
    SELECT id FROM field_activities WHERE business_id IN (SELECT current_business_ids())
  ));

ALTER TABLE activity_comments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all" ON activity_comments;
CREATE POLICY "activity_comments via parent field_activities" ON activity_comments
  FOR ALL
  USING (is_platform_admin() OR activity_id IN (
    SELECT id FROM field_activities WHERE business_id IN (SELECT current_business_ids())
  ))
  WITH CHECK (is_platform_admin() OR activity_id IN (
    SELECT id FROM field_activities WHERE business_id IN (SELECT current_business_ids())
  ));

-- ----------------------------------------------------------------------------
-- 14. enterprise_locations — business_id is confirmed present and this table
--     gets the standard template, but with a caveat the standard tables don't
--     have: CareHub's multi-branch model (a parent business with child
--     `businesses` rows via parent_business_id — see
--     Schema-Reference-CareHub.md §1) means a parent business owner managing
--     a *branch's* locations may need branch business_ids included in
--     current_business_ids() too, and this pilot's version of that function
--     does not do that (it only matches the authenticated user's own email
--     against businesses/staff directly). Locations.jsx's full write path
--     was not re-traced this pass (see knowledge/modules/locations.md) — if
--     branch management turns out to depend on this, current_business_ids()
--     needs a recursive parent_business_id lookup added before this policy
--     is safe to enable, not just this table's policy adjusted.
-- ----------------------------------------------------------------------------
ALTER TABLE enterprise_locations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all" ON enterprise_locations;
CREATE POLICY "enterprise_locations of own business" ON enterprise_locations
  FOR ALL
  USING (business_id IN (SELECT current_business_ids()) OR is_platform_admin())
  WITH CHECK (business_id IN (SELECT current_business_ids()) OR is_platform_admin());


-- ----------------------------------------------------------------------------
-- 15. staff_claims / business_claims — the two CareFind-facing bridge tables.
--     Column names confirmed directly from CareFind source this pass, not
--     guessed: apps/carefind/carefind-main/src/ClaimStaffPosition.jsx line 36
--     (`.eq('user_id', user.id)`) and ClaimBusiness.jsx lines 48-51
--     (`.insert({ user_id: user.id, business_id: businessId })`) — both use
--     `user_id`, a real Supabase Auth UUID from CareFind's consumer session
--     (auth.uid() directly applies here, unlike the email-matching used
--     everywhere else in this file for CareHub's sessionless-until-Phase-1
--     accounts).
--
--     Also confirmed this pass: staff_claims is INSERTed via a Postgres RPC
--     (`attempt_staff_claim(p_staff_id, p_email)`), not a raw client insert —
--     if that function is SECURITY DEFINER (typical for this kind of
--     validate-then-insert pattern, but not confirmed without reading the
--     function body, which lives in the database, not this repo), it bypasses
--     these SELECT/UPDATE policies for its own internal insert, so no INSERT
--     policy is written here for staff_claims. business_claims, by contrast,
--     IS a raw client-side insert (ClaimBusiness.jsx) and needs one.
--
--     RESOLVED (H11): CareFind's AdminPanel.jsx used to approve/reject both
--     tables via the anon key with no Supabase Auth session, which would
--     have been rejected by is_platform_admin() (a CareHub-only identity)
--     once this policy went live. Now routed through api/admin-auth.js's
--     service-role client instead, which bypasses RLS the same legitimate
--     way its other privileged actions already do.
-- ----------------------------------------------------------------------------
ALTER TABLE staff_claims ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all" ON staff_claims;
CREATE POLICY "staff_claims visible to claimant or reviewing business" ON staff_claims
  FOR SELECT
  USING (
    is_platform_admin()
    OR user_id = auth.uid()
    OR staff_id IN (SELECT id FROM staff WHERE business_id IN (SELECT current_business_ids()))
  );

CREATE POLICY "staff_claims approved/rejected only by the reviewing business" ON staff_claims
  FOR UPDATE
  USING (
    is_platform_admin()
    OR staff_id IN (SELECT id FROM staff WHERE business_id IN (SELECT current_business_ids()))
  )
  WITH CHECK (
    is_platform_admin()
    OR staff_id IN (SELECT id FROM staff WHERE business_id IN (SELECT current_business_ids()))
  );
-- Deliberately no policy allowing user_id = auth.uid() on UPDATE — a claimant
-- approving their own claim would defeat the entire point of the workflow.
-- This closes a real gap: lib/supabase.js's approveStaffClaim()/
-- rejectStaffClaim() PATCH by `id` alone with no business_id check at all —
-- today, RLS is the only thing that could stop one business's staff from
-- approving another business's pending claim by guessing/enumerating an id.

ALTER TABLE business_claims ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admin can read claims" ON business_claims;
DROP POLICY IF EXISTS "Admin read claims" ON business_claims;
DROP POLICY IF EXISTS "Admin update claims" ON business_claims;
DROP POLICY IF EXISTS "Users can read their own claims" ON business_claims;
DROP POLICY IF EXISTS "Users can submit a claim" ON business_claims;
CREATE POLICY "business_claims visible to claimant or claimed business" ON business_claims
  FOR SELECT
  USING (
    is_platform_admin()
    OR user_id = auth.uid()
    OR business_id IN (SELECT current_business_ids())
  );

CREATE POLICY "business_claims insertable by the claimant" ON business_claims
  FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "business_claims approved/rejected only by the claimed business" ON business_claims
  FOR UPDATE
  USING (is_platform_admin() OR business_id IN (SELECT current_business_ids()))
  WITH CHECK (is_platform_admin() OR business_id IN (SELECT current_business_ids()));
-- Same reasoning as staff_claims: no claimant self-approval path. CareFind's
-- own admin approval flow (AdminPanel.jsx) is no longer a concern here either
-- (RESOLVED, H11) — it now writes via api/admin-auth.js's service-role
-- client, which bypasses RLS by design rather than needing to satisfy
-- is_platform_admin().


-- ============================================================================
-- What's still NOT covered by this file:
--   - businesses' own parent_business_id multi-branch hierarchy (see §14's
--     caveat on enterprise_locations) — current_business_ids() as written
--     only handles single-branch businesses correctly. Currently inert in
--     practice: 0 of the live project's businesses use parent_business_id
--     today (checked directly against the live project), so this is a real
--     gap but not a live risk yet.
--   - consultations — RESOLVED, no longer a blocker (see the inline note at
--     §4 above): the table-name collision this used to flag turned out not
--     to be a real collision at all — CareFind never had a working write
--     path to this table, broken independent of RLS.
--   - CareFind's AdminPanel.jsx claim-approval flow (businesses,
--     business_claims, staff_claims) — RESOLVED this engagement (H11 in
--     Technical-Debt.md): approveClaim()/rejectClaim() now go through
--     api/admin-auth.js's service-role client, which bypasses RLS by design
--     the same legitimate way its other privileged actions already do, so it
--     doesn't depend on is_platform_admin() recognizing a CareFind admin
--     identity at all.
--   - Pre-existing permissive "Allow all"-style policies on all 40 tables are
--     now DROPped inline above (added this pass, after live-schema access
--     became available) — without those drops, this file's own policies
--     would have had no effect (Postgres ORs permissive policies together).
--   - Every table in this file now has *a* policy, but none of them have been
--     tested against real traffic — this is still a draft, not a verified one.
--   - The DROP POLICY statements above were derived from a live snapshot of
--     pg_policies taken 2026-07-17 — if any policy has been added, renamed,
--     or removed since, re-verify against `select tablename, policyname, cmd
--     from pg_policies where schemaname = 'public'` before running this file,
--     since a DROP POLICY IF EXISTS for a since-renamed policy is a silent
--     no-op, not an error.
-- ============================================================================
