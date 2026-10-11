// @vitest-environment node
// H02 (carefind_20261029_pin_and_payout_protection): the PIN remembers WHEN it was last set (so withdrawals can be capped
// for a while afterwards), existing PINs are not retroactively "recent", the function keeps its signature and ACL, the
// cooling-off hours are a config row, and the destination-history lookups have partial indexes.
import { describe, it, expect, beforeAll } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
const M = (name) => read(`../../../../../supabase/migrations/${name}.sql`)
const U1 = '00000000-0000-4000-8000-0000000b0001'
const U2 = '00000000-0000-4000-8000-0000000b0002'
const LEGACY = '00000000-0000-4000-8000-0000000b0003'
let db

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    grant usage on schema public to anon, authenticated, service_role;
    create schema if not exists auth;
    create table if not exists auth.users (id uuid primary key);
    insert into auth.users (id) values ('${U1}'), ('${U2}'), ('${LEGACY}');
    create table public.financial_config (
      key text primary key, value numeric not null, unit text not null, description text not null,
      updated_at timestamptz not null default now()
    );
    create table public.withdrawal_requests (id uuid primary key default gen_random_uuid(), user_id uuid, bank_code text, account_number text, status text);
    create table public.business_withdrawal_requests (id uuid primary key default gen_random_uuid(), business_id uuid, bank_code text, account_number text, status text);
  `)
  await db.exec(M('carefind_20260816_withdrawal_pin'))
  // A PIN that existed BEFORE this migration (the old set_withdrawal_pin never wrote pin_set_at)
  await db.query(`select public.set_withdrawal_pin($1, 'hash-old', 'salt-old')`, [LEGACY])
  await db.exec(M('carefind_20261029_pin_and_payout_protection'))
})

const setPin = (u, hash = 'h', salt = 's') => db.query('select public.set_withdrawal_pin($1, $2, $3)', [u, hash, salt])
const pinRow = async (u) => (await db.query('select * from public.withdrawal_pins where user_id = $1', [u])).rows[0]

describe('pin_set_at', () => {
  it('a PIN that existed before the migration is NOT recent (null): applying it caps nobody', async () => {
    expect((await pinRow(LEGACY)).pin_set_at).toBeNull()
  })

  it('setting a PIN records the time; replacing it records the new time', async () => {
    await setPin(U1)
    const first = (await pinRow(U1)).pin_set_at
    expect(first).not.toBeNull()
    expect(Date.now() - new Date(first).getTime()).toBeLessThan(60_000)
    await db.query(`update public.withdrawal_pins set pin_set_at = now() - interval '2 days' where user_id = $1`, [U1])
    await setPin(U1, 'h2', 's2')
    const second = await pinRow(U1)
    expect(Date.now() - new Date(second.pin_set_at).getTime()).toBeLessThan(60_000)
    expect(second.pin_hash).toBe('h2')
  })

  it('a reset still clears the lockout state', async () => {
    await setPin(U2)
    await db.query(`update public.withdrawal_pins set failed_attempts = 4, locked_until = now() + interval '10 minutes' where user_id = $1`, [U2])
    await setPin(U2, 'h3', 's3')
    expect(await pinRow(U2)).toMatchObject({ failed_attempts: 0, locked_until: null })
  })

  it('a wrong PIN attempt does not move pin_set_at (only setting does)', async () => {
    const before = (await pinRow(U2)).pin_set_at
    await db.query(`select public.verify_withdrawal_pin($1, 'wrong', 's3')`, [U2])
    expect((await pinRow(U2)).pin_set_at).toEqual(before)
  })
})

describe('function surface', () => {
  it('set_withdrawal_pin is still one function, service_role only', async () => {
    const { rows } = await db.query(`select pg_get_function_identity_arguments(oid) args from pg_proc where pronamespace = 'public'::regnamespace and proname = 'set_withdrawal_pin'`)
    expect(rows).toHaveLength(1)
    const acl = (await db.query(`
      select has_function_privilege('anon', 'public.set_withdrawal_pin(uuid,text,text)', 'execute') a,
             has_function_privilege('authenticated', 'public.set_withdrawal_pin(uuid,text,text)', 'execute') b,
             has_function_privilege('service_role', 'public.set_withdrawal_pin(uuid,text,text)', 'execute') c`)).rows[0]
    expect(acl).toEqual({ a: false, b: false, c: true })
  })
})

describe('configuration and indexes', () => {
  it('seeds pin_change_cooloff_hours = 24, and re-applying does not overwrite an operator change', async () => {
    const seeded = await db.query(`select value::int v from public.financial_config where key = 'pin_change_cooloff_hours'`)
    expect(seeded.rows[0].v).toBe(24)
    await db.query(`update public.financial_config set value = 6 where key = 'pin_change_cooloff_hours'`)
    await db.exec(M('carefind_20261029_pin_and_payout_protection'))
    expect((await db.query(`select value::int v from public.financial_config where key = 'pin_change_cooloff_hours'`)).rows[0].v).toBe(6)
  })

  it('creates the partial indexes for the destination-history lookup', async () => {
    const { rows } = await db.query(`select indexname from pg_indexes where schemaname = 'public' and indexname like '%known_destination' order by 1`)
    expect(rows.map((r) => r.indexname)).toEqual(['business_withdrawal_requests_known_destination', 'withdrawal_requests_known_destination'])
  })
})
