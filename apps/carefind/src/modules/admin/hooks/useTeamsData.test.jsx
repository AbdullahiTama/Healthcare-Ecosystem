import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const callAdminAuth = vi.hoisted(() => vi.fn())
vi.mock('../adminApi', () => ({ callAdminAuth }))

import { useTeamsData } from './useTeamsData'

function makeWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

const respond = (action) => {
  if (action === 'list_teams') return Promise.resolve({ teams: [{ id: 't1' }] })
  if (action === 'list_admin_roles') return Promise.resolve({ data: [{ id: 'r1' }] })
  if (action === 'list_staff') return Promise.resolve({ staff: [{ id: 's1' }] })
  return Promise.reject(new Error('unexpected ' + action))
}

beforeEach(() => {
  callAdminAuth.mockReset().mockImplementation(respond)
})

describe('useTeamsData', () => {
  it('reads teams, roles and staff with empty payloads and no token', async () => {
    const { result } = renderHook(() => useTeamsData({ canSeeStaff: true }), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.data).toBeDefined())
    expect(result.current.data).toEqual({
      teams: { status: 'ok', data: [{ id: 't1' }] },
      roles: { status: 'ok', data: [{ id: 'r1' }] },
      staff: { status: 'ok', data: [{ id: 's1' }] },
    })
    expect(callAdminAuth.mock.calls).toEqual(expect.arrayContaining([
      ['list_teams', {}], ['list_admin_roles', {}], ['list_staff', {}],
    ]))
    callAdminAuth.mock.calls.forEach(([, payload]) => expect(payload).not.toHaveProperty('token'))
  })

  it('never reads staff without permission and reports it as restricted', async () => {
    const { result } = renderHook(() => useTeamsData({ canSeeStaff: false }), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.data).toBeDefined())
    expect(result.current.data.staff).toEqual({ status: 'restricted' })
    expect(callAdminAuth.mock.calls.map(c => c[0])).not.toContain('list_staff')
    expect(result.current.data.teams.status).toBe('ok')
  })

  it('settles each source on its own', async () => {
    callAdminAuth.mockImplementation((a) => (a === 'list_admin_roles' ? Promise.reject(new Error('x')) : respond(a)))
    const { result } = renderHook(() => useTeamsData({ canSeeStaff: true }), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.data).toBeDefined())
    expect(result.current.data.roles).toEqual({ status: 'error' })
    expect(result.current.data.teams.status).toBe('ok')
    expect(result.current.data.staff.status).toBe('ok')
  })

  it('treats a non-array payload as an error', async () => {
    callAdminAuth.mockImplementation((a) => (a === 'list_teams' ? Promise.resolve({ teams: null }) : respond(a)))
    const { result } = renderHook(() => useTeamsData({ canSeeStaff: true }), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.data).toBeDefined())
    expect(result.current.data.teams).toEqual({ status: 'error' })
  })

  it('keeps the last good data as stale on a failed refresh, and clears stale on success', async () => {
    const { result } = renderHook(() => useTeamsData({ canSeeStaff: true }), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.data).toBeDefined())
    callAdminAuth.mockImplementation((a) => (a === 'list_teams' ? Promise.reject(new Error('x')) : respond(a)))
    await act(async () => { await result.current.refetch() })
    await waitFor(() => expect(result.current.data.teams).toEqual({ status: 'ok', data: [{ id: 't1' }], stale: true }))
    callAdminAuth.mockImplementation(respond)
    await act(async () => { await result.current.refetch() })
    await waitFor(() => expect(result.current.data.teams).toEqual({ status: 'ok', data: [{ id: 't1' }] }))
  })

  it('a first failure stays an error', async () => {
    callAdminAuth.mockImplementation((a) => (a === 'list_teams' ? Promise.reject(new Error('x')) : respond(a)))
    const { result } = renderHook(() => useTeamsData({ canSeeStaff: true }), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.data).toBeDefined())
    await act(async () => { await result.current.refetch() })
    expect(result.current.data.teams).toEqual({ status: 'error' })
  })
})
