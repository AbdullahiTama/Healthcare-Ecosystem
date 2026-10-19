// Shared harness for the PGlite database tests (Postgres compiled to WebAssembly).
//
//   npm i --no-save @electric-sql/pglite     (not a project dependency)
//   node scripts/db-tests/directory.pglite.mjs
//   node scripts/db-tests/checkins.pglite.mjs
//
// WHAT THESE PROVE: migrations apply and re-apply cleanly on real Postgres, and
// grants, RLS policies, triggers, constraints and RPCs behave as intended for
// the roles under test.
// WHAT THEY DO NOT PROVE: Supabase itself. auth.uid()/auth.email() are stand-ins
// that read request.jwt.claims; businesses/staff are minimal stand-in tables;
// is_platform_admin() and current_business_ids() are the real definitions from
// sql/phase2_rls_pilot.sql. PostgREST, Realtime and the live schema are not
// exercised. Re-run against a Supabase branch before applying to production.
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

export const REPO = process.env.REPO_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
// Applied migrations live in supabase/migrations; reworked-but-unapproved ones in pending-migrations;
// superseded ones (kept only so their tests still run) in retired-migrations.
export const MIG_DIRS = [
  REPO + '/supabase/migrations/',
  REPO + '/docs/architecture/pending-migrations/',
  REPO + '/docs/architecture/retired-migrations/',
]
export const migrationPath = (f) => MIG_DIRS.map((d) => d + f).find((x) => fs.existsSync(x)) || (MIG_DIRS[0] + f)
export const db = new PGlite()

let pass = 0
let fail = 0
export const results = []

process.on('uncaughtException', (e) => {
  console.log(results.join('\n'))
  console.log('CRASH', e.code, String(e.message).slice(0, 300), String(e.query || '').slice(0, 300))
  process.exit(2)
})

export function ok(name, cond, extra) {
  if (cond) pass++; else fail++
  results.push((cond ? 'PASS ' : 'FAIL ') + name + (cond ? '' : '  -> ' + (extra ?? '')))
}

export async function expectError(name, fn, codeOrText) {
  try { await fn(); ok(name, false, 'expected an error, got none') }
  catch (e) { ok(name, !codeOrText || String(e.code) === codeOrText || String(e.message).includes(codeOrText), e.code + ' ' + e.message) }
}

export function finish() {
  console.log(results.join('\n'))
  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
}

// ---- Supabase-like scaffolding ------------------------------------------------------------
await db.exec(`
  CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
  CREATE SCHEMA auth;
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid $$;
  CREATE FUNCTION auth.email() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email' $$;
  GRANT USAGE ON SCHEMA public, auth TO anon, authenticated;
  GRANT EXECUTE ON FUNCTION auth.uid(), auth.email() TO anon, authenticated;
  CREATE TABLE public.businesses (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text, email text, is_platform_admin boolean NOT NULL DEFAULT false,
    parent_business_id uuid, business_type text, category text, state text, city text, lga text, area text, address text,
    phone text, latitude double precision, longitude double precision, lat double precision, lng double precision,
    website text, created_at timestamptz DEFAULT now());
  CREATE TABLE public.staff (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid, email text, status text DEFAULT 'active', role text, full_name text);
  CREATE TABLE public.field_activities (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid, staff_id uuid, rep_name text, lat double precision, lng double precision, created_at timestamptz NOT NULL DEFAULT now());
`)
// Real definitions from sql/phase2_rls_pilot.sql
await db.exec(`
  CREATE OR REPLACE FUNCTION current_business_ids() RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT id FROM businesses WHERE lower(email) = lower(auth.email())
    UNION SELECT business_id FROM staff WHERE lower(email) = lower(auth.email()) AND status = 'active' $$;
  CREATE OR REPLACE FUNCTION is_platform_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT COALESCE((SELECT is_platform_admin FROM businesses WHERE lower(email) = lower(auth.email())), false) $$;
`)

// ---- fixed identities ---------------------------------------------------------------------
export const ADMIN = '00000000-0000-0000-0000-0000000000a1'
export const COMPANY_A = '00000000-0000-0000-0000-0000000000b1'
export const COMPANY_B = '00000000-0000-0000-0000-0000000000b2'

