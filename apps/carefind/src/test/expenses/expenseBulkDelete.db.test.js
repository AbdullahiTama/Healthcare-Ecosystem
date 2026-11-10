// @vitest-environment node
// carehub_20270112_expense_bulk_delete on PGlite, on top of carehub_20270107_expense_payments, with the live
// stamp_recorded_by() / keep_recorded_by() / pos_actor() and current_business_ids(), is_business_owner(),
// is_platform_admin(), expense_effective_date() (2026-11-10). Deleting keeps each expense and its payment history in a
// copy; restoring puts back the same expense, recorder and payments; only the owner and delete roles may do it.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

vi.setConfig({ testTimeout: 60000, hookTimeout: 120000 })
const read = (name) => readFileSync(fileURLToPath(new URL('../../../../../supabase/migrations/' + name, import.meta.url)), 'utf8')
const PAYMENTS = read('carehub_20270107_expense_payments.sql')
const MIGRATION = read('carehub_20270112_expense_bulk_delete.sql')

const BIZ = 'a0000000-0000-4000-8000-000000000001'
const OTHER = 'b0000000-0000-4000-8000-000000000001'
const OWNER = 'owner@pharm.ng', MANAGER = 'manager@pharm.ng', CASHIER = 'cashier@pharm.ng', STRANGER = 'owner@other.ng'
const UID = { [OWNER]: '10000000-0000-4000-8000-000000000001', [MANAGER]: '10000000-0000-4000-8000-000000000002', [CASHIER]: '10000000-0000-4000-8000-000000000003', [STRANGER]: '10000000-0000-4000-8000-000000000004' }
const E = (n) => 'e0000000-0000-4000-8000-00000000000' + n

let db
async function asUser(email, sql) {
  await db.query('select set_config($1,$2,false)', ['request.jwt.claims', JSON.stringify({ sub: UID[email], email, role: 'authenticated' })])
  await db.exec('set role authenticated')
  try { return (await db.query(sql)).rows } finally { await db.exec('reset role'); await db.query(`select set_config('request.jwt.claims','',false)`) }
}
async function scenario(email, sql, checks = []) {
  await db.exec('begin')
  try {
    if (email) await db.query('select set_config($1,$2,true)', ['request.jwt.claims', JSON.stringify({ sub: UID[email], email, role: 'authenticated' })])
    await db.exec(`set local role ${email ? 'authenticated' : 'anon'}`)
    const out = []
    for (const s of [].concat(sql)) out.push((await db.query(s)).rows)
    await db.exec('reset role')
    const seen = []
    for (const c of checks) seen.push((await db.query(c)).rows)
    return { out, seen }
  } catch (e) {
    return { error: e.message }
  } finally {
    await db.exec('rollback')
  }
}
const del = (ids) => `select delete_expenses('${BIZ}', array[${ids.map((i) => `'${i}'`).join(',')}]::uuid[]) r`
const last = `(select deletion_id from deleted_expenses order by deleted_at desc limit 1)`

