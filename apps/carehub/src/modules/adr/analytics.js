import { getDeadlineStatus, calculateDeadline } from './services'

/**
 * Pure analytics helpers for the ADR Reports tab (Phase 2, Item 3).
 * Kept free of React/DOM so the deadline bucketing and aggregation rules are
 * unit-tested without a renderer.
 */

// Counts a report into a { on_track, due_soon, overdue } deadline bucket. For
// submitted reports the stored submission_deadline is authoritative; for drafts
// the projected deadline (computed from is_serious + expectedness) is used, the
// same rule the detail page banner applies live.
export function deadlineBucket(report) {
  if (!report || !report.created_at) return null
  let deadlineMs = report.submission_deadline ? new Date(report.submission_deadline).getTime() : null
  if (!deadlineMs) {
    const projected = calculateDeadline(report.created_at, report.is_serious, report.reaction_expected, report.new_safety_signal)
    if (!projected) return null
    deadlineMs = projected.getTime()
  }
  return getDeadlineStatus(deadlineMs, report.created_at)
}

export function bucketCounts(reports) {
  const counts = { on_track: 0, due_soon: 0, overdue: 0 }
  reports.forEach(r => {
    const b = deadlineBucket(r)
    if (b) counts[b] += 1
  })
  return counts
}

export function countBy(reports, key) {
  const counts = {}
  reports.forEach(r => {
    const k = r[key] || 'unknown'
    counts[k] = (counts[k] || 0) + 1
  })
  return counts
}

export function monthlyVolume(reports) {
  const months = {}
  const now = new Date()
  for (let i = 5; i >= 0; i--) {
    // Built in UTC so bucket keys always align with created_at's UTC YYYY-MM
    // slice regardless of the browser's timezone.
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1))
    months[d.toISOString().slice(0, 7)] = 0
  }
  reports.forEach(r => {
    const m = (r.created_at || '').slice(0, 7)
    if (months[m] !== undefined) months[m] += 1
  })
  return Object.entries(months)
}

export function seriousCount(reports) {
  return reports.filter(r => r.is_serious).length
}