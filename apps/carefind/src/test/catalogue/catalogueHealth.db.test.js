// @vitest-environment node
// Product catalogue phase 5 (carehub_20270127_catalogue_health and the follow-up 20270128) on the shared PGlite set-up
// (catalogueDb.js: live shapes, live permission functions and every catalogue migration before it).
import { describe, it, expect, beforeAll, vi } from 'vitest'
import { createCatalogueDb, sessions, MIGRATIONS, A, A1, B } from './catalogueDb.js'

vi.setConfig({ testTimeout: 60000, hookTimeout: 120000 })
const { HEALTH, SPEED } = MIGRATIONS
const M = {
  pan1: 'c0000000-0000-4000-8000-000000000001', pan2: 'c0000000-0000-4000-8000-000000000002',
  amox: 'c0000000-0000-4000-8000-000000000003', amoxCaps: 'c0000000-0000-4000-8000-000000000004',
  vitTabs: 'c0000000-0000-4000-8000-000000000005', vitTab: 'c0000000-0000-4000-8000-000000000006',
  vit500: 'c0000000-0000-4000-8000-000000000007', chipsB: 'c0000000-0000-4000-8000-000000000008',
  chipsS: 'c0000000-0000-4000-8000-000000000009', consult: 'c0000000-0000-4000-8000-00000000000a',
  theirs: 'c0000000-0000-4000-8000-00000000000b', theirs2: 'c0000000-0000-4000-8000-00000000000c',
  tram: 'c0000000-0000-4000-8000-00000000000d',
  clinda: 'c0000000-0000-4000-8000-00000000000e', clindaShort: 'c0000000-0000-4000-8000-00000000000f',
}
const P = {
  pan1A: 'e0000000-0000-4000-8000-000000000001', pan2A: 'e0000000-0000-4000-8000-000000000002',
  pan2A1: 'e0000000-0000-4000-8000-000000000003', amoxA: 'e0000000-0000-4000-8000-000000000004',
  amoxCapsA: 'e0000000-0000-4000-8000-000000000005', rxNoPrice: 'e0000000-0000-4000-8000-000000000006',
}
const LIB = 'f0000000-0000-4000-8000-000000000001'
let db

let as, anon
const rows = async (s, p) => (await db.query(s, p)).rows
const one = async (s, p) => (await rows(s, p))[0]
const owner = (fn) => as('owner@allen.com', fn)
const manager = (fn) => as('kemi@allen.com', fn)
const cashier = (fn) => as('tunde@allen.com', fn)
const outsider = (fn) => as('owner@bello.com', fn)
const pairKey = (p) => [p.item_a, p.item_b].sort().join('|')
const pairOf = (x, y) => [x, y].sort().join('|')
const pairsOf = async (business = A) => owner((q) => q('select * from catalogue_pairs($1)', [business]))

