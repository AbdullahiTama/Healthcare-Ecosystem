import { useQuery } from '@tanstack/react-query'
import { callAdminAuth } from '../adminApi'
import { useDebounced } from '../ui/useDebounced'

const GUEST_LIMIT = 20

// list_user_profiles builds a PostgREST `.or(...)` filter from the search term,
// so a comma, parenthesis, double quote or backslash in it either errors on the
// server or adds a filter clause of the user's choosing (Phase 2b finding 30).
// Each is replaced by a space before sending; this is a client guard, not a
// backend fix.
const UNSAFE_FILTER_CHARS = /[,()"\\]/g
const cleanTerm = (s) => s.replace(UNSAFE_FILTER_CHARS, ' ').replace(/\s+/g, ' ').trim()

// Called directly (not through usersRepository, which turns failures into an
// empty list) so a failed search is an error and never "no guests".
async function loadGuests(search) {
  const res = await callAdminAuth('list_user_profiles', {
    search, verified: 'all', specialty: '', limit: GUEST_LIMIT, offset: 0,
  })
  if (!Array.isArray(res?.data)) throw new Error('list_user_profiles returned no list')
  return res.data
}

// Server-side guest search for live shows. An empty search lists the newest 20.
export function useGuestSearch(search = '') {
  const cleaned = cleanTerm(useDebounced(search, 300))
  return useQuery({
    queryKey: ['admin', 'live', 'guests', cleaned],
    queryFn: () => loadGuests(cleaned),
    placeholderData: (prev) => prev,
  })
}
