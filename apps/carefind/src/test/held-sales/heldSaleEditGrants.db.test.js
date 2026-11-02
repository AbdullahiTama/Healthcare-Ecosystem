// @vitest-environment node
// carehub_20270101_held_sale_edit_grants on PGlite, against the LIVE state it fixes (read 2026-11-02):
//   * the grants left by carehub_20261211_sales_write_hardening: authenticated SELECT, INSERT and
//     UPDATE (status, is_on_hold, notes) only; anon nothing;
//   * the live sales_guard_direct_update trigger (carehub_20261216_sales_owner_corrections), verbatim.
// The first test reproduces the production defect (re-holding an edited held sale is refused), the rest pin what the
// new grants allow and, as importantly, what they still refuse.
import { describe, it, expect, beforeAll, vi } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

vi.setConfig({ testTimeout: 60000, hookTimeout: 120000 })
const MIGRATION = readFileSync(fileURLToPath(new URL('../../../../../supabase/migrations/carehub_20270101_held_sale_edit_grants.sql', import.meta.url)), 'utf8')

const BIZ = 'a0000000-0000-4000-8000-000000000001'
const HELD = 'd0000000-0000-4000-8000-000000000001'
const DONE = 'd0000000-0000-4000-8000-000000000002'
const ADA = 'c0000000-0000-4000-8000-000000000001'

// What the till sends when an edited held sale is held again (saleRepository.updateHeld).
const REHOLD = `update sales set items = '[{"id":"p1","qty":3,"price":1200}]'::jsonb, subtotal = 3600, discount = 100,
  total = 3500, balance = 3500, client_id = '${ADA}', client_name = 'Ada Obi', notes = 'added one more'
  where id = '${HELD}' and business_id = '${BIZ}' and is_on_hold returning id`

let db
const one = async (s, p) => (await db.query(s, p)).rows[0]

