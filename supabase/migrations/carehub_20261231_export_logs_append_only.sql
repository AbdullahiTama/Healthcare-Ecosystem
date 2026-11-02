-- carehub_20261231_export_logs_append_only
--
-- Status: APPLIED TO PRODUCTION 2026-11-02 (Supabase migration version 20261102122934). Its own verify block passed.
-- Live behavioural probe afterwards, inside a DO block that raised and rolled back (export_logs had 0 rows before and
-- after): platform admin insert allowed and the actor stamped from the session although the client sent another id;
-- admin reads it back; admin UPDATE, DELETE, TRUNCATE refused; a 1-character reason refused; business owner insert
-- refused and sees 0 rows; anon read refused; the table owner's UPDATE and TRUNCATE refused ("export_logs is
-- append-only"). Security advisor afterwards: no finding mentions export_logs.
--
-- Written against the live schema read on 2026-11-02 (planning/CODE_AUDIT.md, A2):
--   * export_logs (id, actor_admin_id, export_type, row_count, reason, watermark, created_at), 0 rows.
--   * One policy, "export_logs_platform_admin": FOR ALL TO authenticated USING/WITH CHECK is_platform_admin().
--   * anon and authenticated hold SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER. No triggers.
--
-- Why it matters: since PR #39 every platform-admin export (businesses, applications, payouts, subscriptions,
-- ADR reports, plan payments) is declared in export_logs, with a reason and a watermark, before the file is produced.
-- That record is the accountability trail for personal and clinical data leaving the platform, but any platform admin
-- could edit or delete it through the REST API, the actor was whatever id the browser sent, and TRUNCATE was granted
-- to every client role (row security does not apply to TRUNCATE).
--
-- What this does (the same treatment audit_log received in carehub_20261209_record_export_audit):
--   1. Client roles keep only SELECT and INSERT; anon gets nothing. Platform admins read and insert through two
--      narrow policies; there is no UPDATE or DELETE policy.
--   2. A BEFORE INSERT trigger stamps the actor from the caller's own session (auth.uid()) and the time, ignoring
--      what the client sent, and refuses an empty or oversized reason, export type or watermark and a negative count.
--   3. Append-only: UPDATE, DELETE and TRUNCATE are refused by trigger for every role, including the table owner.
--      Correcting an entry means appending a new one.
--
-- App impact: none. The admin console (modules/health/repositories logExport, read in Health > Audit log) only
-- inserts and reads, and already sends a trimmed reason of 3+ characters and the signed-in user's id.
--
-- Security implications: access is only narrowed. Non-admins could already neither read nor write rows (row security);
-- now they also lose the table-level grants. Platform admins lose UPDATE and DELETE. service_role keeps its grants but
-- the append-only trigger still refuses it changes to existing rows.
--
-- Rollback:
--   drop trigger export_logs_append_only on public.export_logs; drop trigger export_logs_no_truncate on public.export_logs;
--   drop trigger export_logs_stamp on public.export_logs;
--   drop function public.export_logs_append_only(); drop function public.export_logs_stamp();
--   drop policy "export_logs admin read" on public.export_logs; drop policy "export_logs admin insert" on public.export_logs;
--   create policy "export_logs_platform_admin" on public.export_logs for all to authenticated
--     using (public.is_platform_admin()) with check (public.is_platform_admin());
--   grant select, insert, update, delete on public.export_logs to authenticated;   -- only if the old access is wanted back

-- ── 1. Grants and policies ─────────────────────────────────────────────────────────────────────────────────────────
revoke all on public.export_logs from public, anon, authenticated;
grant select, insert on public.export_logs to authenticated;
grant all on public.export_logs to service_role;
grant usage on sequence public.export_logs_id_seq to authenticated;
revoke all on sequence public.export_logs_id_seq from anon;

alter table public.export_logs enable row level security;
drop policy if exists "export_logs_platform_admin" on public.export_logs;
drop policy if exists "export_logs admin read" on public.export_logs;
drop policy if exists "export_logs admin insert" on public.export_logs;
create policy "export_logs admin read" on public.export_logs
  for select to authenticated using (public.is_platform_admin());
create policy "export_logs admin insert" on public.export_logs
  for insert to authenticated with check (public.is_platform_admin());

-- ── 2. The actor and time come from the session, never the client ──────────────────────────────────────────────────
create or replace function public.export_logs_stamp()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if current_user in ('authenticated', 'anon') then
    new.actor_admin_id := auth.uid();
    new.created_at := now();
  else
    new.created_at := coalesce(new.created_at, now());
  end if;
  new.reason := btrim(coalesce(new.reason, ''));
  new.export_type := btrim(coalesce(new.export_type, ''));
  new.watermark := btrim(coalesce(new.watermark, ''));
  if length(new.reason) < 3 or length(new.reason) > 500 then
    raise exception 'An export needs a reason of 3 to 500 characters' using errcode = '22023';
  end if;
  if length(new.export_type) = 0 or length(new.export_type) > 100 then
    raise exception 'Unknown export type' using errcode = '22023';
  end if;
  if length(new.watermark) = 0 or length(new.watermark) > 300 then
    raise exception 'An export needs a watermark' using errcode = '22023';
  end if;
  if new.row_count is null or new.row_count < 0 then
    raise exception 'Row count must be zero or more' using errcode = '22023';
  end if;
  return new;
end $$;
revoke all on function public.export_logs_stamp() from public, anon, authenticated;

drop trigger if exists export_logs_stamp on public.export_logs;
create trigger export_logs_stamp before insert on public.export_logs
  for each row execute function public.export_logs_stamp();

-- ── 3. Append-only ─────────────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.export_logs_append_only()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'export_logs is append-only' using errcode = '42501';
end $$;
revoke all on function public.export_logs_append_only() from public, anon, authenticated;

drop trigger if exists export_logs_append_only on public.export_logs;
create trigger export_logs_append_only before update or delete on public.export_logs
  for each row execute function public.export_logs_append_only();
drop trigger if exists export_logs_no_truncate on public.export_logs;
create trigger export_logs_no_truncate before truncate on public.export_logs
  for each statement execute function public.export_logs_append_only();

-- ── Verify, do not assume ──────────────────────────────────────────────────────────────────────────────────────────
do $$
begin
  if has_table_privilege('anon', 'public.export_logs', 'SELECT')
     or has_table_privilege('anon', 'public.export_logs', 'INSERT')
     or has_table_privilege('authenticated', 'public.export_logs', 'UPDATE')
     or has_table_privilege('authenticated', 'public.export_logs', 'DELETE')
     or has_table_privilege('authenticated', 'public.export_logs', 'TRUNCATE') then
    raise exception 'export_logs grants are wider than intended';
  end if;
  if not has_table_privilege('authenticated', 'public.export_logs', 'INSERT')
     or not has_table_privilege('authenticated', 'public.export_logs', 'SELECT') then
    raise exception 'platform admins must still be able to record and read exports';
  end if;
  if (select count(*) from pg_trigger where tgrelid = 'public.export_logs'::regclass and not tgisinternal
        and tgname in ('export_logs_stamp', 'export_logs_append_only', 'export_logs_no_truncate')) <> 3 then
    raise exception 'export_logs triggers are missing';
  end if;
  if has_function_privilege('authenticated', 'public.export_logs_stamp()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.export_logs_append_only()', 'EXECUTE') then
    raise exception 'trigger functions must not be callable';
  end if;
end $$;
