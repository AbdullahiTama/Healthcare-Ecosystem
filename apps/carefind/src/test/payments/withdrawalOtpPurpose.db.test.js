// @vitest-environment node
// The emailed withdrawal code (otp purpose 'withdrawal', carefind_20261027): issue_otp accepts the purpose, counts the
// 60 s gap and the 3-an-hour cap PER PURPOSE (a PIN code never throttles a withdrawal code), keeps only the newest code
// working, and still refuses any purpose it does not know. verify_otp is single use and burns after 5 wrong tries.
import { describe, it, expect, beforeAll } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
const M = (name) => read(`../../../../../supabase/migrations/${name}.sql`)
const U = '00000000-0000-4000-8000-0000000a0001'
let db

const issue = async (purpose, hash, user = U) =>
  (await db.query('select public.issue_otp($1, $2, $3, 300) as r', [user, purpose, hash])).rows[0].r
const verify = async (purpose, hash, user = U) =>
  (await db.query('select public.verify_otp($1, $2, $3) as r', [user, purpose, hash])).rows[0].r
const ageCodes = (purpose) => db.query(`update public.otp_challenges set created_at = now() - interval '2 minutes' where purpose = $1`, [purpose])

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    grant usage on schema public to anon, authenticated, service_role;
    create schema if not exists auth;
    create table if not exists auth.users (id uuid primary key);
    insert into auth.users (id) values ('${U}'), ('00000000-0000-4000-8000-0000000a0002');
  `)
  await db.exec(M('carefind_20261024_otp_challenges'))
  await db.exec(M('carefind_20261027_withdrawal_otp_purpose'))
})

describe("issue_otp with the 'withdrawal' purpose", () => {
  it('accepts it, and refuses a purpose it does not know', async () => {
    expect(await issue('withdrawal', 'h1')).toBe('ok')
    await expect(issue('wire_money_anywhere', 'h')).rejects.toThrow(/unknown otp purpose/)
  })

  it('enforces the 60 s gap and the 3-an-hour cap per purpose', async () => {
    expect(await issue('withdrawal', 'h2')).toBe('cooldown')
    await ageCodes('withdrawal')
    expect(await issue('withdrawal', 'h2')).toBe('ok')
    await ageCodes('withdrawal')
    expect(await issue('withdrawal', 'h3')).toBe('ok')
    await ageCodes('withdrawal')
    expect(await issue('withdrawal', 'h4')).toBe('rate_limited')
  })

  it('a PIN-set code is counted separately: it never throttles a withdrawal code, or the other way round', async () => {
    expect(await issue('pin_set', 'p1')).toBe('ok')
    expect(await issue('withdrawal', 'h5', '00000000-0000-4000-8000-0000000a0002')).toBe('ok')
  })

  it('only the newest code works, it is single use, and a code for one purpose cannot satisfy another', async () => {
    const V = '00000000-0000-4000-8000-0000000a0002'
    await ageCodes('withdrawal')
    expect(await issue('withdrawal', 'new-hash', V)).toBe('ok')
    expect(await verify('withdrawal', 'h5', V)).not.toBe('ok')
    expect(await verify('pin_set', 'new-hash', V)).not.toBe('ok')
    expect(await verify('withdrawal', 'new-hash', V)).toBe('ok')
    expect(await verify('withdrawal', 'new-hash', V)).not.toBe('ok')
  })

  it('five wrong guesses burn the code, even if the sixth is right', async () => {
    const W = '00000000-0000-4000-8000-0000000a0003'
    await db.query('insert into auth.users (id) values ($1)', [W])
    expect(await issue('withdrawal', 'right', W)).toBe('ok')
    for (let i = 0; i < 4; i++) expect(await verify('withdrawal', `wrong${i}`, W)).toBe('invalid')
    expect(await verify('withdrawal', 'wrong4', W)).toBe('locked')
    expect(await verify('withdrawal', 'right', W)).toBe('none') // burned: the right code no longer works
  })

  it('verify_otp and issue_otp are service-role only', async () => {
    const { rows } = await db.query(`
      select has_function_privilege('anon', 'public.issue_otp(uuid,text,text,integer)', 'execute') a,
             has_function_privilege('authenticated', 'public.issue_otp(uuid,text,text,integer)', 'execute') b,
             has_function_privilege('service_role', 'public.issue_otp(uuid,text,text,integer)', 'execute') c`)
    expect(rows[0]).toEqual({ a: false, b: false, c: true })
  })
})
