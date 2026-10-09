// @vitest-environment node
// supabase/migrations/carefind_20261026_notifications_insert_policy.sql, on real Postgres (PGlite). The table and its three policies
// are a replica of production as read from pg_policies / information_schema (not the fixture subset, which has no RLS on
// notifications). The point of the file is behaviour, not catalogue state: who can write what into whose inbox.
import { describe, it, expect, beforeAll } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const MIGRATION = readFileSync(
  fileURLToPath(new URL('../../../../../supabase/migrations/carefind_20261026_notifications_insert_policy.sql', import.meta.url)),
  'utf8',
)

const A = '00000000-0000-4000-8000-00000000000a' // the signed-in user doing the writing
const B = '00000000-0000-4000-8000-00000000000b' // the person whose inbox it is

// Production, verbatim: columns, FKs and the three policies ("insertable by any logged-in actor" is the hole).
const LIVE = `
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
  create schema auth;
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to anon, authenticated, service_role;

  create table public.profiles (id uuid primary key);
  create table public.notifications (
    id uuid primary key default gen_random_uuid(),
    recipient_id uuid references public.profiles(id) on delete cascade,
    actor_id uuid references public.profiles(id) on delete set null,
    type text, message text, link text, post_id uuid,
    read boolean default false,
    created_at timestamptz default now()
  );
  alter table public.notifications enable row level security;
  create policy "notifications visible to their recipient" on public.notifications for select
    using (recipient_id = (select auth.uid()));
  create policy "notifications updatable by their recipient" on public.notifications for update
    using (recipient_id = (select auth.uid())) with check (recipient_id = (select auth.uid()));
  create policy "notifications insertable by any logged-in actor" on public.notifications for insert
    with check (((select auth.uid()) is not null) and ((actor_id = (select auth.uid())) or (actor_id is null)));

  -- How the shop writes its notices: a SECURITY DEFINER function owned by the table owner, no actor.
  create function public._settle_shop_order_stub(p_customer uuid) returns void language plpgsql security definer set search_path = public as $$
  begin
    insert into public.notifications (recipient_id, type, message, link)
    values (p_customer, 'shop_payment', 'Payment confirmed for order CF-000045', '/orders/x');
  end $$;
  insert into public.profiles values ('${A}'), ('${B}');
`

let db
const as = async (role, sub, fn) => {
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [sub || ''])
  await db.exec(`set role ${role}`)
  try { return await fn() } finally { await db.exec('reset role') }
}
const insert = (row) => db.query(
  `insert into notifications (recipient_id, actor_id, type, message, link) values ($1,$2,$3,$4,$5)`,
  [row.recipient ?? B, row.actor === undefined ? null : row.actor, 'type' in row ? row.type : 'like', row.message ?? 'x', row.link ?? null],
)
const outcome = async (promise) => { try { await promise; return 'inserted' } catch (e) { return /row-level security|permission denied/i.test(e.message) ? 'denied' : `error: ${e.message}` } }
const policies = async (cmd) => (await db.query(`select policyname from pg_policies where schemaname='public' and tablename='notifications' and cmd = $1`, [cmd])).rows.map((r) => r.policyname)

const BROWSER_TYPES = ['like', 'comment', 'comment_like', 'reply', 'repost', 'follow', 'profile_view', 'gift', 'mention', 'news_like', 'news_comment', 'review', 'consultation', 'live_invite']
const PLATFORM_TYPES = ['shop_payment', 'shop_order_status', 'shop_order_pending', 'shop_order_paid', 'shop_delivery_quoted', 'shop_order_cancelled', 'shop_refund', 'return_approved', 'return_rejected', 'stock_alert', 'payment_topup', 'anything_new']

let beforeMigration
beforeAll(async () => {
  db = new PGlite()
  await db.exec(LIVE)
  // The hole, measured BEFORE the migration, so the test proves the migration changed something real.
  beforeMigration = await as('authenticated', A, () => outcome(insert({ actor: null, type: 'shop_payment', message: 'Payment confirmed for order CF-1', link: 'https://evil.example' })))
  await db.exec(MIGRATION)
}, 60_000)

