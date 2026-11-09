// @vitest-environment node
// carehub_20270108_staff_activity_expense_status on PGlite: the Owner's staff activity shows each expense's payment
// status (summary text and still_owed) and the payments recorded later on expenses, and nothing else changes. Runs
// on top of carehub_20270107_expense_payments (its real record_expense_payment and history), with the live
// current_business_ids(), is_business_owner(), is_platform_admin() and expense_effective_date().
import { describe, it, expect, beforeAll, vi } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

vi.setConfig({ testTimeout: 60000, hookTimeout: 120000 })
const read = (name) => readFileSync(fileURLToPath(new URL('../../../../../supabase/migrations/' + name, import.meta.url)), 'utf8')
const PAYMENTS = read('carehub_20270107_expense_payments.sql')
const MIGRATION = read('carehub_20270108_staff_activity_expense_status.sql')

const BIZ = 'a0000000-0000-4000-8000-000000000001'
const OWNER = 'owner@pharm.ng'
const CASHIER = 'cashier@pharm.ng'
const OWNER_UID = '10000000-0000-4000-8000-000000000001'
const CASHIER_UID = '10000000-0000-4000-8000-000000000002'
const BISI = 'c0000000-0000-4000-8000-000000000001'
const E_PAID = 'e0000000-0000-4000-8000-000000000001'
const E_PART = 'e0000000-0000-4000-8000-000000000002'
const E_UNPAID = 'e0000000-0000-4000-8000-000000000003'

