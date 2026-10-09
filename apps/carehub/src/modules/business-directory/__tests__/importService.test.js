import { describe, it, expect } from 'vitest'
import {
  parseCsv, readTable, validateRow, analyseImport, summarise, planCommit, commitImport,
  buildTemplateCsv, buildTemplateXlsx, readSpreadsheet, TEMPLATE_COLUMNS, ITEM_STATUS, allowedResolutions, MAX_ROWS,
} from '../services/importService'
import { RESOLUTION } from '../services/deduplication'
import { createDirectoryRepository } from '../repositories'
import { createInMemoryClient } from '../../../test/inMemoryClient'

const A = 'biz-A'
const categories = [{ id: 'c-ph', name: 'Pharmacy' }, { id: 'c-hosp', name: 'Hospital' }]
const subcategories = [{ id: 's1', category_id: 'c-ph', name: 'Community Pharmacy' }]
const ctx = { categories, subcategories }
const good = { name: 'Alpha Pharmacy', category: 'Pharmacies', address: '12 Herbert Macaulay Rd', state: 'Lagos State', latitude: '6.5095', longitude: '3.3711', phone: '0803 111 2222' }

describe('template', () => {
  it('CSV template is headers only — no fabricated businesses', () => {
    const csv = buildTemplateCsv()
    const lines = csv.trim().split(/\r?\n/)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('Business Name')
    expect(lines[0].split(',')).toHaveLength(TEMPLATE_COLUMNS.length)
  })

  it('XLSX template round-trips through the importer and lists the valid categories', async () => {
    const blob = await buildTemplateXlsx(categories)
    const file = new File([await blob.arrayBuffer()], 'template.xlsx')
    const table = readTable(await readSpreadsheet(file))
    expect(table.missing).toEqual([])
    expect(table.rows).toEqual([])
    const ExcelJS = (await import('exceljs')).default
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(await blob.arrayBuffer())
    expect(wb.getWorksheet('Categories').getColumn(1).values.slice(2)).toEqual(['Pharmacy', 'Hospital'])
  })
})

describe('parseCsv', () => {
  it('handles quotes, embedded commas/newlines, BOM and CRLF', () => {
    const rows = parseCsv('﻿Name,Address\r\n"Smith, Jones & Co","1 ""High"" St\nLagos"\r\nPlain,Here\r\n')
    expect(rows).toEqual([['Name', 'Address'], ['Smith, Jones & Co', '1 "High" St\nLagos'], ['Plain', 'Here']])
  })
  it('detects semicolon and tab delimiters', () => {
    expect(parseCsv('a;b\n1;2')).toEqual([['a', 'b'], ['1', '2']])
    expect(parseCsv('a\tb\n1\t2')).toEqual([['a', 'b'], ['1', '2']])
  })
})

describe('readTable', () => {
  it('maps header aliases and tolerates the required-marker asterisk', () => {
    const t = readTable([['Business Name *', 'CATEGORY', 'Street Address', 'State', 'Local Government', 'Mystery'], ['A', 'Pharmacy', '1 St', 'Lagos', 'Yaba', 'zzz']])
    expect(t.missing).toEqual([])
    expect(t.unknown).toEqual(['Mystery'])
    expect(t.rows[0]).toMatchObject({ name: 'A', category: 'Pharmacy', address: '1 St', lga: 'Yaba' })
  })
  it('reports missing required columns', () => {
    expect(readTable([['Business Name', 'Phone']]).missing).toEqual(['Category', 'Address', 'State'])
  })
  it('skips blank rows and rejects empty files', () => {
    expect(readTable([['Business Name', 'Category', 'Address', 'State'], ['', '', '', ''], ['A', 'Pharmacy', 'x', 'Lagos']]).rows).toHaveLength(1)
    expect(() => readTable([[]])).toThrow('empty')
  })
  it('enforces the row cap', () => {
    const rows = [['Business Name', 'Category', 'Address', 'State'], ...Array.from({ length: MAX_ROWS + 1 }, () => ['a', 'b', 'c', 'd'])]
    expect(() => readTable(rows)).toThrow(String(MAX_ROWS))
  })
})

describe('readSpreadsheet guards', () => {
  it('rejects legacy .xls, unknown types and oversized files before reading', async () => {
    await expect(readSpreadsheet(new File(['x'], 'a.xls'))).rejects.toThrow('.xlsx')
    await expect(readSpreadsheet(new File(['x'], 'a.pdf'))).rejects.toThrow('Unsupported')
    const big = { name: 'big.csv', size: 999 * 1024 * 1024, text: async () => '' }
    await expect(readSpreadsheet(big)).rejects.toThrow('larger')
  })
})

