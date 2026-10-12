import { describe, it, expect, vi, beforeEach } from 'vitest'

const callAdminAuth = vi.hoisted(() => vi.fn())
vi.mock('../adminApi', () => ({ callAdminAuth }))

import { loadFinance, TRANSACTION_CAP } from './useFinanceData'

beforeEach(() => { callAdminAuth.mockReset() })

describe('loadFinance', () => {
  it('settles each source on its own', async () => {
    callAdminAuth.mockImplementation(async (action) => {
      if (action === 'list_transactions') throw new Error('boom')
      if (action === 'list_withdrawal_requests') return { data: [{ id: 'w1' }] }
    })
    const r = await loadFinance()
    expect(r.transactions).toEqual({ status: 'error' })
    expect(r.withdrawals).toEqual({ status: 'ok', data: [{ id: 'w1' }] })
  })

  it('treats a response without a list as an error, never an empty list', async () => {
    callAdminAuth.mockResolvedValue({})
    const r = await loadFinance()
    expect(r.transactions.status).toBe('error')
    expect(r.withdrawals.status).toBe('error')
  })

  it('calls the two list actions with no payload', async () => {
    callAdminAuth.mockResolvedValue({ data: [] })
    await loadFinance()
    expect(callAdminAuth).toHaveBeenCalledWith('list_transactions')
    expect(callAdminAuth).toHaveBeenCalledWith('list_withdrawal_requests')
  })

  it('exposes the server cap for transactions', () => expect(TRANSACTION_CAP).toBe(50))
})
