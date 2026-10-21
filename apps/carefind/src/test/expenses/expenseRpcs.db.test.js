// @vitest-environment node
// Expenses RPC regression (Issue 4). Replays the ORIGINAL (broken) RPCs from
// carefind_20261019_red_team_fixes against the live column types, proves the
// bug, then applies the pending fix migration and proves the repaired behaviour.
import { describe, it, expect, beforeAll, vi } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

vi.setConfig({ testTimeout: 60000, hookTimeout: 120000 })
const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
const FIX = read('../../../../../docs/architecture/pending-migrations/carehub_20261201_expenses_rpc_fix.sql')
// The three original functions, extracted verbatim from the shipped migration.
const orig = read('../../../../../supabase/migrations/carefind_20261019_red_team_fixes.sql')
const ORIGINAL = ['get_expense_totals', 'get_expense_summary', 'get_expenses_page'].map((n) => {
  const start = orig.indexOf(`create or replace function public.${n}(`)
  const end = orig.indexOf('$$;', orig.indexOf('as $$', start)) + 3
  return orig.slice(start, end)
}).join('\n')

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
let db

async function as(email, fn) {
  await db.query('select set_config($1,$2,false)', ['request.jwt.claims', JSON.stringify({ sub: '00000000-0000-4000-8000-000000000001', email, role: 'authenticated' })])
  await db.query('set role authenticated')
  try { return await fn((s) => db.query(s).then((r) => r.rows)) } finally { await db.query('reset role') }
}

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth;
    create function auth.role() returns text language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true),'')::jsonb ->> 'role','anon') $$;
    create function auth.email() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claims', true),'')::jsonb ->> 'email' $$;
    grant usage on schema public, auth to anon, authenticated, service_role;
    grant execute on all functions in schema auth to anon, authenticated, service_role;
    create table businesses (id uuid primary key, email text, is_platform_admin boolean default false);
    create table staff (id uuid primary key default gen_random_uuid(), business_id uuid, email text, status text default 'active');
    -- Column types copied from the LIVE table (created_at is timestamp WITHOUT time zone, date is text).
    create table expenses (id uuid primary key default gen_random_uuid(), business_id uuid, category text not null,
      description text, amount numeric default 0, date text, staff_name text, created_at timestamp without time zone default now());
    create function current_business_ids() returns setof uuid language sql stable security definer set search_path = public as $$
      select id from businesses where lower(email)=lower(auth.email()) union select business_id from staff where lower(email)=lower(auth.email()) and status='active' $$;
    create function is_platform_admin() returns boolean language sql stable security definer set search_path = public as $$
      select coalesce((select is_platform_admin from businesses where lower(email)=lower(auth.email())), false) $$;
    alter table expenses enable row level security;
    create policy "expenses of own business" on expenses for all to public
      using (business_id in (select current_business_ids()) or is_platform_admin())
      with check (business_id in (select current_business_ids()) or is_platform_admin());
    grant select, insert, update, delete on expenses to authenticated;
    insert into businesses (id,email) values ('${A}','a@x.com'), ('${B}','b@x.com');
  `)
})

describe('expense RPCs as shipped', () => {
  it('get_expenses_page fails against the live column type (the bug)', async () => {
    await db.exec(ORIGINAL)
    await db.exec('grant execute on all functions in schema public to authenticated')
    await db.query(`insert into expenses (business_id,category,amount,date) values ('${A}','Rent',100,'2026-10-05')`)
    await as('a@x.com', async (q) => {
      await expect(q(`select * from get_expenses_page('${A}', null, 0, 50)`)).rejects.toThrow(/does not match function result type/)
      // The other two work, which is why the failure looked like "total is zero".
      expect((await q(`select * from get_expense_totals('${A}', null)`))[0].total_amount).toBe('100')
    })
  })
})

describe('expense RPCs after the fix migration', () => {
  beforeAll(async () => {
    await db.exec(FIX)
    await db.exec('delete from expenses')
    await db.query(`insert into expenses (business_id,category,description,amount,date,created_at) values
      ('${A}','Rent','oct rent',1000.10,'2026-10-05','2026-10-05 09:00'),
      ('${A}','Power','dated sept',250.25,'2026-09-30','2026-10-02 09:00'),
      ('${A}','Misc','no date',49.65,null,'2026-10-20 23:30'),
      ('${A}','Bad','unparseable date',10,'2026-02-31','2026-10-11 10:00'),
      ('${B}','Rent','other tenant',9999,'2026-10-05','2026-10-05 09:00')`)
  })

  it('the page returns rows instead of raising, filtered by recorded date', async () => {
    const rows = await as('a@x.com', (q) => q(`select * from get_expenses_page('${A}', '2026-10', 0, 50)`))
    expect(rows.map((r) => r.description).sort()).toEqual(['no date', 'oct rent', 'unparseable date'])
  })

  it('the month is decided by the recorded date, not by when the row was typed in', async () => {
    const oct = await as('a@x.com', (q) => q(`select * from get_expense_totals('${A}', '2026-10')`))
    expect(Number(oct[0].total_amount)).toBeCloseTo(1059.75, 2) // 1000.10 + 49.65 + 10
    expect(Number(oct[0].transaction_count)).toBe(3)
    const sep = await as('a@x.com', (q) => q(`select * from get_expense_totals('${A}', '2026-09')`))
    expect(Number(sep[0].total_amount)).toBeCloseTo(250.25, 2)
  })

  it('all-time total includes every persisted row and is exact for decimals', async () => {
    const all = await as('a@x.com', (q) => q(`select * from get_expense_totals('${A}', null)`))
    expect(Number(all[0].total_amount)).toBeCloseTo(1310.0, 2)
    expect(Number(all[0].transaction_count)).toBe(4)
  })

  it('page, totals and summary agree for the same period', async () => {
    await as('a@x.com', async (q) => {
      const page = await q(`select amount from get_expenses_page('${A}', '2026-10', 0, 50)`)
      const tot = (await q(`select * from get_expense_totals('${A}', '2026-10')`))[0]
      const sum = await q(`select * from get_expense_summary('${A}', '2026-10')`)
      const pageSum = page.reduce((s, r) => s + Number(r.amount), 0)
      expect(pageSum.toFixed(2)).toBe(Number(tot.total_amount).toFixed(2))
      expect(Number(sum[0].total_amount).toFixed(2)).toBe(Number(tot.total_amount).toFixed(2))
      expect(sum).toHaveLength(Number(tot.transaction_count))
    })
  })

  it('paging is stable and complete', async () => {
    const p1 = await as('a@x.com', (q) => q(`select id from get_expenses_page('${A}', null, 0, 2)`))
    const p2 = await as('a@x.com', (q) => q(`select id from get_expenses_page('${A}', null, 2, 2)`))
    expect(new Set([...p1, ...p2].map((r) => r.id)).size).toBe(4)
  })

  it('business A cannot read business B through the RPCs or the table', async () => {
    await as('a@x.com', async (q) => {
      await expect(q(`select * from get_expense_totals('${B}', null)`)).rejects.toThrow(/Not authorized/)
      await expect(q(`select * from get_expenses_page('${B}', null, 0, 50)`)).rejects.toThrow(/Not authorized/)
      expect(await q(`select * from expenses where business_id='${B}'`)).toHaveLength(0)
    })
  })

  it('business A cannot insert an expense for business B', async () => {
    await as('a@x.com', async (q) => {
      await expect(q(`insert into expenses (business_id,category,amount,date) values ('${B}','Rent',5,'2026-10-01')`)).rejects.toThrow(/row-level security/)
    })
  })

  it('refuses non-positive amounts, and a malformed month', async () => {
    await as('a@x.com', async (q) => {
      await expect(q(`insert into expenses (business_id,category,amount,date) values ('${A}','Rent',0,'2026-10-01')`)).rejects.toThrow(/expenses_amount_positive/)
      await expect(q(`insert into expenses (business_id,category,amount,date) values ('${A}','Rent',-5,'2026-10-01')`)).rejects.toThrow(/expenses_amount_positive/)
      await expect(q(`select * from get_expense_totals('${A}', '2026-13')`)).rejects.toThrow(/YYYY-MM/)
    })
  })

  it('a duplicate id is ignored, so a retried save cannot double-count', async () => {
    const id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
    await as('a@x.com', async (q) => {
      for (let i = 0; i < 2; i++) await q(`insert into expenses (id,business_id,category,amount,date) values ('${id}','${A}','Rent',7,'2026-10-01') on conflict (id) do nothing`)
      expect(await q(`select * from expenses where id='${id}'`)).toHaveLength(1)
    })
    await db.query(`delete from expenses where id='${id}'`)
  })

  it('leaves exactly one overload per RPC and no anon access', async () => {
    const r = await db.query(`select proname, count(*) n, bool_or(has_function_privilege('anon', oid, 'execute')) anon_ok
      from pg_proc where proname in ('get_expense_totals','get_expense_summary','get_expenses_page') group by proname`)
    for (const row of r.rows) { expect(Number(row.n)).toBe(1); expect(row.anon_ok).toBe(false) }
  })
})
