import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const callAdminAuth = vi.hoisted(() => vi.fn())
const getTasks = vi.hoisted(() => vi.fn())
const admin = vi.hoisted(() => ({ showToast: vi.fn(), invalidateAdmin: vi.fn() }))
vi.mock('../adminApi', () => ({ callAdminAuth }))
vi.mock('../repositories', () => ({ dashboardRepository: { getTasks } }))
vi.mock('../provider/AdminProvider.jsx', () => ({ useAdmin: () => admin }))

import { useTasksData, useTaskActions } from './useTasksData'

function makeWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
}
const run = async (fn) => { let out; await act(async () => { out = await fn() }); return out }
const deferred = () => { let resolve, reject; const p = new Promise((res, rej) => { resolve = res; reject = rej }); return { p, resolve, reject } }

beforeEach(() => {
  callAdminAuth.mockReset().mockResolvedValue({})
  getTasks.mockReset().mockResolvedValue([{ id: 't1' }])
  admin.showToast.mockReset()
  admin.invalidateAdmin.mockReset()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => { vi.useRealTimers() })

describe('useTasksData', () => {
  it('returns the task list', async () => {
    const { result } = renderHook(() => useTasksData(), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.data).toEqual([{ id: 't1' }]))
  })
  it('a rejected read is an error, never an empty list', async () => {
    getTasks.mockRejectedValue(new Error('boom'))
    const { result } = renderHook(() => useTasksData(), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.data).toBeUndefined()
  })
  it('a non-array result is an error', async () => {
    getTasks.mockResolvedValue(null)
    const { result } = renderHook(() => useTasksData(), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.isError).toBe(true))
  })
  it('does not read when disabled', () => {
    renderHook(() => useTasksData(false), { wrapper: makeWrapper() })
    expect(getTasks).not.toHaveBeenCalled()
  })
})

describe('useTaskActions.createTask', () => {
  const good = { title: ' Fix ', description: ' Do it ', compensation: ' 5000 ', specialty: ' Cardio ' }
  const setup = () => renderHook(() => useTaskActions(), { wrapper: makeWrapper() })

  it('sends the trimmed payload, refreshes once and toasts', async () => {
    const { result } = setup()
    expect(await run(() => result.current.createTask(good))).toEqual({ ok: true })
    expect(callAdminAuth.mock.calls).toEqual([['create_task', { title: 'Fix', description: 'Do it', compensation: '5000', specialty: 'Cardio' }]])
    expect(admin.invalidateAdmin).toHaveBeenCalledTimes(1)
    expect(admin.showToast).toHaveBeenCalledWith('Task created', { type: 'success' })
  })
  it('a blank specialty is sent as null', async () => {
    const { result } = setup()
    await run(() => result.current.createTask({ ...good, specialty: '  ' }))
    expect(callAdminAuth.mock.calls[0][1].specialty).toBeNull()
    await run(() => result.current.createTask({ ...good, specialty: undefined }))
    expect(callAdminAuth.mock.calls[1][1].specialty).toBeNull()
  })
  it('accepts a numeric compensation', async () => {
    const { result } = setup()
    await run(() => result.current.createTask({ ...good, compensation: 250 }))
    expect(callAdminAuth.mock.calls[0][1].compensation).toBe('250')
  })
  it.each(['abc', '0', '-5', '12.5', '', '  '])('rejects compensation %j without a call', async (compensation) => {
    const { result } = setup()
    expect(await run(() => result.current.createTask({ ...good, compensation }))).toEqual({ ok: false, error: 'Enter a positive whole-number compensation' })
    expect(callAdminAuth).not.toHaveBeenCalled()
  })
  it('blank title or description makes no call', async () => {
    const { result } = setup()
    expect((await run(() => result.current.createTask({ ...good, title: ' ' }))).ok).toBe(false)
    expect((await run(() => result.current.createTask({ ...good, description: ' ' }))).ok).toBe(false)
    expect(callAdminAuth).not.toHaveBeenCalled()
  })
  it('a server failure returns the message with no toast or refresh', async () => {
    callAdminAuth.mockRejectedValue(new Error('nope'))
    const { result } = setup()
    expect(await run(() => result.current.createTask(good))).toEqual({ ok: false, error: 'nope' })
    expect(admin.showToast).not.toHaveBeenCalled()
    expect(admin.invalidateAdmin).not.toHaveBeenCalled()
  })
  it('a failing refresh still returns ok', async () => {
    admin.invalidateAdmin.mockRejectedValue(new Error('refresh'))
    const { result } = setup()
    expect(await run(() => result.current.createTask(good))).toEqual({ ok: true })
  })
  it('a hung refresh cannot keep Create disabled past 10 s', async () => {
    vi.useFakeTimers()
    admin.invalidateAdmin.mockReturnValue(new Promise(() => {}))
    const { result } = setup()
    let p
    act(() => { p = result.current.createTask(good) })
    await act(async () => { await vi.advanceTimersByTimeAsync(9000) })
    expect(result.current.busy).toBe(true)
    await act(async () => { await vi.advanceTimersByTimeAsync(1500); await p })
    expect(result.current.busy).toBe(false)
  })
  it('refuses a repeat while running', async () => {
    const d = deferred()
    callAdminAuth.mockReturnValue(d.p)
    const { result } = setup()
    let first
    act(() => { first = result.current.createTask(good) })
    expect(result.current.busy).toBe(true)
    expect(await run(() => result.current.createTask(good))).toEqual({ ok: false, error: 'Already running' })
    expect(callAdminAuth).toHaveBeenCalledTimes(1)
    await act(async () => { d.resolve({}); await first })
    expect(result.current.busy).toBe(false)
  })
})
