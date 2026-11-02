// @vitest-environment node
// export_logs append-only (carehub_20261231_export_logs_append_only), on PGlite with the live shape of export_logs
// before the migration: one FOR ALL platform-admin policy and full grants to anon and authenticated.
import { describe, it, expect, beforeAll, vi } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

vi.setConfig({ testTimeout: 60000, hookTimeout: 120000 })
const migration = (name) => readFileSync(fileURLToPath(new URL(`../../../../../supabase/migrations/${name}`, import.meta.url)), 'utf8')

const ADMIN = { sub: 'a0000000-0000-4000-8000-000000000001', email: 'admin@x.com' }
const OWNER = { sub: 'a0000000-0000-4000-8000-000000000002', email: 'owner@x.com' }
let db

async function as(who, fn, role = 'authenticated') {
  await db.query('select set_config($1,$2,false)', ['request.jwt.claims', JSON.stringify({ ...who, role })])
  await db.query(`set role ${role}`)
  try { return await fn((s, p) => db.query(s, p).then((r) => r.rows)) } finally { await db.query('reset role') }
}
const insertLog = (q, over = {}) => q(
  'insert into export_logs (actor_admin_id, export_type, row_count, reason, watermark) values ($1,$2,$3,$4,$5) returning *',
  [over.actor ?? ADMIN.sub, over.type ?? 'admin.businesses.csv', over.count ?? 12, over.reason ?? 'Board report', over.watermark ?? 'admin@x.com · 2026-11-02T10:00:00Z'],
)

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth;
    create function auth.email() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claims', true),'')::jsonb ->> 'email' $$;
    create function auth.uid() returns uuid language sql stable as $$ select (nullif(current_setting('request.jwt.claims', true),'')::jsonb ->> 'sub')::uuid $$;
    grant usage on schema public, auth to anon, authenticated, service_role;
    grant execute on all functions in schema auth to anon, authenticated, service_role;
    create table businesses (id uuid primary key default gen_random_uuid(), email text, is_platform_admin boolean default false);
    insert into businesses (email, is_platform_admin) values ('admin@x.com', true), ('owner@x.com', false);
    create function is_platform_admin() returns boolean language sql stable security definer set search_path = public as $$
      select coalesce((select is_platform_admin from businesses where lower(email) = lower(auth.email()) limit 1), false) $$;
    -- live shape before the migration
    create table export_logs (id bigserial primary key, actor_admin_id uuid, export_type text not null, row_count integer not null,
      reason text not null, watermark text not null, created_at timestamptz not null default now());
    alter table export_logs enable row level security;
    create policy "export_logs_platform_admin" on export_logs for all to authenticated using (is_platform_admin()) with check (is_platform_admin());
    grant all on export_logs to anon, authenticated, service_role;
    grant usage on sequence export_logs_id_seq to anon, authenticated, service_role;
  `)
})

describe('before the migration (the finding)', () => {
  it('a platform admin could rewrite and delete export records', async () => {
    await as(ADMIN, async (q) => {
      const [row] = await insertLog(q)
      await q(`update export_logs set reason = 'nothing to see' where id = $1`, [row.id])
      await q('delete from export_logs where id = $1', [row.id])
      expect(await q('select * from export_logs')).toHaveLength(0)
    })
  })
})

describe('after the migration', () => {
  beforeAll(async () => { await db.exec(migration('carehub_20261231_export_logs_append_only.sql')) })

  it('a platform admin records an export; the actor and time come from the session, not the client', async () => {
    const [row] = await as(ADMIN, (q) => insertLog(q, { actor: OWNER.sub, reason: '  Quarterly NAFDAC submission  ' }))
    expect(row.actor_admin_id).toBe(ADMIN.sub)
    expect(row.reason).toBe('Quarterly NAFDAC submission')
    expect(Math.abs(new Date(row.created_at).getTime() - Date.now())).toBeLessThan(60000)
    expect(await as(ADMIN, (q) => q('select count(*)::int n from export_logs'))).toEqual([{ n: 1 }])
  })

  it('records cannot be changed or removed, by an admin or by the table owner', async () => {
    await expect(as(ADMIN, (q) => q(`update export_logs set reason = 'rewritten'`))).rejects.toThrow()
    await expect(as(ADMIN, (q) => q('delete from export_logs'))).rejects.toThrow()
    await expect(as(ADMIN, (q) => q('truncate export_logs'))).rejects.toThrow()
    await expect(db.query(`update export_logs set reason = 'rewritten'`)).rejects.toThrow(/append-only/)
    await expect(db.query('delete from export_logs')).rejects.toThrow(/append-only/)
    await expect(db.query('truncate export_logs')).rejects.toThrow(/append-only/)
    expect((await db.query('select reason from export_logs')).rows).toEqual([{ reason: 'Quarterly NAFDAC submission' }])
  })

  it('non-admins can neither read nor write; anon has no access at all', async () => {
    await expect(as(OWNER, (q) => insertLog(q))).rejects.toThrow(/row-level security/)
    expect(await as(OWNER, (q) => q('select * from export_logs'))).toEqual([])
    await expect(as({}, (q) => q('select * from export_logs'), 'anon')).rejects.toThrow(/permission denied/)
    await expect(as({}, (q) => insertLog(q), 'anon')).rejects.toThrow(/permission denied/)
  })

  it.each([
    [{ reason: '  ' }, /reason of 3 to 500/],
    [{ reason: 'x'.repeat(501) }, /reason of 3 to 500/],
    [{ type: ' ' }, /Unknown export type/],
    [{ watermark: '' }, /watermark/],
    [{ count: -1 }, /zero or more/],
  ])('refuses an incomplete declaration %o', async (over, message) => {
    await expect(as(ADMIN, (q) => insertLog(q, over))).rejects.toThrow(message)
  })

  it('leaves grants as intended and the trigger functions uncallable', async () => {
    const priv = async (role, p) => (await db.query(`select has_table_privilege('${role}', 'export_logs', '${p}') ok`)).rows[0].ok
    expect(await priv('authenticated', 'INSERT')).toBe(true)
    expect(await priv('authenticated', 'SELECT')).toBe(true)
    for (const p of ['UPDATE', 'DELETE', 'TRUNCATE']) expect(await priv('authenticated', p)).toBe(false)
    for (const p of ['SELECT', 'INSERT']) expect(await priv('anon', p)).toBe(false)
    expect((await db.query(`select has_function_privilege('authenticated', 'export_logs_append_only()', 'EXECUTE') ok`)).rows[0].ok).toBe(false)
  })

  it('re-running the migration is safe and keeps existing records', async () => {
    await db.exec(migration('carehub_20261231_export_logs_append_only.sql'))
    expect((await db.query('select count(*)::int n from export_logs')).rows[0].n).toBe(1)
  })
})
