import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

const searchProducts = vi.hoisted(() => vi.fn())
const getProductReviews = vi.hoisted(() => vi.fn())
vi.mock('../repositories/commerceRepository', () => ({ commerceRepository: { searchProducts, getProductReviews } }))

import { useDrugReviews } from './useDrugReviews'

const deferred = () => {
  let resolve
  const promise = new Promise((r) => { resolve = r })
  return { promise, resolve }
}

beforeEach(() => {
  searchProducts.mockReset().mockResolvedValue([])
  getProductReviews.mockReset().mockResolvedValue([])
})

describe('useDrugReviews', () => {
  it('starts with no result', () => {
    const { result } = renderHook(() => useDrugReviews())
    expect(result.current.result).toBeNull()
    expect(result.current.searching).toBe(false)
  })

  it('a blank term makes no call and leaves the result null', async () => {
    const { result } = renderHook(() => useDrugReviews())
    await act(async () => { await result.current.search('   ') })
    await act(async () => { await result.current.search('') })
    expect(searchProducts).not.toHaveBeenCalled()
    expect(result.current.result).toBeNull()
  })

  it('loads reviews for all matched ids; product is the first match', async () => {
    searchProducts.mockResolvedValue([{ id: 'p1', name: 'A' }, { id: 'p2', name: 'B' }])
    getProductReviews.mockResolvedValue([{ id: 'r1' }])
    const { result } = renderHook(() => useDrugReviews())
    await act(async () => { await result.current.search('para') })
    expect(searchProducts).toHaveBeenCalledWith('para')
    expect(getProductReviews).toHaveBeenCalledWith(['p1', 'p2'])
    expect(result.current.result).toEqual({ status: 'ok', term: 'para', product: { id: 'p1', name: 'A' }, matches: 2, reviews: [{ id: 'r1' }] })
    expect(result.current.searching).toBe(false)
  })

  it('no match gives an empty ok result and no reviews call', async () => {
    const { result } = renderHook(() => useDrugReviews())
    await act(async () => { await result.current.search('zzz') })
    expect(result.current.result).toEqual({ status: 'ok', term: 'zzz', product: null, matches: 0, reviews: [] })
    expect(getProductReviews).not.toHaveBeenCalled()
  })

  it('a rejected product search is an error carrying the term', async () => {
    searchProducts.mockRejectedValue(new Error('boom'))
    const { result } = renderHook(() => useDrugReviews())
    await act(async () => { await result.current.search('para') })
    expect(result.current.result).toEqual({ status: 'error', term: 'para' })
  })

  it('a rejected reviews load is an error, never empty reviews', async () => {
    searchProducts.mockResolvedValue([{ id: 'p1' }])
    getProductReviews.mockRejectedValue(new Error('boom'))
    const { result } = renderHook(() => useDrugReviews())
    await act(async () => { await result.current.search('para') })
    expect(result.current.result).toEqual({ status: 'error', term: 'para' })
  })

  it('searching is true while a search runs', async () => {
    const d = deferred()
    searchProducts.mockReturnValue(d.promise)
    const { result } = renderHook(() => useDrugReviews())
    let pending
    act(() => { pending = result.current.search('para') })
    expect(result.current.searching).toBe(true)
    await act(async () => { d.resolve([]); await pending })
    expect(result.current.searching).toBe(false)
  })

  it('a late older result never overwrites a newer one', async () => {
    const first = deferred()
    searchProducts.mockImplementation((term) => (term === 'old' ? first.promise : Promise.resolve([{ id: 'n1' }])))
    getProductReviews.mockResolvedValue([])
    const { result } = renderHook(() => useDrugReviews())
    let p1
    act(() => { p1 = result.current.search('old') })
    await act(async () => { await result.current.search('new') })
    expect(result.current.result.term).toBe('new')
    await act(async () => { first.resolve([{ id: 'o1' }]); await p1 })
    expect(result.current.result.term).toBe('new')
    expect(result.current.searching).toBe(false)
  })

  it('a search that resolves after unmount makes no further calls and logs nothing', async () => {
    const d = deferred()
    searchProducts.mockReturnValue(d.promise)
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { result, unmount } = renderHook(() => useDrugReviews())
    let pending
    act(() => { pending = result.current.search('para') })
    unmount()
    d.resolve([{ id: 'p1' }])
    await pending
    expect(getProductReviews).not.toHaveBeenCalled()
    expect(err).not.toHaveBeenCalled()
    err.mockRestore()
  })

  it('a superseded older search makes no reviews call', async () => {
    const first = deferred()
    searchProducts.mockImplementation((term) => (term === 'old' ? first.promise : Promise.resolve([{ id: 'n1' }])))
    getProductReviews.mockResolvedValue([])
    const { result } = renderHook(() => useDrugReviews())
    let p1
    act(() => { p1 = result.current.search('old') })
    await act(async () => { await result.current.search('new') })
    expect(getProductReviews).toHaveBeenCalledTimes(1)
    expect(getProductReviews).toHaveBeenCalledWith(['n1'])
    await act(async () => { first.resolve([{ id: 'o1' }]); await p1 })
    expect(getProductReviews).toHaveBeenCalledTimes(1)
    expect(result.current.result.term).toBe('new')
  })
})
