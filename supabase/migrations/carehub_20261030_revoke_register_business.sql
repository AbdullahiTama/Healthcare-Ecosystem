-- Cutover. Apply ONLY after the frontend that calls /api/register-business is live: until then the previous
-- frontend registers through this RPC. After this, the only registration path is the server handler, which calls
-- register_business_unconfirmed with the service role. Kept (not dropped) so a rollback is a single GRANT.
revoke all on function public.register_business(jsonb, text) from public, anon, authenticated;
grant execute on function public.register_business(jsonb, text) to service_role;
