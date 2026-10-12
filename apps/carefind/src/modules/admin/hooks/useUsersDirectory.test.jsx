import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const callAdminAuth = vi.hoisted(() => vi.fn())
const query = vi.hoisted(() => vi.fn())
vi.mock('../adminApi', () => ({ callAdminAuth }))
vi.mock('../repositories/transport', () => ({ adminTransport: { query } }))

import { useUsersDirectory, USERS_PAGE_SIZE } from './useUsersDirectory'

// A fresh client per wrapper, so tests never share a cache.
const createWrapper = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

const rowsOf = (n) => Array.from({ length: n }, (_, i) => ({ id: `u${i}` }))
const params = (o = {}) => ({ search: '', verified: 'all', specialty: '', page: 0, ...o })

beforeEach(() => {
  callAdminAuth.mockReset().mockResolvedValue({ data: rowsOf(3) })
  query.mockReset().mockResolvedValue({ data: [], count: 4218 })
})

describe('useUsersDirectory', () => {
  it('asks the server for one extra row and the right offset', async () => {
    const { result } = renderHook(() => useUsersDirectory(params({ page: 2, search: 'ada', verified: 'verified', specialty: 'pharm' })), { wrapper: createWrapper() })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(callAdminAuth).toHaveBeenCalledWith('list_user_profiles', { search: 'ada', verified: 'verified', specialty: 'pharm', limit: USERS_PAGE_SIZE + 1, offset: 2 * USERS_PAGE_SIZE })
  })

  it('hasNext is true only when the extra row came back, and it is trimmed off', async () => {
    callAdminAuth.mockResolvedValue({ data: rowsOf(USERS_PAGE_SIZE + 1) })
    const { result } = renderHook(() => useUsersDirectory(params()), { wrapper: createWrapper() })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data.hasNext).toBe(true)
    expect(result.current.data.rows).toHaveLength(USERS_PAGE_SIZE)
  })

  it('hasNext is false on a short page', async () => {
    const { result } = renderHook(() => useUsersDirectory(params()), { wrapper: createWrapper() })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data.hasNext).toBe(false)
    expect(result.current.data.rows).toHaveLength(3)
  })

  it('gives the grand total only when no filter is active', async () => {
    const a = renderHook(() => useUsersDirectory(params()), { wrapper: createWrapper() })
    await waitFor(() => expect(a.result.current.isSuccess).toBe(true))
    expect(a.result.current.data.total).toBe(4218)
    expect(query).toHaveBeenCalledWith('profiles', { select: 'id', count: 'head' })

    const b = renderHook(() => useUsersDirectory(params({ search: 'ada' })), { wrapper: createWrapper() })
    await waitFor(() => expect(b.result.current.isSuccess).toBe(true))
    expect(b.result.current.data.total).toBeNull()
  })

  it('a failed list is an error, not an empty list', async () => {
    callAdminAuth.mockRejectedValue(new Error('boom'))
    const { result } = renderHook(() => useUsersDirectory(params()), { wrapper: createWrapper() })
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.data).toBeUndefined()
  })

  it('a failed count does not fail the list', async () => {
    query.mockRejectedValue(new Error('count down'))
    const { result } = renderHook(() => useUsersDirectory(params()), { wrapper: createWrapper() })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data.total).toBeNull()
    expect(result.current.data.rows).toHaveLength(3)
  })

  it('treats a response without a list as an error', async () => {
    callAdminAuth.mockResolvedValue({})
    const { result } = renderHook(() => useUsersDirectory(params()), { wrapper: createWrapper() })
    await waitFor(() => expect(result.current.isError).toBe(true))
  })

  it('trims search and specialty, and a whitespace-only search is no search', async () => {
    const { result } = renderHook(() => useUsersDirectory(params({ search: '   ', specialty: ' pharm ' })), { wrapper: createWrapper() })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(callAdminAuth).toHaveBeenCalledWith('list_user_profiles', expect.objectContaining({ search: '', specialty: 'pharm' }))
    const c = renderHook(() => useUsersDirectory(params({ search: '  ' })), { wrapper: createWrapper() })
    await waitFor(() => expect(c.result.current.isSuccess).toBe(true))
    expect(c.result.current.data.total).toBe(4218)
  })

  it('replaces characters that break the server filter with spaces before sending', async () => {
    const { result } = renderHook(() => useUsersDirectory(params({ search: 'Obi, Ada', specialty: 'Pharm (retail)' })), { wrapper: createWrapper() })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(callAdminAuth).toHaveBeenCalledWith('list_user_profiles', expect.objectContaining({ search: 'Obi Ada', specialty: 'Pharm retail' }))
  })

  it('never lets a filter clause through to the server', async () => {
    const { result } = renderHook(() => useUsersDirectory(params({ search: 'a),id.eq.1', specialty: 'x"\\y' })), { wrapper: createWrapper() })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    const sent = callAdminAuth.mock.calls[0][1]
    expect(sent.search).toBe('a id.eq.1')
    expect(sent.specialty).toBe('x y')
    expect(sent.search).not.toMatch(/[,()"\\]/)
    expect(sent.specialty).not.toMatch(/[,()"\\]/)
  })

  it('a term of only such characters is no filter, and the grand total is loaded', async () => {
    const { result } = renderHook(() => useUsersDirectory(params({ search: ' (,) ', specialty: '""' })), { wrapper: createWrapper() })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(callAdminAuth).toHaveBeenCalledWith('list_user_profiles', expect.objectContaining({ search: '', specialty: '' }))
    expect(result.current.data.total).toBe(4218)
  })

  it('requests the grand total in parallel with the list, not after it', async () => {
    let resolveList
    callAdminAuth.mockReturnValue(new Promise((res) => { resolveList = res }))
    const { result } = renderHook(() => useUsersDirectory(params()), { wrapper: createWrapper() })
    await waitFor(() => expect(query).toHaveBeenCalledWith('profiles', { select: 'id', count: 'head' }))
    expect(result.current.isSuccess).toBe(false)
    resolveList({ data: rowsOf(3) })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data.total).toBe(4218)
  })

  it('a failed list is still the error when the count fails too', async () => {
    callAdminAuth.mockRejectedValue(new Error('boom'))
    query.mockRejectedValue(new Error('count down'))
    const { result } = renderHook(() => useUsersDirectory(params()), { wrapper: createWrapper() })
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.error.message).toBe('boom')
  })
})