beforeEach(async () => {
  db = new PGlite()
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(nullif(current_setting('request.jwt.claims', true),'')::jsonb ->> 'sub','')::uuid $$;
    create function auth.email() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claims', true),'')::jsonb ->> 'email' $$;
    grant usage on schema public, auth to anon, authenticated, service_role;
    grant execute on all functions in schema auth to anon, authenticated, service_role;
    create table businesses (id uuid primary key, name text, email text, owner text, owner_name text, parent_business_id uuid, branch_depth_limit integer default 3, is_platform_admin boolean default false);
    create table staff (id uuid primary key default gen_random_uuid(), business_id uuid, full_name text, email text, role text, status text default 'active', auth_user_id uuid);
    create table roles (id uuid primary key default gen_random_uuid(), business_id uuid, name text, permissions jsonb default '{}');
    insert into businesses (id, name, email, owner_name) values ('${BIZ}', 'Pharm', '${OWNER}', 'Tama'), ('${OTHER}', 'Other', '${STRANGER}', 'Zed');
    insert into staff (business_id, full_name, email, role) values ('${BIZ}', 'Musa', '${MANAGER}', 'Manager'), ('${BIZ}', 'Bisi', '${CASHIER}', 'Cashier');
    insert into roles (business_id, name, permissions) values ('${BIZ}', 'Manager', '{"canDelete": true}'), ('${BIZ}', 'Cashier', '{}');

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
    CREATE OR REPLACE FUNCTION public.is_business_owner(bid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
      WITH RECURSIVE ancestry AS (
        SELECT b.id, b.parent_business_id, b.email, 0 AS depth FROM public.businesses b WHERE b.id = bid
        UNION ALL
        SELECT p.id, p.parent_business_id, p.email, a.depth + 1 FROM public.businesses p JOIN ancestry a ON p.id = a.parent_business_id WHERE a.depth < 10
      )
      SELECT auth.uid() IS NOT NULL
         AND bid IN (SELECT public.current_business_ids())
         AND (
           EXISTS (SELECT 1 FROM ancestry a WHERE lower(a.email) = lower(auth.email()))
           OR EXISTS (SELECT 1 FROM public.staff s WHERE s.business_id = bid AND s.status = 'active' AND s.role = 'Owner' AND lower(s.email) = lower(auth.email()))
         )
    $function$;
    REVOKE ALL ON FUNCTION public.is_business_owner(uuid) FROM PUBLIC, anon, authenticated;
    CREATE OR REPLACE FUNCTION public.is_platform_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
      SELECT COALESCE((SELECT is_platform_admin FROM businesses WHERE lower(email) = lower(auth.email())), false)
    $function$;
    CREATE OR REPLACE FUNCTION public.expense_effective_date(p_date text, p_created_at timestamp without time zone) RETURNS date LANGUAGE plpgsql IMMUTABLE SET search_path TO 'public' AS $function$
    begin
      if p_date ~ '^\\d{4}-\\d{2}-\\d{2}$' then
        return p_date::date;
      end if;
      return p_created_at::date;
    exception when others then
      return p_created_at::date;
    end;
    $function$;
    CREATE OR REPLACE FUNCTION public.pos_actor(p_business_id uuid) RETURNS TABLE(user_id uuid, staff_id uuid, staff_name text) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
    DECLARE
      v_uid uuid := auth.uid();
      v_email text := lower(auth.email());
    BEGIN
      IF v_uid IS NULL OR p_business_id IS NULL OR p_business_id NOT IN (SELECT public.current_business_ids()) THEN RETURN; END IF;
      RETURN QUERY
        WITH RECURSIVE up(id, parent_business_id, depth) AS (
          SELECT b.id, b.parent_business_id, 0 FROM public.businesses b WHERE b.id = p_business_id
          UNION
          SELECT p.id, p.parent_business_id, up.depth + 1 FROM public.businesses p JOIN up ON p.id = up.parent_business_id WHERE up.depth < 10
        )
        SELECT v_uid, s.id, COALESCE(NULLIF(trim(s.full_name), ''), s.email)
          FROM up JOIN public.staff s ON s.business_id = up.id
         WHERE s.status = 'active' AND (s.auth_user_id = v_uid OR lower(s.email) = v_email)
         ORDER BY up.depth, (s.auth_user_id = v_uid) DESC NULLS LAST LIMIT 1;
      IF FOUND THEN RETURN; END IF;
      RETURN QUERY
        WITH RECURSIVE up(id, parent_business_id, depth) AS (
          SELECT b.id, b.parent_business_id, 0 FROM public.businesses b WHERE b.id = p_business_id
          UNION
          SELECT p.id, p.parent_business_id, up.depth + 1 FROM public.businesses p JOIN up ON p.id = up.parent_business_id WHERE up.depth < 10
        )
        SELECT v_uid, NULL::uuid, COALESCE(NULLIF(trim(o.owner_name), ''), NULLIF(trim(o.owner), ''), 'Owner')
          FROM up JOIN public.businesses o ON o.id = up.id WHERE lower(o.email) = v_email ORDER BY up.depth LIMIT 1;
    END $function$;
    CREATE OR REPLACE FUNCTION public.stamp_recorded_by() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
    DECLARE
      v_actor record;
    BEGIN
      IF auth.uid() IS NULL THEN RETURN NEW; END IF;
      NEW.recorded_by := auth.uid();
      NEW.recorded_by_staff_id := NULL;
      NEW.recorded_by_name := NULL;
      SELECT a.staff_id, a.staff_name INTO v_actor FROM public.pos_actor(NEW.business_id) a LIMIT 1;
      IF FOUND THEN
        NEW.recorded_by_staff_id := v_actor.staff_id;
        NEW.recorded_by_name := v_actor.staff_name;
      END IF;
      RETURN NEW;
    END $function$;
    CREATE OR REPLACE FUNCTION public.keep_recorded_by() RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public', 'pg_temp' AS $function$
    BEGIN
      NEW.recorded_by := OLD.recorded_by;
      NEW.recorded_by_staff_id := OLD.recorded_by_staff_id;
      NEW.recorded_by_name := OLD.recorded_by_name;
      RETURN NEW;
    END $function$;

    create table expenses (id uuid primary key default gen_random_uuid(), business_id uuid, category text, description text, amount numeric default 0,
      date text, staff_name text, created_at timestamp default now(), recorded_by uuid, recorded_by_staff_id uuid, recorded_by_name text);
    create trigger stamp_recorded_by_ins before insert on expenses for each row execute function stamp_recorded_by();
    create trigger stamp_recorded_by_upd before update on expenses for each row execute function keep_recorded_by();
    alter table expenses enable row level security;
    create policy "expenses of own business" on expenses for all using ((business_id in (select current_business_ids())) or is_platform_admin());
    grant all on expenses to anon, authenticated, service_role;
    create table audit_log (id uuid primary key default gen_random_uuid(), actor_id uuid, actor_type text default 'staff', branch_id uuid, action text,
      target_type text, target_id uuid, metadata jsonb default '{}', created_at timestamptz default now());
  `)
  await db.exec(PAYMENTS)
  await db.exec(MIGRATION)
  // Bisi (cashier) logs three expenses; the owner later pays part of the unpaid one.
  await asUser(CASHIER, `insert into expenses (id, business_id, category, description, amount, date, amount_paid, payment_method) values
    ('${E(1)}', '${BIZ}', 'Rent', 'Shop rent', 50000, '2026-11-01', 50000, 'Transfer'),
    ('${E(2)}', '${BIZ}', 'Utilities', 'Water', 3000, '2026-11-02', 0, null),
    ('${E(3)}', '${BIZ}', 'Transport', 'Fuel', 800, '2026-11-03', 800, 'Cash')`)
  await asUser(OWNER, `select record_expense_payment('${E(2)}', 1000, 'POS', null, 'part', 'Tama')`)
  await db.exec(`insert into expenses (id, business_id, category, amount, date, amount_paid) values ('${E(9)}', '${OTHER}', 'Rent', 1, '2026-11-01', 1)`)
})

const snapshot = `select x.id, x.amount::float8 amount, x.amount_paid::float8 paid, x.recorded_by_name, x.date,
  (select json_agg(json_build_object('id', p.id, 'kind', p.kind, 'amount', p.amount::float8, 'by', p.staff_name) order by p.created_at, p.kind) from expense_payments p where p.expense_id = x.id) payments
  from expenses x where x.business_id = '${BIZ}' order by x.id`

describe('delete_expenses', () => {
  it('deletes the expenses with their payment history kept in a copy, and audits with the total', async () => {
    const before = (await scenario(OWNER, snapshot)).out[0]
    const r = await scenario(MANAGER, del([E(1), E(2)]), [
      `select id from expenses where business_id = '${BIZ}'`,
      `select expense_id, label, jsonb_array_length(payments) n, deleted_by_name from deleted_expenses order by expense_id`,
      `select action, actor_type, metadata from audit_log`,
      `select count(*)::int n from expense_payments where expense_id in ('${E(1)}', '${E(2)}')`,
    ])
    expect(r.error).toBeUndefined()
    expect(r.out[0][0].r).toEqual({ deletion_id: expect.any(String), deleted: 2, kept: [], not_found: 0 })
    expect(r.seen[0]).toEqual([{ id: E(3) }])
    expect(r.seen[1]).toEqual([
      { expense_id: E(1), label: 'Rent · Shop rent', n: 1, deleted_by_name: 'Musa' },
      { expense_id: E(2), label: 'Utilities · Water', n: 1, deleted_by_name: 'Musa' },
    ])
    expect(r.seen[2]).toEqual([{ action: 'expenses.deleted', actor_type: 'staff', metadata: { deleted: 2, requested: 2, amount: 53000 } }])
    expect(r.seen[3][0].n).toBe(0)
    expect(before).toHaveLength(3)
  })

  it('another business\'s expense and unknown ids are not found and never touched; who may delete', async () => {
    const r = await scenario(OWNER, del([E(9), 'd0000000-0000-4000-8000-000000000001', E(3)]), [`select count(*)::int n from expenses where id = '${E(9)}'`])
    expect(r.out[0][0].r).toMatchObject({ deleted: 1, not_found: 2 })
    expect(r.seen[0][0].n).toBe(1)
    expect((await scenario(CASHIER, del([E(3)]))).error).toMatch(/DELETE_NOT_ALLOWED/)
    expect((await scenario(STRANGER, del([E(3)]))).error).toMatch(/DELETE_NOT_ALLOWED/)
    expect((await scenario(null, del([E(3)]))).error).toMatch(/permission denied/)
    expect((await scenario(OWNER, `select member_can_delete('${BIZ}')`)).error).toMatch(/permission denied/)
  })
})

describe('restore_deleted_expenses', () => {
  it('puts back the same expenses, recorder, paid amount and payment rows (no invented payment), audited', async () => {
    const before = (await scenario(OWNER, snapshot)).out[0]
    const r = await scenario(OWNER, [del([E(1), E(2), E(3)]), `select restore_deleted_expenses('${BIZ}', ${last}) r`], [
      snapshot, `select action, actor_type from audit_log order by created_at, action`,
    ])
    expect(r.error).toBeUndefined()
    expect(r.out[1][0].r).toEqual({ restored: 3, skipped_already_back: 0 })
    expect(r.seen[0]).toEqual(before)
    expect(before.find((x) => x.id === E(2))).toMatchObject({ paid: 1000, recorded_by_name: 'Bisi' })
    expect(r.seen[1]).toEqual([{ action: 'expenses.deleted', actor_type: 'owner' }, { action: 'expenses.restored', actor_type: 'owner' }])
  })

  it('restoring twice changes nothing the second time; same people as deleting; unknown deletion not found', async () => {
    const r = await scenario(OWNER, [del([E(3)]), `select restore_deleted_expenses('${BIZ}', ${last}) r`, `select restore_deleted_expenses('${BIZ}', ${last}) r`])
    expect(r.out[2][0].r).toEqual({ restored: 0, skipped_already_back: 0 })
    expect((await scenario(CASHIER, `select restore_deleted_expenses('${BIZ}', gen_random_uuid())`)).error).toMatch(/DELETE_NOT_ALLOWED/)
    expect((await scenario(OWNER, `select restore_deleted_expenses('${BIZ}', gen_random_uuid())`)).error).toMatch(/RESTORE_NOT_FOUND/)
  })

  it('the restorer\'s identity is back after a restore (later stamps are theirs)', async () => {
    const r = await scenario(OWNER, [del([E(3)]), `select restore_deleted_expenses('${BIZ}', ${last}) r`,
      `insert into expenses (business_id, category, amount, date) values ('${BIZ}', 'Other', 5, '2026-11-10') returning recorded_by_name`])
    expect(r.out[2][0].recorded_by_name).toBe('Tama')
  })
})

describe('deleted_expenses access', () => {
  it('members read their business\'s copies; nobody writes them directly; anon nothing', async () => {
    await db.exec(`insert into deleted_expenses (deletion_id, business_id, expense_id, label, expense) values
      (gen_random_uuid(), '${BIZ}', '${E(1)}', 'x', '{}'), (gen_random_uuid(), '${OTHER}', '${E(9)}', 'y', '{}')`)
    expect((await scenario(CASHIER, `select label from deleted_expenses`)).out[0]).toEqual([{ label: 'x' }])
    expect((await scenario(OWNER, `delete from deleted_expenses`)).error).toMatch(/permission denied/)
    expect((await scenario(null, `select count(*) from deleted_expenses`)).error).toMatch(/permission denied/)
  })
})
