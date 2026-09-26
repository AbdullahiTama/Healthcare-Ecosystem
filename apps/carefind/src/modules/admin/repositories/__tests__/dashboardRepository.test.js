import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createDashboardRepository } from '../dashboardRepository.js'

function createFakeTransport() {
  const calls = { api: [], query: [] }

  return {
    calls,
    apiResponses: {},
    queryResponses: {},

    async api(action, payload) {
      calls.api.push({ action, payload })
      if (calls.apiResponses?.[action]) return calls.apiResponses[action]
      const handler = this.apiResponses[action]
      if (handler) return typeof handler === 'function' ? handler(payload) : handler
      return { data: [] }
    },

    async query(table, opts) {
      calls.query.push({ table, opts })
      const handler = this.queryResponses[table]
      if (handler) return typeof handler === 'function' ? handler(opts) : handler
      return { data: [], count: 0 }
    },
  }
}

describe('dashboardRepository', () => {
  let transport
  let repo

  beforeEach(() => {
    transport = createFakeTransport()
    transport.apiResponses = {
      list_verification_requests: { data: [] },
      list_business_claims: { data: [] },
      list_reports: { data: [] },
      list_transactions: { data: [] },
      list_news: { data: [] },
      list_withdrawal_requests: { data: [] },
      list_task_submissions: { data: [] },
    }
    transport.queryResponses = {
      profiles: { data: [], count: 42 },
      posts: { data: [{ id: 1 }, { id: 2 }, { id: 3 }] },
      live_shows: { data: [{ id: 's1' }, { id: 's2' }] },
      professional_consultations: { data: [] },
    }
    repo = createDashboardRepository(transport)
  })

  describe('getStats', () => {
    it('calls the right transport methods', async () => {
      await repo.getStats()

      const queryTables = transport.calls.query.map(c => c.table)
      expect(queryTables).toContain('profiles')
      expect(queryTables).toContain('posts')

      const apiActions = transport.calls.api.map(c => c.action)
      expect(apiActions).toContain('list_verification_requests')
      expect(apiActions).toContain('list_business_claims')
      expect(apiActions).toContain('list_reports')
      expect(apiActions).toContain('list_transactions')
      expect(apiActions).toContain('list_news')
    })

    it('returns the correct shape', async () => {
      transport.queryResponses.profiles = { data: [], count: 100 }
      transport.queryResponses.posts = { data: Array(5).fill({ id: 1 }) }
      transport.apiResponses.list_verification_requests = {
        data: [
          { status: 'pending', type: 'topup', naira_amount: 5000 },
          { status: 'approved', type: 'topup', naira_amount: 3000 },
        ],
      }
      transport.apiResponses.list_business_claims = {
        data: [{ status: 'pending' }, { status: 'approved' }],
      }
      transport.apiResponses.list_reports = {
        data: [{ status: 'pending' }, { status: 'resolved' }],
      }
      transport.apiResponses.list_transactions = {
        data: [{ id: 1 }, { id: 2 }],
      }
      transport.apiResponses.list_news = {
        data: [{ status: 'pending' }],
      }

      const stats = await repo.getStats()

      expect(stats).toEqual({
        users: 100,
        posts: 5,
        pendingVerifs: 1,
        pendingClaims: 1,
        reports: 1,
        revenue: 80,
        transactions: 2,
        pendingNews: 1,
      })
    })

    it('computes revenue from topup transactions', async () => {
      transport.apiResponses.list_verification_requests = {
        data: [
          { type: 'topup', naira_amount: 10000, status: 'pending' },
          { type: 'topup', naira_amount: 5000, status: 'pending' },
          { type: 'withdrawal', naira_amount: 3000, status: 'pending' },
        ],
      }

      const stats = await repo.getStats()
      expect(stats.revenue).toBe(150)
    })
  })

  describe('getHealthPulse', () => {
    it('returns the right shape', async () => {
      const today = new Date().toISOString().slice(0, 10)
      transport.apiResponses.list_transactions = {
        data: [
          { type: 'topup', naira_amount: 2000, created_at: `${today}T10:00:00Z` },
          { type: 'topup', naira_amount: 3000, created_at: `${today}T12:00:00Z` },
          { type: 'withdrawal', naira_amount: 1000, created_at: `${today}T08:00:00Z` },
        ],
      }
      transport.apiResponses.list_verification_requests = {
        data: [{ status: 'pending' }, { status: 'approved' }],
      }
      transport.apiResponses.list_business_claims = {
        data: [{ status: 'pending' }],
      }
      transport.apiResponses.list_reports = {
        data: [{ status: 'pending' }, { status: 'pending' }, { status: 'resolved' }],
      }
      transport.apiResponses.list_withdrawal_requests = {
        data: [{ status: 'pending' }],
      }
      transport.queryResponses.live_shows = { data: [{ id: 1 }, { id: 2 }, { id: 3 }] }

      const pulse = await repo.getHealthPulse()

      expect(pulse).toHaveProperty('revenueToday')
      expect(pulse).toHaveProperty('pendingItems')
      expect(pulse).toHaveProperty('activeLives')
      expect(pulse).toHaveProperty('openDisputes')
      expect(pulse.revenueToday).toBe(50)
      expect(pulse.activeLives).toBe(3)
      expect(pulse.openDisputes).toBe(2)
      expect(pulse.pendingItems).toBe(5)
    })

    it('calls the right transport methods', async () => {
      await repo.getHealthPulse()

      const apiActions = transport.calls.api.map(c => c.action)
      expect(apiActions).toContain('list_transactions')
      expect(apiActions).toContain('list_verification_requests')
      expect(apiActions).toContain('list_business_claims')
      expect(apiActions).toContain('list_reports')
      expect(apiActions).toContain('list_withdrawal_requests')

      const queryTables = transport.calls.query.map(c => c.table)
      expect(queryTables).toContain('live_shows')
    })
  })

  describe('getNotifications', () => {
    it('returns sorted notifications (newest first)', async () => {
      const older = '2025-01-01T10:00:00Z'
      const newer = '2025-06-15T14:00:00Z'

      transport.apiResponses.list_verification_requests = {
        data: [{ id: 'v1', status: 'pending', full_name: 'Dr Ada', profession: 'Doctor', created_at: older }],
      }
      transport.apiResponses.list_reports = {
        data: [{ id: 'r1', status: 'pending', reason: 'spam', created_at: newer, posts: { content: 'reported post content' } }],
      }
      transport.apiResponses.list_business_claims = { data: [] }
      transport.apiResponses.list_withdrawal_requests = { data: [] }
      transport.apiResponses.list_task_submissions = { data: [] }
      transport.apiResponses.list_news = { data: [] }
      transport.queryResponses.professional_consultations = { data: [] }

      const notifications = await repo.getNotifications()

      expect(notifications.length).toBe(2)
      expect(notifications[0].id).toBe('r1')
      expect(notifications[1].id).toBe('v1')
    })

    it('returns notifications with the right shape', async () => {
      transport.apiResponses.list_verification_requests = {
        data: [{ id: 'v1', status: 'pending', full_name: 'Dr Ada', profession: 'Doctor', created_at: '2025-01-01T10:00:00Z' }],
      }
      transport.apiResponses.list_business_claims = { data: [] }
      transport.apiResponses.list_reports = { data: [] }
      transport.apiResponses.list_withdrawal_requests = { data: [] }
      transport.apiResponses.list_task_submissions = { data: [] }
      transport.apiResponses.list_news = { data: [] }
      transport.queryResponses.professional_consultations = { data: [] }

      const notifications = await repo.getNotifications()

      expect(notifications.length).toBe(1)
      const n = notifications[0]
      expect(n).toHaveProperty('id', 'v1')
      expect(n).toHaveProperty('type', 'verification')
      expect(n).toHaveProperty('icon')
      expect(n).toHaveProperty('title')
      expect(n).toHaveProperty('time')
      expect(n).toHaveProperty('severity')
      expect(n).toHaveProperty('tab')
      expect(n).toHaveProperty('role')
    })

    it('calls the right transport methods', async () => {
      await repo.getNotifications()

      const apiActions = transport.calls.api.map(c => c.action)
      expect(apiActions).toContain('list_verification_requests')
      expect(apiActions).toContain('list_business_claims')
      expect(apiActions).toContain('list_reports')
      expect(apiActions).toContain('list_withdrawal_requests')
      expect(apiActions).toContain('list_task_submissions')
      expect(apiActions).toContain('list_news')

      const queryTables = transport.calls.query.map(c => c.table)
      expect(queryTables).toContain('professional_consultations')
    })

    it('filters out non-pending items', async () => {
      transport.apiResponses.list_verification_requests = {
        data: [
          { id: 'v1', status: 'pending', full_name: 'Dr Ada', profession: 'Doc', created_at: '2025-01-01T10:00:00Z' },
          { id: 'v2', status: 'approved', full_name: 'Dr Bo', profession: 'Doc', created_at: '2025-01-02T10:00:00Z' },
        ],
      }
      transport.apiResponses.list_business_claims = { data: [] }
      transport.apiResponses.list_reports = { data: [] }
      transport.apiResponses.list_withdrawal_requests = { data: [] }
      transport.apiResponses.list_task_submissions = { data: [] }
      transport.apiResponses.list_news = { data: [] }
      transport.queryResponses.professional_consultations = { data: [] }

      const notifications = await repo.getNotifications()
      expect(notifications.length).toBe(1)
      expect(notifications[0].id).toBe('v1')
    })
  })
})
