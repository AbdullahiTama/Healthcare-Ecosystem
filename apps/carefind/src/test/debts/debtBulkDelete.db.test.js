// @vitest-environment node
// carehub_20270113_debt_bulk_delete on PGlite, with member_can_delete() (carehub_20270112_expense_bulk_delete), the live
// stamp_recorded_by() / keep_recorded_by() / pos_actor() and current_business_ids(), is_business_owner(),
// is_platform_admin() (2026-11-10). Only debts recorded by hand are deleted; a debt from a credit sale or a purchase is
// kept with the reason. Restoring puts back the same debt and recorder; only the owner and delete roles may do it.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

vi.setConfig({ testTimeout: 60000, hookTimeout: 120000 })
const read = (name) => readFileSync(fileURLToPath(new URL('../../../../../supabase/migrations/' + name, import.meta.url)), 'utf8')
const MIGRATION = read('carehub_20270113_debt_bulk_delete.sql')
// member_can_delete() exactly as carehub_20270112_expense_bulk_delete defines it (applied 2026-11-10).
const MEMBER_CAN_DELETE = read('carehub_20270112_expense_bulk_delete.sql').match(/create or replace function public\.member_can_delete[\s\S]*?\$\$;\nrevoke[^\n]*\n/)[0]

import { BIZ, OTHER, OWNER, MANAGER, CASHIER, STRANGER, UID, D, C, LIVE_HELPERS_SQL } from './debtsFixture'

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
const del = (ids) => `select delete_debts('${BIZ}', array[${ids.map((i) => `'${i}'`).join(',')}]::uuid[]) r`
const last = `(select deletion_id from deleted_debts order by deleted_at desc limit 1)`

beforeEach(async () => {
  db = new PGlite()
  await db.exec(`
${LIVE_HELPERS_SQL}
    create table clients (id uuid primary key, business_id uuid, full_name text);
    create table debts (id uuid primary key default gen_random_uuid(), business_id uuid, direction text, party_name text, amount numeric default 0,
      amount_paid numeric default 0, balance numeric default 0, due_date text, status text default 'open', description text,
      created_at timestamp default now(), source text, source_ref text, client_id uuid references clients(id) on delete set null,
      recorded_by uuid, recorded_by_staff_id uuid, recorded_by_name text);
    create trigger stamp_recorded_by_ins before insert on debts for each row execute function stamp_recorded_by();
    create trigger stamp_recorded_by_upd before update on debts for each row execute function keep_recorded_by();
    alter table debts enable row level security;
    create policy "debts of own business" on debts for all using ((business_id in (select current_business_ids())) or is_platform_admin());
    grant all on debts, clients to anon, authenticated, service_role;
    create table audit_log (id uuid primary key default gen_random_uuid(), actor_id uuid, actor_type text default 'staff', branch_id uuid, action text,
      target_type text, target_id uuid, metadata jsonb default '{}', created_at timestamptz default now());
  `)
  await db.exec(MEMBER_CAN_DELETE)
  await db.exec(MIGRATION)
  await db.exec(`insert into clients (id, business_id, full_name) values ('${C(1)}', '${BIZ}', 'Ada'), ('${C(2)}', '${BIZ}', 'Ben')`)
  // Bisi (cashier) records two debts by hand; a credit sale and a purchase raised the other two.
  await asUser(CASHIER, `insert into debts (id, business_id, direction, party_name, amount, amount_paid, balance, due_date, status, description, source, source_ref, client_id) values
    ('${D(1)}', '${BIZ}', 'owes_us', 'Ada', 5000, 1000, 4000, '2026-12-01', 'partial', 'Borrowed cash', 'manual', null, '${C(1)}'),
    ('${D(2)}', '${BIZ}', 'we_owe', 'Landlord', 20000, 0, 20000, null, 'open', 'Rent balance', null, null, null),
    ('${D(3)}', '${BIZ}', 'owes_us', 'Ben', 3000, 0, 3000, null, 'open', 'Credit sale', 'credit_sale', 'TXN-1', '${C(2)}'),
    ('${D(4)}', '${BIZ}', 'we_owe', 'Emzor', 90000, 0, 90000, null, 'open', 'Purchase', 'purchase', 'PO-7', null)`)
  await db.exec(`insert into debts (id, business_id, party_name, amount, balance, source) values ('${D(9)}', '${OTHER}', 'X', 1, 1, 'manual')`)
})

const snapshot = `select id, direction, party_name, amount::float8 amount, amount_paid::float8 paid, balance::float8 balance, due_date, status,
  description, source, source_ref, client_id, created_at, recorded_by, recorded_by_name from debts where business_id = '${BIZ}' order by id`