beforeAll(async () => {
  db = await createCatalogueDb()
  ;({ as, anon } = sessions(db))
  await db.exec(`
    insert into catalog_items (id, brand_name, generic_name, category_code, rx_status, status, source)
      values ('${LIB}', 'Amoxil', 'Amoxicillin', 'antibiotics', 'prescription_only', 'active', 'admin');
    insert into master_products (id, business_id, name, generic_name, barcode, default_price, category_code, rx_status, category) values
      ('${M.pan1}', '${A}', 'Panadol Extra', null, '6001', 400, 'medicines_other', 'otc', 'Medicines'),
      ('${M.pan2}', '${A}', 'Panadol-Extra', 'Paracetamol', null, 0, 'analgesics', 'pharmacy_only', 'Analgesics'),
      ('${M.amox}', '${A}', 'Amoxil 500mg', 'Amoxicillin', '5010', 1200, 'antibiotics', 'prescription_only', 'Antibiotics'),
      ('${M.amoxCaps}', '${A}', 'Amoxicillin Caps', null, '5010', 1100, null, 'pharmacy_only', ''),
      ('${M.vitTabs}', '${A}', 'Vitamin C 1000mg tablets', 'Ascorbic acid', '7001', 500, 'vitamins', 'otc', 'Vitamins'),
      ('${M.vitTab}', '${A}', 'Vitamin C 1000mg tablet', 'Ascorbic acid', '7002', 500, 'vitamins', 'otc', 'Vitamins'),
      ('${M.vit500}', '${A}', 'Vitamin C 500mg tablets', 'Ascorbic acid', '7003', 300, 'vitamins', 'otc', 'Vitamins'),
      ('${M.chipsB}', '${A}', 'Archkings plantain chips b/s', null, '8001', 200, 'food_drinks', 'otc', 'Food'),
      ('${M.chipsS}', '${A}', 'Archkings plantain chips s/s', null, '8002', 100, 'food_drinks', 'otc', 'Food'),
      ('${M.consult}', '${A}', 'Consultation', null, null, 0, 'services', 'otc', 'Services'),
      ('${M.tram}', '${A}', 'Tramadol', 'Tramadol', '9001', 2500, 'analgesics', 'controlled', 'Analgesics'),
      ('${M.theirs}', '${B}', 'Panadol Extra', null, '6001', 380, 'analgesics', 'otc', ''),
      ('${M.theirs2}', '${B}', 'Panadol  Extra.', null, null, 380, 'analgesics', 'otc', ''),
      ('${M.clinda}', '${B}', 'Clindamycin 300mg', null, null, 900, 'antibiotics', 'prescription_only', ''),
      ('${M.clindaShort}', '${B}', 'Clinda 300mg (clindamycin)', null, null, 900, 'antibiotics', 'prescription_only', '');
    update master_products set catalog_item_id = '${LIB}' where id = '${M.amox}';
    insert into products (id, business_id, name, generic_name, category, price, stock, barcode, master_product_id, rx_status, list_on_carefind) values
      ('${P.pan1A}', '${A}', 'Panadol Extra', null, 'Medicines', 400, 5, '6001', '${M.pan1}', 'otc', true),
      ('${P.pan2A}', '${A}', 'Panadol-Extra', 'Paracetamol', 'Analgesics', 0, 3, null, '${M.pan2}', 'pharmacy_only', true),
      ('${P.pan2A1}', '${A1}', 'Panadol-Extra', 'Paracetamol', 'Analgesics', 450, 2, null, '${M.pan2}', 'pharmacy_only', true),
      ('${P.amoxA}', '${A}', 'Amoxil 500mg', 'Amoxicillin', 'Antibiotics', 1200, 4, '5010', '${M.amox}', 'prescription_only', true),
      ('${P.amoxCapsA}', '${A}', 'Amoxicillin Caps', null, '', 1100, 0, '5010', '${M.amoxCaps}', 'pharmacy_only', true),
      ('${P.rxNoPrice}', '${A}', 'Tramadol', null, 'Analgesics', 0, 1, null, '${M.tram}', 'controlled', true);
    update products set stock = -1 where id = '${P.amoxCapsA}';
    insert into branch_products (branch_id, master_product_id, active, override_price) values
      ('${A}', '${M.pan1}', true, null), ('${A}', '${M.pan2}', true, null), ('${A1}', '${M.pan2}', false, 450),
      ('${A}', '${M.amox}', true, null), ('${A}', '${M.amoxCaps}', true, null)
      on conflict (branch_id, master_product_id) do update set active = excluded.active, override_price = excluded.override_price;
    insert into stock_batches (business_id, product_id, product_name, batch_number, quantity) values ('${A}', '${P.pan2A}', 'Panadol-Extra', 'PX-1', 3);
  `)
})

