import { sbFetch } from '../../../services/supabase'

export function createComplianceRepository({ request = sbFetch } = {}) {
  return {
    async getRequests({ status, type, limit = 50 } = {}) {
      let q = `compliance_requests?order=requested_at.desc&limit=${limit}&select=*`
      if (status) q += `&status=eq.${encodeURIComponent(status)}`
      if (type) q += `&request_type=eq.${encodeURIComponent(type)}`
      return request(q).catch(() => [])
    },
    async createRequest(req) {
      if (!req.subject_id || !req.request_type || !req.reason) throw new Error('subject_id, request_type, reason required')
      return request('compliance_requests', { method: 'POST', body: JSON.stringify(req), prefer: 'return=representation' })
    },
    async updateRequest(id, patch) {
      return request(`compliance_requests?id=eq.${id}`, { method: 'PATCH', body: JSON.stringify(patch), prefer: 'return=minimal' })
    },
    async getAuditRetention({ days = 365 } = {}) {
      const since = new Date(Date.now() - days * 24 * 3600000).toISOString()
      const rows = await request(`admin_audit_log?created_at=gte.${encodeURIComponent(since)}&select=id&limit=1`).catch(() => [])
      // For MVP, just return count via support_tickets? Use audit count via head
      return { since, sample: rows }
    },
  }
}
export const complianceRepository = createComplianceRepository()
