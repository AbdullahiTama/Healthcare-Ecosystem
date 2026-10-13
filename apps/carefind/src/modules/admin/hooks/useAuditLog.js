import { useQuery } from '@tanstack/react-query'
import { callAdminAuth } from '../adminApi'

export const AUDIT_PAGE_SIZE = 25
export const AUDIT_MAX_ROWS = 200

// One page of the audit trail, filtered on the server. The endpoint has no
// offset, so page N asks for everything up to the end of page N plus one row
// (to detect a next page), capped at the endpoint's 200 rows. A failed list
// rejects; it is never shown as an empty trail.
async function loadAudit({ action, targetType, dateFrom, dateTo, page }) {
  const wanted = (page + 1) * AUDIT_PAGE_SIZE + 1
  const limit = Math.min(AUDIT_MAX_ROWS, wanted)
  const res = await callAdminAuth('list_audit_logs', {
    limit, action, target_type: targetType, dateFrom, dateTo,
  })
  if (!Array.isArray(res?.data)) throw new Error('list_audit_logs returned no list')
  const start = page * AUDIT_PAGE_SIZE
  return {
    rows: res.data.slice(start, start + AUDIT_PAGE_SIZE),
    hasNext: res.data.length > start + AUDIT_PAGE_SIZE,
    // True when the endpoint's cap, not the data, ended the list.
    capped: res.data.length >= AUDIT_MAX_ROWS,
  }
}

export function useAuditLog({ action = 'all', targetType = 'all', dateFrom = '', dateTo = '', page = 0 } = {}) {
  const params = { action, targetType, dateFrom, dateTo, page }
  return useQuery({
    queryKey: ['admin', 'audit', params],
    queryFn: () => loadAudit(params),
    placeholderData: (prev) => prev,
  })
}
