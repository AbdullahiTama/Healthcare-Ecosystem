import { describe, it, expect, vi } from 'vitest'
import { proposeMerge, defaultSelections, buildMergeChanges, summarizeSelections } from './directoryMerge.js'
import { runImport } from './directoryImportRunner.js'
import { mergeTargets, ROW_STATUS, DECISIONS, defaultDecisions, selectRowsToImport } from './directoryImport.js'
import { createDirectoryRepository } from './repositories/index.js'

const EXISTING = { id: 'e1', name: 'Alpha Pharmacy', verification_status: 'unverified', address: '12 Allen Ave', city: null, phone: '08031234567', email: null, latitude: null, longitude: null, state: 'Lagos', category_id: null }
const INCOMING = { name: 'Alpha Pharmacy Ltd', address: '99 Other Street', city: 'Ikeja', phone: '+234 803 123 4567', email: 'info@alpha.test', latitude: 6.5, longitude: 3.4, state: 'lagos', category_id: 'c-ph', website: null, description: '' }
const kinds = (p) => Object.fromEntries(p.fields.map((f) => [f.key, f.kind]))

describe('proposeMerge', () => {
  it('classifies each field as fill, conflict or same, and omits what the import lacks', () => {
    const p = proposeMerge(INCOMING, EXISTING)
    expect(kinds(p)).toEqual({ category_id: 'fill', address: 'conflict', city: 'fill', state: 'same', coordinates: 'fill', phone: 'same', email: 'fill' })
    expect(p.fields.find((f) => f.key === 'website')).toBeUndefined() // nothing to add
    expect(p.locked).toBe(false)
  })
  it('compares phones by digits, not formatting, and text ignoring case', () => {
    const p = proposeMerge({ phone: '0803-123-4567', state: ' LAGOS ' }, EXISTING)
    expect(kinds(p)).toEqual({ state: 'same', phone: 'same' })
  })
  it('treats coordinates as one unit', () => {
    const withCoords = { ...EXISTING, latitude: 6.5, longitude: 3.4 }
    expect(kinds(proposeMerge(INCOMING, withCoords)).coordinates).toBe('same')
    expect(kinds(proposeMerge({ ...INCOMING, latitude: 7, longitude: 3.4 }, withCoords)).coordinates).toBe('conflict')
    expect(proposeMerge({ latitude: 6.5 }, EXISTING).fields).toEqual([]) // half a pair is not a coordinate
  })
  it('marks a verified record as locked', () => {
    expect(proposeMerge(INCOMING, { ...EXISTING, verification_status: 'verified' }).locked).toBe(true)
  })
  it('never proposes the name, verification or source', () => {
    const keys = proposeMerge({ ...INCOMING, verification_status: 'verified', data_source: 'google', name: 'X' }, EXISTING).fields.map((f) => f.key)
    expect(keys).not.toContain('name'); expect(keys).not.toContain('verification_status'); expect(keys).not.toContain('data_source')
  })
})

describe('selections and payload', () => {
  const p = proposeMerge(INCOMING, EXISTING)
  it('by default fills blanks and replaces nothing', () => {
    expect(defaultSelections(p)).toEqual({ category_id: 'fill', city: 'fill', coordinates: 'fill', email: 'fill' })
    const c = buildMergeChanges(p, defaultSelections(p))
    expect(Object.keys(c).sort()).toEqual(['category_id', 'city', 'email', 'latitude', 'longitude'])
    expect(c.city).toEqual({ value: 'Ikeja', mode: 'fill' })
    expect(c.latitude).toEqual({ value: 6.5, mode: 'fill' }); expect(c.longitude).toEqual({ value: 3.4, mode: 'fill' })
    expect(c).not.toHaveProperty('address')
  })
  it('replaces a conflicting value only when the reviewer chose to', () => {
    const c = buildMergeChanges(p, { ...defaultSelections(p), address: 'overwrite' })
    expect(c.address).toEqual({ value: '99 Other Street', mode: 'overwrite' })
  })
  it('refuses to replace anything on a verified record, but still fills blanks', () => {
    const locked = proposeMerge(INCOMING, { ...EXISTING, verification_status: 'verified' })
    const c = buildMergeChanges(locked, { ...defaultSelections(locked), address: 'overwrite' })
    expect(c).not.toHaveProperty('address')
    expect(c.city).toEqual({ value: 'Ikeja', mode: 'fill' })
  })
  it('sends nothing when nothing is selected, or only "same" fields exist', () => {
    expect(buildMergeChanges(p, {})).toBeNull()
    expect(buildMergeChanges(proposeMerge({ phone: '08031234567' }, EXISTING), { phone: 'fill' })).toBeNull()
  })
  it('summarises the effect in words', () => {
    expect(summarizeSelections(p, defaultSelections(p))).toBe('fill 4 blanks')
    expect(summarizeSelections(p, { ...defaultSelections(p), address: 'overwrite' })).toBe('fill 4 blanks, replace 1 value')
    expect(summarizeSelections(p, {})).toBe('no changes')
  })
})

describe('merge as a decision', () => {
  const row = (status, candidates) => ({ row: 2, status, candidates, record: { name: 'A' } })
  it('merge is a known decision but never a default, and never inserts a row', () => {
    expect(DECISIONS).toContain('merge')
    const rows = [row(ROW_STATUS.POSSIBLE_DUPLICATE, [{ ref: { id: 'e1', name: 'A' } }])]
    expect(defaultDecisions(rows)[2]).toBe('skip')
    expect(selectRowsToImport(rows, { 2: 'merge' })).toEqual([])
  })
  it('only existing directory records are merge targets; in-file matches and invalid rows are not', () => {
    expect(mergeTargets(row(ROW_STATUS.POSSIBLE_DUPLICATE, [{ ref: { id: 'e1' } }, { ref: { row: 5 } }]))).toEqual([{ id: 'e1' }])
    expect(mergeTargets(row(ROW_STATUS.INVALID, [{ ref: { id: 'e1' } }]))).toEqual([])
    expect(mergeTargets(row(ROW_STATUS.NEW, []))).toEqual([])
  })
})