describe('missing-data flags and the health score', () => {
  it('flags each item once per issue, with generic names for medicines only and barcodes for anything but a service', async () => {
    const flags = await owner((q) => q(`select m.name, catalogue_issue(m, 'no_price') no_price, catalogue_issue(m, 'no_generic') no_generic,
      catalogue_issue(m, 'no_barcode') no_barcode, catalogue_issue(m, 'other_category') other, catalogue_issue(m, 'unlinked') unlinked,
      catalogue_issue(m, 'hidden') hidden from master_products m where business_id = $1 order by name`, [A]))
    const by = Object.fromEntries(flags.map((f) => [f.name, f]))
    expect(by['Panadol-Extra']).toMatchObject({ no_price: true, no_generic: false, no_barcode: true, other: false, hidden: true })
    expect(by['Panadol Extra']).toMatchObject({ no_price: false, no_generic: true, no_barcode: false, other: true, hidden: false })
    expect(by['Amoxicillin Caps']).toMatchObject({ other: true, no_generic: true })
    expect(by['Amoxil 500mg']).toMatchObject({ unlinked: false, no_generic: false })
    expect(by['Archkings plantain chips b/s']).toMatchObject({ no_generic: false })
    expect(by.Consultation).toMatchObject({ no_price: true, no_barcode: false, no_generic: false })
  })

  it('reports a score and every count; outsiders and the public are refused', async () => {
    const h = (await owner((q) => q('select catalogue_health($1) h', [A])))[0].h
    expect(h).toMatchObject({ total: 11, counts: { no_price: 2, other_category: 2, duplicates: 3, no_generic: 2, no_barcode: 1, unlinked: 10, hidden: 1 }, duplicate_items: 6 })
    // A prescription-only item with no price at its location is not "hidden": CareFind lists it as "ask the pharmacist".
    // 100 - (25*2 + 20*2 + 15*6 + 10*2 + 10*1 + 10*10 + 10*1) / 11 = 100 - 29.1 = 71
    expect(h.score).toBe(71)
    await expect(outsider((q) => q('select catalogue_health($1)', [A]))).rejects.toThrow(/not yours/)
    await expect(anon((q) => q('select catalogue_health($1)', [A]))).rejects.toThrow()
  })

  it('an empty catalogue has no score', async () => {
    await db.query(`insert into businesses (id, name, email) values ('d0000000-0000-4000-8000-000000000001', 'New', 'new@x.com')`)
    const h = (await as('new@x.com', (q) => q(`select catalogue_health('d0000000-0000-4000-8000-000000000001') h`)))[0].h
    expect(h).toMatchObject({ total: 0, score: null })
  })

  it('the Master Catalog page filters by one flag, and still works without it', async () => {
    const page = await owner((q) => q(`select item->>'name' n, total from master_catalog_page($1, p_health => 'no_price')`, [A]))
    expect(page.map((r) => r.n).sort()).toEqual(['Consultation', 'Panadol-Extra'])
    const hidden = await owner((q) => q(`select item->>'name' n from master_catalog_page($1, p_health => 'hidden')`, [A]))
    expect(hidden.map((r) => r.n)).toEqual(['Panadol-Extra'])
    const plain = await owner((q) => q(`select count(*)::int n from master_catalog_page($1, null, null, false, 0, 50, null, null)`, [A]))
    expect(plain[0].n).toBe(11)
  })
})

describe('possible duplicates', () => {
  it('pairs a shared barcode, the same letters and digits, and a near-identical name with the same numbers', async () => {
    const pairs = await pairsOf()
    expect(Object.fromEntries(pairs.map((p) => [pairKey(p), p.reason]))).toEqual({
      [pairOf(M.amox, M.amoxCaps)]: 'barcode',
      [pairOf(M.pan1, M.pan2)]: 'name',
      [pairOf(M.vitTabs, M.vitTab)]: 'similar',
    })
  })

  it('never pairs different strengths, size variants or another business\'s items', async () => {
    const keys = (await pairsOf()).map(pairKey)
    expect(keys).not.toContain(pairOf(M.vitTabs, M.vit500))
    expect(keys).not.toContain(pairOf(M.chipsB, M.chipsS))
    expect(await outsider((q) => q('select * from catalogue_pairs($1)', [A]))).toEqual([])
    const theirs = await outsider((q) => q('select * from catalogue_pairs($1)', [B]))
    // A near-identical name is found even when the first words differ, as long as a word of 4+ letters is shared.
    expect(Object.fromEntries(theirs.map((p) => [pairKey(p), p.reason]))).toEqual({
      [pairOf(M.theirs, M.theirs2)]: 'name',
      [pairOf(M.clinda, M.clindaShort)]: 'similar',
    })
  })

  it('lists each side with its details, locations and stock, barcode matches first', async () => {
    const list = await owner((q) => q('select * from catalogue_duplicate_pairs($1)', [A]))
    expect(list.map((r) => r.reason)).toEqual(['barcode', 'name', 'similar'])
    expect(Number(list[0].total)).toBe(3)
    const pan = list.find((r) => r.reason === 'name')
    const sides = [pan.item_a, pan.item_b].sort((x, y) => x.name.localeCompare(y.name))
    expect(sides[0]).toMatchObject({ name: 'Panadol Extra', locations: 1, stock: 5 })
    expect(sides[1]).toMatchObject({ name: 'Panadol-Extra', locations: 2, stock: 5, generic_name: 'Paracetamol' })
  })

  it('a manager dismisses a pair; a cashier and an outsider cannot; nobody writes the table directly', async () => {
    await expect(cashier((q) => q('select dismiss_duplicate_pair($1, $2, $3)', [A, M.vitTab, M.vitTabs]))).rejects.toThrow(/owner or a manager/)
    await expect(outsider((q) => q('select dismiss_duplicate_pair($1, $2, $3)', [A, M.vitTab, M.vitTabs]))).rejects.toThrow(/owner or a manager/)
    await expect(manager((q) => q(`insert into catalogue_duplicate_dismissals (business_id, item_a, item_b) values ($1, $2, $3)`,
      [A, M.vitTabs, M.vitTab]))).rejects.toThrow()
    await expect(manager((q) => q('select dismiss_duplicate_pair($1, $2, $3)', [A, M.vitTab, M.theirs]))).rejects.toThrow(/not both/)
    await manager((q) => q('select dismiss_duplicate_pair($1, $2, $3)', [A, M.vitTab, M.vitTabs]))
    await manager((q) => q('select dismiss_duplicate_pair($1, $2, $3)', [A, M.vitTabs, M.vitTab])) // again, either order: no error
    expect((await pairsOf()).map(pairKey)).not.toContain(pairOf(M.vitTabs, M.vitTab))
    expect(await manager((q) => q('select count(*)::int n from catalogue_duplicate_dismissals'))).toEqual([{ n: 1 }])
    expect(await outsider((q) => q('select count(*)::int n from catalogue_duplicate_dismissals'))).toEqual([{ n: 0 }])
  })
})

