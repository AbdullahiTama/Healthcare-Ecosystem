import { describe, it, expect } from 'vitest'
import { createAgentDashboardRepository } from './index.js'
import { createInMemoryClient } from '../../../test/inMemoryClient.js'

const AGENT_ID = 'agent-1'
const OTHER_AGENT = 'agent-2'

function build(seed = {}) {
  const client = createInMemoryClient(seed)
  const repo = createAgentDashboardRepository({ request: client })
  return { client, repo }
}

describe('agentDashboardRepository', () => {
  describe('getAgentPortfolio', () => {
    it('calls the get_agent_portfolio RPC and returns results', async () => {
      const client = createInMemoryClient()
      let calledPath = null
      const trackingRequest = async (path, options) => {
        calledPath = path
        return [{ id: 'biz-1', name: 'Test Clinic' }]
      }
      const repo = createAgentDashboardRepository({ request: trackingRequest })
      const rows = await repo.getAgentPortfolio()
      expect(calledPath).toBe('rpc/get_agent_portfolio')
      expect(rows).toHaveLength(1)
      expect(rows[0].name).toBe('Test Clinic')
    })
  })

  describe('getAgentCommissions', () => {
    it('returns only the calling agent commissions', async () => {
      const { repo } = build({
        commissions: [
          { id: 'c1', agent_id: AGENT_ID, amount: 5000, type: 'referral_bonus' },
          { id: 'c2', agent_id: OTHER_AGENT, amount: 8000, type: 'residual' },
        ],
      })
      const rows = await repo.getAgentCommissions(AGENT_ID)
      expect(rows).toHaveLength(1)
      expect(rows[0].amount).toBe(5000)
    })

    it('returns empty when no commissions exist', async () => {
      const { repo } = build()
      const rows = await repo.getAgentCommissions(AGENT_ID)
      expect(rows).toEqual([])
    })
  })

  describe('getAgentPayouts', () => {
    it('returns only the calling agent payouts', async () => {
      const { repo } = build({
        payouts: [
          { id: 'p1', agent_id: AGENT_ID, total_amount: 15000, status: 'processed' },
          { id: 'p2', agent_id: OTHER_AGENT, total_amount: 20000, status: 'processed' },
        ],
      })
      const rows = await repo.getAgentPayouts(AGENT_ID)
      expect(rows).toHaveLength(1)
      expect(rows[0].total_amount).toBe(15000)
    })

    it('returns empty when no payouts exist', async () => {
      const { repo } = build()
      const rows = await repo.getAgentPayouts(AGENT_ID)
      expect(rows).toEqual([])
    })
  })

  describe('getAgentSupportLogs', () => {
    it('returns only the calling agent support logs', async () => {
      const { repo } = build({
        agent_support_logs: [
          { id: 's1', agent_id: AGENT_ID, kind: 'followup', details: 'Called clinic' },
          { id: 's2', agent_id: OTHER_AGENT, kind: 'training', details: 'Training session' },
        ],
      })
      const rows = await repo.getAgentSupportLogs(AGENT_ID)
      expect(rows).toHaveLength(1)
      expect(rows[0].details).toBe('Called clinic')
    })

    it('returns empty when no logs exist', async () => {
      const { repo } = build()
      const rows = await repo.getAgentSupportLogs(AGENT_ID)
      expect(rows).toEqual([])
    })
  })

  describe('addAgentSupportLog', () => {
    it('inserts a support log row', async () => {
      const { repo, client } = build()
      await repo.addAgentSupportLog({
        agent_id: AGENT_ID,
        business_id: 'biz-1',
        kind: 'followup',
        details: 'Checked on onboarding progress',
      })
      const rows = client.rows('agent_support_logs')
      expect(rows).toHaveLength(1)
      expect(rows[0].agent_id).toBe(AGENT_ID)
      expect(rows[0].kind).toBe('followup')
      expect(rows[0].details).toBe('Checked on onboarding progress')
    })
  })
})