describe('runImport with merges', () => {
  const merges = [
    { row: 2, targetId: 'e1', sourceRef: 'fp:2', changes: { city: { value: 'Ikeja', mode: 'fill' } } },
    { row: 3, targetId: 'e2', sourceRef: 'fp:3', changes: { city: { value: 'Yaba', mode: 'fill' } } },
    { row: 4, targetId: 'e3', sourceRef: 'fp:4', changes: { address: { value: 'X', mode: 'overwrite' } } },
  ]
  const base = { planRows: [], decisions: {}, repo: null }

  it('runs each reviewed merge and reports applied, already applied, unchanged and skipped fields', async () => {
    const mergeImportRow = vi.fn()
      .mockResolvedValueOnce({ alreadyMerged: false, applied: { city: 'Ikeja' }, skipped: [{ field: 'address', reason: 'existing_value_kept' }] })
      .mockResolvedValueOnce({ alreadyMerged: true, applied: {}, skipped: [] })
      .mockResolvedValueOnce({ alreadyMerged: false, applied: {}, skipped: [{ field: 'address', reason: 'verified_record' }] })
    const res = await runImport({ ...base, repo: { mergeImportRow }, merges })
    expect(mergeImportRow.mock.calls.map((c) => c.slice(0, 2))).toEqual([['e1', 'fp:2'], ['e2', 'fp:3'], ['e3', 'fp:4']])
    expect(res).toMatchObject({ merged: 1, mergeAlreadyApplied: 1, mergeNothingChanged: 1, total: 3, processed: 3 })
    expect(res.mergeSkipped).toEqual([{ row: 2, field: 'address', reason: 'existing_value_kept' }, { row: 4, field: 'address', reason: 'verified_record' }])
  })
  it('one failed merge does not stop the others', async () => {
    const mergeImportRow = vi.fn().mockRejectedValueOnce(new Error('Supabase error (400): check constraint')).mockResolvedValue({ applied: { city: 'x' }, skipped: [] })
    const res = await runImport({ ...base, repo: { mergeImportRow }, merges })
    expect(res.mergeFailed).toEqual([{ row: 2, message: 'Supabase error (400): check constraint' }])
    expect(res.merged).toBe(2)
  })
  it('stops at once when not permitted', async () => {
    const mergeImportRow = vi.fn().mockRejectedValue(new Error('Supabase error (403): Directory administrator access required'))
    const res = await runImport({ ...base, repo: { mergeImportRow }, merges })
    expect(res.denied).toBe(true)
    expect(mergeImportRow).toHaveBeenCalledTimes(1)
  })
  it('can be cancelled between merges', async () => {
    const ctl = new AbortController()
    const mergeImportRow = vi.fn(async () => { ctl.abort(); return { applied: { city: 'x' }, skipped: [] } })
    const res = await runImport({ ...base, repo: { mergeImportRow }, merges, signal: ctl.signal })
    expect(res.cancelled).toBe(true)
    expect(mergeImportRow).toHaveBeenCalledTimes(1)
  })
  it('inserts first, then merges; nothing merges if the inserts were refused', async () => {
    const order = []
    const planRows = [{ row: 5, status: ROW_STATUS.NEW, record: { name: 'N' } }]
    const repo = {
      insertBatch: vi.fn(async () => { order.push('insert') }), insertOne: vi.fn(),
      mergeImportRow: vi.fn(async () => { order.push('merge'); return { applied: { city: 'x' }, skipped: [] } }),
    }
    await runImport({ planRows, decisions: { 5: 'import' }, repo, merges: [merges[0]] })
    expect(order).toEqual(['insert', 'merge'])

    const denied = { insertBatch: vi.fn().mockRejectedValue(new Error('Supabase error (403): new row violates row-level security policy')), insertOne: vi.fn(), mergeImportRow: vi.fn() }
    const res = await runImport({ planRows, decisions: { 5: 'import' }, repo: denied, merges: [merges[0]] })
    expect(res.denied).toBe(true)
    expect(denied.mergeImportRow).not.toHaveBeenCalled()
  })
})

describe('repository.mergeImportRow', () => {
  it('calls the RPC with the reference and changes, and refuses an empty merge', async () => {
    const calls = []
    const repo = createDirectoryRepository(async (path, o) => { calls.push({ path, body: JSON.parse(o.body) }); return { applied: { city: 'x' }, skipped: [] } })
    const out = await repo.mergeImportRow('e1', 'fp:2', { city: { value: 'x', mode: 'fill' } })
    expect(calls[0]).toEqual({ path: 'rpc/directory_merge_import_row', body: { p_id: 'e1', p_source_ref: 'fp:2', p_changes: { city: { value: 'x', mode: 'fill' } } } })
    expect(out).toMatchObject({ alreadyMerged: false, applied: { city: 'x' } })
    await expect(repo.mergeImportRow('e1', 'fp:2', null)).rejects.toThrow()
    await expect(repo.mergeImportRow('', 'fp:2', {})).rejects.toThrow()
    expect(calls).toHaveLength(1)
  })
  it('asks for the fields a reviewer needs when looking for candidates', async () => {
    const paths = []
    const repo = createDirectoryRepository(async (p) => { paths.push(p); return [] })
    await repo.findCandidates([{ name: 'A', phone: '08031234567', city: 'Ikeja' }])
    expect(decodeURIComponent(paths[0])).toContain('verification_status')
    expect(paths[0]).toContain('description')
  })
})
