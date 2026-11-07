-- Staff can read their own business's row, whether or not it is listed on CareFind.
-- 2027-01-04 (sequence date). Found 2026-11-06 in the live end-to-end check of the importer operating models
-- (docs/architecture/Importer-Operating-Models.md §11).
--
-- Status: APPLIED to the live carehub project 2026-11-06 as carehub_20270104_staff_read_own_business, with the owner's
-- approval during the live end-to-end check. Verified: the new policy is present and the replaced one is gone; the QA
-- importer's representatives (unlisted company, Centralised) then signed in through the live app. PGlite:
-- apps/carefind/src/test/operating-models/staffReadOwnBusiness.db.test.js (before/after, inactive staff, strangers,
-- owners' trees, no write widened).
--
-- PROBLEM
--   A staff member signs in through resolveAccountByEmail(): their staff row, then GET businesses?id=eq.<their
--   business>. On businesses, the only SELECT policies are the owner's own row (by email), the owner's branches, the
--   public listing (status active AND visible_on_carefind) and, since carehub_20270102, a representative's own
--   rep account. So staff of a business that is NOT listed on CareFind cannot read their own business: the app says
--   "No CareHub business or staff account matches this email" and nobody but the owner can sign in.
--   Live 2026-11-06: 3 active staff in that situation (all QA). It bites every importer that chooses not to be listed
--   (and every unlisted pharmacy or clinic with staff), and it locked the QA importer's representatives out as soon
--   as the company switched back to Centralised.
--
-- FIX
--   One SELECT policy: an authenticated user may read the businesses rows in current_business_ids(), which for a
--   staff member is exactly the one business they are an active member of (owners already read their tree). It
--   replaces "rep account members read their account" (carehub_20270102), which was the same rule limited to
--   representative accounts.
--
-- SECURITY
--   Widening: an active staff member can read every column of their own employer's row. Any signed-in user can
--   already read every column of every LISTED business (the public policy, with authenticated's table-level SELECT),
--   so this gives staff of an unlisted business what everyone has for a listed one, and nothing about any other
--   business. No write is widened (the ALL policies are unchanged). Inactive or invited staff get nothing
--   (current_business_ids() requires status = 'active').
--
-- ROLLBACK
--   drop policy "members read their own business" on public.businesses;
--   create policy "rep account members read their account" on public.businesses for select to authenticated
--     using (account_kind = 'rep_account' and id in (select public.current_business_ids()));

drop policy if exists "rep account members read their account" on public.businesses;
drop policy if exists "members read their own business" on public.businesses;
create policy "members read their own business" on public.businesses for select to authenticated
  using (id in (select public.current_business_ids()));
