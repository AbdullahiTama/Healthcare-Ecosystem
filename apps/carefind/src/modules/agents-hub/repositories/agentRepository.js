import { supabase } from '../../../config/supabaseClient'

function createAgentRepository({ client = supabase } = {}) {
  return {
    async fetchPendingAgents() {
      const { data, error } = await client
        .from('agents')
        .select('id, full_name, email, state, tier, status, referral_code, parent_agent_id, commission_pct, created_at')
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
        .limit(50)
      if (error) throw error
      return Array.isArray(data) ? data : []
    },

    async fetchPotentialParents() {
      const { data, error } = await client
        .from('agents')
        .select('id, full_name, email, tier, state, referral_code, commission_pct')
        .eq('status', 'approved')
        .order('created_at', { ascending: false })
        .limit(100)
      if (error) throw error
      return Array.isArray(data) ? data : []
    },

    async fetchChildrenCounts() {
      const { data, error } = await client
        .from('agents')
        .select('id, parent_agent_id')
      if (error) return {}
      const counts = {}
      ;(Array.isArray(data) ? data : []).forEach((r) => {
        if (r.parent_agent_id) counts[r.parent_agent_id] = (counts[r.parent_agent_id] || 0) + 1
      })
      return counts
    },

    async approveAgent({ agentId, tier, parentAgentId, commissionPct }) {
      const TIER_DEFAULT_PCT = { agent: 10, community_coordinator: 5, state_coordinator: 3, unplaced: 0 }
      const pctForTier = (tier) => TIER_DEFAULT_PCT[tier] ?? 10
      const pct = commissionPct != null && commissionPct !== '' ? Number(commissionPct) : pctForTier(tier)
      const payload = {
        tier,
        parent_agent_id: parentAgentId || null,
        commission_pct: pct,
        status: 'approved',
      }
      const { data, error } = await client
        .from('agents')
        .update(payload)
        .eq('id', agentId)
        .select('id, tier, parent_agent_id, commission_pct, status')
        .single()
      if (error) throw error
      return data
    },

    async fetchEarnings({ agentId = null, limit = 100 } = {}) {
      let q = client
        .from('agent_earnings')
        .select('id, agent_id, business_id, amount_owed, amount_paid, commission_pct, plan_value, payment_reference, status, payout_period, created_at, paid_at')
        .order('created_at', { ascending: false })
        .limit(limit)
      if (agentId) q = q.eq('agent_id', agentId)
      const { data, error } = await q
      if (error) throw error
      return Array.isArray(data) ? data : []
    },

    async fetchAgentsMap() {
      const { data, error } = await client
        .from('agents')
        .select('id, full_name, email, referral_code, tier')
        .limit(200)
      if (error) return {}
      const map = {}
      ;(Array.isArray(data) ? data : []).forEach((a) => { map[a.id] = a })
      return map
    },

    async registerAgent({ full_name, email, password, state }) {
      const payload = {
        full_name: full_name.trim(),
        email: email.trim().toLowerCase(),
        password_hash: `cf_agent_${password}`,
        tier: 'unplaced',
        status: 'pending',
        state: state || null,
        commission_pct: null,
      }
      const { data, error } = await client
        .from('agents')
        .insert(payload)
        .select('id, full_name, email, referral_code, tier, status, state, commission_pct, created_at')
        .single()
      if (error) throw error
      return data
    },

    async findAgentByReferralCode(referralCode) {
      const code = String(referralCode).trim().toUpperCase()
      if (!code) return null
      const { data, error } = await client
        .from('agents')
        .select('id, referral_code, status')
        .eq('referral_code', code)
        .maybeSingle()
      if (error) throw error
      return data
    },

    async recordBusinessReferral({ agentId, businessId, referralCode }) {
      const { data, error } = await client
        .from('agent_referrals')
        .insert({ agent_id: agentId, business_id: businessId, referral_code: referralCode })
        .select('id, agent_id, business_id')
        .single()
      if (error) {
        if (error.code === '23505' || /duplicate|unique/i.test(error.message)) {
          return null
        }
        throw error
      }
      return data
    },

    async fetchAgents() {
      const { data, error } = await client
        .from('agents')
        .select('id, full_name, email, referral_code, tier, state, status')
        .order('created_at', { ascending: false })
        .limit(200)
      if (error) throw error
      return Array.isArray(data) ? data : []
    },

    async fetchReferralsForAgent(agentId) {
      if (!agentId) return []
      const { data, error } = await client
        .from('agent_referrals')
        .select('id, agent_id, business_id, referral_code, created_at')
        .eq('agent_id', agentId)
        .order('created_at', { ascending: false })
        .limit(100)
      if (error) throw error
      return Array.isArray(data) ? data : []
    },

    async transferReferralsByReferralId({ fromAgentId, toAgentId, agentReferralId }) {
      const { error } = await client
        .from('agent_referrals')
        .update({ agent_id: toAgentId })
        .eq('id', agentReferralId)
        .eq('agent_id', fromAgentId)
      if (error) throw error
    },

    async transferReferralsByBusinessId({ fromAgentId, toAgentId, businessId }) {
      const { error } = await client
        .from('agent_referrals')
        .update({ agent_id: toAgentId })
        .eq('business_id', businessId)
        .eq('agent_id', fromAgentId)
      if (error) throw error
    },

    async transferAllReferrals({ fromAgentId, toAgentId }) {
      const { error } = await client
        .from('agent_referrals')
        .update({ agent_id: toAgentId })
        .eq('agent_id', fromAgentId)
      if (error) throw error
    },

    async transferEarningsByBusinessId({ fromAgentId, toAgentId, businessId }) {
      const { error } = await client
        .from('agent_earnings')
        .update({ agent_id: toAgentId })
        .eq('business_id', businessId)
        .eq('agent_id', fromAgentId)
      if (error) throw error
    },

    async transferAllEarnings({ fromAgentId, toAgentId }) {
      const { error } = await client
        .from('agent_earnings')
        .update({ agent_id: toAgentId })
        .eq('agent_id', fromAgentId)
      if (error) throw error
    },

    async insertTransferAudit({ agentReferralId, businessId, fromAgentId, toAgentId, byAdminId, reason }) {
      const audit = {
        agent_referral_id: agentReferralId || null,
        business_id: businessId || null,
        from_agent_id: fromAgentId,
        to_agent_id: toAgentId,
        by_admin_id: byAdminId || null,
        reason: reason || null,
      }
      const { data, error } = await client
        .from('agent_transfers')
        .insert(audit)
        .select('id, from_agent_id, to_agent_id, business_id, created_at')
        .single()
      if (error) throw error
      return data
    },

    async calculateAgentEarnings({ businessId, planValue, paymentReference }) {
      const p_plan_value = Number(planValue)
      if (!Number.isFinite(p_plan_value) || p_plan_value <= 0) throw new Error('planValue must be > 0')
      const { data, error } = await client.rpc('calculate_agent_earnings', {
        p_business_id: businessId,
        p_plan_value: p_plan_value,
        p_payment_reference: paymentReference,
      })
      if (error) throw error
      return data
    },
  }
}

export const agentRepository = createAgentRepository()
export { createAgentRepository }