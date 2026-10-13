import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const callAdminAuth = vi.hoisted(() => vi.fn())
const consults = vi.hoisted(() => vi.fn())
vi.mock('../adminApi', () => ({ callAdminAuth }))
vi.mock('../repositories', () => ({ dashboardRepository: { getProfessionalConsultations: consults } }))

import { useAlerts } from './useAlerts'

// One client per test, so tests never share a cache.
const makeWrapper = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
}
const run = (enabled) => renderHook(() => useAlerts(enabled), { wrapper: makeWrapper() })

const ACTIONS = ['list_verification_requests', 'list_business_claims', 'list_reports', 'list_withdrawal_requests', 'list_task_submissions', 'list_news']

beforeEach(() => {
  callAdminAuth.mockReset().mockResolvedValue({ data: [] })
  consults.mockReset().mockResolvedValue([])
})

describe('useAlerts', () => {
  it('reads each source with an empty payload and no token', async () => {
    const { result } = run()
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    for (const a of ACTIONS) expect(callAdminAuth).toHaveBeenCalledWith(a, {})
    expect(callAdminAuth).toHaveBeenCalledTimes(6)
    expect(consults).toHaveBeenCalledTimes(1)
    expect(result.current.data).toEqual({ alerts: [], failed: [] })
  })

  it('builds alerts from the data', async () => {
    callAdminAuth.mockImplementation(async (a) => ({ data: a === 'list_reports' ? [{ id: 'r', status: 'pending', reason: 'spam', created_at: '2026-01-01' }] : [] }))
    const { result } = run()
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data.alerts).toHaveLength(1)
    expect(result.current.data.alerts[0].title).toBe('Post reported: spam')
  })

  it('one rejecting source does not fail the others', async () => {
    callAdminAuth.mockImplementation(async (a) => {
      if (a === 'list_withdrawal_requests') throw new Error('boom')
      return { data: a === 'list_news' ? [{ id: 'n', status: 'pending', headline: 'Hi', created_at: '2026-01-01' }] : [] }
    })
    const { result } = run()
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data.failed).toEqual(['Withdrawals'])
    expect(result.current.data.alerts).toHaveLength(1)
  })

  it('a failing consultations repository is reported as Consultations', async () => {
    consults.mockRejectedValue(new Error('boom'))
    const { result } = run()
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data.failed).toEqual(['Consultations'])
  })

  it('a non-array result counts as that source failing', async () => {
    callAdminAuth.mockImplementation(async (a) => (a === 'list_business_claims' ? {} : { data: [] }))
    consults.mockResolvedValue(null)
    const { result } = run()
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data.failed).toEqual(['Claims', 'Consultations'])
  })

  it('does not fetch when disabled', () => {
    run(false)
    expect(callAdminAuth).not.toHaveBeenCalled()
    expect(consults).not.toHaveBeenCalled()
  })
})
