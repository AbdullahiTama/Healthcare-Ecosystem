import { getDeadlineStatus } from './services'

// ── PV Tracker workflow helpers (Phase 4) ──────────────────────────────────
// Pure twins of the server rules in `carehub_20261105_adr_pv_tracker.sql`:
// the transition table, the four source categories, and the summary buckets.
// Cards and list filter from the same loaded case set so counts reconcile.

export const PV_COMPANY_STATUSES = [
  'new',
  'acknowledged',
  'under_assessment',
  'follow_up_requested',
  'closed',
]

const STATUS_LABELS = {
  new: 'New',
  acknowledged: 'Acknowledged',
  under_assessment: 'Under assessment',
  follow_up_requested: 'Follow-up requested',
  closed: 'Closed',
}

export function companyStatusLabel(status) {
  return STATUS_LABELS[status] || status
}

// Server transition table mirror (update_adr_route_workflow enforces it).
const TRANSITIONS = {
  new: ['acknowledged', 'closed'],
  acknowledged: ['under_assessment', 'follow_up_requested', 'closed'],
  under_assessment: ['follow_up_requested', 'closed'],
  follow_up_requested: ['under_assessment', 'closed'],
  closed: ['under_assessment'],
}

export function allowedCompanyTransitions(from) {
  return [...(TRANSITIONS[from] || [])]
}

// Bulk-export audit: one `exported` event per included report sharing a batch
// id, so a filtered export is countable per case. Partial delivery failures
// are reported explicitly ({ total, failed }) instead of failing silently.
export async function logBulkExport(logEvent, reportIds, meta = {}) {
  const batch = `bulk-${Date.now()}-${Math.random().toString(36).slice(2)}`
  const results = await Promise.allSettled(
    (reportIds || []).map(id => logEvent(id, 'exported', { ...meta, bulk: batch }))
  )
  return { total: reportIds ? reportIds.length : 0, failed: results.filter(r => r.status === 'rejected').length }
}

const SOURCE_BADGES = {
  public: { label: 'Public report', tone: 'info' },
  health_facility: { label: 'Health-facility report', tone: 'success' },
  business_facility: { label: 'Business report', tone: 'neutral' },
  unknown: { label: 'Source not recorded', tone: 'warning' },
}

// Source is the recorded channel, never inferred: anything unrecognized maps
// to unknown rather than guessed.
export function sourceBadge(source) {
  return SOURCE_BADGES[source] || SOURCE_BADGES.unknown
}

// Every card below counts the same `cases` array the list renders, so summary
// and list can never disagree. A case: { company_status, report_status,
// is_serious, submission_deadline, created_at }.
export function bucketTrackerCounts(cases) {
  const counts = {
    total: cases.length,
    new: 0,
    serious: 0,
    followUpRequired: 0,
    underAssessment: 0,
    closed: 0,
    dueSoon: 0,
    overdue: 0,
  }
  for (const c of cases) {
    if (c.company_status === 'new') counts.new += 1
    if (c.is_serious) counts.serious += 1
    if (c.company_status === 'follow_up_requested' || c.report_status === 'follow_up_required') {
      counts.followUpRequired += 1
    }
    if (c.company_status === 'under_assessment') counts.underAssessment += 1
    if (c.company_status === 'closed') counts.closed += 1
    if (c.submission_deadline && c.created_at) {
      const bucket = getDeadlineStatus(c.submission_deadline, c.created_at)
      if (bucket === 'due_soon') counts.dueSoon += 1
      else if (bucket === 'overdue') counts.overdue += 1
    }
  }
  return counts
}
