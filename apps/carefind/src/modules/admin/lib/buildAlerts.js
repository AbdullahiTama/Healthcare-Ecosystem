// Source labels in the fixed order the screen reports failures in.
export const ALERT_LABELS = [
  ['verifications', 'Verifications'],
  ['claims', 'Claims'],
  ['reports', 'Reports'],
  ['withdrawals', 'Withdrawals'],
  ['taskSubmissions', 'Task submissions'],
  ['consultations', 'Consultations'],
  ['news', 'News'],
]

const rowsOf = (source) => (source?.status === 'ok' && Array.isArray(source.data) ? source.data.filter(r => r && typeof r === 'object') : [])
const pending = (rows) => rows.filter(r => r?.status === 'pending')

// Turns the independently settled sources into the alert list. The mapping is
// the one the legacy useAdminData `notifications` block used, plus `failed`:
// the labels of sources that could not be read, so the screen can refuse to say
// "all clear" when a source is missing. Each source is
// { status: 'ok', data } or { status: 'error' }.
export function buildAlerts(sources) {
  const alerts = [
    ...pending(rowsOf(sources.verifications)).map(v => ({ id: v.id, type: 'verification', icon: '\u{1FA7A}', title: `Verification request from ${v.full_name}`, subtitle: v.profession, time: v.created_at, severity: 'warning', tab: 'verifications', role: 'verification_officer' })),
    ...pending(rowsOf(sources.claims)).map(c => ({ id: c.id, type: 'claim', icon: '\u{1F3E5}', title: `Business claim: ${c.businesses?.name}`, subtitle: 'Pending approval', time: c.created_at, severity: 'warning', tab: 'claims', role: 'business_manager' })),
    ...pending(rowsOf(sources.reports)).map(r => ({ id: r.id, type: 'report', icon: '\u{1F6A9}', title: `Post reported: ${r.reason}`, subtitle: r.posts?.content?.slice(0, 60), time: r.created_at, severity: 'urgent', tab: 'reports', role: 'moderator' })),
    ...pending(rowsOf(sources.withdrawals)).map(w => ({ id: w.id, type: 'withdrawal', icon: '\u{1F4B0}', title: `Withdrawal request: ₦${(w.amount * 200).toLocaleString()}`, subtitle: w.profiles?.full_name || 'User', time: w.created_at, severity: 'warning', tab: 'withdrawals', role: 'super_admin' })),
    ...pending(rowsOf(sources.taskSubmissions)).map(s => ({ id: s.id, type: 'task', icon: '\u{1F4CB}', title: `Task submission: ${s.tasks?.title}`, subtitle: s.profiles?.full_name || 'Professional', time: s.created_at, severity: 'info', tab: 'tasks', role: 'super_admin' })),
    ...rowsOf(sources.consultations).map(c => ({ id: c.id, type: 'consultation', icon: '\u{1F4C5}', title: 'New consultation booking', subtitle: c.profiles?.full_name || 'Professional', time: c.created_at, severity: 'info', tab: 'overview', role: 'verification_officer' })),
    ...pending(rowsOf(sources.news)).map(n => ({ id: n.id, type: 'news', icon: '\u{1F4F0}', title: `News submission: ${(n.headline || 'New article').slice(0, 60)}`, subtitle: n.profiles?.full_name || n.profiles?.display_name || 'Contributor', time: n.created_at, severity: 'warning', tab: 'news', role: 'super_admin' })),
  ].sort((a, b) => new Date(b.time) - new Date(a.time))

  const failed = ALERT_LABELS.filter(([key]) => sources[key]?.status !== 'ok').map(([, label]) => label)
  return { alerts, failed }
}
