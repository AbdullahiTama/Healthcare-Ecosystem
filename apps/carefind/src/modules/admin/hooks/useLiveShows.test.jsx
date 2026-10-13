import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const repo = vi.hoisted(() => ({ getActiveShows: vi.fn(), getScheduledShows: vi.fn() }))
vi.mock('../repositories/liveRepository', () => ({ liveRepository: repo }))
const channel = vi.hoisted(() => ({ useRealtimeChannel: vi.fn() }))
vi.mock('./useRealtimeChannel', () => ({ useRealtimeChannel: channel.useRealtimeChannel }))

import { useLiveShows } from './useLiveShows'

function makeWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

const lastConfig = () => channel.useRealtimeChannel.mock.calls.at(-1)[0]

beforeEach(() => {
  repo.getActiveShows.mockReset().mockResolvedValue([{ id: 'a1' }])
  repo.getScheduledShows.mockReset().mockResolvedValue([{ id: 's1' }])
  channel.useRealtimeChannel.mockReset()
})

describe('useLiveShows', () => {
  it('returns both lists as ok', async () => {
    const { result } = renderHook(() => useLiveShows(), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual({
      active: { status: 'ok', data: [{ id: 'a1' }] },
      scheduled: { status: 'ok', data: [{ id: 's1' }] },
    })
  })

  it('settles each source on its own: a failed active list is an error, scheduled stays ok', async () => {
    repo.getActiveShows.mockRejectedValue(new Error('boom'))
    const { result } = renderHook(() => useLiveShows(), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data.active).toEqual({ status: 'error' })
    expect(result.current.data.scheduled).toEqual({ status: 'ok', data: [{ id: 's1' }] })
  })

  it('treats a non-array result as an error, never an empty list', async () => {
    repo.getScheduledShows.mockResolvedValue(null)
    const { result } = renderHook(() => useLiveShows(), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data.scheduled).toEqual({ status: 'error' })
    expect(result.current.data.active.status).toBe('ok')
  })

  it('configures the live_shows channel with always-on 15s polling', async () => {
    const { result } = renderHook(() => useLiveShows(), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(lastConfig()).toMatchObject({
      channelName: 'admin-live-shows',
      subscription: { schema: 'public', table: 'live_shows' },
      pollInterval: 15000,
      pollAlways: true,
    })
  })

  it('keeps the same handler identities across re-renders', async () => {
    const { result, rerender } = renderHook(() => useLiveShows(), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    const first = lastConfig()
    rerender()
    const second = lastConfig()
    expect(second.onAny).toBe(first.onAny)
    expect(second.pollFn).toBe(first.pollFn)
    expect(first.onAny).toBe(first.pollFn)
  })

  it('refetches when the channel reports a change', async () => {
    const { result } = renderHook(() => useLiveShows(), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(repo.getActiveShows).toHaveBeenCalledTimes(1)
    await act(async () => { lastConfig().onAny({ eventType: 'UPDATE' }) })
    await waitFor(() => expect(repo.getActiveShows).toHaveBeenCalledTimes(2))
  })
  it('a channel or poll refresh does not cancel a load already in progress', async () => {
    let release
    repo.getActiveShows.mockImplementation(() => new Promise(r => { release = () => r([{ id: 'a1' }]) }))
    const { result } = renderHook(() => useLiveShows(), { wrapper: makeWrapper() })
    expect(result.current.isSuccess).toBe(false)
    await waitFor(() => expect(repo.getActiveShows).toHaveBeenCalledTimes(1))
    await act(async () => { lastConfig().onAny({ eventType: 'UPDATE' }); lastConfig().pollFn() })
    expect(repo.getActiveShows).toHaveBeenCalledTimes(1)
    await act(async () => { release() })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
  })

  it('makes no repository calls while disabled, and the handlers do not refetch', async () => {
    const { result } = renderHook(() => useLiveShows(false), { wrapper: makeWrapper() })
    expect(result.current.fetchStatus).toBe('idle')
    await act(async () => { lastConfig().onAny({ eventType: 'UPDATE' }); lastConfig().pollFn() })
    expect(repo.getActiveShows).not.toHaveBeenCalled()
    expect(repo.getScheduledShows).not.toHaveBeenCalled()
  })

  it('starts refetching on handler calls once enabled, with the same handler identities', async () => {
    const { result, rerender } = renderHook(({ on }) => useLiveShows(on), { wrapper: makeWrapper(), initialProps: { on: false } })
    const first = lastConfig()
    rerender({ on: true })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(lastConfig().onAny).toBe(first.onAny)
    await act(async () => { lastConfig().pollFn() })
    await waitFor(() => expect(repo.getActiveShows).toHaveBeenCalledTimes(2))
  })

  it('keeps the last good list as stale when a refresh fails, per source', async () => {
    const { result } = renderHook(() => useLiveShows(), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.data).toBeDefined())
    repo.getActiveShows.mockRejectedValue(new Error('boom'))
    await act(async () => { await result.current.refetch() })
    await waitFor(() => expect(result.current.data.active).toEqual({ status: 'ok', data: [{ id: 'a1' }], stale: true }))
    expect(result.current.data.scheduled).toEqual({ status: 'ok', data: [{ id: 's1' }] })
  })

  it('a first-ever failure is an error, not stale', async () => {
    repo.getActiveShows.mockRejectedValue(new Error('boom'))
    const { result } = renderHook(() => useLiveShows(), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.data).toBeDefined())
    expect(result.current.data.active).toEqual({ status: 'error' })
    await act(async () => { await result.current.refetch() })
    expect(result.current.data.active).toEqual({ status: 'error' })
  })

  it('a success after a stale refresh returns fresh data without stale', async () => {
    const { result } = renderHook(() => useLiveShows(), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.data).toBeDefined())
    repo.getActiveShows.mockRejectedValueOnce(new Error('boom'))
    await act(async () => { await result.current.refetch() })
    await waitFor(() => expect(result.current.data.active.stale).toBe(true))
    repo.getActiveShows.mockResolvedValue([{ id: 'a2' }])
    await act(async () => { await result.current.refetch() })
    await waitFor(() => expect(result.current.data.active).toEqual({ status: 'ok', data: [{ id: 'a2' }] }))
  })
})
