// @vitest-environment node
import { describe, it, expect, beforeAll } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
const M = (n) => read(`../../../../../supabase/migrations/${n}.sql`)
let db
beforeAll(async () => {
  db = new PGlite()
  await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    grant usage on schema public to anon, authenticated, service_role;
    create schema if not exists auth; create table if not exists auth.users (id uuid primary key);
    create table public.financial_config (key text primary key, value numeric not null, unit text not null, description text not null, updated_at timestamptz not null default now());`)
  await db.exec(M('carefind_20261024_otp_challenges'))
  await db.exec(M('carefind_20261027_withdrawal_otp_purpose'))
  await db.exec(M('carefind_20261028_otp_hardening'))
  await db.exec(M('carefind_20261104_withdrawal_drafts'))
})
describe('withdrawal_drafts', () => {
  it('creates one live draft per user and refuses a second with draft_active', async () => {
    const u = '00000000-0000-4000-8000-000000000701'
    await db.query('insert into auth.users (id) values ($1) on conflict do nothing', [u])
    const a = (await db.query(`select public.create_withdrawal_draft($1,'carefind',5,'coins','saved:acc-1') as r`, [u])).rows[0].r
    expect(a.ok).toBe(true)
    const b = (await db.query(`select public.create_withdrawal_draft($1,'carefind',5,'coins','saved:acc-1') as r`, [u])).rows[0].r
    expect(b.outcome).toBe('draft_active')
  })
})
