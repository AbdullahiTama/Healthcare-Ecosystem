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

// Report-source breakdown over the four recorded channel categories. The
// source is read from report_source only — never inferred from qualification,
// module, product company or names. Missing values land in the explicit
// not-recorded ('unknown') bucket; every category is always present (possibly
// zero) so charts cannot silently drop a channel.
const SOURCE_CATEGORIES = ['public', 'health_facility', 'business_facility', 'unknown']

export function countBySource(reports) {
  const counts = { public: 0, health_facility: 0, business_facility: 0, unknown: 0 }
  reports.forEach(r => {
    const s = r && r.report_source
    counts[SOURCE_CATEGORIES.includes(s) ? s : 'unknown'] += 1
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

// ── PV analytics helpers (Phase 6) ─────────────────────────────────────────
// All helpers read recorded values only (reactions[] / products[] on the
// Tracker aggregates, report_source, reporter_qualification). Unknown and
// blank values get explicit not-recorded buckets — nothing is ever imputed.

// Interim small-group threshold (privacy-lead sign-off may adjust).
export const SMALL_GROUP_THRESHOLD = 5

const SERIOUSNESS_CRITERIA = [
  'seriousness_death',
  'seriousness_life_threatening',
  'seriousness_hospitalization',
  'seriousness_disability',
  'seriousness_congenital_anomaly',
  'seriousness_other_medically_important',
]

const OUTCOME_VALUES = [
  'recovered',
  'recovering',
  'not_recovered',
  'recovered_with_sequelae',
  'fatal',
  'unknown',
]

// Monthly report counts over the trailing `months` ending at `now` (default
// today), zero-filled so sparse periods render honestly.
export function trendsByMonth(cases, months = 6, now = new Date()) {
  const keys = []
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1))
    keys.push(d.toISOString().slice(0, 7))
  }
  const counts = Object.fromEntries(keys.map(k => [k, 0]))
  cases.forEach(c => {
    const m = (c.created_at || '').slice(0, 7)
    if (m in counts) counts[m] += 1
  })
  return keys.map(k => [k, counts[k]])
}

function normalizeTerm(s) {
  return String(s || '').trim().replace(/\s+/g, ' ').toLowerCase()
}

// Most common reaction descriptions, normalized and ranked. Returns
// [term, count] pairs (raw counts — suppression is the caller's decision via
// suppressCounts, so totals stay auditable).
export function topReactionTerms(cases, limit = 10) {
  const counts = {}
  cases.forEach(c => {
    ;(c.reactions || []).forEach(r => {
      const t = normalizeTerm(r.reaction_description)
      if (!t) return
      counts[t] = (counts[t] || 0) + 1
    })
  })
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, Math.max(limit, 0))
}

// Per-criterion counts across all reactions plus denominators. A reaction
// with any flag set counts toward anySerious; total counts cases.
export function seriousnessBreakdown(cases) {
  const criteria = Object.fromEntries(
    SERIOUSNESS_CRITERIA.map(k => [k.replace(/^seriousness_/, ''), 0])
  )
  let anySerious = 0
  cases.forEach(c => {
    let serious = false
    ;(c.reactions || []).forEach(r => {
      SERIOUSNESS_CRITERIA.forEach(k => {
        if (r[k]) {
          criteria[k.replace(/^seriousness_/, '')] += 1
          serious = true
        }
      })
    })
    if (serious) anySerious += 1
  })
  return { total: cases.length, anySerious, criteria }
}

// Reaction-level outcome counts over the six recorded values. Anything else
// (blank, unexpected) lands in unknown — the recorded value is never guessed.
export function outcomeCounts(cases) {
  const counts = Object.fromEntries(OUTCOME_VALUES.map(o => [o, 0]))
  cases.forEach(c => {
    ;(c.reactions || []).forEach(r => {
      const o = OUTCOME_VALUES.includes(r.outcome) ? r.outcome : 'unknown'
      counts[o] += 1
    })
  })
  return counts
}

// Case-level product/brand counts. Blank brand names group under an explicit
// 'Not recorded' bucket — never attributed to a company.
export function byProductBrand(cases) {
  const counts = {}
  cases.forEach(c => {
    const brands = new Set(
      (c.products || []).map(p => (p.product_brand_name || '').trim() || 'Not recorded')
    )
    if (brands.size === 0) brands.add('Not recorded')
    brands.forEach(b => { counts[b] = (counts[b] || 0) + 1 })
  })
  return counts
}

// Case-level batch/lot counts, same not-recorded rule as brands.
export function byBatchLot(cases) {
  const counts = {}
  cases.forEach(c => {
    const lots = new Set()
    ;(c.products || []).forEach(p => {
      const b = (p.batch_lot_number || '').trim() || 'Not recorded'
      lots.add(b)
    })
    if (lots.size === 0) lots.add('Not recorded')
    lots.forEach(l => { counts[l] = (counts[l] || 0) + 1 })
  })
  return counts
}

// Privacy gate for breakdowns: entries below `threshold` keep their label but
// withhold the value (count: null, suppressed: true) so rare slices cannot
// single out a case. Totals are unaffected — suppression hides distribution,
// never volume.
export function suppressCounts(entries, threshold = SMALL_GROUP_THRESHOLD) {
  return entries.map(([label, count]) =>
    count < threshold
      ? { label, count: null, suppressed: true }
      : { label, count, suppressed: false }
  )
}