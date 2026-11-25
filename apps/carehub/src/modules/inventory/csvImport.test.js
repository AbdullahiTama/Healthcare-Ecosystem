import { describe, it, expect } from 'vitest'
import { readInventoryTable, planInventoryImport, toImportProduct, normalizeExpiryDate, buildInventoryTemplateCsv, UNCOUNTED_STOCK } from './csvImport.js'
import { parseCsv } from '../../lib/spreadsheet'

const HEADER = 'Product Name,Generic Name,Category,Selling Price (NGN),Cost Price (NGN),Stock Quantity,Reorder Level,Barcode,List on CareFind (yes/no),Expiry Date'
const table = (csv) => readInventoryTable(parseCsv(csv))
const plan = (csv, ctx) => planInventoryImport(table(csv).rows, ctx)

describe('readInventoryTable', () => {
  it('reads the template columns by header, with spreadsheet row numbers', () => {
    const { rows, missing } = table(HEADER + '\n"Amoxicillin 500mg","Amoxicillin","Medicines","1500","800","100","20","","yes","2027-06-30"')
    expect(missing).toEqual([])
    expect(rows).toEqual([{ rowNumber: 2, cells: expect.objectContaining({ name: 'Amoxicillin 500mg', price: '1500', expiry_date: '2027-06-30' }) }])
  })

  it('imports a legacy 9-column file (no Expiry Date) with a null expiry', () => {
    const header = HEADER.replace(',Expiry Date', '')
    const p = plan(header + '\n"Amoxicillin 500mg","Amoxicillin","Medicines","1500","800","100","20","","yes"')
    expect(p.items[0].status).toBe('ready')
    expect(p.items[0].product).toMatchObject({ name: 'Amoxicillin 500mg', price: 1500, cost_price: 800, stock: 100, reorder_level: 20, list_on_carefind: true, expiry_date: null })
  })

  it('matches columns in any order and ignores extra ones (an edited Inventory export, or a rows-to-fix file)', () => {
    const { rows, ignored } = table('Barcode,Stock Quantity,Product Name,Problem\n111,5,Zinc 20mg,Duplicate')
    expect(rows[0].cells).toMatchObject({ name: 'Zinc 20mg', stock: '5', barcode: '111' })
    expect(ignored).toEqual(['Problem'])
  })

  it('reads a file whose headers are not recognised in the template order, as before', () => {
    const { rows } = table('A,B,C,D\nZinc 20mg,Zinc,Supplements,300')
    expect(rows[0].cells).toMatchObject({ name: 'Zinc 20mg', generic_name: 'Zinc', category: 'Supplements', price: '300' })
  })

  it('keeps a quoted cell with a line break as one row (the old line split cut it in two)', () => {
    const p = plan(HEADER + '\n"Cough Syrup\n100ml","Dextromethorphan","Medicines","900","500","10","2","","yes",""\n"Zinc 20mg","Zinc","Supplements","300","150","40","5","","yes",""')
    expect(p.summary).toMatchObject({ submitted: 2, ready: 2 })
    expect(p.items[0].product.name).toBe('Cough Syrup\n100ml')
  })

  it('refuses an empty file with a sentence', () => {
    expect(() => table('')).toThrow('The file is empty.')
    expect(() => table(HEADER)).toThrow('The file has headers but no rows.')
  })
})

