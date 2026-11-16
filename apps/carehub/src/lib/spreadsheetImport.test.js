import { describe, it, expect, vi } from 'vitest'
import { saveInBatches, buildRowsToFixCsv, isTransientError, cleanError, readTableByHeader } from './spreadsheetImport'
import { parseCsv } from './spreadsheet'

const items = (n) => Array.from({ length: n }, (_, i) => ({ id: i, name: 'P' + i }))
const echo = (records) => records.map(r => ({ ...r, saved: true }))

describe('saveInBatches', () => {
  it('saves every item in batches of 100, one request each', async () => {
    const createMany = vi.fn(async (records) => echo(records))
    const createOne = vi.fn()
    const progress = []
    const r = await saveInBatches(items(250), { createMany, createOne, onProgress: (d, t) => progress.push([d, t]) })
    expect(r.saved).toHaveLength(250)
    expect(r.failed).toEqual([])
    expect(createMany).toHaveBeenCalledTimes(3)
    expect(createOne).not.toHaveBeenCalled()
    expect(progress).toEqual([[100, 250], [200, 250], [250, 250]])
  })

  it('when a batch is refused, saves its rows one by one so only the bad row fails, with its reason', async () => {
    const createMany = vi.fn(async () => { throw new Error('Supabase error (400): new row violates check constraint') })
    const createOne = vi.fn(async (r) => {
      if (r.name === 'P7') throw new Error('Supabase error (400): invalid input syntax for type numeric')
      return [{ ...r, saved: true }]
    })
    const r = await saveInBatches(items(20), { createMany, createOne })
    expect(r.saved).toHaveLength(19)
    expect(r.failed).toEqual([{ item: { id: 7, name: 'P7' }, message: 'invalid input syntax for type numeric' }])
  })

  it('retries a network or server failure once, never a refusal', async () => {
    let calls = 0
    const createMany = vi.fn(async (recs) => { calls++; if (calls === 1) throw new TypeError('Failed to fetch'); return echo(recs) })
    const r = await saveInBatches(items(5), { createMany, createOne: vi.fn() })
    expect(r.saved).toHaveLength(5)
    expect(createMany).toHaveBeenCalledTimes(2)

    const refused = vi.fn(async () => { throw new Error('Supabase error (403): permission denied') })
    const r2 = await saveInBatches(items(1), { createOne: refused })
    expect(refused).toHaveBeenCalledTimes(1)
    expect(r2.failed[0].message).toBe('permission denied')
  })

  it('stops between batches when asked; the rest are neither saved nor failed', async () => {
    let stop = false
    const r = await saveInBatches(items(300), { createMany: async (recs) => { stop = true; return echo(recs) }, createOne: vi.fn(), shouldCancel: () => stop })
    expect(r.saved).toHaveLength(100)
    expect(r.failed).toHaveLength(0)
  })

  it('never throws, even when everything fails', async () => {
    const r = await saveInBatches(items(3), { createMany: async () => { throw new Error('x') }, createOne: async () => { throw new Error('Supabase error (400): bad') } })
    expect(r.failed).toHaveLength(3)
  })
})

describe('isTransientError / cleanError', () => {
  it('treats network and 5xx as transient, 4xx and an expired session as final', () => {
    expect(isTransientError(new TypeError('Failed to fetch'))).toBe(true)
    expect(isTransientError(new Error('Supabase error (503): unavailable'))).toBe(true)
    expect(isTransientError(new Error('Supabase error (409): duplicate'))).toBe(false)
    expect(isTransientError(new Error('Session expired. Please log in again.'))).toBe(false)
    expect(cleanError(new Error('Supabase error (400): bad value'))).toBe('bad value')
  })
})

describe('buildRowsToFixCsv', () => {
  it('writes the upload columns plus Problem, and is read back with the Problem column ignored', () => {
    const columns = [{ key: 'name', header: 'Product Name', required: true }, { key: 'price', header: 'Selling Price (NGN)' }]
    const csv = buildRowsToFixCsv(columns, [{ cells: { name: 'Syrup, "kids"', price: 'abc' }, problem: 'Selling price "abc" is not a number.' }])
    const back = readTableByHeader(parseCsv(csv), columns)
    expect(back.rows[0].cells).toEqual({ name: 'Syrup, "kids"', price: 'abc' })
    expect(back.ignored).toEqual(['Problem'])
  })
})