describe('delete_debts', () => {
  it('deletes only debts recorded by hand; sale and purchase debts are kept with the reason; copies and audit', async () => {
    const r = await scenario(MANAGER, del([D(1), D(2), D(3), D(4)]), [
      `select id from debts where business_id = '${BIZ}' order by id`,
      `select debt_id, party_name, deleted_by_name from deleted_debts order by debt_id`,
      `select action, actor_type, metadata from audit_log`,
    ])
    expect(r.error).toBeUndefined()
    expect(r.out[0][0].r).toEqual({
      deletion_id: expect.any(String), deleted: 2, not_found: 0,
      kept: [{ id: D(3), name: 'Ben', reasons: ['credit_sale'], ref: 'TXN-1' }, { id: D(4), name: 'Emzor', reasons: ['purchase'], ref: 'PO-7' }],
    })
    expect(r.seen[0]).toEqual([{ id: D(3) }, { id: D(4) }])
    expect(r.seen[1]).toEqual([
      { debt_id: D(1), party_name: 'Ada', deleted_by_name: 'Musa' },
      { debt_id: D(2), party_name: 'Landlord', deleted_by_name: 'Musa' },
    ])
    expect(r.seen[2]).toEqual([{ action: 'debts.deleted', actor_type: 'staff', metadata: { deleted: 2, kept: 2, requested: 4, outstanding: 24000 } }])
  })

  it('only kept debts: nothing deleted, no deletion id, no audit', async () => {
    const r = await scenario(OWNER, del([D(3)]), [`select count(*)::int n from audit_log`, `select count(*)::int n from deleted_debts`])
    expect(r.out[0][0].r).toMatchObject({ deletion_id: null, deleted: 0, kept: [{ id: D(3) }] })
    expect(r.seen).toEqual([[{ n: 0 }], [{ n: 0 }]])
  })

  it('another business\'s debt and unknown ids are not found and never touched; who may delete; limits', async () => {
    const r = await scenario(OWNER, del([D(9), 'f0000000-0000-4000-8000-000000000001', D(2)]), [`select count(*)::int n from debts where id = '${D(9)}'`])
    expect(r.out[0][0].r).toMatchObject({ deleted: 1, not_found: 2 })
    expect(r.seen[0][0].n).toBe(1)
    expect((await scenario(CASHIER, del([D(2)]))).error).toMatch(/DELETE_NOT_ALLOWED/)
    expect((await scenario(STRANGER, del([D(2)]))).error).toMatch(/DELETE_NOT_ALLOWED/)
    expect((await scenario(null, del([D(2)]))).error).toMatch(/permission denied/)
    expect((await scenario(OWNER, `select delete_debts('${BIZ}', '{}'::uuid[])`)).error).toMatch(/DELETE_NONE/)
    expect((await scenario(OWNER, `select delete_debts('${BIZ}', array(select gen_random_uuid() from generate_series(1, 5001)))`)).error).toMatch(/DELETE_TOO_MANY/)
  })
})

describe('restore_deleted_debts', () => {
  it('puts back the same debts (amounts, status, dates, recorder), audited', async () => {
    const before = (await scenario(OWNER, snapshot)).out[0]
    const r = await scenario(OWNER, [del([D(1), D(2)]), `select restore_deleted_debts('${BIZ}', ${last}) r`], [
      snapshot, `select action, actor_type from audit_log order by created_at, action`,
    ])
    expect(r.error).toBeUndefined()
    expect(r.out[1][0].r).toEqual({ restored: 2, skipped_already_back: 0, client_unlinked: 0 })
    expect(r.seen[0]).toEqual(before)
    expect(before.find((x) => x.id === D(1))).toMatchObject({ paid: 1000, balance: 4000, status: 'partial', recorded_by_name: 'Bisi', client_id: C(1) })
    expect(r.seen[1]).toEqual([{ action: 'debts.deleted', actor_type: 'owner' }, { action: 'debts.restored', actor_type: 'owner' }])
  })

  it('a client deleted since: the debt comes back with the party name and no client link', async () => {
    const r = await scenario(OWNER, [del([D(1)]), `delete from clients where id = '${C(1)}'`, `select restore_deleted_debts('${BIZ}', ${last}) r`],
      [`select party_name, client_id from debts where id = '${D(1)}'`])
    expect(r.error).toBeUndefined()
    expect(r.out[2][0].r).toEqual({ restored: 1, skipped_already_back: 0, client_unlinked: 1 })
    expect(r.seen[0]).toEqual([{ party_name: 'Ada', client_id: null }])
  })

  it('restoring twice changes nothing the second time; same people as deleting; unknown deletion not found', async () => {
    const r = await scenario(OWNER, [del([D(2)]), `select restore_deleted_debts('${BIZ}', ${last}) r`, `select restore_deleted_debts('${BIZ}', ${last}) r`])
    expect(r.out[2][0].r).toEqual({ restored: 0, skipped_already_back: 0, client_unlinked: 0 })
    expect((await scenario(CASHIER, `select restore_deleted_debts('${BIZ}', gen_random_uuid())`)).error).toMatch(/DELETE_NOT_ALLOWED/)
    expect((await scenario(OWNER, `select restore_deleted_debts('${BIZ}', gen_random_uuid())`)).error).toMatch(/RESTORE_NOT_FOUND/)
    expect((await scenario(null, `select restore_deleted_debts('${BIZ}', gen_random_uuid())`)).error).toMatch(/permission denied/)
  })

  it('the restorer\'s identity is back after a restore (later stamps are theirs)', async () => {
    const r = await scenario(OWNER, [del([D(2)]), `select restore_deleted_debts('${BIZ}', ${last}) r`,
      `insert into debts (business_id, party_name, amount, balance) values ('${BIZ}', 'New', 5, 5) returning recorded_by_name`])
    expect(r.out[2][0].recorded_by_name).toBe('Tama')
  })
})

describe('deleted_debts access', () => {
  it('members read their business\'s copies; nobody writes them directly; anon nothing', async () => {
    await db.exec(`insert into deleted_debts (deletion_id, business_id, debt_id, party_name, debt) values
      (gen_random_uuid(), '${BIZ}', '${D(1)}', 'x', '{}'), (gen_random_uuid(), '${OTHER}', '${D(9)}', 'y', '{}')`)
    expect((await scenario(CASHIER, `select party_name from deleted_debts`)).out[0]).toEqual([{ party_name: 'x' }])
    expect((await scenario(OWNER, `delete from deleted_debts`)).error).toMatch(/permission denied/)
    expect((await scenario(null, `select count(*) from deleted_debts`)).error).toMatch(/permission denied/)
  })
})
