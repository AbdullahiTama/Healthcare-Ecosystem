import { describe, it, expect } from 'vitest'
import { createWalletRepository } from './index.js'
import { mockSupabaseClient } from '../../../test/mockSupabase.js'

const USER_A = 'user-a'
const USER_B = 'user-b'

function build(seed = {}) {
  const client = mockSupabaseClient(seed)
  const repo = createWalletRepository({ client })
  return { client, repo }
}

describe('walletRepository', () => {
  describe('getBalance', () => {
    it('returns balance for the specified user', async () => {
      const { repo } = build({
        wallets: [
          { id: 'w1', user_id: USER_A, balance: 500 },
          { id: 'w2', user_id: USER_B, balance: 900 },
        ],
      })
      const result = await repo.getBalance(USER_A)
      expect(result).toMatchObject({ balance: 500 })
    })

    it('returns null when no wallet exists', async () => {
      const { repo } = build()
      const result = await repo.getBalance(USER_A)
      expect(result).toBeNull()
    })
  })

  describe('getWallet', () => {
    it('returns full wallet row for the specified user', async () => {
      const { repo } = build({
        wallets: [
          { id: 'w1', user_id: USER_A, balance: 500, created_at: '2026-01-01' },
        ],
      })
      const result = await repo.getWallet(USER_A)
      expect(result).toMatchObject({ id: 'w1', user_id: USER_A, balance: 500 })
    })

    it('returns null when no wallet exists', async () => {
      const { repo } = build()
      const result = await repo.getWallet(USER_A)
      expect(result).toBeNull()
    })
  })

  describe('ensureWallet', () => {
    it('returns existing wallet when one exists', async () => {
      const { repo, client } = build({
        wallets: [{ id: 'w1', user_id: USER_A, balance: 100 }],
      })
      const result = await repo.ensureWallet(USER_A)
      expect(result).toMatchObject({ id: 'w1', balance: 100 })
      expect(client._rows('wallets')).toHaveLength(1)
    })

    it('creates a new wallet when none exists', async () => {
      const { repo, client } = build()
      const result = await repo.ensureWallet(USER_A)
      expect(result).toMatchObject({ user_id: USER_A, balance: 0 })
      expect(client._rows('wallets')).toHaveLength(1)
    })
  })

  describe('getTransactions', () => {
    it('returns transactions for the specified user ordered by created_at desc', async () => {
      const { repo } = build({
        transactions: [
          { id: 't1', user_id: USER_A, type: 'topup', amount: 100, created_at: '2026-01-03' },
          { id: 't2', user_id: USER_A, type: 'gift_sent', amount: 50, created_at: '2026-01-01' },
          { id: 't3', user_id: USER_B, type: 'topup', amount: 200, created_at: '2026-01-02' },
        ],
      })
      const result = await repo.getTransactions(USER_A)
      expect(result).toHaveLength(2)
      expect(result[0].type).toBe('topup')
      expect(result[1].type).toBe('gift_sent')
    })

    it('returns empty array when no transactions exist', async () => {
      const { repo } = build()
      const result = await repo.getTransactions(USER_A)
      expect(result).toEqual([])
    })

    it('respects limit parameter', async () => {
      const { repo } = build({
        transactions: [
          { id: 't1', user_id: USER_A, type: 'topup', amount: 100, created_at: '2026-01-01' },
          { id: 't2', user_id: USER_A, type: 'topup', amount: 200, created_at: '2026-01-02' },
          { id: 't3', user_id: USER_A, type: 'topup', amount: 300, created_at: '2026-01-03' },
        ],
      })
      const result = await repo.getTransactions(USER_A, 2)
      expect(result).toHaveLength(2)
    })
  })
})
