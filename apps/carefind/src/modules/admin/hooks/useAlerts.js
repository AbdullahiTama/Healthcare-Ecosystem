import { useQuery } from '@tanstack/react-query'
import { callAdminAuth } from '../adminApi'
import { dashboardRepository } from '../repositories'
import { buildAlerts } from '../lib/buildAlerts'

const fromAdmin = (action) => async () => (await callAdminAuth(action, {}))?.data

// Each source is read on its own; one failing never hides the others.
const SOURCES = [
  { key: 'verifications', load: fromAdmin('list_verification_requests') },
  { key: 'claims', load: fromAdmin('list_business_claims') },
  { key: 'reports', load: fromAdmin('list_reports') },
  { key: 'withdrawals', load: fromAdmin('list_withdrawal_requests') },
  { key: 'taskSubmissions', load: fromAdmin('list_task_submissions') },
  { key: 'consultations', load: () => dashboardRepository.getProfessionalConsultations() },
  { key: 'news', load: fromAdmin('list_news') },
]

// A non-array result counts as that source failing, never as "nothing there".
const settle = async ({ load }) => {
  try {
    const data = await load()
    return Array.isArray(data) ? { status: 'ok', data } : { status: 'error' }
  } catch {
    return { status: 'error' }
  }
}

// The admin alert list, built from independently settled sources.
// Key starts with 'admin', so invalidateAdmin() refreshes it.
export function useAlerts(enabled = true) {
  return useQuery({
    queryKey: ['admin', 'alerts'],
    queryFn: async () => {
      const settled = await Promise.all(SOURCES.map(settle))
      return buildAlerts(Object.fromEntries(SOURCES.map((s, i) => [s.key, settled[i]])))
    },
    enabled,
  })
}