describe('bulk category', () => {
  it('a manager sets a standard category on many items; other businesses\' items and archived items are untouched', async () => {
    const n = await manager((q) => q(`select set_master_category($1, $2::uuid[], 'analgesics') n`, [A, [M.pan1, M.theirs]]))
    expect(n[0].n).toBe(1)
    expect((await one('select category_code, category from master_products where id = $1', [M.pan1]))).toEqual({ category_code: 'analgesics', category: 'Medicines' })
    expect((await one('select category_code from master_products where id = $1', [M.theirs])).category_code).toBe('analgesics')
  })

  it('with no code, a linked item takes its library category; unlinked items stay as they are', async () => {
    await db.query(`update master_products set category_code = 'medicines_other' where id = $1`, [M.amox])
    const n = await owner((q) => q('select set_master_category($1, $2::uuid[]) n', [A, [M.amox, M.amoxCaps]]))
    expect(n[0].n).toBe(1)
    expect((await one('select category_code from master_products where id = $1', [M.amox])).category_code).toBe('antibiotics')
    expect((await one('select category_code from master_products where id = $1', [M.amoxCaps])).category_code).toBe(null)
  })

  it('refuses a cashier, an unknown category and more than 500 items', async () => {
    await expect(cashier((q) => q(`select set_master_category($1, $2::uuid[], 'analgesics')`, [A, [M.pan1]]))).rejects.toThrow(/owner or a manager/)
    await expect(owner((q) => q(`select set_master_category($1, $2::uuid[], 'nonsense')`, [A, [M.pan1]]))).rejects.toThrow(/does not exist/)
    const many = Array.from({ length: 501 }, () => M.pan1)
    await expect(owner((q) => q(`select set_master_category($1, $2::uuid[], 'analgesics')`, [A, many]))).rejects.toThrow(/500/)
    expect((await owner((q) => q(`select set_master_category($1, '{}'::uuid[], 'analgesics') n`, [A])))[0].n).toBe(0)
  })
})