describe('toImportProduct', () => {
  it('reads ₦ and thousands separators (parseFloat read "1,500" as 1)', () => {
    expect(toImportProduct({ name: 'X', price: '₦1,500', cost_price: '1,200.50' }).product).toMatchObject({ price: 1500, cost_price: 1200.5 })
  })

  it('reports numbers it cannot read instead of saving 0', () => {
    const r = toImportProduct({ name: 'X', price: 'abc', stock: '-3', reorder_level: '2.5' })
    expect(r.problems).toEqual(['Retail price "abc" is not a number.', 'Stock quantity cannot be negative.', 'Reorder level must be a whole number.'])
  })

  it('keeps the old defaults for blank cells', () => {
    expect(toImportProduct({ name: 'Consultation' }).product).toMatchObject({ category: 'Medicines', price: 0, cost_price: 0, stock: UNCOUNTED_STOCK, reorder_level: 5, list_on_carefind: true, expiry_date: null })
    expect(toImportProduct({ name: 'X', list_on_carefind: 'No' }).product.list_on_carefind).toBe(false)
  })

  it('saves a product with an unreadable expiry without one, and says so', () => {
    const r = toImportProduct({ name: 'X', expiry_date: 'not-a-date' })
    expect(r.problems).toEqual([])
    expect(r.product.expiry_date).toBeNull()
    expect(r.warnings[0]).toContain('"not-a-date" could not be read')
  })
})

describe('planInventoryImport', () => {
  const existing = [{ id: 'p1', name: 'Panadol 500mg', generic_name: 'Paracetamol', barcode: '6200000000001' }]

  it('does NOT skip a different product that shares a generic name with one in stock (the reported shortfall)', () => {
    const p = plan(HEADER + '\nEmzor Paracetamol 500mg,Paracetamol,Medicines,500,300,10,5,,yes,\nParacetamol Syrup 60ml,Paracetamol,Medicines,700,400,10,5,,yes,', { existing })
    expect(p.items.map(i => i.status)).toEqual(['ready', 'ready'])
  })

  it('skips a product whose name or barcode is already in Inventory, with the reason', () => {
    const p = plan(HEADER + '\n panadol  500MG ,Paracetamol,Medicines,500,300,10,5,,yes,\nOther Name,,Medicines,1,1,1,1,6200000000001,yes,', { existing })
    expect(p.items.map(i => i.status)).toEqual(['duplicate', 'duplicate'])
    expect(p.items[0].reason).toBe('Duplicate: already in Inventory as Panadol 500mg.')
    expect(p.items[1].reason).toBe('Duplicate: barcode 6200000000001 is already used by Panadol 500mg.')
  })

  it('skips a repeat of an earlier row in the same file', () => {
    const p = plan(HEADER + '\nZinc 20mg,Zinc,Supplements,300,150,40,5,,yes,\nzinc 20mg,Zinc,Supplements,300,150,40,5,,yes,')
    expect(p.items[1]).toMatchObject({ status: 'duplicate', reason: 'Duplicate: same name as row 2.' })
  })

  it('accounts for every row: submitted = ready + duplicates + invalid + over limit', () => {
    const rows = [HEADER]
    for (let i = 0; i < 1000; i++) rows.push(`Product ${i},Generic ${i % 7},Medicines,${100 + i},50,10,5,,yes,`)
    rows.push(',No name,Medicines,1,1,1,1,,yes,') // invalid
    rows.push('Product 3,,Medicines,1,1,1,1,,yes,') // duplicate of row 5
    const p = plan(rows.join('\n'), { existing: [], remaining: 990 })
    expect(p.summary).toEqual({ submitted: 1002, ready: 990, duplicates: 1, invalid: 1, overLimit: 10 })
    expect(p.items.find(i => i.status === 'invalid').reason).toBe('Product name is missing.')
  })
})

