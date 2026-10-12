import { useQuery } from '@tanstack/react-query'
import { adminTransport, likeContains } from '../repositories/transport'

export const BUSINESSES_PAGE_SIZE = 25

const COLUMNS = 'id, name, business_type, city, state, whatsapp, visible_on_carefind, created_at'

// An empty term must never become a filter: ilike '%%' silently drops rows whose
// searched columns are NULL. search and location arrive already trimmed.
function filtersFor({ search, type, status, location }) {
  const filters = []
  if (search) filters.push({ op: 'ilike', col: 'name', val: likeContains(search) })
  if (type && type !== 'all') filters.push({ op: 'eq', col: 'business_type', val: type })
  if (status === 'claimed') filters.push({ op: 'eq', col: 'visible_on_carefind', val: true })
  else if (status === 'unclaimed') filters.push({ op: 'eq', col: 'visible_on_carefind', val: false })
  if (location) filters.push({ op: 'or', terms: [{ col: 'state', contains: location }, { col: 'city', contains: location }] })
  return filters
}

// One page of the business directory, filtered on the server. A failed query
// rejects; it is never shown as an empty directory.
async function loadBusinesses(params) {
  const { data, count } = await adminTransport.query('businesses', {
    select: COLUMNS,
    filters: filtersFor(params),
    order: { column: 'created_at', ascending: false },
    limit: BUSINESSES_PAGE_SIZE + 1,
    offset: params.page * BUSINESSES_PAGE_SIZE,
    count: 'exact',
  })
  return {
    rows: data.slice(0, BUSINESSES_PAGE_SIZE),
    hasNext: data.length > BUSINESSES_PAGE_SIZE,
    total: typeof count === 'number' ? count : null,
  }
}

export function useBusinessesDirectory({ search = '', type = 'all', status = 'all', location = '', page = 0 } = {}) {
  const params = { search: search.trim(), type, status, location: location.trim(), page }
  return useQuery({
    queryKey: ['admin', 'businesses', params],
    queryFn: () => loadBusinesses(params),
    // Keep the previous page on screen while the next one loads (react-query v5).
    placeholderData: (prev) => prev,
  })
}