describe('merging two catalogue items', () => {
  it('only the owner merges; a manager, a cashier and an outsider are refused', async () => {
    for (const who of [manager, cashier, outsider]) {
      await expect(who((q) => q('select merge_master_items($1, $2, $3)', [A, M.pan1, M.pan2]))).rejects.toThrow(/Only the business owner/)
    }
    await expect(owner((q) => q('select merge_master_items($1, $2, $2)', [A, M.pan1]))).rejects.toThrow(/two different/)
    await expect(owner((q) => q('select merge_master_items($1, $2, $3)', [A, M.pan1, M.theirs]))).rejects.toThrow(/current items/)
  })

  it('moves stock and batches where both are carried, stops the dropped product without deleting it, and relinks where only it is carried', async () => {
    const r = (await owner((q) => q('select merge_master_items($1, $2, $3) r', [A, M.pan1, M.pan2])))[0].r
    expect(r).toMatchObject({ kept: M.pan1, archived: M.pan2, relinked: 1, merged_locations: 1, units_moved: 3, negative_left: 0 })

    // At the main shop: 3 units moved, through the ledger, a movement on each side.
    expect((await one('select stock from products where id = $1', [P.pan1A])).stock).toBe(8)
    const dropped = await one('select stock, list_on_carefind, master_product_id from products where id = $1', [P.pan2A])
    expect(dropped).toEqual({ stock: 0, list_on_carefind: false, master_product_id: M.pan2 })
    const moves = await rows(`select product_id, quantity, movement_type, source_type from stock_movements where source_type = 'catalogue_merge' order by quantity`)
    expect(moves).toEqual([
      { product_id: P.pan2A, quantity: -3, movement_type: 'correction', source_type: 'catalogue_merge' },
      { product_id: P.pan1A, quantity: 3, movement_type: 'correction', source_type: 'catalogue_merge' },
    ])
    expect(await one(`select product_id, product_name, quantity from stock_batches where batch_number = 'PX-1'`)).toEqual({ product_id: P.pan1A, product_name: 'Panadol Extra', quantity: 3 })
    expect(await one('select active from branch_products where branch_id = $1 and master_product_id = $2', [A, M.pan2])).toEqual({ active: false })
    expect(await one('select active from branch_products where branch_id = $1 and master_product_id = $2', [A, M.pan1])).toEqual({ active: true })

    // At Ikeja only the dropped item was carried (stopped): the product now belongs to the kept item, stays stopped and keeps its price.
    expect(await one('select master_product_id, name, price::int, stock from products where id = $1', [P.pan2A1]))
      .toEqual({ master_product_id: M.pan1, name: 'Panadol Extra', price: 450, stock: 2 })
    expect(await one('select active, override_price from branch_products where branch_id = $1 and master_product_id = $2', [A1, M.pan1])).toEqual({ active: false, override_price: 450 })
    expect(await one('select count(*)::int n from branch_products where branch_id = $1 and master_product_id = $2', [A1, M.pan2])).toEqual({ n: 0 })
  })

  it('the kept item fills its empty details, keeps the stricter status, and its products follow; the dropped item is archived', async () => {
    const kept = await one('select generic_name, barcode, default_price, category_code, rx_status, archived_at from master_products where id = $1', [M.pan1])
    expect(kept).toMatchObject({ generic_name: 'Paracetamol', barcode: '6001', default_price: 400, category_code: 'analgesics', rx_status: 'pharmacy_only', archived_at: null })
    expect((await one('select archived_at from master_products where id = $1', [M.pan2])).archived_at).not.toBe(null)
    const products = await rows('select rx_status, generic_name from products where master_product_id = $1', [M.pan1])
    expect(products).toEqual([{ rx_status: 'pharmacy_only', generic_name: 'Paracetamol' }, { rx_status: 'pharmacy_only', generic_name: 'Paracetamol' }])
    expect((await pairsOf()).map(pairKey)).not.toContain(pairOf(M.pan1, M.pan2))
    await expect(owner((q) => q('select merge_master_items($1, $2, $3)', [A, M.pan1, M.pan2]))).rejects.toThrow(/current items/)
  })

  it('stock below zero is not moved: it stays on the stopped product and is counted; the library link and stricter status carry over', async () => {
    // Keep the unlinked one, drop the linked prescription-only one (stock 4 moves into a product at -1).
    const r = (await owner((q) => q('select merge_master_items($1, $2, $3) r', [A, M.amoxCaps, M.amox])))[0].r
    expect(r).toMatchObject({ merged_locations: 1, units_moved: 4, negative_left: 0 })
    expect((await one('select stock from products where id = $1', [P.amoxCapsA])).stock).toBe(3)
    const kept = await one('select catalog_item_id, rx_status, generic_name from master_products where id = $1', [M.amoxCaps])
    expect(kept).toEqual({ catalog_item_id: LIB, rx_status: 'prescription_only', generic_name: 'Amoxicillin' })
    expect((await one('select rx_status from products where id = $1', [P.amoxCapsA])).rx_status).toBe('prescription_only')

    // A dropped product below zero.
    await db.exec(`insert into master_products (id, business_id, name, default_price) values ('c0000000-0000-4000-8000-0000000000f1', '${A}', 'Oversold', 100);
      insert into products (id, business_id, name, price, stock, master_product_id) values ('e0000000-0000-4000-8000-0000000000f1', '${A}', 'Oversold', 100, 0, 'c0000000-0000-4000-8000-0000000000f1');
      update products set stock = -2 where id = 'e0000000-0000-4000-8000-0000000000f1';`)
    const r2 = (await owner((q) => q(`select merge_master_items($1, $2, 'c0000000-0000-4000-8000-0000000000f1') r`, [A, M.amoxCaps])))[0].r
    expect(r2).toMatchObject({ units_moved: 0, negative_left: 1 })
    expect((await one(`select stock from products where id = 'e0000000-0000-4000-8000-0000000000f1'`)).stock).toBe(-2)
    expect((await one('select stock from products where id = $1', [P.amoxCapsA])).stock).toBe(3)
  })

  it('refuses batch-tracked products and a service against a stocked product at the same location, changing nothing', async () => {
    await db.exec(`insert into master_products (id, business_id, name, default_price, category) values
        ('c0000000-0000-4000-8000-0000000000f2', '${A}', 'Tracked One', 100, ''), ('c0000000-0000-4000-8000-0000000000f3', '${A}', 'Tracked Two', 100, '');
      insert into products (business_id, name, price, stock, master_product_id, tracking_mode) values
        ('${A}', 'Tracked One', 100, 0, 'c0000000-0000-4000-8000-0000000000f2', 'batch'), ('${A}', 'Tracked Two', 100, 0, 'c0000000-0000-4000-8000-0000000000f3', 'none');
      insert into products (business_id, name, price, stock, master_product_id, category) values ('${A}', 'Consultation', 0, 0, '${M.consult}', 'Services');`)
    await expect(owner((q) => q(`select merge_master_items($1, 'c0000000-0000-4000-8000-0000000000f3', 'c0000000-0000-4000-8000-0000000000f2')`, [A]))).rejects.toThrow(/batch/)
    await expect(owner((q) => q(`select merge_master_items($1, $2, 'c0000000-0000-4000-8000-0000000000f3')`, [A, M.consult]))).rejects.toThrow(/service/)
    expect((await one(`select archived_at from master_products where id = 'c0000000-0000-4000-8000-0000000000f2'`)).archived_at).toBe(null)
  })
})

