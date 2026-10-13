import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const repo = vi.hoisted(() => ({ getLiveControl: vi.fn() }))
vi.mock('../repositories/liveRepository', () => ({ liveRepository: repo }))
const channel = vi.hoisted(() => ({ useRealtimeChannel: vi.fn() }))
vi.mock('./useRealtimeChannel', () => ({ useRealtimeChannel: channel.useRealtimeChannel }))

import { useLiveControl } from './useLiveControl'

function makeWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

const dataFor = (id) => ({ items: [{ id: `i-${id}` }], comments: [{ id: `c-${id}` }], stats: { likes: 1 } })
// Two channel calls per render: comments first, items second.
const lastConfigs = () => {
  const calls = channel.useRealtimeChannel.mock.calls
  return { comments: calls.at(-2)[0], items: calls.at(-1)[0] }
}

beforeEach(() => {
  repo.getLiveControl.mockReset().mockImplementation(async (id) => dataFor(id))
  channel.useRealtimeChannel.mockReset()
})

describe('useLiveControl', () => {
  it('loads control data for a show', async () => {
    const { result } = renderHook(() => useLiveControl('a'), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(repo.getLiveControl).toHaveBeenCalledWith('a')
    expect(result.current.data).toEqual(dataFor('a'))
  })

  it('never shows one show\'s data under another show', async () => {
    let resolveB
    repo.getLiveControl.mockImplementation((id) => id === 'b' ? new Promise((r) => { resolveB = r }) : Promise.resolve(dataFor(id)))
    const { result, rerender } = renderHook(({ id }) => useLiveControl(id), { wrapper: makeWrapper(), initialProps: { id: 'a' } })
    await waitFor(() => expect(result.current.data).toEqual(dataFor('a')))
    rerender({ id: 'b' })
    expect(result.current.data).toBeUndefined()
    expect(result.current.isLoading).toBe(true)
    resolveB(dataFor('b'))
    await waitFor(() => expect(result.current.data).toEqual(dataFor('b')))
  })

  it('a failed read is an error, not empty data', async () => {
    repo.getLiveControl.mockRejectedValue(new Error('boom'))
    const { result } = renderHook(() => useLiveControl('a'), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.data).toBeUndefined()
  })

  it('a result missing items or comments is an error', async () => {
    repo.getLiveControl.mockResolvedValue({ items: [], stats: {} })
    const a = renderHook(() => useLiveControl('a'), { wrapper: makeWrapper() })
    await waitFor(() => expect(a.result.current.isError).toBe(true))
    repo.getLiveControl.mockResolvedValue({ items: 'x', comments: [] })
    const b = renderHook(() => useLiveControl('a'), { wrapper: makeWrapper() })
    await waitFor(() => expect(b.result.current.isError).toBe(true))
  })

  it('keeps the same show\'s last good data when a refetch fails', async () => {
    const { result } = renderHook(() => useLiveControl('a'), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    repo.getLiveControl.mockRejectedValue(new Error('down'))
    await act(async () => { await result.current.refetch() })
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.data).toEqual(dataFor('a'))
  })

  it('dataUpdatedAt advances after a refetch', async () => {
    const { result } = renderHook(() => useLiveControl('a'), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    const before = result.current.dataUpdatedAt
    await new Promise((r) => setTimeout(r, 5))
    await act(async () => { await result.current.refetch() })
    await waitFor(() => expect(result.current.dataUpdatedAt).toBeGreaterThan(before))
  })

  it('configures the comments and items channels for the show', async () => {
    const { result } = renderHook(() => useLiveControl('a'), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    const { comments, items } = lastConfigs()
    expect(comments).toMatchObject({
      channelName: 'admin-live-comments-a',
      subscription: { schema: 'public', table: 'live_comments', filter: 'show_id=eq.a' },
      pollInterval: 10000,
      pollAlways: true,
    })
    expect(items).toMatchObject({
      channelName: 'admin-live-items-a',
      subscription: { schema: 'public', table: 'live_items', filter: 'show_id=eq.a' },
    })
    expect(items.pollFn).toBeUndefined()
    expect(comments.onAny).toBe(comments.pollFn)
    expect(items.onAny).toBe(comments.onAny)
  })

  it('keeps the same handler identities across re-renders', async () => {
    const { result, rerender } = renderHook(() => useLiveControl('a'), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    const first = lastConfigs()
    rerender()
    const second = lastConfigs()
    expect(second.comments.onAny).toBe(first.comments.onAny)
    expect(second.comments.pollFn).toBe(first.comments.pollFn)
    expect(second.items.onAny).toBe(first.items.onAny)
  })

  it('refetches when a channel reports a change', async () => {
    const { result } = renderHook(() => useLiveControl('a'), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    await act(async () => { lastConfigs().items.onAny({ eventType: 'INSERT' }) })
    await waitFor(() => expect(repo.getLiveControl).toHaveBeenCalledTimes(2))
  })

  it('a channel or poll refresh does not cancel a load already in progress', async () => {
    let release
    repo.getLiveControl.mockImplementation(() => new Promise(r => { release = () => r(dataFor('a')) }))
    const { result } = renderHook(() => useLiveControl('a'), { wrapper: makeWrapper() })
    expect(result.current.isSuccess).toBe(false)
    expect(result.current.isSuccess).toBe(false)
    await waitFor(() => expect(repo.getLiveControl).toHaveBeenCalledTimes(1))
    await act(async () => { lastConfigs().items.onAny({ eventType: 'INSERT' }); lastConfigs().comments.pollFn() })
    expect(repo.getLiveControl).toHaveBeenCalledTimes(1)
    await act(async () => { release() })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
  })

  it('without a show id: no repository call, inert channels, handlers do not refetch', async () => {
    const { result } = renderHook(() => useLiveControl(null), { wrapper: makeWrapper() })
    expect(result.current.fetchStatus).toBe('idle')
    const { comments, items } = lastConfigs()
    expect(comments.channelName).toBeFalsy()
    expect(items.channelName).toBeFalsy()
    await act(async () => { comments.onAny(); comments.pollFn(); items.onAny() })
    expect(repo.getLiveControl).not.toHaveBeenCalled()
  })

  it('when disabled: no repository call, inert channels, handlers do not refetch', async () => {
    const { result } = renderHook(() => useLiveControl('a', false), { wrapper: makeWrapper() })
    expect(result.current.fetchStatus).toBe('idle')
    const { comments, items } = lastConfigs()
    expect(comments.channelName).toBeFalsy()
    expect(items.channelName).toBeFalsy()
    await act(async () => { comments.onAny(); comments.pollFn(); items.onAny() })
    expect(repo.getLiveControl).not.toHaveBeenCalled()
  })
})
