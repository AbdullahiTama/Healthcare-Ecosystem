// The single builder for the admin "Needs attention" queue.
//
// One row per kind of waiting work (not one per record), so a backlog of 40
// reports is one row with a count, newest context and the oldest wait time.
// A source that failed to load is passed as null/undefined and reported in
// `unavailable`; it is never treated as an empty list, because "couldn't
// load" and "nothing waiting" must not look the same to an operator.
//
// Withdrawals count while reserved or processing (the withdrawal-engine
// states, matching WithdrawalsTab). No currency amount is shown here.

const SEVERITY_RANK = { urgent: 0, warning: 1, info: 2 }

const timeOf = (iso) => {
  const n = new Date(iso).getTime()
  return Number.isFinite(n) ? n : 0
}

const pending = (r) => r?.status === 'pending'

const KINDS = [
  {
    type: 'verification', source: 'verifications', severity: 'warning', tab: 'verifications', label: 'Verification requests',
    isOpen: pending,
    context: (r) => [r.full_name, r.profession].filter(Boolean).join(' · ') || 'Applicant',
  },
  {
    type: 'claim', source: 'claims', severity: 'warning', tab: 'claims', label: 'Business claims',
    isOpen: pending,
    context: (r) => r.businesses?.name || 'Business',
  },
  {
    type: 'report', source: 'reports', severity: 'urgent', tab: 'reports', label: 'Reported posts',
    isOpen: pending,
    context: (r) => [r.reason, r.posts?.content?.slice(0, 60)].filter(Boolean).join(' · ') || 'Reported post',
  },
  {
    type: 'withdrawal', source: 'withdrawals', severity: 'warning', tab: 'withdrawals', label: 'Withdrawal requests',
    isOpen: (r) => r?.status === 'reserved' || r?.status === 'processing',
    context: (r) => r.profiles?.full_name || r.profiles?.display_name || 'Member',
  },
  {
    type: 'news', source: 'news', severity: 'warning', tab: 'news', label: 'News submissions',
    isOpen: pending,
    context: (r) => (r.headline || 'New article').slice(0, 60),
  },
  {
    type: 'task', source: 'taskSubmissions', severity: 'info', tab: 'tasks', label: 'Task submissions',
    isOpen: pending,
    context: (r) => [r.tasks?.title, r.profiles?.full_name].filter(Boolean).join(' · ') || 'Task',
  },
  {
    type: 'consultation', source: 'consultations', severity: 'info', tab: null, label: 'Consultation bookings',
    isOpen: () => true,
    context: (r) => r.profiles?.full_name || r.profiles?.display_name || 'Professional',
  },
]

// `capped`: names of sources whose server list hit its row cap, so the true
// total may be higher. Their rows carry `atLeast: true` and show "N+".
export function buildAttentionQueue(sources = {}, { capped = [] } = {}) {
  const rows = []
  const unavailable = []

  for (const kind of KINDS) {
    const list = sources[kind.source]
    if (!Array.isArray(list)) { unavailable.push(kind.type); continue }

    const open = list.filter(kind.isOpen).sort((a, b) => timeOf(b.created_at) - timeOf(a.created_at))
    if (open.length === 0) continue

    const newest = open[0]
    const oldest = open[open.length - 1]
    rows.push({
      type: kind.type,
      severity: kind.severity,
      tab: kind.tab,
      title: kind.label,
      subtitle: kind.context(newest),
      count: open.length,
      atLeast: capped.includes(kind.source),
      time: newest.created_at ?? null,
      oldest: oldest.created_at ?? null,
    })
  }

  rows.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || timeOf(b.time) - timeOf(a.time))
  return { rows, unavailable }
}

export function filterBySeverity(rows, severity) {
  return severity === 'all' ? rows : rows.filter(r => r.severity === severity)
}

export function countBySeverity(rows) {
  const counts = { all: 0, urgent: 0, warning: 0, info: 0 }
  for (const r of rows) { counts[r.severity] += r.count; counts.all += r.count }
  return counts
}
