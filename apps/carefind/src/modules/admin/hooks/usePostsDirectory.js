import { useQuery } from '@tanstack/react-query'
import { callAdminAuth } from '../adminApi'
import { adminTransport } from '../repositories/transport'

export const POSTS_PAGE_SIZE = 25

async function loadTotal() {
  try {
    const r = await adminTransport.query('posts', { select: 'id', count: 'head' })
    return typeof r?.count === 'number' ? r.count : null
  } catch { return null }
}

// One page of posts, filtered on the server. limit+1 rows are requested so a
// next page can be detected without a total. A failed list rejects; it is never
// shown as an empty feed. (The server ignores type 'all'.)
async function loadPosts({ search, type, dateFrom, dateTo, page }) {
  // The grand total is only meaningful when nothing filters the list. It loads
  // in parallel with the list, and a failed count resolves to null, so it never
  // fails the list.
  const unfiltered = !search && type === 'all' && !dateFrom && !dateTo
  const [res, total] = await Promise.all([
    callAdminAuth('list_posts', {
      search, type, dateFrom, dateTo, limit: POSTS_PAGE_SIZE + 1, offset: page * POSTS_PAGE_SIZE,
    }),
    unfiltered ? loadTotal() : null,
  ])
  if (!Array.isArray(res?.data)) throw new Error('list_posts returned no list')
  return {
    rows: res.data.slice(0, POSTS_PAGE_SIZE),
    hasNext: res.data.length > POSTS_PAGE_SIZE,
    total,
  }
}

export function usePostsDirectory({ search = '', type = 'all', dateFrom = '', dateTo = '', page = 0 } = {}) {
  const params = { search: search.trim(), type, dateFrom, dateTo, page }
  return useQuery({
    queryKey: ['admin', 'posts', params],
    queryFn: () => loadPosts(params),
    // Keep the previous page on screen while the next one loads (react-query v5).
    placeholderData: (prev) => prev,
  })
}