let db
const claims = (email, sub) => JSON.stringify({ sub, email, role: 'authenticated' })
async function as(email, sub, sql) {
  await db.exec('begin')
  try {
    if (email) await db.query('select set_config($1,$2,true)', ['request.jwt.claims', claims(email, sub)])
    await db.exec(`set local role ${email ? 'authenticated' : 'anon'}`)
    return { rows: (await db.query(sql)).rows }
  } catch (e) {
    return { error: e.message }
  } finally {
    await db.exec('rollback')
  }
}
async function commitAs(email, sub, sql) {
  await db.query('select set_config($1,$2,false)', ['request.jwt.claims', claims(email, sub)])
  await db.exec('set role authenticated')
  try { return (await db.query(sql)).rows } finally { await db.exec('reset role'); await db.query(`select set_config('request.jwt.claims','',false)`) }
}
const activity = `select kind, actor_name, summary, amount::float8 amount, ref, still_owed::float8 still_owed
  from staff_activity('${BIZ}', now() - interval '2 days', now() + interval '1 day') order by kind, summary`

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
    create table staff (id uuid primary key default gen_random_uuid(), business_id uuid, full_name text, email text, role text, status text default 'active', auth_user_id uuid);
    insert into businesses (id, name, email) values ('${BIZ}', 'Pharm', '${OWNER}');
    insert into staff (id, business_id, full_name, email, role, auth_user_id) values ('${BISI}', '${BIZ}', 'Bisi', '${CASHIER}', 'Cashier', '${CASHIER_UID}');

    -- Live definitions, verbatim (2026-11-04 / 2026-11-09).
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

    -- Every table staff_activity() reads, with the columns it uses (live shapes).
    create table sales (id uuid primary key default gen_random_uuid(), business_id uuid, created_at timestamp default now(), is_on_hold boolean default false,
      is_credit boolean default false, payment_method text, cashier_staff_id uuid, cashier_user_id uuid, staff_name text, txn_no text, client_name text,
      balance numeric default 0, total numeric, status text);
    create table sale_payments (id uuid primary key default gen_random_uuid(), business_id uuid, sale_id uuid, received_at timestamptz default now(), kind text,
      staff_id uuid, received_by uuid, staff_name text, method text, note text, amount numeric);
    create table audit_log (id uuid primary key default gen_random_uuid(), created_at timestamptz default now(), action text, actor_id uuid, metadata jsonb, branch_id uuid, target_type text);
    create table expenses (id uuid primary key default gen_random_uuid(), business_id uuid, category text, description text, amount numeric default 0,
      date text, staff_name text, created_at timestamp default now(), recorded_by uuid, recorded_by_staff_id uuid, recorded_by_name text);
    alter table expenses enable row level security;
    create policy "expenses of own business" on expenses for all using ((business_id in (select current_business_ids())) or is_platform_admin());
    grant all on expenses to anon, authenticated, service_role;
    create table purchases (id uuid primary key default gen_random_uuid(), business_id uuid, created_at timestamp default now(), recorded_by_staff_id uuid, recorded_by uuid,
      recorded_by_name text, supplier_name text, items jsonb, product_name text, balance numeric default 0, due_date text, total_cost numeric);
    create table purchase_payments (id uuid primary key default gen_random_uuid(), business_id uuid, created_at timestamptz default now(), recorded_by uuid, staff_name text,
      supplier_name text, method text, balance_after numeric, note text, amount numeric, purchase_id uuid, kind text);
    create table debts (id uuid primary key default gen_random_uuid(), business_id uuid, created_at timestamp default now(), recorded_by_staff_id uuid, recorded_by uuid,
      recorded_by_name text, direction text, party_name text, description text, due_date text, amount numeric, source text);
    create table stock_movements (id uuid primary key default gen_random_uuid(), business_id uuid, created_at timestamptz default now(), actor_id uuid, moved_by text,
      movement_type text, quantity numeric, reason text);
    create table staff_checkins (id uuid primary key default gen_random_uuid(), business_id uuid, created_at timestamptz default now(), staff_id uuid, user_id uuid,
      staff_name text, event_type text, status text, location_label text);
    create table field_activities (id uuid primary key default gen_random_uuid(), business_id uuid, created_at timestamptz default now(), staff_id uuid, rep_name text,
      facility_name text, place_of_visit text, location_label text);
    create table pos_shifts (id uuid primary key default gen_random_uuid(), business_id uuid, opened_at timestamptz, staff_id uuid, opened_by uuid, staff_name text,
      opening_float numeric, closed_at timestamptz, closed_by uuid, closed_by_name text, counted_cash numeric, expected_cash numeric);

    -- A sale by Bisi and an expense logged before payment status existed (paid in full).
    insert into sales (business_id, txn_no, client_name, payment_method, cashier_staff_id, total) values ('${BIZ}', 'TXN-1', 'Ada', 'Cash', '${BISI}', 1500);
    insert into expenses (id, business_id, category, description, amount, date, staff_name, recorded_by_staff_id) values
      ('${E_PAID}', '${BIZ}', 'Rent', 'Shop rent', 50000, to_char(current_date, 'YYYY-MM-DD'), 'Bisi', '${BISI}');
  `)
  await db.exec(PAYMENTS)
  await db.exec(MIGRATION)
  // Bisi logs a part-paid and an unpaid expense; the Owner later pays some of the unpaid one.
  await commitAs(CASHIER, CASHIER_UID, `insert into expenses (id, business_id, category, description, amount, date, amount_paid, payment_method, staff_name, recorded_by_staff_id) values
    ('${E_PART}', '${BIZ}', 'Maintenance', 'Generator', 20000, to_char(current_date, 'YYYY-MM-DD'), 5000, 'Cash', 'Bisi', '${BISI}'),
    ('${E_UNPAID}', '${BIZ}', 'Utilities', 'Water', 3000, to_char(current_date, 'YYYY-MM-DD'), 0, null, 'Bisi', '${BISI}')`)
  await commitAs(OWNER, OWNER_UID, `select record_expense_payment('${E_UNPAID}', 1000, 'Transfer', null, 'first part', 'Owner')`)
  await commitAs(CASHIER, CASHIER_UID, `select record_expense_payment('${E_PART}', 15000, 'POS', null, null, 'Bisi')`)
})

describe('staff_activity: expense payment status', () => {
  it('each expense says paid or what is still to pay, with still_owed; other kinds have no still_owed', async () => {
    const { rows, error } = await as(OWNER, OWNER_UID, activity)
    expect(error).toBeUndefined()
    const exp = rows.filter((r) => r.kind === 'expense')
    expect(exp).toEqual([
      { kind: 'expense', actor_name: 'Bisi', summary: 'Maintenance · Generator · paid', amount: 20000, ref: E_PART, still_owed: 0 },
      { kind: 'expense', actor_name: 'Bisi', summary: 'Rent · Shop rent · paid', amount: 50000, ref: E_PAID, still_owed: 0 },
      { kind: 'expense', actor_name: 'Bisi', summary: 'Utilities · Water · ₦2,000 still to pay', amount: 3000, ref: E_UNPAID, still_owed: 2000 },
    ])
    expect(rows.find((r) => r.kind === 'sale')).toMatchObject({ actor_name: 'Bisi', still_owed: null })
  })

  it('payments recorded later appear as expense_payment, by who recorded them; logging-time and pre-history rows do not', async () => {
    const { rows } = await as(OWNER, OWNER_UID, activity)
    expect(rows.filter((r) => r.kind === 'expense_payment')).toEqual([
      { kind: 'expense_payment', actor_name: 'Bisi', summary: 'Maintenance · Generator · POS · now paid', amount: 15000, ref: E_PART, still_owed: null },
      { kind: 'expense_payment', actor_name: 'Owner', summary: 'Utilities · Water · Transfer · ₦2,000 still to pay · first part', amount: 1000, ref: E_UNPAID, still_owed: null },
    ])
  })

  it('still refuses anyone but the Owner; anon cannot execute it', async () => {
    expect((await as(CASHIER, CASHIER_UID, activity)).error).toMatch(/Only the Owner/)
    expect((await as(null, null, `select * from staff_activity('${BIZ}', now() - interval '1 day', now())`)).error).toMatch(/permission denied/)
  })

  it('re-running the migration changes nothing', async () => {
    const before = (await as(OWNER, OWNER_UID, activity)).rows
    await db.exec(MIGRATION)
    expect((await as(OWNER, OWNER_UID, activity)).rows).toEqual(before)
  })
})
