import { useQuery } from '@tanstack/react-query'
import { callAdminAuth } from '../adminApi'
import { adminTransport } from '../repositories/transport'
import { dashboardRepository } from '../repositories'

// Data for the admin Overview. Every source is fetched on its own and settles
// to { status: 'ok', data } or { status: 'error' }, so one failing call leaves
// the rest of the page intact and a failure is never shown as an empty list or
// a zero. Only endpoints and tables the admin already reads are used.
//
// The key starts with 'admin', so the panel's existing invalidateAdmin() (and
// its realtime channels) refresh this query too.

// Rows the server returns at most for these lists (api/_handlers/admin-auth.js).
// A list that reaches its cap may be missing older rows, so its counts are
// shown as "N+".
export const SOURCE_CAPS = { reports: 30, transactions: 50, news: 60, taskSubmissions: 20 }

const settle = async (promise) => {
  try { return { status: 'ok', data: await promise } } catch { return { status: 'error' } }
}

const list = (action) => callAdminAuth(action).then(r => {
  if (!Array.isArray(r?.data)) throw new Error(`${action} returned no list`)
  return r.data
})

const headCount = (table, filters) =>
  adminTransport.query(table, { select: 'id', count: 'head', ...(filters ? { filters } : {}) }).then(r => {
    if (typeof r.count !== 'number') throw new Error(`No count for ${table}`)
    return r.count
  })

export async function loadOverview(now = new Date()) {
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString()
  const [verifications, claims, reports, transactions, withdrawals, taskSubmissions, news, consultations, users, businesses, posts24h] =
    await Promise.all([
      settle(list('list_verification_requests')),
      settle(list('list_business_claims')),
      settle(list('list_reports')),
      settle(list('list_transactions')),
      settle(list('list_withdrawal_requests')),
      settle(list('list_task_submissions')),
      settle(list('list_news')),
      settle(dashboardRepository.getProfessionalConsultations()),
      settle(headCount('profiles')),
      settle(headCount('businesses')),
      settle(headCount('posts', [{ op: 'gte', col: 'created_at', val: since }])),
    ])
  return {
    sources: { verifications, claims, reports, transactions, withdrawals, taskSubmissions, news, consultations },
    totals: { users, businesses, posts24h },
  }
}

// Plain arrays (null where a source failed) plus which of them hit their cap.
export function listsFrom(result) {
  const lists = {}
  const capped = []
  for (const [name, s] of Object.entries(result?.sources || {})) {
    lists[name] = s.status === 'ok' && Array.isArray(s.data) ? s.data : null
    if (lists[name] && SOURCE_CAPS[name] != null && lists[name].length >= SOURCE_CAPS[name]) capped.push(name)
  }
  return { lists, capped }
}

export function useOverviewData(enabled = true) {
  return useQuery({ queryKey: ['admin', 'overview'], queryFn: () => loadOverview(), enabled })
}
