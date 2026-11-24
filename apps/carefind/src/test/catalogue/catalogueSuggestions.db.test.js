// @vitest-environment node
// Product catalogue phase 6 (carehub_20270205_catalogue_suggestions): suggested categories and prices, applied by the
// owner, on the shared PGlite set-up (catalogueDb.js: live shapes, live permission functions, every catalogue migration
// up to phase 5).
import { describe, it, expect, beforeAll, vi } from 'vitest'
import { createCatalogueDb, sessions, repoFile, A, A1, B } from './catalogueDb.js'

vi.setConfig({ testTimeout: 60000, hookTimeout: 120000 })
const SUGGESTIONS = repoFile('supabase/migrations/carehub_20270205_catalogue_suggestions.sql')
const C = 'c1000000-0000-4000-8000-000000000001'
const D = 'd1000000-0000-4000-8000-000000000001'
const LIB = 'f0000000-0000-4000-8000-000000000002'
const id = (n) => `c0000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const S = { ventolin: id(101), bag: id(102), neurotex: id(103), genta: id(104), iceCream: id(105), mystery: id(106),
  linked: id(107), analgesic: id(108), diaformin: id(109) }
const PR = { panadol: id(201), coartem: id(202), rare: id(203), consult: id(204) }
const LOC = { panadolA: 'e0000000-0000-4000-8000-000000000201', panadolA1: 'e0000000-0000-4000-8000-000000000202',
  coartemA1: 'e0000000-0000-4000-8000-000000000203' }
let db, as, anon

const rows = async (s, p) => (await db.query(s, p)).rows
const one = async (s, p) => (await rows(s, p))[0]
const owner = (fn) => as('owner@allen.com', fn)
const manager = (fn) => as('kemi@allen.com', fn)
const cashier = (fn) => as('tunde@allen.com', fn)
const outsider = (fn) => as('owner@bello.com', fn)
const categories = async () => owner((q) => q('select * from catalogue_category_suggestions($1)', [A]))
const prices = async () => owner((q) => q('select * from catalogue_price_suggestions($1)', [A]))
const byId = (list) => Object.fromEntries(list.map((r) => [r.item.id, r]))
const apply = (fixes, push = true, who = owner) => who((q) => q('select apply_catalogue_fixes($1, $2::jsonb, $3) r', [A, JSON.stringify(fixes), push])).then((r) => r[0].r)

beforeAll(async () => {
  db = await createCatalogueDb()
  ;({ as, anon } = sessions(db))
  await db.exec(SUGGESTIONS)
  await db.exec(`
    insert into businesses (id, name, email) values ('${C}', 'Chi Stores', 'owner@chi.com'), ('${D}', 'Dee Pharmacy', 'owner@dee.com');
    insert into catalog_items (id, brand_name, category_code, rx_status, status, source)
      values ('${LIB}', 'Ciprotab', 'antibiotics', 'prescription_only', 'active', 'admin');
    insert into master_products (id, business_id, name, generic_name, default_price, category_code, category) values
      ('${S.ventolin}', '${A}', 'Ventolin Inhaler', null, 2500, 'medicines_other', 'Medicines'),
      ('${S.bag}', '${A}', 'Shopping Bag', null, 50, 'medicines_other', 'SUPERMARKET'),
      ('${S.neurotex}', '${A}', 'Neurotex Forte', null, 1800, 'medicines_other', 'DRUGS'),
      ('${S.genta}', '${A}', 'Gentamicin Inj 80mg', null, 300, 'medicines_other', 'Medicines'),
      ('${S.iceCream}', '${A}', 'Supreme Ice Cream 900ml', null, 2000, 'medicines_other', 'Medicines'),
      ('${S.mystery}', '${A}', 'Mystery Product', null, 100, null, ''),
      ('${S.linked}', '${A}', 'Cipro Tabs', null, 900, 'medicines_other', 'Medicines'),
      ('${S.analgesic}', '${A}', 'Feldene', null, 700, 'analgesics', 'Analgesics'),
      ('${S.diaformin}', '${A}', 'Diaformin', 'Metformin', 400, 'medicines_other', 'Medicines'),
      ('${PR.panadol}', '${A}', 'Panadol Extra', null, 0, 'analgesics', 'Analgesics'),
      ('${PR.coartem}', '${A}', 'Coartem 80/480', null, 0, 'antimalarials', 'Antimalarials'),
      ('${PR.rare}', '${A}', 'Rare Thing', null, 0, 'medicines_other', 'Medicines'),
      ('${PR.consult}', '${A}', 'Consultation', null, 0, 'services', 'Services'),
      (gen_random_uuid(), '${B}', 'Neurotex Forte', null, 1700, 'vitamins', ''),
      (gen_random_uuid(), '${C}', 'NEUROTEX FORTE', null, 1750, 'vitamins', ''),
      (gen_random_uuid(), '${D}', 'Neurotex Forte', null, 1900, 'nervous_system', ''),
      (gen_random_uuid(), '${B}', 'Coartem 80/480', null, 1500, 'antimalarials', ''),
      (gen_random_uuid(), '${C}', 'Coartem 80/480', null, 1600, 'antimalarials', ''),
      (gen_random_uuid(), '${D}', 'Coartem 80/480', null, 1720, 'antimalarials', ''),
      (gen_random_uuid(), '${B}', 'Rare Thing', null, 900, 'medicines_other', ''),
      (gen_random_uuid(), '${C}', 'Rare Thing', null, 1000, 'medicines_other', '');
    update master_products set catalog_item_id = '${LIB}' where id = '${S.linked}';
    insert into products (id, business_id, name, category, price, stock, master_product_id, list_on_carefind) values
      ('${LOC.panadolA}', '${A}', 'Panadol Extra', 'Analgesics', 400, 5, '${PR.panadol}', true),
      ('${LOC.panadolA1}', '${A1}', 'Panadol Extra', 'Analgesics', 0, 2, '${PR.panadol}', true),
      ('${LOC.coartemA1}', '${A1}', 'Coartem 80/480', 'Antimalarials', 0, 2, '${PR.coartem}', true);
    update products set price_source = 'master' where id in ('${LOC.panadolA1}', '${LOC.coartemA1}');
  `)
})

describe('category suggestions', () => {
  it('suggests from the library, the category text, other businesses and keywords, strongest first', async () => {
    const list = await categories()
    const s = byId(list)
    expect(s[S.linked]).toMatchObject({ category_code: 'antibiotics', reason: 'library', detail: 'Ciprotab' })
    expect(s[S.bag]).toMatchObject({ category_code: 'general_retail', reason: 'text', detail: 'SUPERMARKET' })
    expect(s[S.neurotex]).toMatchObject({ category_code: 'vitamins', reason: 'elsewhere', detail: '2' })
    expect(s[S.ventolin]).toMatchObject({ category_code: 'respiratory', reason: 'keyword', detail: 'inhaler' }) // a tie between equal words goes to the first alphabetically
    expect(list.map((r) => r.reason)).toEqual([...list.map((r) => r.reason)].sort((x, y) =>
      ['library', 'text', 'elsewhere', 'keyword'].indexOf(x) - ['library', 'text', 'elsewhere', 'keyword'].indexOf(y)))
    expect(Number(list[0].total)).toBe(list.length)
  })

  it('a form beats the drug class, a food name beats a skin form, and the generic name counts', async () => {
    const s = byId(await categories())
    expect(s[S.genta]).toMatchObject({ category_code: 'injections', detail: 'inj' })
    expect(s[S.iceCream]).toMatchObject({ category_code: 'food_drinks', detail: 'ice' })
    expect(s[S.diaformin]).toMatchObject({ category_code: 'antidiabetics', detail: 'metformin' })
  })

  it('leaves out items with a specific category and items with nothing to go on', async () => {
    const ids = (await categories()).map((r) => r.item.id)
    expect(ids).not.toContain(S.analgesic)
    expect(ids).not.toContain(S.mystery)
  })

  it('only the owner or a manager of the main business can see them', async () => {
    expect((await manager((q) => q('select count(*)::int n from catalogue_category_suggestions($1)', [A])))[0].n).toBeGreaterThan(0)
    await expect(cashier((q) => q('select * from catalogue_category_suggestions($1)', [A]))).rejects.toThrow(/owner or a manager/)
    await expect(outsider((q) => q('select * from catalogue_category_suggestions($1)', [A]))).rejects.toThrow(/owner or a manager/)
    await expect(anon((q) => q('select * from catalogue_category_suggestions($1)', [A]))).rejects.toThrow()
    await expect(as('owner@allen.com', (q) => q('select * from catalogue_category_suggestions($1)', [A1]))).rejects.toThrow(/owner or a manager/)
  })

  it('nobody reads the keyword list directly', async () => {
    await expect(owner((q) => q('select * from category_keywords'))).rejects.toThrow()
    await expect(anon((q) => q('select * from category_keywords'))).rejects.toThrow()
  })

  it('a new item typed under a newly mapped spelling gets its standard category straight away', async () => {
    await db.query(`insert into products (business_id, name, category, price) values ($1, 'Biscuit Pack', 'BISCUIT', 200)`, [A])
    expect((await one(`select category_code from master_products where business_id = $1 and name = 'Biscuit Pack'`, [A])).category_code).toBe('food_drinks')
  })
})

describe('price suggestions', () => {
  it('uses the item\'s own location prices first, else the median of 3 or more other businesses, rounded to ₦10', async () => {
    const s = byId(await prices())
    expect(s[PR.panadol]).toMatchObject({ price: 400, reason: 'locations', detail: '1' })
    expect(s[PR.panadol].item.hidden).toBe(1)
    expect(s[PR.coartem]).toMatchObject({ price: 1600, reason: 'elsewhere', detail: '3' })
  })

  it('never shows a price that fewer than three other businesses use, and never prices a service', async () => {
    const ids = (await prices()).map((r) => r.item.id)
    expect(ids).not.toContain(PR.rare)
    expect(ids).not.toContain(PR.consult)
  })
})

describe('applying fixes', () => {
  it('applies accepted categories and prices only where the problem is still there, and reports what changed', async () => {
    const r = await apply([
      { id: S.bag, category_code: 'general_retail' },
      { id: S.ventolin, category_code: 'respiratory' },
      { id: S.analgesic, category_code: 'vitamins' },        // already has a specific category: untouched
      { id: S.genta, category_code: 'medicines_other' },     // not a fix
      { id: S.iceCream, category_code: 'nonsense' },         // unknown category
      { id: PR.panadol, default_price: 400 },
    ])
    expect(r).toEqual({ categories: 2, prices: 1, location_prices: 1 })
    expect((await one('select category_code from master_products where id = $1', [S.bag])).category_code).toBe('general_retail')
    expect((await one('select category_code from master_products where id = $1', [S.analgesic])).category_code).toBe('analgesics')
    expect((await one('select category_code from master_products where id = $1', [S.iceCream])).category_code).toBe('medicines_other')
    expect((await one('select default_price from master_products where id = $1', [PR.panadol])).default_price).toBe(400)
  })

  it('a location following the master price with none takes it, stays following, and reappears on CareFind', async () => {
    expect(await one('select price::int, price_source from products where id = $1', [LOC.panadolA1])).toEqual({ price: 400, price_source: 'master' })
    expect(await anon((q) => q('select id from carefind_products where id = $1', [LOC.panadolA1]))).toEqual([{ id: LOC.panadolA1 }])
  })

  it('without push, locations keep their price; a price already set is never overwritten', async () => {
    const r = await apply([{ id: PR.coartem, default_price: 1600 }, { id: S.ventolin, default_price: 1 }], false)
    expect(r).toEqual({ categories: 0, prices: 1, location_prices: 0 })
    expect((await one('select price::int from products where id = $1', [LOC.coartemA1])).price).toBe(0)
    expect((await one('select default_price from master_products where id = $1', [S.ventolin])).default_price).toBe(2500)
  })

  it('applied items drop out of the suggestions', async () => {
    const cats = (await categories()).map((r) => r.item.id)
    expect(cats).not.toContain(S.bag)
    expect((await prices()).map((r) => r.item.id)).not.toContain(PR.panadol)
  })

  it('refuses a cashier, an outsider, malformed fixes and more than 500', async () => {
    await expect(apply([{ id: S.genta, category_code: 'injections' }], true, cashier)).rejects.toThrow(/owner or a manager/)
    await expect(apply([{ id: S.genta, category_code: 'injections' }], true, outsider)).rejects.toThrow(/owner or a manager/)
    await expect(apply([{ id: 'not-an-id', category_code: 'injections' }])).rejects.toThrow(/not valid/)
    await expect(apply([{ id: PR.rare, default_price: '-5' }])).rejects.toThrow(/not valid/)
    await expect(apply(Array.from({ length: 501 }, () => ({ id: S.genta, category_code: 'injections' })))).rejects.toThrow(/500/)
    await expect(owner((q) => q(`select apply_catalogue_fixes($1, '{}'::jsonb)`, [A]))).rejects.toThrow(/Nothing to apply/)
  })

  it('another business\'s items are never changed', async () => {
    const theirs = await one(`select id from master_products where business_id = $1 and name = 'Rare Thing'`, [B])
    const r = await apply([{ id: theirs.id, default_price: 5 }])
    expect(r.prices).toBe(0)
    expect((await one('select default_price from master_products where id = $1', [theirs.id])).default_price).toBe(900)
  })
})

describe('dismissing', () => {
  it('a manager dismisses items so they are not suggested again; other businesses\' ids are ignored', async () => {
    const theirs = await one(`select id from master_products where business_id = $1 and name = 'Neurotex Forte'`, [B])
    const n = await manager((q) => q(`select dismiss_catalogue_suggestions($1, $2::uuid[], 'category') n`, [A, [S.genta, theirs.id]]))
    expect(n[0].n).toBe(1)
    expect((await categories()).map((r) => r.item.id)).not.toContain(S.genta)
    await manager((q) => q(`select dismiss_catalogue_suggestions($1, $2::uuid[], 'category')`, [A, [S.genta]])) // again: no error
    await expect(cashier((q) => q(`select dismiss_catalogue_suggestions($1, $2::uuid[], 'category')`, [A, [S.iceCream]]))).rejects.toThrow(/owner or a manager/)
    await expect(owner((q) => q(`select dismiss_catalogue_suggestions($1, $2::uuid[], 'colour')`, [A, [S.iceCream]]))).rejects.toThrow(/category or price/)
    await expect(owner((q) => q(`insert into catalogue_suggestion_dismissals (master_product_id, kind, business_id) values ($1, 'price', $2)`, [PR.rare, A]))).rejects.toThrow()
    expect(await outsider((q) => q('select count(*)::int n from catalogue_suggestion_dismissals'))).toEqual([{ n: 0 }])
  })

  it('a dismissed price suggestion is not shown again', async () => {
    await db.query(`insert into master_products (business_id, name, default_price) values ($1, 'Rare Thing', 1100)`, [D])
    expect((await prices()).map((r) => r.item.id)).toContain(PR.rare)
    await owner((q) => q(`select dismiss_catalogue_suggestions($1, $2::uuid[], 'price')`, [A, [PR.rare]]))
    expect((await prices()).map((r) => r.item.id)).not.toContain(PR.rare)
  })
})

describe('re-running the migration', () => {
  it('changes nothing and keeps dismissals', async () => {
    const before = await one('select count(*)::int n from catalogue_suggestion_dismissals')
    await db.exec(SUGGESTIONS)
    expect(await one('select count(*)::int n from catalogue_suggestion_dismissals')).toEqual(before)
    expect((await categories()).length).toBeGreaterThan(0)
  })
})
