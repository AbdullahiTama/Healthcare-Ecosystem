import { describe, it, expect } from 'vitest'
import { validateMasterForm, formFromMaster, parseBranchPrice, carryingByLocation, carryingSummary, rxStatus, locationName } from '../catalogueRules'

const CATS = [
  { code: 'antibiotics', label: 'Antibiotics & anti-infectives', rx_default: 'prescription_only' },
  { code: 'analgesics', label: 'Pain relief', rx_default: 'otc' },
]

describe('validateMasterForm', () => {
  it('builds the full payload, tidying the name and taking the category\'s prescription status by default', () => {
    const form = { ...formFromMaster(null), name: '  Amoxil   500mg ', generic_name: ' Amoxicillin ', category_code: 'antibiotics', default_price: '1200.4', default_cost: '900.555', barcode: '6001234' }
    expect(validateMasterForm(form, { categories: CATS })).toEqual({
      payload: {
        name: 'Amoxil 500mg', default_price: 1200, description: '', category: 'Antibiotics & anti-infectives',
        generic_name: 'Amoxicillin', strength: null, dose_form: null, pack_size: null, barcode: '6001234',
        category_code: 'antibiotics', rx_status: 'prescription_only', default_cost: 900.56, reorder_level: 5,
      },
    })
  })

  it('an explicit prescription status wins over the category default', () => {
    const form = { ...formFromMaster(null), name: 'Amoxil', category_code: 'antibiotics', rx_status: 'controlled', default_price: '1' }
    expect(validateMasterForm(form, { categories: CATS }).payload.rx_status).toBe('controlled')
  })

  it('reports each problem against its field', () => {
    const r = validateMasterForm({ name: ' ', default_price: '-1', default_cost: '-2', reorder_level: '1.5', barcode: 'ab', category_code: 'nope', rx_status: 'maybe' }, { categories: CATS })
    expect(Object.keys(r.errors).sort()).toEqual(['barcode', 'category_code', 'default_cost', 'default_price', 'name', 'reorder_level', 'rx_status'])
    expect(validateMasterForm({ name: 'X', default_price: '' }).errors.default_price).toMatch(/selling price/)
  })

  it('before the catalogue update, sends only the original columns', () => {
    const form = { ...formFromMaster(null), name: 'Paracetamol', default_price: '500', generic_name: 'Paracetamol', barcode: '1234' }
    expect(validateMasterForm(form, { categories: [], upgraded: false })).toEqual({ payload: { name: 'Paracetamol', default_price: 500, description: '' } })
  })

  it('formFromMaster round-trips an item', () => {
    const item = { name: 'Amoxil', generic_name: 'Amoxicillin', category_code: 'antibiotics', rx_status: 'prescription_only', default_price: 1200, default_cost: '900.00', reorder_level: 3, barcode: '6001234' }
    expect(validateMasterForm(formFromMaster(item), { categories: CATS }).payload).toMatchObject({ name: 'Amoxil', default_price: 1200, default_cost: 900, reorder_level: 3, rx_status: 'prescription_only' })
  })
})

describe('parseBranchPrice', () => {
  it('empty follows the master; a positive number is the price; anything else is refused', () => {
    expect(parseBranchPrice('')).toBeNull()
    expect(parseBranchPrice(' 1500 ')).toBe(1500)
    expect(parseBranchPrice('0')).toEqual({ error: 'The price must be greater than zero.' })
    expect(parseBranchPrice('abc').error).toBeTruthy()
  })
})

describe('carryingByLocation', () => {
  const locs = [{ id: 'main', name: 'Allen' }, { id: 'yaba', branch_name: 'Yaba', parent_business_id: 'main' }, { id: 'ikeja', name: 'Ikeja', parent_business_id: 'main' }]
  const item = { carried: [
    { branch_id: 'main', price: 500, stock: 10, price_source: 'master', active: true },
    { branch_id: 'yaba', price: 600, stock: 2, price_source: 'branch', active: true },
    { branch_id: 'yaba', price: 550, stock: 3, price_source: 'master', active: true },
  ] }

  it('one row per location, in order; duplicates at a location are summed with the lowest price', () => {
    const rows = carryingByLocation(item, locs)
    expect(rows.map((r) => [locationName(r.location), r.carried, r.price, r.stock, r.ownPrice, r.products])).toEqual([
      ['Main Location', true, 500, 10, false, 1],
      ['Yaba', true, 550, 5, true, 2],
      ['Ikeja', false, null, 0, false, 0],
    ])
    expect(carryingSummary(rows)).toBe('Carried at 2 of 3 locations · 15 in stock')
  })

  it('a stopped location is not counted as carrying', () => {
    const rows = carryingByLocation({ carried: [{ branch_id: 'main', price: 1, stock: 4, active: false }] }, locs.slice(0, 1))
    expect(rows[0]).toMatchObject({ carried: false, stopped: true, stock: 4 })
    expect(carryingSummary(rows)).toBe('Not carried at any location')
  })
})

describe('rxStatus', () => {
  it('labels each status and nothing else', () => {
    expect(rxStatus('prescription_only').label).toBe('Prescription only')
    expect(rxStatus('x')).toBeNull()
  })
})
