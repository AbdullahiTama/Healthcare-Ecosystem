import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useDebounced } from './useDebounced.js'

afterEach(() => { vi.useRealTimers() })

describe('useDebounced', () => {
  it('returns the initial value at once', () => {
    const { result } = renderHook(() => useDebounced('a', 300))
    expect(result.current).toBe('a')
  })

  it('returns a new value only after it has been stable for the delay', () => {
    vi.useFakeTimers()
    const { result, rerender } = renderHook(({ v }) => useDebounced(v, 300), { initialProps: { v: 'a' } })
    rerender({ v: 'ab' })
    act(() => { vi.advanceTimersByTime(299) })
    expect(result.current).toBe('a')
    act(() => { vi.advanceTimersByTime(1) })
    expect(result.current).toBe('ab')
  })

  it('restarts the wait on every change', () => {
    vi.useFakeTimers()
    const { result, rerender } = renderHook(({ v }) => useDebounced(v, 300), { initialProps: { v: 'a' } })
    rerender({ v: 'ab' })
    act(() => { vi.advanceTimersByTime(200) })
    rerender({ v: 'abc' })
    act(() => { vi.advanceTimersByTime(200) })
    expect(result.current).toBe('a')
    act(() => { vi.advanceTimersByTime(100) })
    expect(result.current).toBe('abc')
  })

  it('clears its timer on unmount', () => {
    vi.useFakeTimers()
    const { rerender, unmount } = renderHook(({ v }) => useDebounced(v, 300), { initialProps: { v: 'a' } })
    rerender({ v: 'ab' })
    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
})
