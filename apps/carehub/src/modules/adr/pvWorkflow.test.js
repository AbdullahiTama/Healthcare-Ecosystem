import { describe, it, expect } from 'vitest'
import {
  PV_COMPANY_STATUSES,
  allowedCompanyTransitions,
  sourceBadge,
  bucketTrackerCounts,
  companyStatusLabel,
} from './pvWorkflow.js'

const base = {
  company_status: 'acknowledged',
  report_status: 'submitted',
  is_serious: false,
  submission_deadline: null,
  created_at: new Date(Date.now() - 24 * 3600 * 1000).toISOString(),
}

describe('allowedCompanyTransitions', () => {
  it('mirrors the server transition table', () => {
    expect(allowedCompanyTransitions('new')).toEqual(['acknowledged', 'closed'])
    expect(allowedCompanyTransitions('acknowledged')).toEqual(['under_assessment', 'follow_up_requested', 'closed'])
    expect(allowedCompanyTransitions('under_assessment')).toEqual(['follow_up_requested', 'closed'])
    expect(allowedCompanyTransitions('follow_up_requested')).toEqual(['under_assessment', 'closed'])
    expect(allowedCompanyTransitions('closed')).toEqual(['under_assessment'])
  })

  it('rejects illegal jumps (e.g. new straight to assessment)', () => {
    expect(allowedCompanyTransitions('new')).not.toContain('under_assessment')
    expect(allowedCompanyTransitions('closed')).not.toContain('acknowledged')
    expect(allowedCompanyTransitions('bogus')).toEqual([])
  })
})

describe('sourceBadge', () => {
  it('labels all four source categories distinctly', () => {
    expect(sourceBadge('public').label).toMatch(/public/i)
    expect(sourceBadge('health_facility').label).toMatch(/facility/i)
    expect(sourceBadge('business_facility').label).toMatch(/business/i)
    expect(sourceBadge('unknown').label).toMatch(/unknown|not recorded/i)
  })

  it('never guesses — unrecognized sources map to unknown', () => {
    expect(sourceBadge('a-job-title')).toEqual(sourceBadge('unknown'))
    expect(sourceBadge(null)).toEqual(sourceBadge('unknown'))
  })
})

describe('bucketTrackerCounts', () => {
  it('reconciles cards with the underlying list', () => {
    const cases = [
      { ...base, company_status: 'new', is_serious: true },
      { ...base, company_status: 'acknowledged', is_serious: false },
      { ...base, company_status: 'under_assessment', is_serious: true },
      { ...base, company_status: 'follow_up_requested', is_serious: false },
      { ...base, company_status: 'closed', is_serious: false },
      { ...base, company_status: 'acknowledged', report_status: 'follow_up_required' },
    ]
    const counts = bucketTrackerCounts(cases)
    expect(counts.total).toBe(6)
    expect(counts.new).toBe(1)
    expect(counts.serious).toBe(2)
    expect(counts.underAssessment).toBe(1)
    expect(counts.closed).toBe(1)
    // follow_up_requested status + follow_up_required report status both count
    expect(counts.followUpRequired).toBe(2)
  })

  it('buckets overdue and due-soon from the stored deadline', () => {
    const overdue = { ...base, company_status: 'acknowledged', submission_deadline: new Date(Date.now() - 3600 * 1000).toISOString() }
    const farFuture = { ...base, company_status: 'acknowledged', submission_deadline: new Date(Date.now() + 90 * 24 * 3600 * 1000).toISOString() }
    const counts = bucketTrackerCounts([overdue, farFuture])
    expect(counts.overdue).toBe(1)
    expect(counts.dueSoon + counts.overdue).toBeLessThanOrEqual(2)
  })

  it('counts zero for an empty tracker', () => {
    expect(bucketTrackerCounts([]).total).toBe(0)
  })
})

describe('PV_COMPANY_STATUSES', () => {
  it('covers the five workflow states with labels', () => {
    for (const s of ['new', 'acknowledged', 'under_assessment', 'follow_up_requested', 'closed']) {
      expect(companyStatusLabel(s)).toBeTruthy()
    }
    expect(PV_COMPANY_STATUSES).toContain('acknowledged')
  })
})
