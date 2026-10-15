import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { deadlineBucket, bucketCounts, countBy, countBySource, monthlyVolume, seriousCount, trendsByMonth, topReactionTerms, seriousnessBreakdown, outcomeCounts, byProductBrand, byBatchLot, suppressCounts, SMALL_GROUP_THRESHOLD } from './analytics.js'

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

describe('countBySource', () => {
  it('buckets the four recorded categories without guessing', () => {
    const rows = [
      { report_source: 'public' },
      { report_source: 'business_facility' },
      { report_source: 'business_facility' },
      { report_source: 'unknown' },
      {}, // missing channel lands in the not-recorded bucket, never inferred
    ]
    expect(countBySource(rows)).toEqual({
      public: 1,
      health_facility: 0,
      business_facility: 2,
      unknown: 2,
    })
  })

  it('never invents a source from other fields', () => {
    const rows = [{ reporter_qualification: 'physician', module_type: 'hospital' }]
    const counts = countBySource(rows)
    expect(counts.unknown).toBe(1)
    expect(counts.public ?? 0).toBe(0)
  })
})

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
describe('pv analytics helpers', () => {
  const rxn = (over = {}) => ({ reaction_description: 'Rash', severity: 'moderate', outcome: 'recovering', seriousness_death: false, seriousness_life_threatening: false, seriousness_hospitalization: false, seriousness_disability: false, seriousness_congenital_anomaly: false, seriousness_other_medically_important: false, ...over })
  const kase = (over = {}) => ({ report_id: 'r1', created_at: '2026-08-01T00:00:00Z', report_source: 'public', reporter_qualification: 'consumer', reactions: [rxn()], products: [{ product_brand_name: 'Ampiclox', batch_lot_number: 'L1' }], ...over })

  it('trendsByMonth buckets volume over trailing months, zero-filled', () => {
    const rows = trendsByMonth([kase(), kase({ created_at: '2026-09-15T00:00:00Z' })], 3, new Date('2026-09-20T00:00:00Z'))
    expect(rows).toEqual([['2026-07', 0], ['2026-08', 1], ['2026-09', 1]])
  })

  it('topReactionTerms groups normalized descriptions, ranked with limit', () => {
    const cases = [kase(), kase({ report_id: 'r2', reactions: [rxn({ reaction_description: '  RASH ' }), rxn({ reaction_description: 'Vomiting' })] })]
    expect(topReactionTerms(cases, 10)).toEqual([['rash', 2], ['vomiting', 1]])
    expect(topReactionTerms(cases, 1)).toEqual([['rash', 2]])
  })

  it('seriousnessBreakdown counts each criterion plus the any-serious denominator', () => {
    const cases = [kase(), kase({ report_id: 'r2', reactions: [rxn({ seriousness_hospitalization: true })] })]
    const b = seriousnessBreakdown(cases)
    expect(b.anySerious).toBe(1)
    expect(b.total).toBe(2)
    expect(b.criteria.hospitalization).toBe(1)
    expect(b.criteria.death).toBe(0)
  })

  it('outcomeCounts buckets six outcomes with an unknown bucket, never invents', () => {
    const cases = [kase(), kase({ report_id: 'r2', reactions: [rxn({ outcome: 'fatal' }), rxn({ outcome: '' })] })]
    expect(outcomeCounts(cases)).toEqual({ recovered: 0, recovering: 1, not_recovered: 0, recovered_with_sequelae: 0, fatal: 1, unknown: 1 })
  })

  it('byProductBrand and byBatchLot group blanks as not-recorded', () => {
    const cases = [kase(), kase({ report_id: 'r2', products: [{ product_brand_name: '', batch_lot_number: '' }] })]
    expect(byProductBrand(cases)).toEqual({ Ampiclox: 1, 'Not recorded': 1 })
    expect(byBatchLot(cases)).toEqual({ L1: 1, 'Not recorded': 1 })
  })

  it('suppressCounts withholds small groups below threshold', () => {
    expect(suppressCounts([['rash', 7], ['vomiting', 3]], 5)).toEqual([{ label: 'rash', count: 7, suppressed: false }, { label: 'vomiting', count: null, suppressed: true }])
  })
})