describe('validateRow', () => {
  it('accepts a good row and normalises state/category/phone', () => {
    const v = validateRow(good, ctx)
    expect(v.errors).toEqual([])
    expect(v.record).toMatchObject({ category_id: 'c-ph', state: 'Lagos', phone_normalized: '08031112222', name_normalized: 'alpha pharmacy', latitude: 6.5095, data_source: 'import' })
  })

  it('reports every missing required field', () => {
    const v = validateRow({}, ctx)
    expect(v.errors.map((e) => e.field).sort()).toEqual(['address', 'category', 'name', 'state'])
  })

  it('rejects unknown categories, bad phone/email/website and unparsable numbers', () => {
    const v = validateRow({ ...good, category: 'Spaceship', phone: 'call me', email: 'nope', website: 'ftp://x', latitude: 'abc', longitude: '3' }, ctx)
    expect(v.errors.map((e) => e.field).sort()).toEqual(['category', 'email', 'latitude', 'phone', 'website'])
  })

  it('requires latitude and longitude together and in range', () => {
    expect(validateRow({ ...good, longitude: '' }, ctx).errors.map((e) => e.field)).toEqual(['longitude'])
    expect(validateRow({ ...good, latitude: '95', longitude: '3' }, ctx).errors).toHaveLength(1)
  })

  it('warns (not rejects) on swapped coordinates, unknown states and new subcategories', () => {
    const v = validateRow({ ...good, latitude: '3.37', longitude: '6.5', state: 'Atlantis', subcategory: 'Brand New Sub' }, ctx)
    expect(v.errors).toEqual([])
    expect(v.warnings.map((w) => w.field).sort()).toEqual(['latitude', 'state', 'subcategory'])
    expect(v.pendingSubcategory).toEqual({ category_id: 'c-ph', name: 'Brand New Sub' })
  })

  it('finds an existing subcategory case-insensitively', () => {
    expect(validateRow({ ...good, subcategory: 'community pharmacy' }, ctx).record.subcategory_id).toBe('s1')
  })

  it('enforces length limits', () => {
    expect(validateRow({ ...good, name: 'x'.repeat(201) }, ctx).errors.map((e) => e.field)).toContain('name')
  })
})

