// @vitest-environment node
// Financial audit F-04: pay_creator_subscription must charge the creator's LISTED price, never the
// caller's. Real Postgres (PGlite), the real migration, a replica of the live tables.
import { describe, it, expect, beforeAll } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
let db
let n = 0
const uid = () => `00000000-0000-4000-8000-${(++n + 5000).toString(16).padStart(12, '0')}`

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    grant usage on schema public to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
  `)
  await db.exec(read('./fixtures/liveSchemaSubset.sql'))
  // In production the function already exists with these grants (postgres, authenticated, service_role)
  // and CREATE OR REPLACE keeps them; reproduce that starting point.
  await db.exec(`
    create function public.pay_creator_subscription(p_creator uuid, p_price integer) returns text language sql as $$ select 'old'::text $$;
    revoke all on function public.pay_creator_subscription(uuid, integer) from public, anon;
    grant execute on function public.pay_creator_subscription(uuid, integer) to authenticated, service_role;
  `)
  await db.exec(read('../../../../../supabase/migrations/carefind_20261004_pay_creator_subscription_authoritative_price.sql'))
}, 120_000) // PGlite start-up + migrations is slow when many suites run at once

async function setup({ listed = 12, balance = 50 } = {}) {
  const creator = uid()
  const me = uid()
  await db.query('insert into profiles (id, subscription_price) values ($1,$2)', [creator, listed])
  if (balance !== null) await db.query('insert into wallets (user_id, balance) values ($1,$2)', [me, balance])
  return { creator, me }
}
const as = (me) => db.query(`select set_config('request.jwt.claim.sub', $1, false), set_config('request.jwt.claim.role', 'authenticated', false)`, [me])
const pay = async (me, creator, price) => {
  await as(me)
  return (await db.query('select pay_creator_subscription($1,$2) r', [creator, price])).rows[0].r
}
const bal = async (u) => Number((await db.query('select balance from wallets where user_id = $1', [u])).rows[0]?.balance ?? NaN)

describe('pay_creator_subscription: the creator\'s listed price is the only price', () => {
  it('charges the listed price when the caller names it', async () => {
    const { creator, me } = await setup({ listed: 12, balance: 50 })
    expect(await pay(me, creator, 12)).toBe('ok')
    expect(await bal(me)).toBe(38)
    expect(await bal(creator)).toBe(12)
    const sub = (await db.query('select price from creator_subscriptions where subscriber_id = $1 and creator_id = $2', [me, creator])).rows[0]
    expect(sub.price).toBe(12)
  })

  it('refuses a cheaper price than the one listed (the exploit), moving nothing', async () => {
    const { creator, me } = await setup({ listed: 12, balance: 50 })
    expect(await pay(me, creator, 1)).toBe('price_mismatch')
    expect(await bal(me)).toBe(50)
    expect((await db.query('select 1 from wallets where user_id = $1', [creator])).rows).toHaveLength(0)
    expect((await db.query('select 1 from creator_subscriptions where creator_id = $1', [creator])).rows).toHaveLength(0)
  })

  it('refuses a higher price than the one listed too (it is not a tip jar)', async () => {
    const { creator, me } = await setup({ listed: 3, balance: 50 })
    expect(await pay(me, creator, 10)).toBe('price_mismatch')
    expect(await bal(me)).toBe(50)
  })

  it('refuses a creator with nothing for sale', async () => {
    const none = await setup({ listed: 0 })
    expect(await pay(none.me, none.creator, 1)).toBe('not_for_sale')
    const unset = uid()
    await db.query('insert into profiles (id, subscription_price) values ($1, null)', [unset])
    const me = uid(); await db.query('insert into wallets (user_id, balance) values ($1, 9)', [me])
    expect(await pay(me, unset, 1)).toBe('not_for_sale')
    expect(await pay(me, uid(), 1)).toBe('not_for_sale') // no profile at all
  })

  it('refuses subscribing to yourself', async () => {
    const me = uid()
    await db.query('insert into profiles (id, subscription_price) values ($1, 5)', [me])
    await db.query('insert into wallets (user_id, balance) values ($1, 9)', [me])
    expect(await pay(me, me, 5)).toBe('self_subscription')
    expect(await bal(me)).toBe(9)
  })

  it('still reports insufficient funds, signed-out callers and invalid arguments', async () => {
    const { creator, me } = await setup({ listed: 12, balance: 3 })
    expect(await pay(me, creator, 12)).toBe('insufficient')
    const noWallet = await setup({ listed: 4, balance: null })
    expect(await pay(noWallet.me, noWallet.creator, 4)).toBe('insufficient')
    await db.query(`select set_config('request.jwt.claim.sub', '', false)`)
    expect((await db.query('select pay_creator_subscription($1,$2) r', [creator, 12])).rows[0].r).toBe('not_signed_in')
    expect(await pay(me, creator, 0)).toBe('invalid_args')
    expect(await pay(me, creator, -5)).toBe('invalid_args')
  })

  it('a renewal extends from the current expiry and records the listed price', async () => {
    const { creator, me } = await setup({ listed: 4, balance: 40 })
    await db.query(`insert into creator_subscriptions (subscriber_id, creator_id, price, expires_at) values ($1,$2,2, now() + interval '20 days')`, [me, creator])
    expect(await pay(me, creator, 4)).toBe('ok')
    const sub = (await db.query('select price, expires_at from creator_subscriptions where subscriber_id = $1 and creator_id = $2', [me, creator])).rows[0]
    expect(sub.price).toBe(4)
    expect(new Date(sub.expires_at).getTime()).toBeGreaterThan(Date.now() + 49 * 86400e3)
  })

  it('a creator who RAISED their price breaks an old-price renewal instead of undercharging it', async () => {
    const { creator, me } = await setup({ listed: 4, balance: 40 })
    await pay(me, creator, 4)
    await db.query('update profiles set subscription_price = 9 where id = $1', [creator])
    expect(await pay(me, creator, 4)).toBe('price_mismatch')
    expect(await bal(me)).toBe(36)
  })

  it('is replaced in place: one function, executable by signed-in users and not by anon', async () => {
    const r = await db.query(`select p.proname, has_function_privilege('anon', p.oid, 'execute') a, has_function_privilege('authenticated', p.oid, 'execute') u
                                from pg_proc p where p.proname = 'pay_creator_subscription'`)
    expect(r.rows).toHaveLength(1)
    expect(r.rows[0].u).toBe(true)
  })
})
