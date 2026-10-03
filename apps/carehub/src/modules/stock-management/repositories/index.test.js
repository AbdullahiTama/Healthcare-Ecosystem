import { describe, it, expect, vi } from 'vitest'
import { createStockValidationRepository, stockValidationRepository } from './index.js'

const BIZ = 'biz-1'
const USER = 'user-1'

function recording(returns = []) {
  const calls = []
  const request = vi.fn(async (path, options) => {
    calls.push({ path, method: options?.method, body: options?.body ? JSON.parse(options.body) : null })
    if (typeof returns === 'function') return returns(calls.length - 1, calls)
    return returns
  })
  const repo = createStockValidationRepository(request)
  return { calls, request, repo }
}

const session = {
  user_name: 'Ada Lovelace',
  products_checked: 12,
  products_adjusted: 3,
}

const items = [
  { product_id: 'p1', expected: 100, counted: 98, adjustment: -2, reason: 'Damaged' },
  { product_id: 'p2', expected: 50, counted: 50, adjustment: 0, reason: null },
  { product_id: 'p3', expected: 25, counted: 27, adjustment: 2, reason: 'Found in storage' },
]

describe('stockValidationRepository', () => {
  describe('saveSession', () => {
    it('calls the save_stock_validation_session RPC with correct parameters', async () => {
      const { calls, repo } = recording('session-uuid-123')
      const result = await repo.saveSession(BIZ, session, items, USER)

      expect(calls).toHaveLength(1)
      expect(calls[0].path).toBe('rpc/save_stock_validation_session')
      expect(calls[0].method).toBe('POST')
      expect(calls[0].body).toEqual({
        p_business_id: BIZ,
        p_user_id: USER,
        p_user_name: session.user_name,
        p_products_checked: session.products_checked,
        p_products_adjusted: session.products_adjusted,
        p_items: items,
      })
    })

    it('returns sessionId and itemsCount', async () => {
      const { repo } = recording('session-uuid-123')
      const result = await repo.saveSession(BIZ, session, items, USER)

      expect(result).toEqual({ sessionId: 'session-uuid-123', itemsCount: 3 })
    })

    it('returns itemsCount of 0 for an empty items array', async () => {
      const { repo } = recording('session-uuid-456')
      const result = await repo.saveSession(BIZ, session, [], USER)

      expect(result).toEqual({ sessionId: 'session-uuid-456', itemsCount: 0 })
    })

    it('forwards the raw RPC return value as sessionId', async () => {
      const { repo } = recording(42)
      const result = await repo.saveSession(BIZ, session, items, USER)

      expect(result.sessionId).toBe(42)
    })
  })

  describe('getSessions', () => {
    it('fetches sessions ordered by created_at desc for the given business', async () => {
      const mockSessions = [
        { id: 's2', business_id: BIZ, created_at: '2026-09-01T10:00:00Z' },
        { id: 's1', business_id: BIZ, created_at: '2026-08-31T10:00:00Z' },
      ]
      const { calls, repo } = recording(mockSessions)
      const result = await repo.getSessions(BIZ)

      expect(calls).toHaveLength(1)
      expect(calls[0].path).toBe(
        `stock_validation_sessions?business_id=eq.${BIZ}&order=created_at.desc&select=*`
      )
      expect(calls[0].method).toBeUndefined()
      expect(result).toEqual(mockSessions)
    })

    it('returns an empty array when no sessions exist', async () => {
      const { repo } = recording([])
      const result = await repo.getSessions(BIZ)

      expect(result).toEqual([])
    })
  })

  describe('getSessionById', () => {
    it('fetches a session with its items', async () => {
      const mockSession = { id: 's1', business_id: BIZ, user_name: 'Ada' }
      const mockItems = [
        { id: 'i1', session_id: 's1', product_id: 'p1' },
        { id: 'i2', session_id: 's1', product_id: 'p2' },
      ]

      let callIndex = 0
      const { calls, repo } = recording((idx) => {
        callIndex++
        if (callIndex === 1) return [mockSession]
        return mockItems
      })

      const result = await repo.getSessionById('s1', BIZ)

      expect(calls).toHaveLength(2)
      expect(calls[0].path).toBe(
        `stock_validation_sessions?id=eq.s1&business_id=eq.${BIZ}&select=*`
      )
      expect(calls[1].path).toBe(
        `stock_validation_items?session_id=eq.s1&order=created_at.asc&select=*`
      )
      expect(result).toEqual({ ...mockSession, items: mockItems })
    })

    it('returns null when the session does not exist', async () => {
      const { calls, repo } = recording([])
      const result = await repo.getSessionById('nonexistent', BIZ)

      expect(calls).toHaveLength(1)
      expect(result).toBeNull()
    })

    it('scopes the session lookup by both id and business_id', async () => {
      const { calls, repo } = recording([])
      await repo.getSessionById('s1', BIZ)

      expect(calls[0].path).toContain('id=eq.s1')
      expect(calls[0].path).toContain(`business_id=eq.${BIZ}`)
    })

    it('returns an empty items array when the session has no items', async () => {
      const mockSession = { id: 's1', business_id: BIZ, user_name: 'Ada' }
      let callIndex = 0
      const { repo } = recording((idx) => {
        callIndex++
        if (callIndex === 1) return [mockSession]
        return []
      })

      const result = await repo.getSessionById('s1', BIZ)

      expect(result).toEqual({ ...mockSession, items: [] })
    })
  })

  describe('default export', () => {
    it('exports a stockValidationRepository instance with all methods', () => {
      expect(typeof stockValidationRepository.saveSession).toBe('function')
      expect(typeof stockValidationRepository.getSessions).toBe('function')
      expect(typeof stockValidationRepository.getSessionById).toBe('function')
    })
  })
})
