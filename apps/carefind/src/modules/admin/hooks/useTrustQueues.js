import { useQuery } from '@tanstack/react-query'
import { callAdminAuth } from '../adminApi'

// The three review queues. Each list settles on its own to
// { status: 'ok', data } or { status: 'error' }, so a failed list is shown as
// failed and never as an empty queue. The key starts with 'admin', so
// invalidateAdmin() and the realtime channels refresh it.

// The server returns at most this many rows (api/_handlers/admin-auth.js).
export const TRUST_CAPS = { reports: 30 }

const settle = async (promise) => {
  try { return { status: 'ok', data: await promise } } catch { return { status: 'error' } }
}

const list = (action) => callAdminAuth(action).then(r => {
  if (!Array.isArray(r?.data)) throw new Error(`${action} returned no list`)
  return r.data
})

export async function loadTrustQueues() {
  const [verifications, claims, reports] = await Promise.all([
    settle(list('list_verification_requests')),
    settle(list('list_business_claims')),
    settle(list('list_reports')),
  ])
  return { verifications, claims, reports }
}

export function useTrustQueues(enabled = true) {
  return useQuery({ queryKey: ['admin', 'trust-queues'], queryFn: loadTrustQueues, enabled })
}
