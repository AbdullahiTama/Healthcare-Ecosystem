import { sbFetch } from '../../../services/supabase'

export function createOpsRepository({ request = sbFetch } = {}) {
  return {
    async getTickets({ status, priority, assignee, search, limit = 50 } = {}) {
      let q = `support_tickets?order=created_at.desc&limit=${limit}&select=*`
      if (status) q += `&status=eq.${encodeURIComponent(status)}`
      if (priority) q += `&priority=eq.${encodeURIComponent(priority)}`
      if (assignee) q += `&assignee_admin_id=eq.${assignee}`
      if (search) q += `&subject=ilike.*${encodeURIComponent(search)}*`
      return request(q).catch(() => [])
    },
    async createTicket(ticket) {
      if (!ticket.subject || !ticket.body) throw new Error('subject and body required')
      const sla = ticket.sla_due_at || new Date(Date.now() + (ticket.priority === 'urgent' ? 4 : ticket.priority === 'high' ? 24 : 48) * 3600000).toISOString()
      return request('support_tickets', { method: 'POST', body: JSON.stringify({ ...ticket, sla_due_at: sla }), prefer: 'return=representation' })
    },
    async updateTicket(id, patch) {
      return request(`support_tickets?id=eq.${id}`, { method: 'PATCH', body: JSON.stringify(patch), prefer: 'return=minimal' })
    },
    async getMessages(ticketId) {
      return request(`support_messages?ticket_id=eq.${ticketId}&order=created_at.asc&select=*`).catch(() => [])
    },
    async addMessage(ticketId, body, author_admin_id) {
      if (!body?.trim()) throw new Error('body required')
      return request('support_messages', { method: 'POST', body: JSON.stringify({ ticket_id: ticketId, body: body.trim(), author_admin_id: author_admin_id || null }), prefer: 'return=representation' })
    },
  }
}
export const opsRepository = createOpsRepository()
