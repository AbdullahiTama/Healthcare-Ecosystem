// @vitest-environment node
// H01 (carefind_20261028_otp_hardening): issue_otp gains a per-IP and a platform-wide hourly ceiling, read from
// financial_config; the four-argument function is gone (no overload sibling); verification semantics are unchanged
// and re-proven here (expiry, single use / replay, five-guess burn, purpose + user binding).
import { describe, it, expect, beforeAll } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
const M = (name) => read(`../../../../../supabase/migrations/${name}.sql`)
const uid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const IP_A = 'ip-hash-a'
const IP_B = 'ip-hash-b'
let db
let next = 100

const newUser = async () => {
  const id = uid(++next)
  await db.query('insert into auth.users (id) values ($1)', [id])
  return id
}
const issue = async (user, purpose, hash, ip = null) =>
  (await db.query('select public.issue_otp($1, $2, $3, 300, $4) as r', [user, purpose, hash, ip])).rows[0].r
const verify = async (user, purpose, hash) =>
  (await db.query('select public.verify_otp($1, $2, $3) as r', [user, purpose, hash])).rows[0].r
const setCap = (key, value) => db.query('update public.financial_config set value = $2 where key = $1', [key, value])
const reset = async () => {
  await db.query('truncate public.otp_challenges')
  await setCap('otp_ip_hourly_cap', 10)
  await setCap('otp_global_hourly_cap', 500)
}

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    grant usage on schema public to anon, authenticated, service_role;
    create schema if not exists auth;
    create table if not exists auth.users (id uuid primary key);
    create table public.financial_config (
      key text primary key, value numeric not null, unit text not null, description text not null,
      updated_at timestamptz not null default now()
    );
  `)
  await db.exec(M('carefind_20261024_otp_challenges'))
  await db.exec(M('carefind_20261027_withdrawal_otp_purpose'))
  await db.exec(M('carefind_20261028_otp_hardening'))
})

describe('the migration', () => {
  it('leaves exactly one issue_otp, with the new signature, callable by service_role only', async () => {
    const { rows } = await db.query(`
      select pg_get_function_identity_arguments(oid) as args from pg_proc
       where pronamespace = 'public'::regnamespace and proname = 'issue_otp'`)
    expect(rows).toHaveLength(1)
    expect(rows[0].args).toContain('p_ip_hash')

    const acl = (await db.query(`
      select has_function_privilege('anon', 'public.issue_otp(uuid,text,text,integer,text)', 'execute') a,
             has_function_privilege('authenticated', 'public.issue_otp(uuid,text,text,integer,text)', 'execute') b,
             has_function_privilege('service_role', 'public.issue_otp(uuid,text,text,integer,text)', 'execute') c`)).rows[0]
    expect(acl).toEqual({ a: false, b: false, c: true })
  })

  it('is re-runnable and seeds both ceilings without overwriting an operator change', async () => {
    await setCap('otp_ip_hourly_cap', 7)
    await db.exec(M('carefind_20261028_otp_hardening'))
    const { rows } = await db.query(`select key, value::int as v from public.financial_config where key like 'otp_%' order by key`)
    expect(rows).toEqual([{ key: 'otp_global_hourly_cap', v: 500 }, { key: 'otp_ip_hourly_cap', v: 7 }])
    await reset()
  })

  it('a caller that still passes four arguments (the code deployed before this one) keeps working', async () => {
    const u = await newUser()
    const r = (await db.query(`select public.issue_otp($1, 'pin_set', 'legacy-hash', 300) as r`, [u])).rows[0].r
    expect(r).toBe('ok')
    await reset()
  })
})

describe('per-IP ceiling', () => {
  it('counts every account and purpose behind one address, then refuses', async () => {
    await reset()
    await setCap('otp_ip_hourly_cap', 3)
    const [a, b, c, d] = [await newUser(), await newUser(), await newUser(), await newUser()]
    expect(await issue(a, 'pin_set', 'h1', IP_A)).toBe('ok')
    expect(await issue(b, 'withdrawal', 'h2', IP_A)).toBe('ok')
    expect(await issue(c, 'payout_account', 'h3', IP_A)).toBe('ok')
    expect(await issue(d, 'pin_set', 'h4', IP_A)).toBe('ip_limited')
  })

  it('another address is unaffected, and an unknown address (null) skips only this check', async () => {
    const e = await newUser()
    const f = await newUser()
    expect(await issue(e, 'pin_set', 'h5', IP_B)).toBe('ok')
    expect(await issue(f, 'pin_set', 'h6', null)).toBe('ok')
  })

  it('stores the keyed hash and the code hash only', async () => {
    const { rows } = await db.query(`select ip_hash, code_hash from public.otp_challenges where code_hash = 'h5'`)
    expect(rows).toEqual([{ ip_hash: IP_B, code_hash: 'h5' }])
  })

  it('reads the ceiling from financial_config on every call (no deploy needed) and falls back to 10 if the row is gone', async () => {
    await reset()
    await setCap('otp_ip_hourly_cap', 1)
    const [a, b] = [await newUser(), await newUser()]
    expect(await issue(a, 'pin_set', 'c1', IP_A)).toBe('ok')
    expect(await issue(b, 'pin_set', 'c2', IP_A)).toBe('ip_limited')
    await setCap('otp_ip_hourly_cap', 2)
    expect(await issue(b, 'pin_set', 'c3', IP_A)).toBe('ok')

    await reset()
    await db.query(`delete from public.financial_config where key = 'otp_ip_hourly_cap'`)
    const got = []
    for (let i = 0; i < 11; i++) got.push(await issue(await newUser(), 'pin_set', `d${i}`, IP_A))
    expect(got.slice(0, 10)).toEqual(Array(10).fill('ok'))
    expect(got[10]).toBe('ip_limited')
    await db.query(`insert into public.financial_config (key, value, unit, description) values ('otp_ip_hourly_cap', 10, 'count', 'x')`)
  })

  it('a refusal by the per-user gap does not spend the address budget', async () => {
    await reset()
    await setCap('otp_ip_hourly_cap', 2)
    const u = await newUser()
    expect(await issue(u, 'pin_set', 'e1', IP_A)).toBe('ok')
    expect(await issue(u, 'pin_set', 'e2', IP_A)).toBe('cooldown')
    expect(await issue(await newUser(), 'pin_set', 'e3', IP_A)).toBe('ok')
    expect(await issue(await newUser(), 'pin_set', 'e4', IP_A)).toBe('ip_limited')
  })
})

describe('platform-wide ceiling', () => {
  it('refuses once the hour is full, whatever the account or address', async () => {
    await reset()
    await setCap('otp_global_hourly_cap', 3)
    expect(await issue(await newUser(), 'pin_set', 'g1', IP_A)).toBe('ok')
    expect(await issue(await newUser(), 'pin_set', 'g2', IP_B)).toBe('ok')
    expect(await issue(await newUser(), 'pin_set', 'g3', null)).toBe('ok')
    expect(await issue(await newUser(), 'pin_set', 'g4', 'ip-hash-c')).toBe('global_limited')
  })

  it('rows older than an hour stop counting', async () => {
    await db.query(`update public.otp_challenges set created_at = now() - interval '61 minutes'`)
    expect(await issue(await newUser(), 'pin_set', 'g5', IP_A)).toBe('ok')
    await reset()
  })
})

describe('verification semantics are unchanged', () => {
  it('is single use: a replayed code is refused', async () => {
    const u = await newUser()
    expect(await issue(u, 'withdrawal', 'rp', IP_A)).toBe('ok')
    expect(await verify(u, 'withdrawal', 'rp')).toBe('ok')
    expect(await verify(u, 'withdrawal', 'rp')).toBe('none')
  })

  it('an expired code is refused and burned', async () => {
    const u = await newUser()
    await db.query(`select public.issue_otp($1, 'pin_set', 'ex', -1, null)`, [u])
    expect(await verify(u, 'pin_set', 'ex')).toBe('expired')
    expect(await verify(u, 'pin_set', 'ex')).toBe('none')
  })

  it('five wrong guesses burn the challenge, even if the sixth is right', async () => {
    const u = await newUser()
    expect(await issue(u, 'withdrawal', 'secret', null)).toBe('ok')
    for (let i = 0; i < 4; i++) expect(await verify(u, 'withdrawal', `bad${i}`)).toBe('invalid')
    expect(await verify(u, 'withdrawal', 'bad4')).toBe('locked')
    expect(await verify(u, 'withdrawal', 'secret')).toBe('none')
  })

  it('a code is bound to its user and its purpose', async () => {
    const [a, b] = [await newUser(), await newUser()]
    expect(await issue(a, 'withdrawal', 'bound', null)).toBe('ok')
    expect(await verify(b, 'withdrawal', 'bound')).toBe('none')
    expect(await verify(a, 'pin_set', 'bound')).toBe('none')
    expect(await verify(a, 'withdrawal', 'bound')).toBe('ok')
  })

  it('a new code invalidates the previous one for the same user and purpose', async () => {
    const u = await newUser()
    expect(await issue(u, 'pin_set', 'old', null)).toBe('ok')
    await db.query(`update public.otp_challenges set created_at = now() - interval '2 minutes' where user_id = $1`, [u])
    expect(await issue(u, 'pin_set', 'new', null)).toBe('ok')
    expect(await verify(u, 'pin_set', 'old')).toBe('invalid')
    expect(await verify(u, 'pin_set', 'new')).toBe('ok')
  })

  it('an unknown purpose still raises', async () => {
    await expect(issue(await newUser(), 'wire_money', 'x', null)).rejects.toThrow(/unknown otp purpose/)
  })
})
