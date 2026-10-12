import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const callAdminAuth = vi.hoisted(() => vi.fn())
const query = vi.hoisted(() => vi.fn())
vi.mock('../adminApi', () => ({ callAdminAuth }))
vi.mock('../repositories/transport', () => ({ adminTransport: { query } }))

import { usePostsDirectory, POSTS_PAGE_SIZE } from './usePostsDirectory'

// One client per test, so tests never share a cache.
const makeWrapper = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

const rowsOf = (n) => Array.from({ length: n }, (_, i) => ({ id: `p${i}` }))
const params = (o = {}) => ({ search: '', type: 'all', dateFrom: '', dateTo: '', page: 0, ...o })

beforeEach(() => {
  callAdminAuth.mockReset().mockResolvedValue({ data: rowsOf(3) })
  query.mockReset().mockResolvedValue({ data: [], count: 977 })
})

describe('usePostsDirectory', () => {
  it('asks the server for one extra row and the right offset', async () => {
    const { result } = renderHook(() => usePostsDirectory(params({ page: 2, search: 'flu', type: 'tip', dateFrom: '2026-01-01', dateTo: '2026-02-01' })), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(callAdminAuth).toHaveBeenCalledWith('list_posts', { search: 'flu', type: 'tip', dateFrom: '2026-01-01', dateTo: '2026-02-01', limit: POSTS_PAGE_SIZE + 1, offset: 50 })
  })

  it('sends a whitespace-only search as empty and treats it as no filter', async () => {
    const { result } = renderHook(() => usePostsDirectory(params({ search: '   ' })), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(callAdminAuth).toHaveBeenCalledWith('list_posts', expect.objectContaining({ search: '', offset: 0 }))
    expect(result.current.data.total).toBe(977)
  })

  it('hasNext is true only with the extra row, which is trimmed off', async () => {
    callAdminAuth.mockResolvedValue({ data: rowsOf(POSTS_PAGE_SIZE + 1) })
    const { result } = renderHook(() => usePostsDirectory(params()), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data.hasNext).toBe(true)
    expect(result.current.data.rows).toHaveLength(POSTS_PAGE_SIZE)
  })

  it('hasNext is false on a short page', async () => {
    const { result } = renderHook(() => usePostsDirectory(params()), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data.hasNext).toBe(false)
    expect(result.current.data.rows).toHaveLength(3)
  })

  it('gives the grand total only when no filter is active', async () => {
    const a = renderHook(() => usePostsDirectory(params()), { wrapper: makeWrapper() })
    await waitFor(() => expect(a.result.current.isSuccess).toBe(true))
    expect(a.result.current.data.total).toBe(977)
    expect(query).toHaveBeenCalledWith('posts', { select: 'id', count: 'head' })

    for (const f of [{ search: 'x' }, { type: 'tip' }, { dateFrom: '2026-01-01' }, { dateTo: '2026-01-02' }]) {
      const b = renderHook(() => usePostsDirectory(params(f)), { wrapper: makeWrapper() })
      await waitFor(() => expect(b.result.current.isSuccess).toBe(true))
      expect(b.result.current.data.total).toBeNull()
    }
  })

  it('a failed list is an error, not an empty list', async () => {
    callAdminAuth.mockRejectedValue(new Error('boom'))
    const { result } = renderHook(() => usePostsDirectory(params()), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.data).toBeUndefined()
  })

  it('a failed count does not fail the list', async () => {
    query.mockRejectedValue(new Error('count down'))
    const { result } = renderHook(() => usePostsDirectory(params()), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data.total).toBeNull()
    expect(result.current.data.rows).toHaveLength(3)
  })

  it('treats a response without a list as an error', async () => {
    callAdminAuth.mockResolvedValue({})
    const { result } = renderHook(() => usePostsDirectory(params()), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.isError).toBe(true))
  })
})
