import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const callAdminAuth = vi.hoisted(() => vi.fn())
const getStories = vi.hoisted(() => vi.fn())
const getPromotions = vi.hoisted(() => vi.fn())
vi.mock('../adminApi', () => ({ callAdminAuth }))
vi.mock('../repositories/contentRepository', () => ({ contentRepository: { getStories } }))
vi.mock('../repositories/commerceRepository', () => ({ commerceRepository: { getPromotions } }))

import { useStoriesList, useNewsList, usePromotionsList } from './useContentLists'

// One client per test, so tests never share a cache.
const makeWrapper = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

beforeEach(() => {
  callAdminAuth.mockReset().mockResolvedValue({ data: [{ id: 'n1' }], phones: { n1: '080' } })
  getStories.mockReset().mockResolvedValue([{ id: 's1' }])
  getPromotions.mockReset().mockResolvedValue([{ id: 'pr1' }])
})

describe('content list hooks', () => {
  it('useStoriesList returns the stories', async () => {
    const { result } = renderHook(() => useStoriesList(), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual([{ id: 's1' }])
  })

  it('usePromotionsList returns the promotions', async () => {
    const { result } = renderHook(() => usePromotionsList(), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual([{ id: 'pr1' }])
  })

  it('useNewsList returns items and phones, calling list_news with no token', async () => {
    const { result } = renderHook(() => useNewsList(), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual({ items: [{ id: 'n1' }], phones: { n1: '080' } })
    expect(callAdminAuth).toHaveBeenCalledWith('list_news')
  })

  it('useNewsList defaults phones to an empty object', async () => {
    callAdminAuth.mockResolvedValue({ data: [] })
    const { result } = renderHook(() => useNewsList(), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual({ items: [], phones: {} })
  })

  it.each([
    ['useStoriesList', useStoriesList, () => getStories.mockRejectedValue(new Error('boom'))],
    ['useNewsList', useNewsList, () => callAdminAuth.mockRejectedValue(new Error('boom'))],
    ['usePromotionsList', usePromotionsList, () => getPromotions.mockRejectedValue(new Error('boom'))],
  ])('%s rejects when its source throws, never an empty list', async (_n, hook, fail) => {
    fail()
    const { result } = renderHook(() => hook(), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.data).toBeUndefined()
  })

  it.each([
    ['useStoriesList', useStoriesList, () => getStories.mockResolvedValue(null)],
    ['useNewsList', useNewsList, () => callAdminAuth.mockResolvedValue({ data: null })],
    ['usePromotionsList', usePromotionsList, () => getPromotions.mockResolvedValue(undefined)],
  ])('%s treats a non-array result as an error', async (_n, hook, bad) => {
    bad()
    const { result } = renderHook(() => hook(), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.data).toBeUndefined()
  })
})
