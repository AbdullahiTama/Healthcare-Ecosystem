// @vitest-environment node
// carehub_20270122_client_totals_guard (CODE_AUDIT A30) on PGlite with the live helpers, their live EXECUTE grants,
// the live refresh_client_totals / sales_refresh_client_totals and the live clients policy. Visits and total spent
// are changed only by the Owner, staff whose role has canAdjustClientTotals, or the database itself (a sale);
// everything else members do with clients is unchanged; anon has nothing; TRUNCATE is gone.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { BIZ, OTHER, OWNER, MANAGER, CASHIER, STRANGER, UID, C, LIVE_HELPERS_SQL, read } from '../debts/debtsFixture'

vi.setConfig({ testTimeout: 60000, hookTimeout: 120000 })
const MIGRATION = read('carehub_20270122_client_totals_guard.sql')

// The fixture's ids plus a staff member whose custom role has canAdjustClientTotals.
const SUB = { ...UID, 'kemi@pharm.ng': '10000000-0000-4000-8000-000000000009' }
let db
async function as(email, sql) {
  await db.exec('begin')
  try {
    if (email) await db.query('select set_config($1,$2,true)', ['request.jwt.claims', JSON.stringify({ sub: SUB[email], email, role: 'authenticated' })])
    await db.exec(`set local role ${email ? 'authenticated' : 'anon'}`)
    const out = []
    for (const s of [].concat(sql)) out.push((await db.query(s)).rows)
    return { out }
  } catch (e) {
    return { error: e.message }
  } finally {
    await db.exec('rollback')
  }
}

beforeEach(async () => {
  db = new PGlite()
  await db.exec(LIVE_HELPERS_SQL)
  await db.exec(`
    create table clients (id uuid primary key default gen_random_uuid(), business_id uuid, full_name text, phone text, address text,
      total_spend numeric default 0, visit_count integer default 0, created_at timestamp default now());
    alter table clients enable row level security;
    create policy "clients of own business" on clients for all using ((business_id in (select current_business_ids())) or is_platform_admin())
      with check ((business_id in (select current_business_ids())) or is_platform_admin());
    -- Live table grants before the migration (2026-11-16): every privilege to anon and authenticated.
    grant all on clients to anon, authenticated, service_role;
    create table sales (id uuid primary key default gen_random_uuid(), business_id uuid, txn_no text, client_id uuid, total numeric,
      refunded_amount numeric default 0, is_on_hold boolean default false, status text, deleted_at timestamptz);
    alter table sales enable row level security;
    create policy "sales of own business" on sales for all using (business_id in (select current_business_ids())) with check (business_id in (select current_business_ids()));
    grant select, insert on sales to authenticated;
    -- Live definitions, verbatim (2026-11-16).
    CREATE OR REPLACE FUNCTION public.refresh_client_totals(p_client_ids uuid[]) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
      update public.clients c set visit_count = coalesce(t.visits, 0), total_spend = coalesce(t.spend, 0)
      from (select c2.id, count(s.id) as visits, sum(coalesce(s.total, 0) - coalesce(s.refunded_amount, 0)) as spend from public.clients c2
            left join public.sales s on s.client_id = c2.id and s.business_id = c2.business_id and coalesce(s.is_on_hold, false) = false and (s.status is null or s.status = 'completed') and s.deleted_at is null
            where c2.id = any(p_client_ids) group by c2.id) t
      where c.id = t.id and (c.visit_count is distinct from coalesce(t.visits, 0) or c.total_spend is distinct from coalesce(t.spend, 0))
    $function$;
    CREATE OR REPLACE FUNCTION public.sales_refresh_client_totals() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
    begin
      if tg_op = 'INSERT' then if new.client_id is not null then perform public.refresh_client_totals(array[new.client_id]); end if;
      elsif tg_op = 'DELETE' then if old.client_id is not null then perform public.refresh_client_totals(array[old.client_id]); end if;
      else if coalesce(new.client_id, old.client_id) is not null then perform public.refresh_client_totals(array_remove(array[new.client_id, old.client_id], null)); end if; end if;
      return null;
    end $function$;
    create trigger sales_refresh_client_totals after insert or update or delete on sales for each row execute function sales_refresh_client_totals();
    -- Live EXECUTE grants: Supabase does not keep Postgres' default PUBLIC execute.
    revoke execute on function public.current_business_ids(), public.is_business_owner(uuid), public.is_platform_admin(), public.refresh_client_totals(uuid[]) from public;
    grant execute on function public.current_business_ids() to authenticated, anon, service_role;
    grant execute on function public.is_platform_admin() to authenticated, service_role;
    grant execute on function public.is_business_owner(uuid), public.refresh_client_totals(uuid[]) to service_role;
    insert into clients (id, business_id, full_name, phone, total_spend, visit_count) values
      ('${C(1)}', '${BIZ}', 'Ada Obi', '0801', 5000, 2), ('${C(9)}', '${OTHER}', 'Zed', '0909', 0, 0);
    -- A custom role given the new permission.
    insert into roles (business_id, name, permissions) values ('${BIZ}', 'Accountant', '{"canAdjustClientTotals": true}');
    insert into staff (business_id, full_name, email, role) values ('${BIZ}', 'Kemi', 'kemi@pharm.ng', 'Accountant');
  `)
  await db.exec(MIGRATION)
})