describe('CareFind hides items with no price', () => {
  it('carefind_products leaves out unpriced items but keeps prescription-only ones as "ask the pharmacist"', async () => {
    await db.query(`update products set list_on_carefind = true, price = 0 where id = $1`, [P.pan2A])
    const names = await anon((q) => q('select name, price, rx_restricted from carefind_products order by name'))
    expect(names.map((r) => r.name)).not.toContain('Panadol-Extra')
    expect(names.find((r) => r.name === 'Tramadol')).toMatchObject({ price: null, rx_restricted: true })
    expect(names.find((r) => r.name === 'Panadol Extra')).toBeTruthy()
  })

  it('the public cannot read an unpriced product directly; its business still can', async () => {
    expect(await anon((q) => q('select id from products where id = $1', [P.pan2A]))).toEqual([])
    expect(await owner((q) => q('select id from products where id = $1', [P.pan2A]))).toEqual([{ id: P.pan2A }])
    await db.query(`update products set price = 350 where id = $1`, [P.pan2A])
    expect(await anon((q) => q('select id from carefind_products where id = $1', [P.pan2A]))).toEqual([{ id: P.pan2A }])
  })
})

describe('re-running the migration', () => {
  it('changes nothing and keeps dismissals', async () => {
    const before = await one('select count(*)::int n from catalogue_duplicate_dismissals')
    await db.exec(HEALTH)
    await db.exec(SPEED)
    expect(await one('select count(*)::int n from catalogue_duplicate_dismissals')).toEqual(before)
    expect((await owner((q) => q('select catalogue_health($1) h', [A])))[0].h.total).toBeGreaterThan(0)
  })
})
