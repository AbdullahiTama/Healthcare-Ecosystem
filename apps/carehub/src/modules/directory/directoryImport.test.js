import { describe, it, expect, vi } from 'vitest'
import {
  parseCsv, autoMapColumns, buildImportPlan, defaultDecisions, selectRowsToImport,
  fileFingerprint, nameSimilarity, templateCsv, ROW_STATUS, MAX_IMPORT_ROWS,
} from './directoryImport.js'
import { runImport } from './directoryImportRunner.js'
import { createDirectoryRepository } from './repositories/index.js'

const CATS = [
  { id: 'c-ph', slug: 'pharmacy', name: 'Pharmacies', parent_id: null },
  { id: 'c-hos', slug: 'hospital', name: 'Hospitals', parent_id: null },
  { id: 's-1', slug: 'retail', name: 'Retail pharmacy', parent_id: 'c-ph' },
]

function plan(csv, existing = [], fp = 'fp') {
  const { rows } = parseCsv(csv)
  const { mapping } = autoMapColumns(rows[0])
  return buildImportPlan(rows, { mapping, categories: CATS, existing, fingerprint: fp })
}
const byRow = (p, n) => p.rows.find((r) => r.row === n)

describe('parseCsv', () => {
  it('handles quotes, doubled quotes, CRLF, BOM and newlines inside quotes', () => {
    const { rows, error } = parseCsv('﻿name,address\r\n"Smith, ""Best"" Pharmacy","1 Main St\nIkeja"\r\n')
    expect(error).toBeNull()
    expect(rows).toEqual([['name', 'address'], ['Smith, "Best" Pharmacy', '1 Main St\nIkeja']])
  })
  it('drops blank lines and reports an unclosed quote', () => {
    expect(parseCsv('a,b\n\n\n1,2\n').rows).toHaveLength(2)
    expect(parseCsv('a,b\n"oops,2').error).toMatch(/unclosed quote/)
  })
  it('round-trips the downloadable template through the planner', () => {
    const p = plan(templateCsv())
    expect(p.error).toBeNull()
    expect(p.rows).toHaveLength(1)
    expect(p.rows[0].status).not.toBe(ROW_STATUS.INVALID)
  })
})

describe('autoMapColumns', () => {
  it('maps common header spellings and lists the rest as unmapped', () => {
    const { mapping, unmapped } = autoMapColumns(['Business Name', 'LGA', 'Lat', 'Lon', 'Region'])
    expect(mapping).toMatchObject({ name: 0, lga: 1, latitude: 2, longitude: 3 })
    expect(unmapped.map((u) => u.header)).toEqual(['Region'])
  })
})

describe('buildImportPlan: validation', () => {
  it('reports invalid rows with the exact spreadsheet row and field', () => {
    const p = plan('name,category,latitude,longitude,email\nGood,pharmacy,6.5,3.4,a@b.co\n,pharmacy,,,\nBad Geo,pharmacy,95,3,\nBad Cat,spaceship,,,\nBad Mail,pharmacy,,,nope\n')
    expect(byRow(p, 2).status).not.toBe(ROW_STATUS.INVALID)
    expect(byRow(p, 3)).toMatchObject({ status: ROW_STATUS.INVALID, errors: { name: expect.any(String) } })
    expect(byRow(p, 4).errors.latitude).toBeTruthy()
    expect(byRow(p, 5).errors.category).toMatch(/spaceship/)
    expect(byRow(p, 6).errors.email).toBeTruthy()
  })
  it('resolves subcategories under their own category only', () => {
    const p = plan('name,category,subcategory\nA,pharmacy,retail\nB,hospital,retail\n')
    expect(byRow(p, 2).record.subcategory_id).toBe('s-1')
    expect(byRow(p, 3).errors.subcategory).toBeTruthy()
  })
  it('flags missing coordinates or category for review but does not invent them', () => {
    const p = plan('name\nNo Location Clinic\n')
    expect(byRow(p, 2).status).toBe(ROW_STATUS.NEEDS_REVIEW)
    expect(byRow(p, 2).record.latitude).toBeNull()
  })
  it('never lets a file set verification or a trusted data source', () => {
    const p = plan('name,verification_status,data_source\nX,verified,regulatory\n')
    expect(byRow(p, 2).record).not.toHaveProperty('verification_status')
    expect(byRow(p, 2).record.data_source).toBe('import')
  })
  it('rejects oversize files and a missing name column', () => {
    const big = 'name\n' + Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, i) => 'n' + i).join('\n')
    expect(plan(big).error).toMatch(/at most/)
    expect(plan('foo\nbar\n').error).toMatch(/business name/)
  })
})

