-- Finding S1: discover_facilities_cursor is SECURITY DEFINER, reads every businesses row
-- (bypassing RLS) and returns phone numbers and coordinates, yet PUBLIC and anon could
-- execute it. Confirmed on the live project 2026-10-19: proacl contained "=X/postgres" and
-- "anon=X/postgres", and the security advisor lists it under
-- anon_security_definer_function_executable.
--
-- Callers: CareHub's signed-in screens only (apps/carehub/src/lib/places.js). CareFind does
-- not call it. So the fix is permission-only: the function body is NOT changed.
--
-- Supersedes the body-changing variant carehub_20261119_discover_facilities_cursor_lockdown.sql,
-- which must not be applied (it also replaces the live body).
--
-- Rollback: GRANT EXECUTE ON FUNCTION public.discover_facilities_cursor(text,text,text,text,text,integer,text) TO anon;

REVOKE ALL ON FUNCTION public.discover_facilities_cursor(text, text, text, text, text, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.discover_facilities_cursor(text, text, text, text, text, integer, text) TO authenticated, service_role;
