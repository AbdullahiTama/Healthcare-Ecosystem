import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const callAdminAuth = vi.hoisted(() => vi.fn())
vi.mock('../adminApi', () => ({ callAdminAuth }))

import { useGuestSearch } from './useGuestSearch'

function makeWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

const rows = [{ id: 'u1' }, { id: 'u2' }]
const sentSearches = () => callAdminAuth.mock.calls.map((c) => c[1].search)

beforeEach(() => {
  callAdminAuth.mockReset().mockResolvedValue({ data: rows })
})
afterEach(() => { vi.useRealTimers() })

describe('useGuestSearch', () => {
  it('sends the exact payload and returns the rows', async () => {
    const { result } = renderHook(() => useGuestSearch('ada'), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(callAdminAuth).toHaveBeenCalledWith('list_user_profiles', { search: 'ada', verified: 'all', specialty: '', limit: 20, offset: 0 })
    expect(result.current.data).toEqual(rows)
  })

  it('an empty search requests the newest 20', async () => {
    const { result } = renderHook(() => useGuestSearch(''), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(callAdminAuth).toHaveBeenCalledWith('list_user_profiles', { search: '', verified: 'all', specialty: '', limit: 20, offset: 0 })
  })

  it('debounces: no request for intermediate keystrokes, one after 300 ms', async () => {
    vi.useFakeTimers()
    const { rerender } = renderHook(({ q }) => useGuestSearch(q), { wrapper: makeWrapper(), initialProps: { q: '' } })
    await act(async () => { await vi.advanceTimersByTimeAsync(300) })
    callAdminAuth.mockClear()
    rerender({ q: 'a' })
    await act(async () => { await vi.advanceTimersByTimeAsync(100) })
    rerender({ q: 'ad' })
    await act(async () => { await vi.advanceTimersByTimeAsync(100) })
    rerender({ q: 'ada' })
    await act(async () => { await vi.advanceTimersByTimeAsync(299) })
    expect(callAdminAuth).not.toHaveBeenCalled()
    await act(async () => { await vi.advanceTimersByTimeAsync(1) })
    expect(sentSearches()).toEqual(['ada'])
  })

  it('replaces characters that break the server filter with spaces', async () => {
    const { result } = renderHook(() => useGuestSearch('Obi, Ada'), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(sentSearches()).toEqual(['Obi Ada'])
  })

  it('never lets a filter clause reach the server unchanged', async () => {
    const { result } = renderHook(() => useGuestSearch('a),id.eq.1'), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(sentSearches()).toEqual(['a id.eq.1'])
    expect(sentSearches()[0]).not.toMatch(/[,()"\\]/)
  })

  it('trims, and a term of only such characters is an empty search', async () => {
    const { result } = renderHook(() => useGuestSearch('  (,) "\\ '), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(sentSearches()).toEqual([''])
  })

  it('a failed search is an error, not an empty list', async () => {
    callAdminAuth.mockRejectedValue(new Error('boom'))
    const { result } = renderHook(() => useGuestSearch('ada'), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.data).toBeUndefined()
  })

  it('a response without a list is an error', async () => {
    callAdminAuth.mockResolvedValue({ data: null })
    const { result } = renderHook(() => useGuestSearch('ada'), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.isError).toBe(true))
  })

  it('keeps the previous results on screen while the next search loads', async () => {
    const { result, rerender } = renderHook(({ q }) => useGuestSearch(q), { wrapper: makeWrapper(), initialProps: { q: 'ada' } })
    await waitFor(() => expect(result.current.data).toEqual(rows))
    callAdminAuth.mockReturnValue(new Promise(() => {}))
    rerender({ q: 'bola' })
    await waitFor(() => expect(sentSearches()).toContain('bola'))
    expect(result.current.data).toEqual(rows)
    expect(result.current.isPlaceholderData).toBe(true)
  })
})