// Runs `sql` as a signed-in app user, inside a transaction that is always rolled back, and returns the rows or the
// error message — so each test starts from the same data.
async function asRole(role, sql) {
  await db.exec('begin')
  try {
    await db.exec(`set local role ${role}`)
    const res = await db.query(sql)
    return { rows: res.rows }
  } catch (e) {
    return { error: e.message }
  } finally {
    await db.exec('rollback')
  }
}

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create table sales (id uuid primary key default gen_random_uuid(), business_id uuid, txn_no text not null,
      client_id uuid, client_name text, items jsonb default '[]'::jsonb, subtotal numeric default 0, discount numeric default 0,
      total numeric default 0, payment_method text, payment_split jsonb, amount_paid numeric default 0, balance numeric default 0,
      is_credit boolean default false, is_on_hold boolean default false, notes text, status text,
      refunded_amount numeric not null default 0, resumed_from uuid references sales(id) on delete set null,
      edited_at timestamptz, deleted_at timestamptz, created_at timestamp default now());
    insert into sales (id, business_id, txn_no, client_name, items, subtotal, total, payment_method, amount_paid, balance, is_on_hold, notes)
      values ('${HELD}', '${BIZ}', 'HLD100001', 'Walk-in', '[{"id":"p1","qty":2,"price":1200}]', 2400, 2400, 'On Hold', 0, 2400, true, 'back in 30 min');
    insert into sales (id, business_id, txn_no, client_name, items, subtotal, total, payment_method, amount_paid, balance, is_on_hold)
      values ('${DONE}', '${BIZ}', 'TXN100001', 'Bisi', '[{"id":"p1","qty":1,"price":1200}]', 1200, 1200, 'Cash', 1200, 0, false);

    -- Live sales_guard_direct_update, verbatim (pg_get_functiondef, 2026-11-02).
    CREATE OR REPLACE FUNCTION public.sales_guard_direct_update()
     RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public', 'pg_temp'
    AS $function$
    BEGIN
      IF current_user NOT IN ('authenticated', 'anon') THEN RETURN NEW; END IF;

      IF COALESCE(OLD.is_on_hold, false) THEN
        IF NEW.is_on_hold IS DISTINCT FROM OLD.is_on_hold OR NEW.status IS DISTINCT FROM OLD.status
           OR NEW.txn_no IS DISTINCT FROM OLD.txn_no OR NEW.business_id IS DISTINCT FROM OLD.business_id
           OR NEW.created_at IS DISTINCT FROM OLD.created_at OR NEW.resumed_from IS DISTINCT FROM OLD.resumed_from THEN
          RAISE EXCEPTION 'A held sale can only be edited or completed at the till; it cannot be released, deleted or relabelled'
            USING ERRCODE = '42501';
        END IF;
        RETURN NEW;
      END IF;

      IF NEW.items IS DISTINCT FROM OLD.items OR NEW.subtotal IS DISTINCT FROM OLD.subtotal
         OR NEW.discount IS DISTINCT FROM OLD.discount OR NEW.total IS DISTINCT FROM OLD.total
         OR NEW.amount_paid IS DISTINCT FROM OLD.amount_paid OR NEW.balance IS DISTINCT FROM OLD.balance
         OR NEW.is_credit IS DISTINCT FROM OLD.is_credit OR NEW.payment_method IS DISTINCT FROM OLD.payment_method
         OR NEW.payment_split IS DISTINCT FROM OLD.payment_split OR NEW.status IS DISTINCT FROM OLD.status
         OR NEW.is_on_hold IS DISTINCT FROM OLD.is_on_hold OR NEW.refunded_amount IS DISTINCT FROM OLD.refunded_amount
         OR NEW.client_id IS DISTINCT FROM OLD.client_id OR NEW.client_name IS DISTINCT FROM OLD.client_name
         OR NEW.txn_no IS DISTINCT FROM OLD.txn_no OR NEW.created_at IS DISTINCT FROM OLD.created_at
         OR NEW.business_id IS DISTINCT FROM OLD.business_id THEN
        RAISE EXCEPTION 'A completed sale can only be changed by the Owner, from Financial Reports'
          USING ERRCODE = '42501';
      END IF;
      RETURN NEW;
    END $function$;
    CREATE TRIGGER sales_guard_direct_update BEFORE UPDATE ON public.sales
      FOR EACH ROW EXECUTE FUNCTION public.sales_guard_direct_update();

    -- Live grants (carehub_20261211_sales_write_hardening, as applied).
    REVOKE ALL ON public.sales FROM anon;
    REVOKE ALL ON public.sales FROM authenticated;
    GRANT SELECT, INSERT ON public.sales TO authenticated;
    GRANT UPDATE (status, is_on_hold, notes) ON public.sales TO authenticated;
  `)
})

describe('before the migration (live state)', () => {
  it('re-holding an edited held sale is refused — the production defect', async () => {
    expect((await asRole('authenticated', REHOLD)).error).toMatch(/permission denied/)
    // only the note could be saved, which is why the till appeared to "refuse" the edit
    expect((await asRole('authenticated', `update sales set notes = 'x' where id = '${HELD}' returning id`)).rows).toHaveLength(1)
  })
})

describe('after the migration', () => {
  beforeAll(async () => { await db.exec(MIGRATION) })

  it('an edited held sale is saved back onto the same held row', async () => {
    const res = await asRole('authenticated', REHOLD)
    expect(res.error).toBeUndefined()
    expect(res.rows).toEqual([{ id: HELD }])
  })

  it('the edit really lands (committed, as the till would)', async () => {
    await db.exec(`set role authenticated; ${REHOLD.replace(' returning id', '')}; reset role;`)
    const row = await one(`select total::float8 total, balance::float8 balance, client_id, client_name, notes, is_on_hold, status from sales where id = '${HELD}'`)
    expect(row).toEqual({ total: 3500, balance: 3500, client_id: ADA, client_name: 'Ada Obi', notes: 'added one more', is_on_hold: true, status: null })
  })

  it('a held sale still cannot be released, relabelled or given a status by the till', async () => {
    expect((await asRole('authenticated', `update sales set is_on_hold = false where id = '${HELD}'`)).error).toMatch(/permission denied/)
    expect((await asRole('authenticated', `update sales set status = 'deleted' where id = '${HELD}'`)).error).toMatch(/permission denied/)
    expect((await asRole('authenticated', `update sales set txn_no = 'X' where id = '${HELD}'`)).error).toMatch(/permission denied/)
    expect((await asRole('authenticated', `update sales set resumed_from = '${DONE}' where id = '${HELD}'`)).error).toMatch(/permission denied/)
  })

  it('a held sale cannot be marked paid from the till', async () => {
    for (const set of ['amount_paid = 3500', "payment_method = 'Cash'", 'is_credit = true', "payment_split = '{}'::jsonb", 'refunded_amount = 1', 'deleted_at = now()']) {
      expect((await asRole('authenticated', `update sales set ${set} where id = '${HELD}'`)).error).toMatch(/permission denied/)
    }
  })

  it("a completed sale's money and customer stay Owner-only (Financial Reports)", async () => {
    for (const set of ['total = 1', 'subtotal = 1', 'discount = 1200', 'balance = 1200', "items = '[]'::jsonb", "client_name = 'Someone else'", `client_id = '${ADA}'`]) {
      expect((await asRole('authenticated', `update sales set ${set} where id = '${DONE}'`)).error)
        .toMatch(/A completed sale can only be changed by the Owner/)
    }
    expect((await asRole('authenticated', `update sales set amount_paid = 0 where id = '${DONE}'`)).error).toMatch(/permission denied/)
  })

  it('a note can still be added to any sale, as before', async () => {
    expect((await asRole('authenticated', `update sales set notes = 'rang twice' where id = '${DONE}' returning id`)).rows).toHaveLength(1)
  })

  it('anon still has no access at all', async () => {
    expect((await asRole('anon', `update sales set notes = 'x' where id = '${HELD}'`)).error).toMatch(/permission denied/)
    expect((await asRole('anon', 'select id from sales')).error).toMatch(/permission denied/)
  })

  it('re-running the migration changes nothing and its self-check still passes', async () => {
    await db.exec(MIGRATION)
    const grants = await db.query(`select column_name from information_schema.column_privileges
      where table_name = 'sales' and grantee = 'authenticated' and privilege_type = 'UPDATE' order by 1`)
    expect(grants.rows.map((r) => r.column_name)).toEqual(['balance', 'client_id', 'client_name', 'discount', 'items', 'notes', 'subtotal', 'total'])
  })
})
