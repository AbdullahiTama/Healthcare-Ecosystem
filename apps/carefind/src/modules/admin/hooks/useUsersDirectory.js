import { useQuery } from '@tanstack/react-query'
import { callAdminAuth } from '../adminApi'
import { adminTransport } from '../repositories/transport'

export const USERS_PAGE_SIZE = 25

// list_user_profiles builds a PostgREST `.or(...)` filter from the search term,
// so a comma, parenthesis, double quote or backslash in it either errors on the
// server ("Obi, Ada") or adds a filter clause of the user's choosing
// ("a),id.eq.1"). Each is replaced by a space before sending; this is a client
// guard, not a backend fix. Specialty is cleaned the same way.
const UNSAFE_FILTER_CHARS = /[,()"\\]/g
const cleanTerm = (s) => s.replace(UNSAFE_FILTER_CHARS, ' ').replace(/\s+/g, ' ').trim()

async function loadTotal() {
  try {
    const r = await adminTransport.query('profiles', { select: 'id', count: 'head' })
    return typeof r?.count === 'number' ? r.count : null
  } catch { return null }
}

// One page of the user directory, filtered on the server. limit+1 rows are
// requested so a next page can be detected without a total (the server returns
// no count). A failed list rejects; it is never shown as an empty directory.
// This calls callAdminAuth directly because usersRepository turns failures into
// `data || []`, which would show a failed list as an empty one.
async function loadUsers({ search, verified, specialty, page }) {
  // The grand total is only meaningful (and only cheap to label) when nothing
  // filters the list. It loads in parallel with the list, and a failed count
  // resolves to null, so it never fails the list.
  const unfiltered = !search && !specialty && verified === 'all'
  const [res, total] = await Promise.all([
    callAdminAuth('list_user_profiles', {
      search, verified, specialty, limit: USERS_PAGE_SIZE + 1, offset: page * USERS_PAGE_SIZE,
    }),
    unfiltered ? loadTotal() : null,
  ])
  if (!Array.isArray(res?.data)) throw new Error('list_user_profiles returned no list')
  const hasNext = res.data.length > USERS_PAGE_SIZE
  return { rows: res.data.slice(0, USERS_PAGE_SIZE), hasNext, total }
}

export function useUsersDirectory({ search = '', verified = 'all', specialty = '', page = 0 } = {}) {
  const params = { search: cleanTerm(search), verified, specialty: cleanTerm(specialty), page }
  return useQuery({
    queryKey: ['admin', 'users', params],
    queryFn: () => loadUsers(params),
    // Keep the previous page on screen while the next one loads (react-query v5).
    placeholderData: (prev) => prev,
  })
}