describe('buildImportPlan: duplicates', () => {
  const existing = [
    { id: 'e1', name: 'Alpha Pharmacy', name_normalized: 'alpha pharmacy', phone_normalized: '8031234567', address: '12 Allen Ave', latitude: 6.6018, longitude: 3.3515, data_source: 'manual', source_ref: null, verification_status: 'verified' },
  ]
  it('same name and phone is a confirmed duplicate', () => {
    const p = plan('name,phone,latitude,longitude\nAlpha Pharmacy,0803 123 4567,6.7,3.5\n', existing)
    expect(byRow(p, 2).status).toBe(ROW_STATUS.CONFIRMED_DUPLICATE)
    expect(byRow(p, 2).candidates[0].ref.id).toBe('e1')
  })
  it('same name only, or same phone only, is a possible duplicate, never auto-merged', () => {
    const a = plan('name,latitude,longitude\nAlpha Pharmacy,7.0,4.0\n', existing)
    expect(byRow(a, 2).status).toBe(ROW_STATUS.POSSIBLE_DUPLICATE)
    const b = plan('name,phone,latitude,longitude\nTotally Different,08031234567,7,4\n', existing)
    expect(byRow(b, 2).status).toBe(ROW_STATUS.POSSIBLE_DUPLICATE)
  })
  it('catches a similar name at the same address without exact string equality', () => {
    const p = plan('name,address,latitude,longitude\nAlpha Pharmacy Ltd,12 Allen Ave,6.7,3.5\n', existing)
    expect(byRow(p, 2).status).toBe(ROW_STATUS.POSSIBLE_DUPLICATE)
    expect(nameSimilarity('Alpha Pharmacy Ltd', 'Alpha Pharmacy')).toBeGreaterThanOrEqual(0.5)
  })
  it('catches a similar name within 30 m', () => {
    const p = plan('name,latitude,longitude\nAlpha Pharmacy Ltd,6.60185,3.35152\n', existing)
    expect(byRow(p, 2).status).toBe(ROW_STATUS.POSSIBLE_DUPLICATE)
  })
  it('does not flag unrelated businesses', () => {
    const p = plan('name,phone,address,state,latitude,longitude,category\nBeta Hospital,08099999999,5 Other Rd,Lagos,6.9,3.9,hospital\n', existing)
    expect(byRow(p, 2).status).toBe(ROW_STATUS.NEW)
  })
  it('detects duplicates inside the same file against the earlier row', () => {
    const p = plan('name,phone,state,latitude,longitude,category\nGamma Lab,08011112222,Lagos,6.1,3.1,hospital\nGamma Lab,08011112222,Lagos,6.1,3.1,hospital\n')
    expect(byRow(p, 2).status).toBe(ROW_STATUS.NEW)
    expect(byRow(p, 3).status).toBe(ROW_STATUS.CONFIRMED_DUPLICATE)
    expect(byRow(p, 3).candidates[0].ref.row).toBe(2)
  })
  it('a same-file source record is a confirmed duplicate of a previously imported row', () => {
    const prior = [{ id: 'e9', name: 'Zed', name_normalized: 'zed', phone_normalized: '', data_source: 'import', source_ref: 'fp:2' }]
    const p = plan('name,category,latitude,longitude\nZed Renamed,pharmacy,6.5,3.4\n', prior, 'fp')
    expect(byRow(p, 2).status).toBe(ROW_STATUS.CONFIRMED_DUPLICATE)
  })
})

describe('decisions', () => {
  it('imports only new rows by default; duplicates, review and invalid rows need an explicit choice', () => {
    const p = plan('name,category,state,latitude,longitude\nNew One,pharmacy,Lagos,6.5,3.4\nNo Geo,pharmacy,Lagos,,\n,,,,\nBad,pharmacy,Lagos,99,3\n')
    const d = defaultDecisions(p.rows)
    expect(selectRowsToImport(p.rows, d).map((r) => r.row)).toEqual([2])
  })
  it('never imports an invalid row even if told to', () => {
    const p = plan('name,latitude,longitude\nBad,99,3\n')
    expect(selectRowsToImport(p.rows, { 2: 'import' })).toEqual([])
  })
  it('fingerprint is stable per file and differs between files', () => {
    expect(fileFingerprint('a')).toBe(fileFingerprint('a'))
    expect(fileFingerprint('a')).not.toBe(fileFingerprint('b'))
  })
})

