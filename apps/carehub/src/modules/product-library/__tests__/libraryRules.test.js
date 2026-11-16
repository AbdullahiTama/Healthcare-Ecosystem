import { describe, it, expect, vi } from 'vitest'
import { libraryLabel, libraryFacts, formFromLibrary, validateLibraryForm, guessMapping, rowsFromSheet, chunk, addImportResult, emptyImportResult, MAX_IMPORT_ROWS } from '../libraryRules'
import { createLibraryRepository } from '../repositories'

const CATS = [{ code: 'antibiotics', label: 'Antibiotics', rx_default: 'prescription_only' }]

describe('labels', () => {
  it('adds the strength only when the name does not already include it', () => {
    expect(libraryLabel({ brand_name: 'Amoxil', strength: '500mg' })).toBe('Amoxil 500mg')
    expect(libraryLabel({ brand_name: 'Amoxil 500MG caps', strength: '500mg' })).toBe('Amoxil 500MG caps')
    expect(libraryLabel(null)).toBe('')
    expect(libraryFacts({ generic_name: 'Amoxicillin', dose_form: 'Capsule', nafdac_no: 'A4-1234', pack_size: ' ' })).toBe('Amoxicillin · Capsule · NAFDAC A4-1234')
  })
})

describe('the admin item form', () => {
  it('turns barcodes into a list and back', () => {
    expect(formFromLibrary({ brand_name: 'X', barcodes: ['111', '222'] }).barcodes).toBe('111, 222')
    expect(formFromLibrary({ brand_name: 'X', barcode: '333' }).barcodes).toBe('333')
  })

  it('checks the name, barcodes, category and status, and cleans the payload', () => {
    expect(validateLibraryForm({ brand_name: ' ' }).errors.brand_name).toMatch(/Enter the product name/)
    expect(validateLibraryForm({ brand_name: 'X', barcodes: '12' }).errors.barcodes).toMatch(/4 to 32/)
    expect(validateLibraryForm({ brand_name: 'X', category_code: 'nope' }, { categories: CATS }).errors.category_code).toBeTruthy()
    expect(validateLibraryForm({ brand_name: 'X', rx_status: 'maybe' }).errors.rx_status).toBeTruthy()
    const { payload } = validateLibraryForm({ brand_name: '  Amoxil   500 ', barcodes: '5012345, 5012345;6001', nafdac_no: ' a4-1234 ', category_code: 'antibiotics', strength: '' }, { categories: CATS })
    expect(payload).toMatchObject({ brand_name: 'Amoxil 500', barcodes: ['5012345', '6001'], nafdac_no: 'A4-1234', category_code: 'antibiotics', strength: null, rx_status: null })
  })
})

describe('reading an official list', () => {
  it('guesses which column holds what from the headings, each field once', () => {
    expect(guessMapping(['Product Name', 'Generic Name', 'NAFDAC Reg. No.', 'Dosage Form', 'Name', 'Applicant', 'Something'])).toEqual({
      0: 'brand_name', 1: 'generic_name', 2: 'nafdac_no', 3: 'dose_form', 5: 'manufacturer' })
  })

  it('maps rows, drops empty lines, splits barcodes and counts rows without a name', () => {
    const sheet = [['Name', 'Barcode', 'Notes'], ['Coartem', '111, 222', 'x'], ['', '', ''], ['', '333', ''], ['  Panadol  ', '', '']]
    const r = rowsFromSheet(sheet, { 0: 'brand_name', 1: 'barcodes' })
    expect(r.rows).toEqual([{ brand_name: 'Coartem', barcodes: ['111', '222'] }, { barcodes: ['333'] }, { brand_name: 'Panadol' }])
    expect(r.missingName).toBe(1)
  })

  it('refuses a file over the row limit', () => {
    const sheet = [['Name'], ...Array.from({ length: MAX_IMPORT_ROWS + 1 }, () => ['x'])]
    expect(() => rowsFromSheet(sheet, { 0: 'brand_name' })).toThrow(/limit/)
  })

  it('imports in batches and numbers problems by file row', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
    let t = addImportResult(emptyImportResult(), { inserted: 2, updated: 1, skipped: 1, errors: [{ row: 0, reason: 'No product name' }] }, 0)
    t = addImportResult(t, { inserted: 1, updated: 0, skipped: 1, errors: [{ row: 3, reason: 'Bad' }] }, 500)
    expect(t).toEqual({ inserted: 3, updated: 1, skipped: 2, errors: [{ row: 2, reason: 'No product name' }, { row: 505, reason: 'Bad' }] })
  })
})

describe('repository', () => {
  const req = () => vi.fn(async () => [])
  it('calls the library functions with their parameters', async () => {
    const request = req()
    const repo = createLibraryRepository(request)
    request.mockResolvedValueOnce([{ item: { id: 'c1' } }])
    expect(await repo.search(' amox ')).toEqual([{ id: 'c1' }])
    expect(JSON.parse(request.mock.calls[0][1].body)).toEqual({ p_query: 'amox', p_limit: 20 })
    expect(await repo.search('a')).toEqual([])
    request.mockResolvedValueOnce(3)
    expect(await repo.link('biz', [{ master_product_id: 'm', catalog_item_id: 'c' }])).toBe(3)
    expect(request.mock.calls.at(-1)[0]).toBe('rpc/link_master_to_catalog')
    request.mockResolvedValueOnce([{ item: { id: 'c1', status: 'pending' }, linked: '4', total: '120' }])
    expect(await repo.adminPage({ status: 'pending' })).toEqual({ items: [{ id: 'c1', status: 'pending', linked: 4 }], total: 120, available: true })
    request.mockResolvedValueOnce('c9')
    await repo.decide('s1', 'reject', { note: 'No strength' })
    expect(JSON.parse(request.mock.calls.at(-1)[1].body)).toEqual({ p_id: 's1', p_action: 'reject', p_catalog_item_id: null, p_fields: null, p_note: 'No strength' })
  })

  it('reports the library as not installed before the migration, and rethrows anything else', async () => {
    const missing = vi.fn(async () => { throw new Error('Supabase error (404): Could not find the function public.admin_catalog_page') })
    const repo = createLibraryRepository(missing)
    expect(await repo.adminPage()).toEqual({ items: [], total: 0, available: false })
    expect(await repo.search('amox')).toEqual([])
    expect((await repo.linkMatches('b')).available).toBe(false)
    const down = createLibraryRepository(vi.fn(async () => { throw new Error('Failed to fetch') }))
    await expect(down.adminPage()).rejects.toThrow('Failed to fetch')
  })
})
