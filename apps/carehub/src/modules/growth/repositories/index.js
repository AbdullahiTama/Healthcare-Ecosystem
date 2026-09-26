import { sbFetch } from '../../../services/supabase'

// ── Growth repository — Agents hierarchy + performance ─────────────────────
export function createGrowthRepository({ request = sbFetch } = {}) {
  return {
    async getAgents({ limit = 100 } = {}) {
      return request(`agents?select=*&order=created_at.desc&limit=${limit}`).catch(() => [])
    },
    async getAgentTiers() {
      return request('agent_tiers?select=*&order=created_at.asc').catch(() => [])
    },
    async getAgentReferrals(agentId) {
      return request(`agent_referrals?agent_id=eq.${agentId}&select=*`).catch(() => [])
    },
    async getAgentEarnings(agentId) {
      return request(`agent_earnings?agent_id=eq.${agentId}&select=*&order=created_at.desc`).catch(() => [])
    },
    async getPerformance({ limit = 100 } = {}) {
      // Try view agent_performance first, fallback to client aggregation if view missing
      try {
        const rows = await request(`agent_performance?select=*&limit=${limit}&order=referrals.desc`)
        if (Array.isArray(rows) && rows.length) return rows
      } catch {}
      // Fallback: aggregate from agents + referrals + earnings + payments (light)
      const agents = await this.getAgents({ limit })
      const results = []
      for (const a of (agents || [])) {
        const [referrals, earnings] = await Promise.all([
          this.getAgentReferrals(a.id).catch(() => []),
          this.getAgentEarnings(a.id).catch(() => []),
        ])
        const owed = (earnings || []).reduce((s, e) => s + Number(e.amount_owed || 0), 0)
        const paid = (earnings || []).reduce((s, e) => s + Number(e.amount_paid || 0), 0)
        results.push({
          id: a.id,
          full_name: a.full_name || a.name,
          state: a.state,
          tier: a.tier,
          parent_agent_id: a.parent_agent_id,
          referrals: referrals.length,
          converted: 0,
          owed,
          paid,
          last_earning_at: earnings[0]?.created_at || null,
        })
      }
      return results.sort((a, b) => b.referrals - a.referrals)
    },
    async getBusinessesByState({ limit = 200 } = {}) {
      return request(`businesses?select=state&limit=${limit}`).catch(() => [])
    },
    async getCoverageGaps({ limit = 200 } = {}) {
      const [agents, businesses] = await Promise.all([
        this.getAgents({ limit }),
        this.getBusinessesByState({ limit }),
      ])
      const agentByState = {}
      for (const a of (agents || [])) {
        const s = (a.state || '—').trim() || '—'
        agentByState[s] = (agentByState[s] || 0) + 1
      }
      const bizByState = {}
      for (const b of (businesses || [])) {
        const s = (b.state || '—').trim() || '—'
        bizByState[s] = (bizByState[s] || 0) + 1
      }
      const states = new Set([...Object.keys(agentByState), ...Object.keys(bizByState)])
      const rows = []
      for (const s of states) {
        const agentsCount = agentByState[s] || 0
        const bizCount = bizByState[s] || 0
        const gap = bizCount - agentsCount * 10 // heuristic: 1 agent per 10 businesses
        rows.push({ state: s, agents: agentsCount, businesses: bizCount, gap, gapLabel: gap > 20 ? 'thin' : gap > 0 ? 'watch' : 'covered' })
      }
      return rows.sort((a, b) => b.gap - a.gap)
    },
    generateReferralLink(referralCode, base) {
      const origin = base || (typeof window !== 'undefined' ? window.location.origin : 'https://carefindhub.com')
      return `${origin}/register?ref=${encodeURIComponent(referralCode)}`
    },
    // Build tree: state -> coordinator -> agents
    buildTree(agents) {
      const byState = {}
      for (const a of (agents || [])) {
        const state = a.state || '—'
        if (!byState[state]) byState[state] = []
        byState[state].push(a)
      }
      // For each state, group by parent
      const tree = []
      for (const [state, list] of Object.entries(byState)) {
        const coordinators = list.filter(x => x.tier === 'state_coordinator' || x.tier === 'community_coordinator')
        const agentsOnly = list.filter(x => !coordinators.find(c => c.id === x.id))
        const byParent = {}
        for (const ag of agentsOnly) {
          const pid = ag.parent_agent_id || '__root'
          if (!byParent[pid]) byParent[pid] = []
          byParent[pid].push(ag)
        }
        tree.push({ state, coordinators, byParent, total: list.length })
      }
      return tree.sort((a, b) => b.total - a.total)
    },
  }
}

export const growthRepository = createGrowthRepository()