describe('runImport', () => {
  const rowsFor = (n) => Array.from({ length: n }, (_, i) => ({ row: i + 2, status: ROW_STATUS.NEW, record: { name: 'N' + i } }))
  const allImport = (rows) => Object.fromEntries(rows.map((r) => [r.row, 'import']))

  it('inserts in bounded batches and reports progress', async () => {
    const rows = rowsFor(120)
    const insertBatch = vi.fn().mockResolvedValue(undefined)
    const progress = []
    const res = await runImport({ planRows: rows, decisions: allImport(rows), repo: { insertBatch, insertOne: vi.fn() }, batchSize: 50, onProgress: (p) => progress.push(p.processed) })
    expect(insertBatch.mock.calls.map((c) => c[0].length)).toEqual([50, 50, 20])
    expect(res).toMatchObject({ total: 120, inserted: 120, processed: 120 })
    expect(progress).toEqual([50, 100, 120, 120])
  })

  it('a failed batch does not undo earlier batches and is isolated row by row', async () => {
    const rows = rowsFor(6)
    const inserted = []
    const insertBatch = vi.fn(async (recs) => {
      if (recs.some((r) => r.name === 'N4')) throw new Error('Supabase error (500): boom')
      recs.forEach((r) => inserted.push(r.name))
    })
    const insertOne = vi.fn(async (rec) => {
      if (rec.name === 'N4') throw new Error('Supabase error (400): check violated')
      inserted.push(rec.name)
    })
    const res = await runImport({ planRows: rows, decisions: allImport(rows), repo: { insertBatch, insertOne }, batchSize: 3 })
    expect(inserted).toEqual(['N0', 'N1', 'N2', 'N3', 'N5'])
    expect(res.inserted).toBe(5)
    expect(res.failed).toEqual([{ row: 6, message: 'Supabase error (400): check violated' }])
  })

  it('retrying a processed file reports rows as already imported instead of duplicating', async () => {
    const rows = rowsFor(4)
    const insertBatch = vi.fn().mockRejectedValue(new Error('Supabase error (409): duplicate key value violates unique constraint'))
    const insertOne = vi.fn().mockRejectedValue(new Error('Supabase error (409): duplicate key value violates unique constraint'))
    const res = await runImport({ planRows: rows, decisions: allImport(rows), repo: { insertBatch, insertOne }, batchSize: 4 })
    expect(res).toMatchObject({ inserted: 0, alreadyImported: 4 })
    expect(res.failed).toEqual([])
  })

  it('stops at once when the caller is not permitted', async () => {
    const rows = rowsFor(100)
    const insertBatch = vi.fn().mockRejectedValue(new Error('Supabase error (403): new row violates row-level security policy'))
    const res = await runImport({ planRows: rows, decisions: allImport(rows), repo: { insertBatch, insertOne: vi.fn() }, batchSize: 10 })
    expect(res.denied).toBe(true)
    expect(insertBatch).toHaveBeenCalledTimes(1)
    expect(res.inserted).toBe(0)
  })

  it('can be cancelled between batches', async () => {
    const rows = rowsFor(30)
    const ctl = new AbortController()
    const insertBatch = vi.fn(async () => { ctl.abort() })
    const res = await runImport({ planRows: rows, decisions: allImport(rows), repo: { insertBatch, insertOne: vi.fn() }, batchSize: 10, signal: ctl.signal })
    expect(res.cancelled).toBe(true)
    expect(insertBatch).toHaveBeenCalledTimes(1)
  })

  it('skips undecided duplicates', async () => {
    const rows = [{ row: 2, status: ROW_STATUS.POSSIBLE_DUPLICATE, record: { name: 'D' } }, ...rowsFor(1).map((r) => ({ ...r, row: 3 }))]
    const insertBatch = vi.fn().mockResolvedValue(undefined)
    await runImport({ planRows: rows, decisions: defaultDecisions(rows), repo: { insertBatch, insertOne: vi.fn() } })
    expect(insertBatch.mock.calls[0][0]).toHaveLength(1)
  })
})

describe('repository import methods', () => {
  it('insertBatch refuses oversize batches and sends minimal returns', async () => {
    const calls = []
    const repo = createDirectoryRepository(async (path, o) => { calls.push({ path, o }); return [] })
    await expect(repo.insertBatch(Array.from({ length: 201 }, () => ({})))).rejects.toThrow()
    await repo.insertBatch([{ name: 'A' }])
    expect(calls[0].o.prefer).toBe('return=minimal')
  })
  it('findCandidates queries by key lists, never the whole table', async () => {
    const paths = []
    const repo = createDirectoryRepository(async (path) => { paths.push(path); return [{ id: 'x' }] })
    const found = await repo.findCandidates([{ name: 'Alpha', phone: '08031234567', city: 'Ikeja' }])
    expect(found).toEqual([{ id: 'x' }])
    expect(paths.every((p) => /in\.|ilike\./.test(p) && p.includes('limit='))).toBe(true)
  })
})
