import { sbFetch } from '../../../services/supabase'

// ── Notification repository ──────────────────────────────────────────────────
// A deep module over `staff_notifications` — the in-app alert system. The
// interface is small (getAll/notify/markRead/markAllRead); the implementation
// owns the PostgREST query shape and tenant scoping.
//
// `notify` writes one row per recipient and never throws — a failed
// notification must not break the action that triggered it.
export function createNotificationRepository(request = sbFetch) {
  return {
    async getAll(businessId, staffId) {
      const who = staffId
        ? 'staff_id=eq.' + staffId
        : 'is_owner=eq.true'
      return request('staff_notifications?business_id=eq.' + businessId + '&' + who + '&order=created_at.desc&select=*&limit=50')
    },

    async notify(businessId, recipients, kind, title, body, link) {
      try {
        if (!recipients || recipients.length === 0) return
        const rows = recipients.map(function (r) {
          return {
            business_id: businessId,
            staff_id: r.staffId || null,
            is_owner: !r.staffId,
            kind: kind,
            title: title,
            body: body || null,
            link: link || null,
          }
        })
        await request('staff_notifications', { method: 'POST', body: JSON.stringify(rows), prefer: 'return=minimal' })
      } catch (e) {
        // Swallow — the order still went through, the message still sent.
      }
    },

    async markRead(id) {
      return request('staff_notifications?id=eq.' + id, {
        method: 'PATCH',
        body: JSON.stringify({ read_at: new Date().toISOString() }),
        prefer: 'return=minimal',
      })
    },

    async markAllRead(businessId, staffId) {
      const who = staffId ? 'staff_id=eq.' + staffId : 'is_owner=eq.true'
      return request('staff_notifications?business_id=eq.' + businessId + '&' + who + '&read_at=is.null', {
        method: 'PATCH',
        body: JSON.stringify({ read_at: new Date().toISOString() }),
        prefer: 'return=minimal',
      })
    },
  }
}

export const notificationRepository = createNotificationRepository()
