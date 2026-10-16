import { describe, it, expect } from 'vitest'
import { createDraftBackup, buildDraftSnapshot, isStale, scopeFor, DRAFT_BACKUP_TTL_MS, pruneExpired, clearAllDraftBackups } from './draftBackup.js'

// Minimal in-memory storage the module accepts via injection.
function memoryStorage() {
  const map = new Map()
  const storage = {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  }
  storage.key = (i) => [...map.keys()][i] ?? null
  Object.defineProperty(storage, 'length', { get: () => map.size })
  return storage
}

describe('draftBackup', () => {
  it('saves and loads a draft under the report- and scope-qualified key', () => {
    const backup = createDraftBackup(memoryStorage())
    backup.save('report-1', 'biz-1:staff-9', { report: { status: 'draft' }, products: [] })
    const loaded = backup.load('report-1', 'biz-1:staff-9')
    expect(loaded.report.status).toBe('draft')
    expect(loaded.savedAt).toBeGreaterThan(0)
  })

  it('isolates drafts by report so they never bleed across reports', () => {
    const backup = createDraftBackup(memoryStorage())
    backup.save('report-1', 's', { report: { report_id: 'report-1' } })
    backup.save('report-2', 's', { report: { report_id: 'report-2' } })
    expect(backup.load('report-1', 's').report.report_id).toBe('report-1')
    expect(backup.load('report-2', 's').report.report_id).toBe('report-2')
  })

  it('isolates drafts by scope so tenants never read each other on shared devices', () => {
    const backup = createDraftBackup(memoryStorage())
    backup.save('report-1', 'biz-1:staff-9', { report: { reporter_name: 'Ada' } })
    expect(backup.load('report-1', 'biz-2:staff-9')).toBe(null)
    expect(backup.load('report-1', 'biz-1:staff-9').report.reporter_name).toBe('Ada')
  })

  it('treats expired drafts as missing and removes them on load', () => {
    const storage = memoryStorage()
    const backup = createDraftBackup(storage)
    backup.save('report-1', 's', { report: {} })
    const raw = JSON.parse(storage.getItem('carehub_adr_draft_s:report-1'))
    raw.savedAt = Date.now() - DRAFT_BACKUP_TTL_MS - 1000
    storage.setItem('carehub_adr_draft_s:report-1', JSON.stringify(raw))
    expect(backup.load('report-1', 's')).toBe(null)
    expect(storage.getItem('carehub_adr_draft_s:report-1')).toBe(null)
  })

  it('clears a draft', () => {
    const backup = createDraftBackup(memoryStorage())
    backup.save('report-1', 's', { report: {} })
    backup.clear('report-1', 's')
    expect(backup.load('report-1', 's')).toBe(null)
  })

  it('returns null on a missing or corrupt draft', () => {
    const storage = memoryStorage()
    storage.setItem('carehub_adr_draft_s:bad', '{not json')
    const backup = createDraftBackup(storage)
    expect(backup.load('missing', 's')).toBe(null)
    expect(backup.load('bad', 's')).toBe(null)
  })

  it('degrades to safe no-ops when storage is unavailable or throws', () => {
    const throwing = {
      getItem: () => { throw new Error('denied') },
      setItem: () => { throw new Error('quota') },
      removeItem: () => { throw new Error('denied') },
    }
    const backup = createDraftBackup(throwing)
    expect(backup.save('r', 's', {})).toBe(false)
    expect(backup.load('r', 's')).toBe(null)
    expect(backup.clear('r', 's')).toBe(false)
  })

  it('clearAllDraftBackups removes every draft key (logout path)', () => {
    const storage = memoryStorage()
    storage.setItem('carehub_adr_draft_a:r1', '{}')
    storage.setItem('carehub_adr_draft_b:r2', '{}')
    storage.setItem('carehub_auth', '{}')
    clearAllDraftBackups(storage)
    expect(storage.getItem('carehub_adr_draft_a:r1')).toBe(null)
    expect(storage.getItem('carehub_adr_draft_b:r2')).toBe(null)
    expect(storage.getItem('carehub_auth')).not.toBe(null)
  })

  it('pruneExpired removes only stale drafts and reports the count', () => {
    const storage = memoryStorage()
    const backup = createDraftBackup(storage)
    backup.save('fresh', 's', { report: {} })
    backup.save('old', 's', { report: {} })
    const raw = JSON.parse(storage.getItem('carehub_adr_draft_s:old'))
    raw.savedAt = Date.now() - DRAFT_BACKUP_TTL_MS - 1000
    storage.setItem('carehub_adr_draft_s:old', JSON.stringify(raw))
    expect(pruneExpired(storage)).toBe(1)
    expect(backup.load('fresh', 's')).not.toBe(null)
    expect(backup.load('old', 's')).toBe(null)
  })
})

describe('scopeFor', () => {
  it('scopes by business and creator, defaulting missing parts', () => {
    expect(scopeFor({ business_id: 'b1', created_by_user_id: 's9' })).toBe('b1:s9')
    expect(scopeFor({ business_id: 'b1', created_by_user_id: null })).toBe('b1:owner')
    expect(scopeFor(null)).toBe('none:owner')
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