describe('analyseImport + commitImport (end to end)', () => {
  const existingRows = [
    { id: 'e1', name: 'Alpha Pharmacy', name_normalized: 'alpha pharmacy', address_normalized: '12 herbert macaulay road', phone_normalized: '08031112222', latitude: 6.5095, longitude: 3.3711, category_id: 'c-ph' },
    { id: 'e2', name: 'Delta Hospital', name_normalized: 'delta hospital', phone_normalized: '09011112222', address_normalized: '1 marina road', category_id: 'c-hosp', latitude: 6.45, longitude: 3.39 },
  ]
  const fileRows = [
    { ...good }, // confirmed duplicate of e1
    { name: 'Brand New Pharmacy', category: 'Pharmacy', address: '77 Unique Close', state: 'Oyo', latitude: '7.38', longitude: '3.9', subcategory: 'Wholesale Pharmacy' },
    { name: 'Gamma Stores', category: 'Hospital', address: '5 Elsewhere', state: 'Lagos', phone: '0901 111 2222' }, // shares e2's phone → possible
    { name: '', category: 'Pharmacy', address: 'x', state: 'Lagos' }, // invalid
    { name: 'Brand New Pharmacy', category: 'Pharmacy', address: '77 Unique Close', state: 'Oyo', latitude: '7.38', longitude: '3.9' }, // in-file twin
    { name: 'Warn Pharmacy', category: 'Pharmacy', address: '9 Wide Rd', state: 'Atlantis' }, // review
  ]

  async function run() {
    const client = createInMemoryClient({ directory_businesses: existingRows.map((r) => ({ ...r, business_id: A })), directory_subcategories: [] })
    const repo = createDirectoryRepository(client)
    const progress = []
    const items = await analyseImport(fileRows, { categories, subcategories, existing: existingRows, onProgress: (p, d, t) => progress.push([p, d, t]) })
    return { client, repo, items, progress }
  }

  it('classifies and summarises like the spec example', async () => {
    const { items, progress } = await run()
    expect(items.map((i) => i.status)).toEqual([
      // row 2 is review, not new: its subcategory does not exist yet and needs approval
      ITEM_STATUS.CONFIRMED, ITEM_STATUS.REVIEW, ITEM_STATUS.POSSIBLE, ITEM_STATUS.INVALID, ITEM_STATUS.CONFIRMED, ITEM_STATUS.REVIEW,
    ])
    expect(items[4].in_file).toBe(true)
    expect(summarise(items)).toMatchObject({ total: 6, new: 0, possible: 1, confirmed: 2, invalid: 1, review: 2, unresolved: 1 })
    expect(progress.some(([p]) => p === 'checking duplicates')).toBe(true)
    expect(items[0].rowNumber).toBe(2)
  })

  it('defaults: invalid and confirmed are not imported; possible duplicates need a human', async () => {
    const { items } = await run()
    expect(items.map((i) => i.resolution)).toEqual([RESOLUTION.KEEP_EXISTING, RESOLUTION.IMPORT_NEW, null, RESOLUTION.SKIP, RESOLUTION.SKIP, RESOLUTION.IMPORT_NEW])
    expect(allowedResolutions(items[3])).toEqual([RESOLUTION.SKIP])
    expect(allowedResolutions(items[2])).toEqual(expect.arrayContaining([RESOLUTION.KEEP_EXISTING, RESOLUTION.IMPORT_NEW, RESOLUTION.MERGE, RESOLUTION.SKIP]))
  })

  it('refuses to commit while a possible duplicate is undecided', async () => {
    const { items, repo } = await run()
    await expect(commitImport({ items, repo, businessId: A })).rejects.toThrow('need a decision')
  })

  it('commits the reviewed decisions, creates the subcategory once and records invalid rows', async () => {
    const { items, repo, client } = await run()
    items[2].resolution = RESOLUTION.SKIP
    const out = await commitImport({ items, repo, businessId: A, createdBy: 'admin@x.co', fileName: 'f.csv' })
    expect(out).toMatchObject({ imported: 2, merged: 0, skipped: 3, keptExisting: 1 })

    const added = client.rows('directory_businesses').filter((r) => r.import_batch_id === out.batchId)
    expect(added.map((r) => r.name).sort()).toEqual(['Brand New Pharmacy', 'Warn Pharmacy'])
    expect(added.every((r) => r.business_id === A && r.created_by === 'admin@x.co' && r.data_source === 'import')).toBe(true)
    const sub = client.rows('directory_subcategories')
    expect(sub).toHaveLength(1)
    expect(added.find((r) => r.name === 'Brand New Pharmacy').subcategory_id).toBe(sub[0].id)

    expect(client.rows('directory_import_errors')[0]).toMatchObject({ row_number: 5, field: 'name', batch_id: out.batchId })
    expect(client.rows('directory_import_batches')[0]).toMatchObject({ status: 'completed', total_rows: 6, imported_count: 2, invalid_count: 1 })
  })

  it('MERGE fills blanks on the existing record instead of creating a twin', async () => {
    const { items, repo, client } = await run()
    items[0].resolution = RESOLUTION.MERGE
    items[0].record.email = 'info@alpha.ng'
    items[2].resolution = RESOLUTION.SKIP
    const before = client.rows('directory_businesses').length
    const out = await commitImport({ items, repo, businessId: A })
    expect(out.merged).toBe(1)
    const e1 = client.rows('directory_businesses').find((r) => r.id === 'e1')
    expect(e1.email).toBe('info@alpha.ng')
    expect(e1.phone_normalized).toBe('08031112222')
    expect(client.rows('directory_businesses').length).toBe(before + 2)
  })

  it('a failing chunk stops the import, marks the batch failed and says how far it got', async () => {
    const { items, client } = await run()
    items[2].resolution = RESOLUTION.SKIP
    const inner = createDirectoryRepository(client)
    const repo = { ...inner, insertMany: async () => { throw new Error('boom') } }
    await expect(commitImport({ items, repo, businessId: A })).rejects.toThrow('Import stopped after 0')
    expect(client.rows('directory_import_batches')[0].status).toBe('failed')
  })

  it('re-running the same file after a successful import finds everything as duplicates', async () => {
    const { items, repo, client } = await run()
    items[2].resolution = RESOLUTION.SKIP
    await commitImport({ items, repo, businessId: A })
    const index = await repo.getDedupIndexRows(A)
    const again = await analyseImport(fileRows, { categories, subcategories, existing: index })
    expect(summarise(again).new).toBe(0)
    expect(planCommit(again).inserts.length).toBe(0)
    expect(client.rows('directory_businesses').length).toBeGreaterThan(2)
  })

  it('a 5,000-row file is analysed in slices and reports progress', async () => {
    const syl = ['ka', 'lo', 'mi', 'ne', 'su', 'ta', 'vo', 'xe', 'zu', 'bi', 'da', 'fo']
    const uniq = (i) => syl[i % 12] + syl[Math.floor(i / 12) % 12] + syl[Math.floor(i / 144) % 12] + syl[Math.floor(i / 1728) % 12]
    const rows = Array.from({ length: 5000 }, (_, i) => ({ name: uniq(i) + ' Pharmacy', category: 'Pharmacy', address: uniq(i + 3) + ' Road', state: 'Lagos', latitude: String(4.5 + (i % 100) * 0.05), longitude: String(3 + Math.floor(i / 100) * 0.1) }))
    let ticks = 0
    const t0 = Date.now()
    const items = await analyseImport(rows, { categories, subcategories, existing: [], onProgress: () => { ticks++ } })
    expect(items).toHaveLength(5000)
    expect(ticks).toBeGreaterThan(20)
    expect(Date.now() - t0).toBeLessThan(15000)
  })
})
