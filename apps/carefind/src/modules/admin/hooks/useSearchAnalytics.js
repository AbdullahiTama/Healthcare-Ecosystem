import { useQuery } from '@tanstack/react-query'
import { callAdminAuth } from '../adminApi'

// The newest 300 searches (the endpoint's window). A failed read rejects; it is
// never shown as "no searches yet".
export function useSearchAnalytics(enabled = true) {
  return useQuery({
    queryKey: ['admin', 'searches'],
    queryFn: async () => {
      const res = await callAdminAuth('list_search_logs', {})
      if (!Array.isArray(res?.data)) throw new Error('list_search_logs returned no list')
      return res.data.filter(r => typeof r?.query === 'string' && r.query.trim() !== '')
    },
    enabled,
    staleTime: 60_000,
  })
}
