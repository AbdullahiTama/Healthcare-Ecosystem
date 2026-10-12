import { useQuery } from '@tanstack/react-query'
import { callAdminAuth } from '../adminApi'
import { adminTransport } from '../repositories/transport'

export const USERS_PAGE_SIZE = 25

// One page of the user directory, filtered on the server. limit+1 rows are
// requested so a next page can be detected without a total (the server returns
// no count). A failed list rejects; it is never shown as an empty directory.
async function loadUsers({ search, verified, specialty, page }) {
  const res = await callAdminAuth('list_user_profiles', {
    search, verified, specialty, limit: USERS_PAGE_SIZE + 1, offset: page * USERS_PAGE_SIZE,
  })
  if (!Array.isArray(res?.data)) throw new Error('list_user_profiles returned no list')
  const hasNext = res.data.length > USERS_PAGE_SIZE

  // The grand total is only meaningful (and only cheap to label) when nothing
  // filters the list. A failed count must not fail the list.
  let total = null
  const unfiltered = !search && !specialty && verified === 'all'
  if (unfiltered) {
    try {
      const r = await adminTransport.query('profiles', { select: 'id', count: 'head' })
      total = typeof r?.count === 'number' ? r.count : null
    } catch { total = null }
  }
  return { rows: res.data.slice(0, USERS_PAGE_SIZE), hasNext, total }
}

export function useUsersDirectory({ search = '', verified = 'all', specialty = '', page = 0 } = {}) {
  const params = { search: search.trim(), verified, specialty: specialty.trim(), page }
  return useQuery({
    queryKey: ['admin', 'users', params],
    queryFn: () => loadUsers(params),
    // Keep the previous page on screen while the next one loads (react-query v5).
    placeholderData: (prev) => prev,
  })
}