describe('normalizeExpiryDate', () => {
  it('returns null for blank and whitespace-only values', () => {
    expect(normalizeExpiryDate('')).toBeNull()
    expect(normalizeExpiryDate('   ')).toBeNull()
    expect(normalizeExpiryDate(undefined)).toBeNull()
    expect(normalizeExpiryDate(null)).toBeNull()
  })

  it('accepts ISO dates, Excel date cells and serials, and day-first dates', () => {
    expect(normalizeExpiryDate('2027-06-30')).toBe('2027-06-30')
    expect(normalizeExpiryDate('2027-06-30T00:00:00.000Z')).toBe('2027-06-30')
    expect(normalizeExpiryDate('46569')).toBe('2027-07-01')
    expect(normalizeExpiryDate('30/06/2027')).toBe('2027-06-30')
  })

  it('rejects impossible calendar dates instead of rolling them over', () => {
    expect(normalizeExpiryDate('2027-02-31')).toBeNull()
    expect(normalizeExpiryDate('2027-13-01')).toBeNull()
  })

  it('parses other unambiguous formats via Date.parse', () => {
    expect(normalizeExpiryDate('June 30, 2027')).toBe('2027-06-30')
    expect(normalizeExpiryDate('5/31/2027')).toBe('2027-05-31')
  })
})

describe('buildInventoryTemplateCsv', () => {
  it('is read back by the importer with every example row ready', () => {
    const p = planInventoryImport(readInventoryTable(parseCsv(buildInventoryTemplateCsv())).rows)
    expect(p.summary).toMatchObject({ submitted: 4, ready: 4 })
  })

  it('has separate optional Retail Price and Wholesale Price columns, with examples of one, the other and both', () => {
    const [header] = parseCsv(buildInventoryTemplateCsv())
    expect(header.slice(3, 6)).toEqual(['Retail Price (NGN)', 'Wholesale Price (NGN)', 'Cost Price (NGN)'])
    const products = planInventoryImport(readInventoryTable(parseCsv(buildInventoryTemplateCsv())).rows).items.map(i => i.product)
    expect(products.map(p => [p.price, p.wholesale_price])).toEqual([[1500, 1200], [800, null], [0, 9500], [5000, null]])
  })
})

describe('wholesale and retail prices', () => {
  const NEW_HEADER = 'Product Name,Retail Price (NGN),Wholesale Price (NGN),Stock Quantity'
  it('accepts a retail price only, a wholesale price only, both, or neither', () => {
    const p = plan(NEW_HEADER + '\nA,500,,1\nB,,420,1\nC,500,420,1\nD,,,1')
    expect(p.items.map(i => i.status)).toEqual(['ready', 'ready', 'ready', 'ready'])
    expect(p.items.map(i => [i.product.price, i.product.wholesale_price])).toEqual([[500, null], [0, 420], [500, 420], [0, null]])
  })

  it('reads ₦ and thousands separators in the wholesale price', () => {
    expect(toImportProduct({ name: 'X', wholesale_price: '₦1,250' }).product.wholesale_price).toBe(1250)
  })

  it('reports a wholesale price it cannot read instead of saving it', () => {
    const r = toImportProduct({ name: 'X', wholesale_price: 'cheap' })
    expect(r.problems).toEqual(['Wholesale price "cheap" is not a price (a number, 0 or more).'])
    expect(toImportProduct({ name: 'X', wholesale_price: '-1' }).problems).toHaveLength(1)
  })

  it('still reads files made from the earlier template ("Selling Price" is the retail price)', () => {
    const p = plan(HEADER + '\n"Amoxicillin 500mg","Amoxicillin","Medicines","1500","800","100","20","","yes",""')
    expect(p.items[0].product).toMatchObject({ price: 1500, wholesale_price: null, cost_price: 800, stock: 100 })
  })

  it('reads the "Wholesale" and "Retail" short headers', () => {
    const { rows } = table('Name,Retail,Wholesale\nZinc,300,250')
    expect(rows[0].cells).toMatchObject({ name: 'Zinc', price: '300', wholesale_price: '250' })
  })

  it('reads a file without recognisable headers in the earlier ten-column order, so its cost and stock stay in place', () => {
    const { rows } = table('A,B,C,D,E,F\nZinc 20mg,Zinc,Supplements,300,150,40')
    expect(rows[0].cells).toMatchObject({ name: 'Zinc 20mg', price: '300', cost_price: '150', stock: '40' })
    expect(rows[0].cells.wholesale_price).toBeUndefined()
  })
})
