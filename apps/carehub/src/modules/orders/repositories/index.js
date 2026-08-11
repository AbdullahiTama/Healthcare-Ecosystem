import { sbFetch, sbUpload, notify as defaultNotify } from '../../../services/supabase'

// ── Order repository ──────────────────────────────────────────────────────────
// A deep module over the orders aggregate — orders and their items, watchers,
// files and events. The interface is small (getAll/getById/create/advance/…);
// the implementation owns the PostgREST query shapes, the multi-table create/
// advance commands, and the notifications those commands fan out. Callers issue
// one intent ("create this order", "advance this order to approved") and never
// re-derive the fan-out.
//
// Three collaborators are injected so the aggregate is the test surface:
//   request — the transport, sbFetch's shape (path, options) => Promise<rows>
//   upload  — object storage, sbUpload's shape
//   notify  — the notification fan-out
// Production binds the real ones (defaults); tests bind in-memory / spy adapters.
export function createOrderRepository({ request = sbFetch, upload = sbUpload, notify = defaultNotify } = {}) {
  const repo = {
    async getAll(businessId) {
      return request(`orders?business_id=eq.${businessId}&order=created_at.desc&select=*`)
    },

    async getById(orderId, businessId) {
      const rows = await request(`orders?id=eq.${orderId}&business_id=eq.${businessId}&select=*`)
      return rows[0] || null
    },

    // The child tables (order_items/watchers/files/events) are keyed by
    // order_id alone — they carry no business_id column — so their tenant
    // boundary is the order id list, which callers only ever obtain from the
    // business-scoped getAll above.

    async getItems(orderIds) {
      if (!orderIds || orderIds.length === 0) return []
      return request(`order_items?order_id=in.(${orderIds.join(',')})&select=*`)
    },

    async getWatchers(orderIds) {
      if (!orderIds || orderIds.length === 0) return []
      return request(`order_watchers?order_id=in.(${orderIds.join(',')})&select=*`)
    },

    async getFiles(orderIds) {
      if (!orderIds || orderIds.length === 0) return []
      return request(`order_files?order_id=in.(${orderIds.join(',')})&select=*`)
    },

    async getEvents(orderId) {
      return request(`order_events?order_id=eq.${orderId}&order=created_at.asc&select=*`)
    },

    async addEvent(event) {
      return request('order_events', { method: 'POST', body: JSON.stringify(event) })
    },

    async uploadFile(file) {
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
      const path = Date.now() + '-' + Math.floor(Math.random() * 100000) + '-' + safeName
      return upload('order-files', path, file, file.type || 'application/octet-stream')
    },

    // Raises an order and everything hanging off it in one command: the order
    // row, its items/watchers/files, a 'submitted' event, and the approval +
    // copy notifications.
    async create(order, items, watchers, files) {
      const rows = await request('orders', { method: 'POST', body: JSON.stringify(order) })
      const saved = Array.isArray(rows) ? rows[0] : rows
      if (!saved || !saved.id) throw new Error('Order was not saved — no id returned.')

      if (items && items.length > 0) {
        await request('order_items', {
          method: 'POST',
          body: JSON.stringify(items.map((i) => ({ ...i, order_id: saved.id }))),
          prefer: 'return=minimal',
        })
      }
      if (watchers && watchers.length > 0) {
        await request('order_watchers', {
          method: 'POST',
          body: JSON.stringify(watchers.map((w) => ({ ...w, order_id: saved.id }))),
          prefer: 'return=minimal',
        })
      }
      if (files && files.length > 0) {
        await request('order_files', {
          method: 'POST',
          body: JSON.stringify(files.map((f) => ({ ...f, order_id: saved.id }))),
          prefer: 'return=minimal',
        })
      }

      await repo.addEvent({
        order_id: saved.id,
        event_type: 'submitted',
        note: null,
        actor_name: order.created_by_name,
      })

      // The approver needs to act. Everyone copied just needs to know.
      await notify(
        order.business_id,
        [{ staffId: order.approver_staff_id }],
        'order_approval',
        'Order needs your approval',
        order.created_by_name + ' raised an order for ' + order.customer_name,
        'orders'
      )
      if (watchers && watchers.length > 0) {
        await notify(
          order.business_id,
          watchers.map((w) => ({ staffId: w.staff_id })),
          'order_copy',
          'You were copied on an order',
          order.created_by_name + ' raised an order for ' + order.customer_name,
          'orders'
        )
      }

      return saved
    },

    // Moves one order to the next status, logs the event, and notifies the
    // raiser plus watchers. Scoped by id AND business_id: a previous naive
    // reimplementation of this method filtered by neither, so a single call
    // would have rewritten the status of EVERY order in the table, across every
    // tenant. businessId sits second here to match every other method in the
    // seam ((entityId, businessId, …)).
    async advance(orderId, businessId, status, extra, actorName, note) {
      const patch = { status, ...(extra || {}) }
      // No `return=minimal` here on purpose: the returned rows are how we learn
      // whether the scoped filter actually matched anything. An empty result
      // means the order does not exist or belongs to another tenant, so we log
      // no event and notify nobody rather than leaving a phantom audit trail
      // for a status change that never happened.
      const updated = await request(`orders?id=eq.${orderId}&business_id=eq.${businessId}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      })
      const order = Array.isArray(updated) ? updated[0] : updated
      if (!order) return

      await repo.addEvent({
        order_id: orderId,
        event_type: status,
        note: note || null,
        actor_name: actorName,
      })

      // Tell the rep who raised it, and everyone copied. Notification failures
      // must not fail the status change — the order has already moved.
      try {
        const watchers = await repo.getWatchers([orderId])
        const targets = [{ staffId: order.created_by_staff_id }]
        ;(watchers || []).forEach((w) => targets.push({ staffId: w.staff_id }))

        const labels = {
          approved: 'Order approved',
          rejected: 'Order rejected',
          processing: 'Order sent to warehouse',
          dispatched: 'Order dispatched',
          delivered: 'Order delivered',
        }

        await notify(
          order.business_id,
          targets,
          'order_update',
          labels[status] || 'Order updated',
          actorName + ' — ' + order.customer_name + (note ? ' · ' + note : ''),
          'orders'
        )
      } catch (e) {}
    },
  }

  return repo
}

export const orderRepository = createOrderRepository()
