// @vitest-environment node
// Phase 16 (database, task A6): saved payout accounts. Ownership shape, status lifecycle,
// one default per owner, cascading audit events, and no client-role access at all.
import { describe, it, expect, beforeAll } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
const M = (name) => read(`../../../../../supabase/migrations/${name}.sql`)
let db
let n = 0
const uid = () => `00000000-0000-4000-8000-${(++n + 170000).toString(16).padStart(12, '0')}`

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    grant usage on schema public to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
  `)
  await db.exec(M('carefind_20261020_payout_accounts'))
}, 120_000)

const one = async (sql, p = []) => (await db.query(sql, p)).rows[0]
const addAccount = async (over = {}, owner = {}) => {
  const id = uid()
  const row = {
    owner_user_id: owner.user ?? uid(),
    bank_code: '058', bank_name: 'GTBank',
    account_number: '0123456789', account_name: 'Ada Obi',
    ...over,
  }
  const cols = Object.keys(row).join(', ')
  const vals = Object.keys(row).map((k, i) => `$${i + 1}`).join(', ')
  return (await db.query(`insert into payout_accounts (${cols}) values (${vals}) returning *`, Object.values(row))).rows[0]
}

describe('payout_accounts shape', () => {
  it('defaults to pending_review with no verification stamp', async () => {
    const a = await addAccount()
    expect(a).toMatchObject({ status: 'pending_review', is_default: false, bvn_last4: null, nin_last4: null, verified_at: null })
  })

  it('rejects an unknown status', async () => {
    await expect(addAccount({ status: 'approved' })).rejects.toThrow(/status/)
  })

  it('requires an owner: neither user nor business is refused', async () => {
    await expect(db.query(`insert into payout_accounts (bank_code, bank_name, account_number, account_name) values ('058','GTBank','0123456789','Ada Obi')`))
      .rejects.toThrow(/check|owner|null/)
  })

  it('accepts either owner: user-owned (CareFind) and business-owned (CareHub)', async () => {
    const userOwned = await addAccount({ owner_business_id: null })
    expect(userOwned.owner_user_id).toBeTruthy()
    const biz = uid()
    const bizOwned = await addAccount({ owner_user_id: null, owner_business_id: biz })
    expect(bizOwned.owner_business_id).toBe(biz)
    expect(bizOwned.owner_user_id).toBeNull()
  })
})

describe('one default per owner', () => {
  it('two defaults for the SAME owner violate the partial unique index', async () => {
    const u = uid()
    await addAccount({ is_default: true }, { user: u })
    await expect(addAccount({ is_default: true }, { user: u })).rejects.toThrow(/payout_accounts_default_user_uniq/)
  })

  it('a second account may claim the default only after the first releases it', async () => {
    const u = uid()
    const a = await addAccount({ is_default: true }, { user: u })
    const b = await addAccount({}, { user: u })
    await expect(addAccount({ is_default: true }, { user: u })).rejects.toThrow()
    await db.query('update payout_accounts set is_default = false where id = $1', [a.id])
    await db.query('update payout_accounts set is_default = true where id = $1', [b.id])
    const defaults = (await db.query('select id from payout_accounts where owner_user_id = $1 and is_default', [u])).rows
    expect(defaults.map((r) => r.id)).toEqual([b.id])
  })

  it('different owners (two businesses) may each have their own default', async () => {
    const d1 = await addAccount({ owner_user_id: null, owner_business_id: uid(), is_default: true })
    const d2 = await addAccount({ owner_user_id: null, owner_business_id: uid(), is_default: true })
    expect(d1.is_default && d2.is_default).toBe(true)
  })
})

describe('payout_account_events', () => {
  it('event survives account deletion (FK -> set null)', async () => {
    const a = await addAccount()
    await db.query('insert into payout_account_events (payout_account_id, actor, action) values ($1, $2, $3)', [a.id, a.owner_user_id, 'added'])
    await db.query('delete from payout_accounts where id = $1', [a.id])
    const ev = await one('select id, payout_account_id from payout_account_events where action = $1 order by id desc limit 1', ['added'])
    expect(ev.payout_account_id).toBeNull()
  })

  it('rejects an event pointing at a missing account', async () => {
    await expect(db.query(`insert into payout_account_events (payout_account_id, action) values ($1, 'added')`, [uid()]))
      .rejects.toThrow(/payout_account_events_payout_account_id_fkey|violates foreign key/)
  })
})

describe('access', () => {
  it('keeps both tables off client roles and out of RLS-with-no-policy limbo', async () => {
    for (const table of ['payout_accounts', 'payout_account_events']) {
      expect(Number((await one(`select relrowsecurity from pg_class where relname = $1`, [table])).relrowsecurity)).toBe(1)
      for (const role of ['anon', 'authenticated']) {
        for (const priv of ['select', 'insert', 'update', 'delete']) {
          expect(await one(`select has_table_privilege($1::name, 'public.' || $2::regclass, $3::text) p`, [role, table, priv]),
            `${table} ${role} ${priv}`).toMatchObject({ p: false })
        }
      }
    }
    expect(await one(`select has_table_privilege('service_role', 'public.payout_accounts', 'update') p`)).toMatchObject({ p: true })
    expect(await one(`select has_table_privilege('service_role', 'public.payout_account_events', 'insert') p`)).toMatchObject({ p: true })
    expect(await one(`select has_table_privilege('service_role', 'public.payout_accounts', 'delete') p`)).toMatchObject({ p: true })
    expect(await one(`select has_table_privilege('service_role', 'public.payout_account_events', 'delete') p`)).toMatchObject({ p: true })
  })
})