const totals = `select visit_count v, total_spend::float8 s from clients where id = '${C(1)}'`

describe('carehub_20270122_client_totals_guard', () => {
  it('staff without the permission cannot change visits or total spent, but still edit the rest', async () => {
    expect((await as(CASHIER, `update clients set total_spend = 99999 where id = '${C(1)}'`)).error).toMatch(/Only the Owner, or staff allowed to adjust client totals/)
    expect((await as(MANAGER, `update clients set visit_count = 50 where id = '${C(1)}'`)).error).toMatch(/Only the Owner/)
    const ok = await as(CASHIER, [`update clients set full_name = 'Ada Okafor', address = 'Yaba' where id = '${C(1)}' returning full_name`, totals])
    expect(ok.out).toEqual([[{ full_name: 'Ada Okafor' }], [{ v: 2, s: 5000 }]])
  })

  it('the Owner and staff given access can change them', async () => {
    expect((await as(OWNER, [`update clients set total_spend = 4500, visit_count = 1 where id = '${C(1)}'`, totals])).out[1]).toEqual([{ v: 1, s: 4500 }])
    expect((await as('kemi@pharm.ng', [`update clients set total_spend = 4800 where id = '${C(1)}'`, totals])).out[1]).toEqual([{ v: 2, s: 4800 }])
  })

  it('a new client starts at zero unless the Owner or staff given access set the figures', async () => {
    const c = await as(CASHIER, `insert into clients (business_id, full_name, phone, total_spend, visit_count) values ('${BIZ}', 'New', '0802', 777, 7) returning visit_count v, total_spend::float8 s`)
    expect(c.out[0]).toEqual([{ v: 0, s: 0 }])
    const o = await as(OWNER, `insert into clients (business_id, full_name, phone, total_spend, visit_count) values ('${BIZ}', 'Migrated', '0803', 777, 7) returning visit_count v, total_spend::float8 s`)
    expect(o.out[0]).toEqual([{ v: 7, s: 777 }])
  })

  it('a sale by any member still refreshes the totals (the database itself)', async () => {
    const r = await as(CASHIER, [`insert into sales (business_id, txn_no, client_id, total) values ('${BIZ}', 'T1', '${C(1)}', 1200)`, totals])
    expect(r.error).toBeUndefined()
    expect(r.out[1]).toEqual([{ v: 1, s: 1200 }])
  })

  it('the permission is only for your own business, and is not something others can read', async () => {
    expect((await as(STRANGER, `select can_adjust_client_totals('${BIZ}') ok`)).out[0]).toEqual([{ ok: false }])
    expect((await as(OWNER, `select can_adjust_client_totals('${OTHER}') ok`)).out[0]).toEqual([{ ok: false }])
    expect((await as(CASHIER, `select can_adjust_client_totals('${BIZ}') ok`)).out[0]).toEqual([{ ok: false }])
    expect((await as(STRANGER, `update clients set total_spend = 1 where id = '${C(1)}' returning id`)).out[0]).toEqual([])
  })

  it('anon has nothing on clients; members cannot TRUNCATE', async () => {
    expect((await as(null, `select count(*) from clients`)).error).toMatch(/permission denied/)
    expect((await as(null, `insert into clients (business_id, full_name) values ('${BIZ}', 'x')`)).error).toMatch(/permission denied/)
    expect((await as(OWNER, `truncate clients`)).error).toMatch(/permission denied/)
    expect((await as(OWNER, `select count(*)::int n from clients`)).out[0]).toEqual([{ n: 1 }])
  })
})
