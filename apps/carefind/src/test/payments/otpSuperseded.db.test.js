// @vitest-environment node
import { describe, it, expect, beforeAll } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
const M = (n) => read(`../../../../../supabase/migrations/${n}.sql`)
let db
const uid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
beforeAll(async () => {
  db = new PGlite()
  await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    grant usage on schema public to anon, authenticated, service_role;
    create schema if not exists auth; create table if not exists auth.users (id uuid primary key);
    create table public.financial_config (key text primary key, value numeric not null, unit text not null, description text not null, updated_at timestamptz not null default now());`)
  await db.exec(M('carefind_20261024_otp_challenges'))
  await db.exec(M('carefind_20261027_withdrawal_otp_purpose'))
  await db.exec(M('carefind_20261028_otp_hardening'))
  await db.exec(M('carefind_20261103_otp_superseded_reason'))
})
describe('superseded branch', () => {
  it('typing a burned prior code returns superseded and does not burn the live row', async () => {
    const u = uid(901)
    await db.query('insert into auth.users (id) values ($1)', [u])
    await db.query(`select public.issue_otp($1,'withdrawal','old-hash',300,null)`, [u])
    await db.query(`update public.otp_challenges set created_at = now() - interval '2 minutes' where user_id=$1`, [u])
    await db.query(`select public.issue_otp($1,'withdrawal','new-hash',300,null)`, [u])
    const r1 = (await db.query(`select public.verify_otp($1,'withdrawal','old-hash') as r`, [u])).rows[0].r
    expect(r1).toBe('superseded')
    const live = (await db.query(`select attempts from public.otp_challenges where user_id=$1 and consumed_at is null`, [u])).rows[0]
    expect(live.attempts).toBe(0)
    const r2 = (await db.query(`select public.verify_otp($1,'withdrawal','new-hash') as r`, [u])).rows[0].r
    expect(r2).toBe('ok')
  })
})
