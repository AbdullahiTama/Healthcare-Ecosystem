import { describe, it, expect } from 'vitest'
import { createGrowthRepository } from './index.js'
import { createInMemoryClient } from '../../../test/inMemoryClient.js'

function build(seed = {}) {
  const client = createInMemoryClient(seed)
  return { client, repo: createGrowthRepository({ request: client }) }
}

describe('growthRepository', () => {
  it('buildTree groups by state and parent', () => {
    const { repo } = build()
    const agents = [
      { id: '1', full_name: 'A', state: 'Lagos', tier: 'state_coordinator', parent_agent_id: null },
      { id: '2', full_name: 'B', state: 'Lagos', tier: 'community_coordinator', parent_agent_id: '1' },
      { id: '3', full_name: 'C', state: 'Lagos', tier: 'agent', parent_agent_id: '2' },
      { id: '4', full_name: 'D', state: 'Abuja', tier: 'agent', parent_agent_id: null },
    ]
    const tree = repo.buildTree(agents)
    expect(tree.find(t => t.state === 'Lagos').total).toBe(3)
    expect(tree.find(t => t.state === 'Abuja').total).toBe(1)
  })

  it('getCoverageGaps computes gap heuristic', async () => {
    const { repo } = build({
      agents: [{ id: 'a1', state: 'Lagos' }, { id: 'a2', state: 'Lagos' }],
      businesses: [{ state: 'Lagos' }, { state: 'Lagos' }, { state: 'Lagos' }, { state: 'Abuja' }],
    })
    const gaps = await repo.getCoverageGaps({ limit: 10 })
    const lagos = gaps.find(g => g.state === 'Lagos')
    expect(lagos.agents).toBe(2)
    expect(lagos.businesses).toBe(3)
  })

  it('generateReferralLink encodes', () => {
    const { repo } = build()
    expect(repo.generateReferralLink('CF-ABC', 'https://example.com')).toBe('https://example.com/register?ref=CF-ABC')
  })

  it('getPerformance fallback aggregates referrals and earnings', async () => {
    const { repo } = build({
      agents: [{ id: 'a1', full_name: 'A', state: 'Lagos', tier: 'agent', parent_agent_id: null }],
      agent_referrals: [{ agent_id: 'a1', business_id: 'biz-1' }, { agent_id: 'a1', business_id: 'biz-2' }],
      agent_earnings: [{ agent_id: 'a1', amount_owed: 1000, amount_paid: 500 }],
    })
    const perf = await repo.getPerformance({ limit: 10 })
    expect(perf[0].referrals).toBe(2)
    expect(perf[0].owed).toBe(1000)
  })

  it('getAgents catches and returns []', async () => {
    const repo = createGrowthRepository({ request: async () => { throw new Error('42501') } })
    expect(await repo.getAgents()).toEqual([])
  })
})
