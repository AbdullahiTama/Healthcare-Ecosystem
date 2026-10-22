// @vitest-environment node
// Pickup-station receipt (Phase 4 / Rem-05). Real Postgres (PGlite), the real migration chain in production order.
//
// The gap this closes: a vendor's held earnings were released only when `shop_orders.status` became 'delivered', and
// `update_shop_order_status` lets the VENDOR set that status themselves - so the vendor could release their own money
// by typing a status, and nothing anywhere recorded that a person had actually looked at the goods.
import { describe, it, expect, beforeAll } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createLegacyStubs } from './fixtures/legacyFunctions.js'

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
const M = (name) => read(`../../../../../supabase/migrations/${name}.sql`)
let db
let n = 0
const uid = () => `00000000-0000-4000-8000-${(++n + 170000).toString(16).padStart(12, '0')}`
const ref = (p) => `${p}_${++n}_abcdefgh`

const SUBTOTAL = 2_000_000
const COMMISSION = 400_000
const FULFILMENT = 50_000
const TOTAL = SUBTOTAL + FULFILMENT
const VENDOR = SUBTOTAL - COMMISSION

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    grant usage on schema public to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
  `)
  await db.exec(read('./fixtures/liveSchemaSubset.sql'))
  await db.exec(M('carefind_20261003_payment_intents_foundation'))
  await db.exec(M('carefind_20261004_settle_payment_intent'))
  await db.exec(M('carefind_20261005_coin_ledger'))
  await createLegacyStubs(db)
  await db.exec(M('carefind_20261005_coin_writers_use_ledger'))
  await db.exec(M('carefind_20261005_lock_wallets_to_ledger'))
  await db.exec(M('carefind_20261006_settle_plan_and_carehub_appointments'))
  await db.exec(M('carefind_20261007_commission_engine'))
  await db.exec(M('carefind_20261008_commission_reconcile_first_payment'))
  await db.exec(M('carefind_20261008_withdrawal_engine'))
  await db.exec(M('carefind_20261009_refund_engine'))
  await db.exec(M('carefind_20261010_central_settlement'))
  await db.exec(`
    create function public.cancel_shop_order(p_order_id uuid, p_reason text default null) returns text language sql as $$ select 'old'::text $$;
    create function public.process_shop_return(p_return_id uuid, p_action text, p_notes text default null) returns text language sql as $$ select 'old'::text $$;
    grant execute on function public.cancel_shop_order(uuid, text), public.process_shop_return(uuid, text, text) to anon, authenticated, service_role;
  `)
  await db.exec(M('carefind_20261012_shop_vendor_payouts'))
  await db.exec(`
    create function public.request_shop_return(p_order_id uuid, p_reason text, p_description text default null, p_refund_amount_kobo integer default null) returns uuid language sql as $$ select null::uuid $$;
    grant execute on function public.request_shop_return(uuid, text, text, integer) to anon, authenticated, service_role;
  `)
  await db.exec(M('carefind_20261013_shop_return_hardening'))
  await db.exec(M('carefind_20261014_reconciliation'))
  await db.exec(M('carefind_20261015_reconciliation_ops'))
  await db.exec(M('carefind_20261016_reconciliation_scale'))
  await db.exec(M('carefind_20261017_engine_timeouts_and_hot_paths'))
  await db.exec(M('carefind_20261019_red_team_fixes'))
  await db.exec(M('carefind_20261018_shop_return_service_caller'))
  await db.exec(M('carefind_20261105_release_on_delivery'))
  await db.exec(M('carefind_20261112_engine_timeouts_reapply'))
  await db.exec(M('carefind_20261113_pickup_receipt_release'))
}, 240_000)

const one = async (sql, p = []) => (await db.query(sql, p)).rows[0]
const all = async (sql, p = []) => (await db.query(sql, p)).rows
const asRole = async (role, fn) => { await db.exec(`set role ${role}`); try { return await fn() } finally { await db.exec('reset role') } }

const wallet = (b) => one('select held_balance::int held, available_balance::int avail from business_wallets where business_id = $1', [b])
const credit = (id) => one('select status, amount_kobo, released_kobo, release_shortfall_kobo from shop_vendor_credits where order_id = $1', [id])
const ledger = (b, type) => all('select amount::int amount, reference from business_wallet_transactions where business_id = $1 and type = $2 order by created_at', [b, type])
const receipts = (id) => all('select reference, business_id, received_by, note, created_at from shop_order_receipts where order_id = $1 order by created_at', [id])

async function business({ held = 0, available = 0, email = null } = {}) {
  const b = (await db.query('insert into businesses (name, email) values ($1,$2) returning id', ['Vendor', email])).rows[0].id
  await db.query('insert into business_wallets (business_id, held_balance, available_balance) values ($1,$2,$3)', [b, held, available])
  return b
}

async function paidOrder({ vendor, customer = uid(), quantity = 4 } = {}) {
  vendor ||= await business()
  // shop_order_items.line_total_kobo is derived from quantity x unit_price, and the settlement engine refuses an order
  // whose item lines do not sum to subtotal_kobo. Derive the subtotal from the line instead of asserting a number.
  const unitPrice = Math.floor(SUBTOTAL / quantity)
  const subtotal = unitPrice * quantity
  const total = subtotal + FULFILMENT
  // The shared test fixture auto-inserts one default line per order unless the ref starts with 'CF-RT-'. These tests
  // build their own lines, so opt out of the fixture's or the sum is doubled and settlement refuses.
  const o = (await db.query(
    `insert into shop_orders (order_ref, customer_id, vendor_business_id, status, total_kobo, subtotal_kobo, commission_kobo)
     values ($1,$2,$3,'pending_payment',$4,$5,$6) returning id`,
    [`CF-RT-${++n}_abcdefgh`, customer, vendor, total, subtotal, COMMISSION],
  )).rows[0]
  const item = (await db.query(
    `insert into shop_order_items (order_id, product_name, quantity, unit_price_kobo, line_total_kobo)
     values ($1,'Item',$2,$3,$4) returning id`,
    [o.id, quantity, unitPrice, subtotal],
  )).rows[0]
  const reference = ref('cf_shop')
  await db.query(`insert into payment_intents (reference, application, purpose, customer_id, business_id, entity_type, entity_id, expected_amount, metadata) values ($1,'carefind','shop_order',$2,$3,'shop_order',$4,$5,'{}'::jsonb)`, [reference, customer, vendor, o.id, total])
  await db.query(`insert into shop_payments (order_id, payment_reference, amount_kobo, status) values ($1,$2,$3,'pending')`, [o.id, reference, total])
  const r = (await one('select settle_payment_intent($1,$2,$3,$4,$5) r', [reference, 'paystack', `T${reference}`, total, 'NGN'])).r
  // Surface WHY rather than a bare 'needs_refund': that is the difference between a five-second fix and a guess.
  if (r.outcome !== 'settled') {
    const why = (await one('select metadata->>\'refund_reason\' reason from payment_intents where reference = $1', [reference])).reason
    const nums = (await one(
      `select (select sum(line_total_kobo) from shop_order_items where order_id = $1)::int items_sum,
              (select subtotal_kobo from shop_orders where id = $1)::int order_subtotal,
              (select count(*) from shop_order_items where order_id = $1)::int item_rows`,
      [o.id]))
    throw new Error(`settlement refused: ${r.outcome} / ${why} / items_sum=${nums.items_sum} order_subtotal=${nums.order_subtotal} rows=${nums.item_rows} unitPrice=${unitPrice} subtotal=${subtotal}`)
  }
  return { id: o.id, itemId: item.id, vendor, customer, reference, quantity }
}

const receive = (id, items, { by = null, email = null, note = null } = {}) =>
  asRole('service_role', () => one('select record_pickup_receipt($1,$2::jsonb,$3,$4,$5) r', [id, JSON.stringify(items), note, by, email])).then((x) => x.r)
const itemsFor = (o, quantity) => [{ item_id: o.itemId, quantity: quantity ?? o.quantity }]

describe('staff confirming pickup-station receipt', () => {
  it('releases the vendor earning from held to available, with one ledger row', async () => {
    const o = await paidOrder()
    const r = await receive(o.id, itemsFor(o), { by: uid(), email: 'staff@carefind.ng', note: '2 cartons, seals intact' })
    expect(r.ok).toBe(true)
    expect(r.already_received).toBe(false)
    expect(r.credit_status).toBe('released')
    expect(r.released_kobo).toBe(VENDOR)
    expect(await wallet(o.vendor)).toEqual({ held: 0, avail: VENDOR })
    expect(await ledger(o.vendor, 'shop_release')).toEqual([{ amount: VENDOR, reference: `shoprl_${o.id}` }])
  })

  it('records WHO received it, WHEN, and WHAT, as an append-only audit row', async () => {
    const o = await paidOrder()
    const staff = uid()
    const r = await receive(o.id, itemsFor(o), { by: staff, email: 'staff@carefind.ng', note: 'damaged box replaced' })
    const rows = await receipts(o.id)
    expect(rows).toHaveLength(1)
    expect(rows[0].reference).toBe(r.reference)
    expect(rows[0].received_by).toBe(staff)
    expect(rows[0].note).toBe('damaged box replaced')
    expect(rows[0].created_at).toBeTruthy()
    // The amount is NOT duplicated onto the receipt: it already lives on shop_vendor_credits under its own guard, and
    // two copies of the same money drift.
    expect(await credit(o.id)).toMatchObject({ status: 'released', released_kobo: VENDOR })
    const stored = (await one('select items from shop_order_receipts where reference = $1', [r.reference]))
    expect(stored.items).toHaveLength(1)
  })

  it('refuses a receipt with no named staff member, because nobody signed it', async () => {
    const o = await paidOrder()
    const r = await receive(o.id, itemsFor(o), { by: null })
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('staff_required')
    expect(await receipts(o.id)).toHaveLength(0)
    expect(await wallet(o.vendor)).toEqual({ held: VENDOR, avail: 0 })
  })

  it('cannot be repeated: a second confirmation releases nothing further', async () => {
    const o = await paidOrder()
    await receive(o.id, itemsFor(o), { by: uid() })
    const second = await receive(o.id, itemsFor(o), { by: uid() })
    expect(second.already_received).toBe(true)
    expect(await wallet(o.vendor)).toEqual({ held: 0, avail: VENDOR })
    // Still exactly ONE release ledger row and ONE receipt. This is the double-payment guard.
    expect(await ledger(o.vendor, 'shop_release')).toHaveLength(1)
    expect(await receipts(o.id)).toHaveLength(1)
  })

  it('is unreachable by a customer or an anonymous caller', async () => {
    for (const role of ['anon', 'authenticated']) {
      await expect(asRole(role, () => db.query('select record_pickup_receipt($1,$2::jsonb,null,null,null)', ['00000000-0000-4000-8000-000000000001', '[]']))).rejects.toThrow(/permission denied/)
    }
  })

  it('refuses an order that was never paid, so no money is invented', async () => {
    const vendor = await business()
    const o = (await db.query(`insert into shop_orders (order_ref, customer_id, vendor_business_id, status, total_kobo, subtotal_kobo, commission_kobo) values ($1,$2,$3,'pending_payment',$4,$5,$6) returning id`, [ref('CF'), uid(), vendor, TOTAL, SUBTOTAL, COMMISSION])).rows[0]
    const r = await receive(o.id, [], { by: uid() })
    expect(r.ok).toBe(false)
    expect(reason(r)).toMatch(/items_required|order_not_payable/)
    expect(await wallet(vendor)).toEqual({ held: 0, avail: 0 })
  })

  it('refuses a cancelled or refunded order', async () => {
    for (const st of ['cancelled', 'refunded']) {
      const o = await paidOrder()
      await db.query('update shop_orders set status = $2 where id = $1', [o.id, st])
      const r = await receive(o.id, itemsFor(o), { by: uid() })
      expect(r.ok).toBe(false)
      expect(r.reason).toBe('order_not_payable')
      expect(await wallet(o.vendor)).toEqual({ held: VENDOR, avail: 0 })
    }
  })

  it('refuses an item that is not on THIS order', async () => {
    const o = await paidOrder()
    const other = await paidOrder()
    const r = await receive(o.id, [{ item_id: other.itemId, quantity: 1 }], { by: uid() })
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('item_not_on_order')
    expect(await receipts(o.id)).toHaveLength(0)
  })

  it('refuses to confirm more units than were ordered', async () => {
    const o = await paidOrder({ quantity: 2 })
    const r = await receive(o.id, [{ item_id: o.itemId, quantity: 5 }], { by: uid() })
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('quantity_exceeds_order')
    expect(await wallet(o.vendor)).toEqual({ held: VENDOR, avail: 0 })
  })

  it('accepts a PARTIAL handover and records exactly what was counted', async () => {
    const o = await paidOrder({ quantity: 4 })
    const r = await receive(o.id, [{ item_id: o.itemId, quantity: 2 }], { by: uid(), note: '2 of 4 received, rest in transit' })
    expect(r.ok).toBe(true)
    const stored = (await one('select items from shop_order_receipts where reference = $1', [r.reference])).items
    expect(stored[0].quantity).toBe(2)
  })

  it('writes the handover into the order history the customer sees', async () => {
    const o = await paidOrder()
    const r = await receive(o.id, itemsFor(o), { by: uid() })
    const h = await all('select to_status, note from shop_order_status_history where order_id = $1', [o.id])
    expect(h.some((x) => String(x.note).includes(r.reference))).toBe(true)
  })

  it('a receipt is evidence: it can never be edited or deleted', async () => {
    const o = await paidOrder()
    const r = await receive(o.id, itemsFor(o), { by: uid() })
    await expect(db.query('update shop_order_receipts set note = $2 where reference = $1', [r.reference, 'edited'])).rejects.toThrow(/append-only/)
    await expect(db.query('delete from shop_order_receipts where reference = $1', [r.reference])).rejects.toThrow(/append-only/)
    expect(await receipts(o.id)).toHaveLength(1)
  })

  it('is invisible to every API role, including service_role', async () => {
    const o = await paidOrder()
    await receive(o.id, itemsFor(o), { by: uid() })
    for (const role of ['anon', 'authenticated', 'service_role']) {
      const ok = (await one(`select has_table_privilege($1,'public.shop_order_receipts','SELECT') v`, [role])).v
      expect(ok, role).toBe(false)
    }
  })

  it('coexists with the delivered-based release without paying twice', async () => {
    // The owner decision of 2026-10-14 still releases on delivery. A receipt arriving afterwards must not pay again.
    const o = await paidOrder()
    await db.query(`update shop_orders set status = 'delivered' where id = $1`, [o.id])
    const before = await wallet(o.vendor)
    expect(before.avail).toBe(VENDOR)
    const r = await receive(o.id, itemsFor(o), { by: uid() })
    expect(r.credit_status).toBe('released')
    expect(await wallet(o.vendor)).toEqual({ held: 0, avail: VENDOR })
    expect(await ledger(o.vendor, 'shop_release')).toHaveLength(1)
  })

  it("one vendor's receipt never releases another vendor's money", async () => {
    const a = await paidOrder()
    const b = await paidOrder()
    await receive(a.id, itemsFor(a), { by: uid() })
    expect(await wallet(a.vendor)).toEqual({ held: 0, avail: VENDOR })
    expect(await wallet(b.vendor)).toEqual({ held: VENDOR, avail: 0 })
    expect(await receipts(b.id)).toHaveLength(0)
  })

  it('still respects an open return: the receipt is recorded but nothing is released', async () => {
    // Money must not move while the customer may still be returning the goods. The refund path is covered end-to-end by
    // vendorPayouts.db.test.js; this covers the return gate on the receipt path.
    const o = await paidOrder()
    await db.query(
      `insert into shop_order_returns (order_id, customer_id, vendor_business_id, status, reason, refund_amount_kobo)
       values ($1,$2,$3,'requested','damaged on arrival',0)`, [o.id, o.customer, o.vendor])
    const r = await receive(o.id, itemsFor(o), { by: uid() })
    expect(r.ok).toBe(true)                        // the receipt is still recorded...
    expect(r.credit_status).toBe('held')            // ...but no money moved while the return is open
    expect(await wallet(o.vendor)).toEqual({ held: VENDOR, avail: 0 })
    expect(await ledger(o.vendor, 'shop_release')).toHaveLength(0)
  })

  it('still respects a live refund: the receipt is recorded but money that is being refunded is not released', async () => {
    const o = await paidOrder()
    const rf = (await one('select request_refund($1,$2,$3,null,null,$4,$5) r', ['shop_return', 'shop_order', o.id, false, 100_000])).r
    expect(rf.outcome).toBe('requested')
    const r = await receive(o.id, itemsFor(o), { by: uid() })
    expect(r.ok).toBe(true)
    expect(r.credit_status).toBe('held')
    expect(r.release.reason).toBe('refund_in_flight')
    // requesting the refund already recovered the vendor's pro rata share from held; the point here is that nothing was released
    expect((await wallet(o.vendor)).avail).toBe(0)
    expect(await ledger(o.vendor, 'shop_release')).toHaveLength(0)
  })

  it('reports WHY nothing was released, so staff are not left guessing', async () => {
    const o = await paidOrder()
    await db.query(
      `insert into shop_order_returns (order_id, customer_id, vendor_business_id, status, reason, refund_amount_kobo)
       values ($1,$2,$3,'requested','wrong item',0)`, [o.id, o.customer, o.vendor])
    const r = await receive(o.id, itemsFor(o), { by: uid() })
    expect(r.release.reason).toBe('return_requested')
  })
})

function reason(r) { return String(r && (r.reason || '')) }