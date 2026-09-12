import { describe, it, expect } from 'vitest'
import { parseInventoryCsv, normalizeExpiryDate } from './csvImport.js'

// A legacy template row — exactly the 9 columns the original template shipped,
// before Expiry Date was appended as column 10.
const LEGACY_ROW = '"Amoxicillin 500mg","Amoxicillin","Medicines","1500","800","100","20","","yes"'
const NEW_ROW = '"Amoxicillin 500mg","Amoxicillin","Medicines","1500","800","100","20","","yes","2027-06-30"'

describe('parseInventoryCsv', () => {
  it('imports legacy 9-column rows with a null expiry date', () => {
    const csv = 'Product Name,Generic Name,Category,Selling Price (NGN),Cost Price (NGN),Stock Quantity,Reorder Level,Barcode,List on CareFind (yes/no)\n' + LEGACY_ROW
    const { rows, error } = parseInventoryCsv(csv)
    expect(error).toBeNull()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      name: 'Amoxicillin 500mg',
      generic_name: 'Amoxicillin',
      category: 'Medicines',
      price: 1500,
      cost_price: 800,
      stock: 100,
      reorder_level: 20,
      list_on_carefind: true,
    })
    expect(rows[0].expiry_date).toBeNull()
  })

  it('parses the expiry date from a 10-column row', () => {
    const csv = 'Product Name,Generic Name,Category,Selling Price (NGN),Cost Price (NGN),Stock Quantity,Reorder Level,Barcode,List on CareFind (yes/no),Expiry Date\n' + NEW_ROW
    const { rows, error } = parseInventoryCsv(csv)
    expect(error).toBeNull()
    expect(rows[0].expiry_date).toBe('2027-06-30')
  })

  it('nulls a malformed expiry date but still imports the row', () => {
    const row = '"Bad Date Product","Generic","Medicines","100","50","10","5","","no","not-a-date"'
    const csv = 'Product Name,Generic Name,Category,Selling Price (NGN),Cost Price (NGN),Stock Quantity,Reorder Level,Barcode,List on CareFind (yes/no),Expiry Date\n' + row
    const { rows } = parseInventoryCsv(csv)
    expect(rows).toHaveLength(1)
    expect(rows[0].expiry_date).toBeNull()
    expect(rows[0].list_on_carefind).toBe(false)
  })

  it('normalises Excel-style dates to ISO', () => {
    const row = '"Excel Product","G","Medicines","100","50","10","5","","yes","5/31/2027"'
    const csv = 'Product Name,Generic Name,Category,Selling Price (NGN),Cost Price (NGN),Stock Quantity,Reorder Level,Barcode,List on CareFind (yes/no),Expiry Date\n' + row
    const { rows } = parseInventoryCsv(csv)
    expect(rows[0].expiry_date).toBe('2027-05-31')
  })

  it('skips rows without a product name and reports an error when nothing valid remains', () => {
    const header = 'Product Name,Generic Name,Category,Selling Price (NGN),Cost Price (NGN),Stock Quantity,Reorder Level,Barcode,List on CareFind (yes/no)'
    const empty = parseInventoryCsv(header + '\n,"No name","Medicines","1","1","1","1","","yes"')
    expect(empty.rows).toHaveLength(0)
    expect(empty.error).toBe('No valid products found.')

    const blank = parseInventoryCsv('')
    expect(blank.rows).toHaveLength(0)
    expect(blank.error).toBe('File is empty or has no products.')
  })
})

describe('normalizeExpiryDate', () => {
  it('returns null for blank and whitespace-only values', () => {
    expect(normalizeExpiryDate('')).toBeNull()
    expect(normalizeExpiryDate('   ')).toBeNull()
    expect(normalizeExpiryDate(undefined)).toBeNull()
    expect(normalizeExpiryDate(null)).toBeNull()
  })

  it('accepts ISO dates and passes them through unchanged', () => {
    expect(normalizeExpiryDate('2027-06-30')).toBe('2027-06-30')
  })

  it('rejects impossible calendar dates instead of rolling them over', () => {
    // JS silently rolls 2027-02-31 to March; the stored day must be what the
    // user typed or nothing at all.
    expect(normalizeExpiryDate('2027-02-31')).toBeNull()
    expect(normalizeExpiryDate('2027-13-01')).toBeNull()
  })

  it('parses other unambiguous formats via Date.parse', () => {
    expect(normalizeExpiryDate('June 30, 2027')).toBe('2027-06-30')
  })
})
