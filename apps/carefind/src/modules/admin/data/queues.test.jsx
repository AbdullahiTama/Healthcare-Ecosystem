import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'

const { callAdminAuth } = vi.hoisted(() => ({ callAdminAuth: vi.fn() }))
vi.mock('../adminApi', () => ({ callAdminAuth, SESSION_EXPIRED_EVENT: 'admin:session-expired' }))

import { renderAdmin } from '../test/renderAdmin.jsx'
import { usePendingCounts, useQueue, QUEUES } from './queues'

function Counts() {
  const { counts, total, failed } = usePendingCounts()
  return <pre data-testid="out">{JSON.stringify({ counts, total, failed })}</pre>
}
function List({ name }) {
  const { data = [], isError } = useQueue(name)
  return <div>{isError ? 'ERR' : `rows:${data.length}`}</div>
}
const read = () => JSON.parse(screen.getByTestId('out').textContent)

const lists = {
  list_verification_requests: [{ id: 'v1', status: 'pending' }, { id: 'v2', status: 'approved' }],
  list_business_claims: [{ id: 'c1', status: 'pending' }],
  list_reports: [{ id: 'r1', status: 'pending' }, { id: 'r2', status: 'pending' }],
  list_news: [{ id: 'n1', status: 'rejected' }],
  list_withdrawal_requests: [{ id: 'w1', status: 'reserved' }, { id: 'w2', status: 'processing' }, { id: 'w3', status: 'completed' }],
}

describe('queues', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    callAdminAuth.mockImplementation(async (action) => ({ data: lists[action] || [] }))
  })

  it('counts pending items per queue, with withdrawals pending while reserved or processing', async () => {
    renderAdmin(<Counts />)
    await waitFor(() => expect(read().counts.withdrawals).toBe(2))
    expect(read()).toEqual({
      counts: { verifications: 1, claims: 1, reports: 2, news: 0, withdrawals: 2, queue: 3 },
      total: 6,
      failed: false,
    })
  })

  it('hides only the failed queue and flags the counts as incomplete', async () => {
    callAdminAuth.mockImplementation(async (action) => {
      if (action === 'list_reports') throw new Error('boom')
      return { data: lists[action] || [] }
    })
    renderAdmin(<Counts />)
    await waitFor(() => expect(read().failed).toBe(true))
    expect(read().counts.reports).toBeNull()
    expect(read().counts.queue).toBeNull()
    expect(read().counts.verifications).toBe(1)
    expect(read().total).toBe(4)
  })

  it('does not fetch queues the admin may not see', async () => {
    renderAdmin(<Counts />, { admin: { id: 'm', role: 'moderator' }, permissions: { withdrawals: false, claims: false } })
    await waitFor(() => expect(read().counts.reports).toBe(2))
    expect(callAdminAuth).not.toHaveBeenCalledWith('list_withdrawal_requests', expect.anything())
    expect(callAdminAuth).not.toHaveBeenCalledWith('list_business_claims', expect.anything())
    expect(read().counts.withdrawals).toBeNull()
  })

  it('shares one request between a list and the counts', async () => {
    renderAdmin(<><Counts /><List name="reports" /></>)
    expect(await screen.findByText('rows:2')).toBeInTheDocument()
    expect(callAdminAuth.mock.calls.filter(c => c[0] === 'list_reports')).toHaveLength(1)
  })

  it('surfaces a list failure as an error, not an empty list', async () => {
    callAdminAuth.mockRejectedValue(new Error('down'))
    renderAdmin(<List name="claims" />)
    expect(await screen.findByText('ERR')).toBeInTheDocument()
  })

  it('treats a missing data field as an empty list', async () => {
    callAdminAuth.mockResolvedValue({})
    renderAdmin(<List name="claims" />)
    expect(await screen.findByText('rows:0')).toBeInTheDocument()
  })

  it('declares a permission for every queue', () => {
    Object.values(QUEUES).forEach(q => expect(typeof q.permission).toBe('string'))
  })
})
