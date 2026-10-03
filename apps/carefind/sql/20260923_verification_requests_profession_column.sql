-- ============================================================================
-- 20260923_verification_requests_profession_column.sql
--
-- Ensures the `profession` column exists on `verification_requests`.
-- The column is required by the `approve_verification` API handler
-- (api/_handlers/admin-auth.js) and is used throughout the admin
-- dashboard to display the professional's profession.
--
-- If the column was missing (e.g., table created before this field
-- was added, or a prior migration dropped it), all verification
-- approval/rejection flows would silently fail because
-- `profession` would be undefined/null, causing the API to return
-- "id, userId and profession required" (HTTP 400) and the admin
-- panel to show "No verification requests yet" via the
-- catch(() => ({ data: [] })) fallback in useAdminData.
-- ============================================================================

begin;

alter table if exists public.verification_requests
  add column if not exists profession text;

commit;
