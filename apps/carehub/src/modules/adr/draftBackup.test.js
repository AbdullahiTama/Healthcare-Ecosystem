import { describe, it, expect } from 'vitest'
import { createDraftBackup, buildDraftSnapshot, isStale } from './draftBackup.js'

// Minimal in-memory storage the module accepts via injection.
function memoryStorage() {
  const map = new Map()
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  }
}

describe('draftBackup', () => {
  it('saves and loads a draft under the report-scoped key', () => {
    const backup = createDraftBackup(memoryStorage())
    backup.save('report-1', { report: { status: 'draft' }, products: [] })
    const loaded = backup.load('report-1')
    expect(loaded.report.status).toBe('draft')
    expect(loaded.savedAt).toBeGreaterThan(0)
  })

  it('isolates drafts by report so they never bleed across reports', () => {
    const backup = createDraftBackup(memoryStorage())
    backup.save('report-1', { report: { report_id: 'report-1' } })
    backup.save('report-2', { report: { report_id: 'report-2' } })
    expect(backup.load('report-1').report.report_id).toBe('report-1')
    expect(backup.load('report-2').report.report_id).toBe('report-2')
  })

  it('clears a draft', () => {
    const backup = createDraftBackup(memoryStorage())
    backup.save('report-1', { report: {} })
    backup.clear('report-1')
    expect(backup.load('report-1')).toBe(null)
  })

  it('returns null on a missing or corrupt draft', () => {
    const storage = memoryStorage()
    storage.setItem('carehub_adr_draft_bad', '{not json')
    const backup = createDraftBackup(storage)
    expect(backup.load('missing')).toBe(null)
    expect(backup.load('bad')).toBe(null)
  })

  it('degrades to safe no-ops when storage is unavailable or throws', () => {
    const throwing = {
      getItem: () => { throw new Error('denied') },
      setItem: () => { throw new Error('quota') },
      removeItem: () => { throw new Error('denied') },
    }
    const backup = createDraftBackup(throwing)
    expect(backup.save('r', {})).toBe(false)
    expect(backup.load('r')).toBe(null)
    expect(backup.clear('r')).toBe(false)
  })
})

describe('buildDraftSnapshot', () => {
  it('snapshots the full form state the restore path needs', () => {
    const snap = buildDraftSnapshot({
      report: { report_id: 'r1', reporter_name: 'Ada' },
      products: [{ product_name: 'X' }],
      meds: [{ medicine_name: 'Y' }],
      reactions: [{ reaction: 'Rash' }],
      reactionExpected: true,
      newSafetySignal: false,
    })
    expect(snap.report.reporter_name).toBe('Ada')
    expect(snap.products).toHaveLength(1)
    expect(snap.meds).toHaveLength(1)
    expect(snap.reactions[0].reaction).toBe('Rash')
    expect(snap.reactionExpected).toBe(true)
    expect(snap.newSafetySignal).toBe(false)
  })

  it('defaults missing child rows to empty arrays', () => {
    const snap = buildDraftSnapshot({ report: {} })
    expect(snap.products).toEqual([])
    expect(snap.meds).toEqual([])
    expect(snap.reactions).toEqual([])
  })
})

describe('isStale', () => {
  it('treats a draft older than the server update as stale', () => {
    const draft = { savedAt: new Date('2026-08-01T00:00:00Z').getTime() }
    expect(isStale(draft, new Date('2026-08-02T00:00:00Z').toISOString())).toBe(true)
  })

  it('treats a draft newer than the server update as restorable', () => {
    const draft = { savedAt: new Date('2026-08-02T00:00:00Z').getTime() }
    expect(isStale(draft, new Date('2026-08-01T00:00:00Z').toISOString())).toBe(false)
  })

  it('returns false when either side is missing', () => {
    expect(isStale(null, '2026-08-01T00:00:00Z')).toBe(false)
    expect(isStale({ savedAt: 123 }, null)).toBe(false)
  })
})
