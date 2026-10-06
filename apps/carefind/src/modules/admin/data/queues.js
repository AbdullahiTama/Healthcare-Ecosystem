import { useQueries, useQuery } from '@tanstack/react-query'
import { callAdminAuth } from '../adminApi'
import { useAdmin } from '../AdminGate.jsx'

// The work queues. Each is one admin-API list; "pending" is decided here so
// the sidebar, Home and the screens agree on what still needs attention.
export const QUEUES = {
  verifications: { action: 'list_verification_requests', permission: 'verifications', isPending: r => r.status === 'pending' },
  claims: { action: 'list_business_claims', permission: 'claims', isPending: r => r.status === 'pending' },
  reports: { action: 'list_reports', permission: 'reports', isPending: r => r.status === 'pending' },
  news: { action: 'list_news', permission: 'news', isPending: r => r.status === 'pending' },
  // The withdrawal engine has no "pending" status: a request awaits action
  // while it is reserved or processing.
  withdrawals: { action: 'list_withdrawal_requests', permission: 'withdrawals', isPending: r => r.status === 'reserved' || r.status === 'processing' },
}

const NAMES = Object.keys(QUEUES)
const STALE_MS = 15000

// Under the ['admin'] prefix on purpose: the existing
// invalidateQueries({ queryKey: ['admin'] }) calls refresh these too.
export const queueKey = (name) => ['admin', 'queue', name]

async function fetchQueue(name) {
  const res = await callAdminAuth(QUEUES[name].action, {})
  return res?.data || []
}

const queryFor = (name, enabled) => ({
  queryKey: queueKey(name),
  queryFn: () => fetchQueue(name),
  enabled,
  staleTime: STALE_MS,
})

// Queue permissions are all pre-existing keys: allowed unless explicitly false.
const allowed = (permissions, name) => permissions?.[QUEUES[name].permission] !== false

export function useQueue(name, { enabled = true } = {}) {
  const { permissions } = useAdmin()
  return useQuery(queryFor(name, enabled && allowed(permissions, name)))
}

export function usePendingCounts() {
  const { permissions } = useAdmin()
  const results = useQueries({ queries: NAMES.map(n => queryFor(n, allowed(permissions, n))) })

  const counts = {}
  let failed = false
  let total = 0
  NAMES.forEach((name, i) => {
    const r = results[i]
    if (r.isError) { failed = true; counts[name] = null; return }
    if (!r.data) { counts[name] = null; return }
    counts[name] = r.data.filter(QUEUES[name].isPending).length
    total += counts[name]
  })
  // The moderation queue lists reports and pending verifications together.
  counts.queue = counts.reports === null || counts.verifications === null ? null : counts.reports + counts.verifications

  return { counts, total, failed }
}
