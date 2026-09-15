import { describe, it, expect } from 'vitest'
import { createWalletRepository } from './index.js'
import { createInMemoryClient } from '../../../test/inMemoryClient.js'

const A = 'biz-A'
const B = 'biz-B'

function build(seed = {}) {
  const client = createInMemoryClient(seed)
  const repo = createWalletRepository({ request: client })
  return { client, repo }
}

describe('walletRepository', () => {
  it('getWallet returns only the calling tenant wallet', async () => {
    const { repo } = build({
      business_wallets: [
        { id: 'w1', business_id: A, available_balance: 50000 },
        { id: 'w2', business_id: B, available_balance: 90000 },
      ],
    })
    const rows = await repo.getWallet(A)
    expect(rows).toHaveLength(1)
    expect(rows[0].available_balance).toBe(50000)
  })

  it('getWallet returns empty when no wallet exists', async () => {
    const { repo } = build()
    const rows = await repo.getWallet(A)
    expect(rows).toEqual([])
  })

  it('getTransactions returns only the calling tenant transactions', async () => {
    const { repo } = build({
      business_wallet_transactions: [
        { id: 't1', business_id: A, type: 'booking_credit', amount: 10000 },
        { id: 't2', business_id: B, type: 'booking_credit', amount: 20000 },
      ],
    })
    const rows = await repo.getTransactions(A)
    expect(rows).toHaveLength(1)
    expect(rows[0].amount).toBe(10000)
  })

  it('getTransactions returns empty when no transactions exist', async () => {
    const { repo } = build()
    const rows = await repo.getTransactions(A)
    expect(rows).toEqual([])
  })

  it('getWithdrawals returns only the calling tenant withdrawals', async () => {
    const { repo } = build({
      business_withdrawal_requests: [
        { id: 'wd1', business_id: A, amount: 5000, status: 'pending' },
        { id: 'wd2', business_id: B, amount: 8000, status: 'completed' },
      ],
    })
    const rows = await repo.getWithdrawals(A)
    expect(rows).toHaveLength(1)
    expect(rows[0].amount).toBe(5000)
  })

  it('getWithdrawals returns empty when no withdrawals exist', async () => {
    const { repo } = build()
    const rows = await repo.getWithdrawals(A)
    expect(rows).toEqual([])
  })
})
