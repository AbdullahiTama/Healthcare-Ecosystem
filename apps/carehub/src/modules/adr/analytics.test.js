import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { deadlineBucket, bucketCounts, countBy, monthlyVolume, seriousCount } from './analytics.js'

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

describe('deadlineBucket', () => {
  const createdAt = '2026-01-01T00:00:00Z'
  const deadlineMs = new Date(createdAt).getTime() + 10 * DAY

  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('uses the stored submission_deadline for submitted reports', () => {
    vi.setSystemTime(deadlineMs - 4 * DAY) // 4 of 10 days left -> 40% -> due_soon
    const report = { created_at: createdAt, submission_deadline: new Date(deadlineMs).toISOString() }
    expect(deadlineBucket(report)).toBe('due_soon')
  })

  it('projects the deadline for drafts without a stored deadline', () => {
    vi.setSystemTime(deadlineMs - 1 * DAY) // 10% left -> overdue
    const report = { created_at: createdAt, is_serious: false, reaction_expected: true } // non-serious + expected: +90d
    expect(deadlineBucket(report)).toBe('on_track')
  })

  it('returns null when there is no created_at', () => {
    expect(deadlineBucket({ submission_deadline: '2026-01-01T00:00:00Z' })).toBe(null)
    expect(deadlineBucket(null)).toBe(null)
  })
})

describe('bucketCounts', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('distributes reports across the three buckets', () => {
    vi.setSystemTime(new Date('2026-01-10T00:00:00Z').getTime())
    const reports = [
      { report_id: 'a', created_at: '2026-01-01T00:00:00Z', submission_deadline: '2026-01-05T00:00:00Z' }, // past -> overdue
      { report_id: 'b', created_at: '2026-01-01T00:00:00Z', submission_deadline: '2026-01-30T00:00:00Z' }, // 20d window, 20d left -> on_track
      { report_id: 'c', created_at: '2026-01-01T00:00:00Z', submission_deadline: '2026-01-12T00:00:00Z' }, // 11d window, 2d left (18%) -> overdue
      { report_id: 'd' }, // no created_at -> skipped
    ]
    expect(bucketCounts(reports)).toEqual({ on_track: 1, due_soon: 0, overdue: 2 })
  })
})

describe('countBy', () => {
  it('counts values per key', () => {
    const reports = [
      { status: 'draft' },
      { status: 'submitted' },
      { status: 'draft' },
      { module_type: 'x' },
    ]
    expect(countBy(reports, 'status')).toEqual({ draft: 2, submitted: 1, unknown: 1 })
  })
})

describe('monthlyVolume', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('returns the last six months with zero-filled buckets', () => {
    vi.setSystemTime(new Date('2026-06-15T00:00:00Z').getTime())
    const volume = monthlyVolume([
      { created_at: '2026-04-01T00:00:00Z' },
      { created_at: '2026-04-20T00:00:00Z' },
      { created_at: '2026-06-01T00:00:00Z' },
      { created_at: '2025-01-01T00:00:00Z' }, // outside window -> ignored
    ])
    const map = Object.fromEntries(volume)
    expect(map['2026-01']).toBe(0)
    expect(map['2026-04']).toBe(2)
    expect(map['2026-06']).toBe(1)
    expect(volume).toHaveLength(6)
  })
})

describe('seriousCount', () => {
  it('counts only reports flagged serious', () => {
    const reports = [
      { is_serious: true },
      { is_serious: false },
      { is_serious: true },
      {},
    ]
    expect(seriousCount(reports)).toBe(2)
  })
})

// Ensure a non-imported constant used by the component stays in sync (the
// HOUR/DAY constants are used above for window math).
void HOUR
void DAY