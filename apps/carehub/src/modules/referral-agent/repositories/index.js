import { sbFetch } from '../../../services/supabase'

export function createAgentDashboardRepository({ request = sbFetch } = {}) {
  return {
    async getAgentPortfolio() {
      return request('rpc/get_agent_portfolio', { method: 'POST' })
    },

    async getAgentCommissions(agentId) {
      return request(`commissions?agent_id=eq.${agentId}&order=created_at.desc&select=*`)
    },

    async getAgentPayouts(agentId) {
      return request(`payouts?agent_id=eq.${agentId}&order=created_at.desc&select=*`)
    },

    async getAgentSupportLogs(agentId) {
      return request(`agent_support_logs?agent_id=eq.${agentId}&order=created_at.desc&select=*`)
    },

    async addAgentSupportLog(data) {
      return request('agent_support_logs', {
        method: 'POST',
        body: JSON.stringify(data),
      })
    },
  }
}

export const agentDashboardRepository = createAgentDashboardRepository()
