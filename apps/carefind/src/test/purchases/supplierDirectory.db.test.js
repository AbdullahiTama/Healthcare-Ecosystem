// @vitest-environment node
// carehub_20270119_supplier_directory on PGlite with the live current_business_ids(), is_platform_admin() and their
// live EXECUTE grants (Supabase does not keep Postgres' default PUBLIC execute). The supplier list: members of a
// business read, add and edit their own suppliers; a name keeps its key; duplicates are refused by the key.
import { describe, it, expect, beforeAll, vi } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

vi.setConfig({ testTimeout: 60000, hookTimeout: 120000 })
const MIGRATION = readFileSync(fileURLToPath(new URL('../../../../../supabase/migrations/carehub_20270119_supplier_directory.sql', import.meta.url)), 'utf8')

const BIZ = 'a0000000-0000-4000-8000-000000000001'
const BRANCH = 'a0000000-0000-4000-8000-000000000002'
const OTHER = 'b0000000-0000-4000-8000-000000000001'
const OWNER = 'owner@pharm.ng'
const CASHIER = 'cashier@pharm.ng'
const STRANGER = 'owner@other.ng'

let db
async function as(email, sql) {
  await db.exec('begin')
  try {
    if (email) await db.query('select set_config($1,$2,true)', ['request.jwt.claims', JSON.stringify({ sub: '10000000-0000-4000-8000-0000000000' + String(email.length).padStart(2, '0'), email, role: 'authenticated' })])
    await db.exec(`set local role ${email ? 'authenticated' : 'anon'}`)
    return { rows: (await db.query(sql)).rows }
  } catch (e) {
    return { error: e.message }
  } finally {
    await db.exec('rollback')
  }
}
async function commitAs(email, sql) {
  await db.query('select set_config($1,$2,false)', ['request.jwt.claims', JSON.stringify({ sub: '10000000-0000-4000-8000-000000000001', email, role: 'authenticated' })])
  await db.exec('set role authenticated')
  try { return (await db.query(sql)).rows } finally { await db.exec('reset role'); await db.query(`select set_config('request.jwt.claims','',false)`) }
}

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(nullif(current_setting('request.jwt.claims', true),'')::jsonb ->> 'sub','')::uuid $$;
    create function auth.email() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claims', true),'')::jsonb ->> 'email' $$;
    grant usage on schema public, auth to anon, authenticated, service_role;
    grant execute on all functions in schema auth to anon, authenticated, service_role;
    create table businesses (id uuid primary key, name text, email text, parent_business_id uuid, branch_depth_limit integer default 3, is_platform_admin boolean default false);
    create table staff (id uuid primary key default gen_random_uuid(), business_id uuid, email text, role text, status text default 'active');
    insert into businesses (id, name, email) values ('${BIZ}', 'Pharm', '${OWNER}'), ('${OTHER}', 'Other', '${STRANGER}');
    insert into businesses (id, name, email, parent_business_id) values ('${BRANCH}', 'Pharm Yaba', 'yaba@pharm.ng', '${BIZ}');
    insert into staff (business_id, email, role) values ('${BIZ}', '${CASHIER}', 'Cashier');
    CREATE OR REPLACE FUNCTION public.current_business_ids() RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
      WITH RECURSIVE visible AS (
        SELECT b.id, b.parent_business_id, b.branch_depth_limit, 0 AS depth FROM businesses b WHERE lower(b.email) = lower(auth.email())
        UNION ALL
        SELECT child.id, child.parent_business_id, child.branch_depth_limit, visible.depth + 1
        FROM businesses child INNER JOIN visible ON child.parent_business_id = visible.id WHERE visible.depth < visible.branch_depth_limit
      )
      SELECT id FROM visible
      UNION
      SELECT b.id FROM businesses b INNER JOIN staff s ON s.business_id = b.id WHERE lower(s.email) = lower(auth.email()) AND s.status = 'active'
    $function$;
    CREATE OR REPLACE FUNCTION public.is_platform_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
      SELECT COALESCE((SELECT is_platform_admin FROM businesses WHERE lower(email) = lower(auth.email())), false)
    $function$;
    -- Live grants (2026-11-15).
    revoke execute on function public.current_business_ids(), public.is_platform_admin() from public;
    grant execute on function public.current_business_ids() to authenticated, anon, service_role;
    grant execute on function public.is_platform_admin() to authenticated, service_role;
    grant select on businesses to authenticated;
  `)
  await db.exec(MIGRATION)
  // The migration's own REVOKE leaves the trigger function without EXECUTE for authenticated, as live: it must still fire.
  await commitAs(OWNER, `insert into suppliers (business_id, name, phone) values ('${BIZ}', '  Emzor   Distributors ', '0803 111 2222')`)
})

describe('supplier list (carehub_20270119_supplier_directory)', () => {
  it('stores a tidy name and the key purchases use, with the trigger firing for a caller without EXECUTE on it', async () => {
    const r = await as(OWNER, `select name, supplier_key, phone from suppliers where business_id = '${BIZ}'`)
    expect(r.rows).toEqual([{ name: 'Emzor Distributors', supplier_key: 'emzor distributors', phone: '0803 111 2222' }])
  })

  it('lets staff of the business read, add and edit', async () => {
    expect((await as(CASHIER, `select count(*)::int n from suppliers`)).rows[0].n).toBe(1)
    expect((await as(CASHIER, `insert into suppliers (business_id, name) values ('${BIZ}', 'Fidson') returning name`)).rows).toHaveLength(1)
    expect((await as(CASHIER, `update suppliers set email = 'sales@emzor.ng' where business_id = '${BIZ}' returning email`)).rows).toEqual([{ email: 'sales@emzor.ng' }])
  })

  it('lets the Owner manage a branch\'s suppliers, and staff only their own business', async () => {
    expect((await as(OWNER, `insert into suppliers (business_id, name) values ('${BRANCH}', 'Fidson') returning id`)).rows).toHaveLength(1)
    expect((await as(CASHIER, `insert into suppliers (business_id, name) values ('${BRANCH}', 'Fidson')`)).error).toMatch(/row-level security/)
  })

  it('hides suppliers from other businesses and anon, and refuses writes into them', async () => {
    expect((await as(STRANGER, `select count(*)::int n from suppliers`)).rows[0].n).toBe(0)
    expect((await as(STRANGER, `insert into suppliers (business_id, name) values ('${BIZ}', 'X')`)).error).toMatch(/row-level security/)
    expect((await as(STRANGER, `update suppliers set phone = '1' returning id`)).rows).toHaveLength(0)
    expect((await as(null, `select count(*) from suppliers`)).error).toMatch(/permission denied/)
  })

  it('refuses a second supplier with the same name in any capitals or spacing', async () => {
    expect((await as(OWNER, `insert into suppliers (business_id, name) values ('${BIZ}', 'EMZOR distributors')`)).error).toMatch(/suppliers_business_key_unique/)
  })

  it('skips an existing name on an upsert that ignores duplicates (the import\'s path)', async () => {
    const r = await as(OWNER, `insert into suppliers (business_id, name) values ('${BIZ}', 'emzor distributors'), ('${BIZ}', 'May & Baker')
      on conflict (business_id, supplier_key) do nothing returning name`)
    expect(r.rows).toEqual([{ name: 'May & Baker' }])
  })

  it('allows a name correction in capitals or spacing only', async () => {
    expect((await as(OWNER, `update suppliers set name = 'EMZOR Distributors' where business_id = '${BIZ}' returning supplier_key`)).rows).toEqual([{ supplier_key: 'emzor distributors' }])
    expect((await as(OWNER, `update suppliers set name = 'Emzor Pharma' where business_id = '${BIZ}'`)).error).toMatch(/only be corrected in capitals or spacing/)
  })

  it('keeps the business, creator and creation time fixed', async () => {
    expect((await as(OWNER, `update suppliers set business_id = '${BRANCH}' where business_id = '${BIZ}'`)).error).toMatch(/cannot be moved|row-level security/)
    const r = await as(OWNER, `update suppliers set created_at = '2000-01-01', created_by = null where business_id = '${BIZ}' returning created_at > '2001-01-01' as kept, created_by is not null as creator_kept`)
    expect(r.rows).toEqual([{ kept: true, creator_kept: true }])
  })

  it('cannot delete or truncate', async () => {
    expect((await as(OWNER, `delete from suppliers`)).error).toMatch(/permission denied/)
    expect((await as(OWNER, `truncate suppliers`)).error).toMatch(/permission denied/)
  })

  it('refuses an empty or overlong name', async () => {
    expect((await as(OWNER, `insert into suppliers (business_id, name) values ('${BIZ}', '   ')`)).error).toMatch(/check constraint/)
    expect((await as(OWNER, `insert into suppliers (business_id, name, phone) values ('${BIZ}', 'Ok', repeat('1', 41))`)).error).toMatch(/check constraint/)
  })
})