// who -> JWT claims. 'a'/'b' are business owners (their login email is the business email).
export const USERS = {
  admin: { sub: ADMIN, email: 'admin@x.test' },
  a: { sub: COMPANY_A, email: 'a@x.test' },
  b: { sub: COMPANY_B, email: 'b@x.test' },
  repA1: { sub: '00000000-0000-0000-0000-0000000000c1', email: 'rep1@a.test' },
  repA2: { sub: '00000000-0000-0000-0000-0000000000c2', email: 'rep2@a.test' },
  mgrA: { sub: '00000000-0000-0000-0000-0000000000c3', email: 'mgr@a.test' },
  repB1: { sub: '00000000-0000-0000-0000-0000000000d1', email: 'rep1@b.test' },
  outsider: { sub: '00000000-0000-0000-0000-0000000000e1', email: 'nobody@z.test' },
}

await db.exec(`
  INSERT INTO businesses (email, is_platform_admin, name, state, city, latitude, longitude, phone) VALUES
   ('admin@x.test', true, 'Platform', 'Lagos', 'Ikeja', 6.6, 3.35, '0803'),
   ('a@x.test', false, 'Company A', 'Lagos', 'Yaba', 6.5, 3.38, '0804'),
   ('b@x.test', false, 'Company B', 'Oyo', 'Ibadan', 7.4, 3.9, '0805');
`)
export const bizId = async (email) => (await db.query('select id from businesses where email=$1', [email])).rows[0].id

export async function seedStaff() {
  const A = await bizId('a@x.test'), B = await bizId('b@x.test')
  const ins = (biz, email, role, name, status = 'active') =>
    db.query('insert into staff (business_id,email,role,full_name,status) values ($1,$2,$3,$4,$5) returning id', [biz, email, role, name, status]).then((r) => r.rows[0].id)
  return {
    A, B,
    repA1: await ins(A, USERS.repA1.email, 'Sales Rep', 'Rep One'),
    repA2: await ins(A, USERS.repA2.email, 'Sales Rep', 'Rep Two'),
    mgrA: await ins(A, USERS.mgrA.email, 'Regional Manager', 'Manager A'),
    repB1: await ins(B, USERS.repB1.email, 'Sales Rep', 'Rep B'),
  }
}

// Run SQL as a role + identity, the way PostgREST does (role switch + JWT claims).
export async function as(who, sql, params) {
  const claims = USERS[who] || null
  await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claims', '${claims ? JSON.stringify(claims) : ''}', false);`)
  await db.exec(who === 'anon' || !claims ? 'SET ROLE anon' : 'SET ROLE authenticated')
  try { return await db.query(sql, params) } finally { await db.exec('RESET ROLE') }
}

// As the table owner (bypasses RLS), for arranging fixtures and for inspecting truth.
export const sup = (sql, params) => db.query(sql, params)

export async function applyMigrations(files, { rerun = true } = {}) {
  for (const f of files) {
    try { await db.exec(fs.readFileSync(migrationPath(f), 'utf8')); ok('migration applies: ' + f, true) }
    catch (e) { ok('migration applies: ' + f, false, e.message) }
  }
  if (!rerun) return
  for (const f of files) {
    try { await db.exec(fs.readFileSync(migrationPath(f), 'utf8')); ok('migration re-runs cleanly: ' + f, true) }
    catch (e) { ok('migration re-runs cleanly: ' + f, false, e.message) }
  }
}

// Live-like permissions. On the production project is_business_manager() is NOT executable by
// signed-in users (ACL {postgres, service_role}); an RLS policy that calls it directly fails with
// "permission denied". Tests that apply the facility-review migration call this afterwards so
// they behave like production instead of like a database with permissive default grants.
export async function makeLikeLive() {
  await db.exec(`REVOKE ALL ON FUNCTION public.is_business_manager(uuid) FROM PUBLIC, anon, authenticated;`)
}

// Stand-in for the live can_manage_directory(business_id): true when the caller's email is listed.
// (Live: owner-level, or a role whose permissions include canManageDirectory.)
export async function addDirectoryManagerStub() {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS public.directory_managers_stub (business_id uuid, email text);
    CREATE OR REPLACE FUNCTION public.can_manage_directory(p_business_id uuid) RETURNS boolean
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
      AS $$ SELECT EXISTS (SELECT 1 FROM public.directory_managers_stub d WHERE d.business_id = p_business_id AND lower(d.email) = lower(auth.email())) $$;
    REVOKE ALL ON FUNCTION public.can_manage_directory(uuid) FROM PUBLIC, anon;
    GRANT EXECUTE ON FUNCTION public.can_manage_directory(uuid) TO authenticated;
  `)
}