describe('notifications INSERT policy', () => {
  it('(before) any signed-in user could put a platform-looking notice, with no actor, in anyone\'s inbox', () => {
    expect(beforeMigration).toBe('inserted')
  })

  it('leaves exactly one INSERT policy, and the recipient SELECT/UPDATE policies untouched', async () => {
    expect(await policies('INSERT')).toEqual(['notifications insertable by their actor'])
    expect((await policies('SELECT')).length).toBe(1)
    expect((await policies('UPDATE')).length).toBe(1)
    expect(await policies('ALL')).toEqual([])
  })

  it('lets a member write every kind of notification the app writes, as themselves', async () => {
    for (const type of BROWSER_TYPES) {
      expect(await as('authenticated', A, () => outcome(insert({ actor: A, type }))), type).toBe('inserted')
    }
  })

  it('refuses a notification with no actor, whatever its type', async () => {
    for (const type of [...BROWSER_TYPES, ...PLATFORM_TYPES]) {
      expect(await as('authenticated', A, () => outcome(insert({ actor: null, type }))), type).toBe('denied')
    }
  })

  it('refuses a notification that names someone else as its actor', async () => {
    for (const type of BROWSER_TYPES) {
      expect(await as('authenticated', A, () => outcome(insert({ actor: B, recipient: A, type }))), type).toBe('denied')
    }
  })

  it('refuses a member posting as the platform, even when they name themselves', async () => {
    for (const type of PLATFORM_TYPES) {
      expect(await as('authenticated', A, () => outcome(insert({ actor: A, type, message: 'Payment confirmed', link: 'https://evil.example' }))), type).toBe('denied')
    }
  })

  it('refuses a null or unknown type', async () => {
    expect(await as('authenticated', A, () => outcome(insert({ actor: A, type: null })))).toBe('denied')
    expect(await as('authenticated', A, () => outcome(insert({ actor: A, type: '' })))).toBe('denied')
  })

  it('refuses an anonymous caller and a signed-in session with no user id', async () => {
    expect(await as('anon', '', () => outcome(insert({ actor: A, type: 'like' })))).toBe('denied')
    expect(await as('authenticated', '', () => outcome(insert({ actor: A, type: 'like' })))).toBe('denied')
  })

  it('does not get in the way of the platform: a SECURITY DEFINER function still writes actor-less shop notices', async () => {
    await as('authenticated', A, () => db.query('select public._settle_shop_order_stub($1)', [B]))
    const rows = (await db.query(`select actor_id, type from notifications where type = 'shop_payment' and message = 'Payment confirmed for order CF-000045'`)).rows
    expect(rows).toEqual([{ actor_id: null, type: 'shop_payment' }])
  })

  it('does not get in the way of the API: the service role can write anything', async () => {
    for (const type of ['shop_refund', 'live_invite', 'payment_topup']) {
      expect(await as('service_role', '', () => outcome(insert({ actor: null, type }))), type).toBe('inserted')
    }
  })

  it('keeps inboxes private and writable only by their owner', async () => {
    await db.query(`delete from notifications`)
    await as('service_role', '', () => insert({ recipient: B, actor: A, type: 'like' }))

    expect(await as('authenticated', B, async () => (await db.query('select id from notifications')).rows.length)).toBe(1)
    expect(await as('authenticated', A, async () => (await db.query('select id from notifications')).rows.length)).toBe(0)

    await as('authenticated', B, () => db.query(`update notifications set read = true`))
    expect((await db.query(`select read from notifications`)).rows).toEqual([{ read: true }])

    // The recipient cannot hand a row to somebody else, and a stranger cannot touch it.
    expect(await as('authenticated', B, () => outcome(db.query(`update notifications set recipient_id = $1`, [A])))).toBe('denied')
    await as('authenticated', A, () => db.query(`update notifications set read = false`))
    expect((await db.query(`select read from notifications`)).rows).toEqual([{ read: true }])
  })

  it('is safe to run twice', async () => {
    await db.exec(MIGRATION)
    expect(await policies('INSERT')).toEqual(['notifications insertable by their actor'])
    expect(await as('authenticated', A, () => outcome(insert({ actor: null, type: 'shop_payment' })))).toBe('denied')
  })
})

describe('the migration defends itself', () => {
  it('removes a leftover INSERT policy whatever it is called (a wrong name would otherwise silently keep the hole open)', async () => {
    const other = new PGlite()
    await other.exec(LIVE)
    await other.exec(`create policy "some old open policy" on public.notifications for insert with check (true)`)
    await other.exec(MIGRATION)
    const names = (await other.query(`select policyname from pg_policies where tablename='notifications' and cmd='INSERT'`)).rows.map((r) => r.policyname)
    expect(names).toEqual(['notifications insertable by their actor'])
  }, 60_000)

  it('refuses to run, and changes nothing, when a FOR ALL policy would bypass it', async () => {
    const other = new PGlite()
    await other.exec(LIVE)
    await other.exec(`create policy "blanket" on public.notifications for all using (true) with check (true)`)
    await expect(other.exec(MIGRATION)).rejects.toThrow(/FOR ALL policy/)
    await other.exec('rollback').catch(() => {})
    const insertPolicies = (await other.query(`select policyname from pg_policies where tablename='notifications' and cmd='INSERT'`)).rows.map((r) => r.policyname)
    expect(insertPolicies).toEqual(['notifications insertable by any logged-in actor'])
  }, 60_000)
})
