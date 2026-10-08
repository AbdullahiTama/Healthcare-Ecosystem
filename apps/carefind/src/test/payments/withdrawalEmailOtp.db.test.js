// @vitest-environment node
// Phase 16 (database, task A1): the withdrawal-PIN email OTP table. Client roles get nothing;
// service_role gets exactly select/insert/update; defaults match the emailed-code contract.
import { describe, it, expect, beforeAll } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
const M = (name) => read(`../../../../../supabase/migrations/${name}.sql`)
let db

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    grant usage on schema public to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
  `)
  await db.exec(M('carefind_20261020_withdrawal_email_otp'))
}, 120_000)

const one = async (sql, p = []) => (await db.query(sql, p)).rows[0]
const USER = '00000000-0000-4000-8000-000000000001'

describe('withdrawal_email_otps', () => {
  it('stores a row with the 10-minute expiry, purpose and attempt defaults', async () => {
    await db.query('insert into withdrawal_email_otps (user_id, code_hash) values ($1, $2)', [USER, 'a'.repeat(64)])
    const row = await one(`select purpose, attempts, consumed_at, expires_at, created_at from withdrawal_email_otps where user_id = $1`, [USER])
    expect(row).toMatchObject({ purpose: 'withdrawal_pin', attempts: 0, consumed_at: null })
    const ttl = new Date(row.expires_at).getTime() - new Date(row.created_at).getTime()
    expect(ttl).toBeGreaterThanOrEqual(9 * 60 * 1000)
    expect(ttl).toBeLessThanOrEqual(10 * 60 * 1000 + 5000)
  })

  it('rejects a missing code_hash or user', async () => {
    await expect(db.query('insert into withdrawal_email_otps (user_id) values ($1)', [USER])).rejects.toThrow(/code_hash/)
    await expect(db.query('insert into withdrawal_email_otps (code_hash) values ($1)', ['b'.repeat(64)])).rejects.toThrow(/user_id/)
  })

  it('has the user lookup index', async () => {
    const idx = await one(`select indexname from pg_indexes where tablename = 'withdrawal_email_otps' and indexname = 'withdrawal_email_otps_user_idx'`)
    expect(idx).toBeTruthy()
  })

  it('keeps client roles out entirely: RLS on, no grants, service_role limited to select/insert/update', async () => {
    const rls = await one(`select relrowsecurity from pg_class where relname = 'withdrawal_email_otps'`)
    expect(Number(rls.relrowsecurity)).toBe(1)
    for (const role of ['anon', 'authenticated']) {
      for (const priv of ['select', 'insert', 'update', 'delete']) {
        expect(await one(`select has_table_privilege($1::name, 'public.withdrawal_email_otps', $2::text) p`, [role, priv]),
          `${role} ${priv}`).toMatchObject({ p: false })
      }
    }
    for (const priv of ['select', 'insert', 'update']) {
      expect(await one(`select has_table_privilege('service_role', 'public.withdrawal_email_otps', $1::text) p`, [priv]),
        `service_role ${priv}`).toMatchObject({ p: true })
    }
  })

  it('leaves no grants behind for PUBLIC', async () => {
    const rows = (await db.query(`select grantee, privilege_type from information_schema.role_table_grants
      where table_schema = 'public' and table_name = 'withdrawal_email_otps'`)).rows
    expect(rows.filter((r) => r.grantee === 'PUBLIC')).toEqual([])
  })
})
