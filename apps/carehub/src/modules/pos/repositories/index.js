import { sbFetch } from '../../../services/supabase'

// ── Offline sale queue ────────────────────────────────────────────────────────
// The counter has to keep selling when the network drops, so an unsent sale is
// parked in localStorage and replayed later. This is the sale aggregate's second
// persistence mechanism, so it is modelled as its own small store rather than
// hidden inside the repository: one interface (all/push/replace), a localStorage
// adapter for production and an in-memory one for tests.
//
// The storage key is unchanged from the previous services/supabase.js
// implementation — sales already queued on a device must survive this refactor.
const OFFLINE_KEY = 'carehub_v1_offline_sales'

function readQueue() {
  try { return JSON.parse(localStorage.getItem(OFFLINE_KEY) || '[]') } catch (e) { return [] }
}

// No `this` anywhere in here: callers routinely detach these methods.
export const localOfflineQueue = {
  all: readQueue,

  push(sale) {
    try {
      const queue = readQueue()
      // Date.now() alone collided for sales queued in the same millisecond,
      // which matters now that syncing removes entries by id.
      queue.push({ ...sale, _offline_id: `${Date.now()}-${Math.floor(Math.random() * 100000)}` })
      localStorage.setItem(OFFLINE_KEY, JSON.stringify(queue))
    } catch (e) {}
  },

  replace(sales) {
    try {
      if (sales.length) localStorage.setItem(OFFLINE_KEY, JSON.stringify(sales))
      else localStorage.removeItem(OFFLINE_KEY)
    } catch (e) {}
  },
}

// An in-memory queue with the same interface — the second adapter that makes
// the store a real seam, and what the tests bind.
export function createMemoryOfflineQueue(initial = []) {
  let queue = initial.map((s) => ({ ...s }))
  return {
    all: () => queue.map((s) => ({ ...s })),
    push: (sale) => { queue.push({ ...sale, _offline_id: `${Date.now()}-${queue.length}` }) },
    replace: (sales) => { queue = sales.map((s) => ({ ...s })) },
  }
}

// ── Sale repository ───────────────────────────────────────────────────────────
// A deep module over the `sales` table plus the offline queue that backs it.
// Callers issue one intent — "record this sale" — and never decide for
// themselves whether it goes to PostgREST or to the queue, nor re-derive the
// tenant filter on a write.
//
// Three collaborators are injected so the aggregate is the test surface:
//   request  — the transport, sbFetch's shape: (path, options) => Promise<rows>
//   offline  — the queue store above (all/push/replace)
//   isOnline — connectivity, so both branches of create() are reachable in tests
// Production binds the real ones (defaults); tests bind in-memory adapters.
export function createSaleRepository({
  request = sbFetch,
  offline = localOfflineQueue,
  isOnline = () => navigator.onLine,
} = {}) {
  return {
    async getAll(businessId, filters = {}) {
      let query = `sales?business_id=eq.${businessId}&order=created_at.desc&select=*`
      if (filters.date) query += `&created_at=gte.${filters.date}T00:00:00`
      if (filters.onHold !== undefined) query += `&is_on_hold=eq.${filters.onHold}`
      if (filters.isCredit !== undefined) query += `&is_credit=eq.${filters.isCredit}`
      return request(query)
    },

    // Today's completed sales — held sales are excluded because they are not
    // takings yet.
    async getToday(businessId) {
      const today = new Date().toISOString().split('T')[0]
      return request(
        `sales?business_id=eq.${businessId}&created_at=gte.${today}T00:00:00&is_on_hold=eq.false&order=created_at.desc&select=*`
      )
    },

    // Records a sale, choosing its own destination. Returns { queued } so the
    // page can tell the cashier what happened without knowing how it decided:
    //   queued: false            — written to the database
    //   queued: true, 'offline'  — no connection, parked for later replay
    //   queued: true, 'error'    — the write failed, parked rather than lost
    async create(businessId, sale) {
      const row = { ...sale, business_id: businessId }
      if (!isOnline()) {
        offline.push(row)
        return { queued: true, reason: 'offline' }
      }
      try {
        const rows = await request('sales', { method: 'POST', body: JSON.stringify(row) })
        return { queued: false, sale: Array.isArray(rows) ? rows[0] : rows }
      } catch (e) {
        // A sale is money that already changed hands — never drop it because
        // the write failed.
        offline.push(row)
        return { queued: true, reason: 'error' }
      }
    },

    // Tenant-scoped: the previous services/supabase.js `updateSale` filtered on
    // id alone. Every caller passes an id from a business-scoped list, so this
    // is defence in depth rather than a live-leak fix.
    async update(saleId, businessId, updates) {
      return request(`sales?id=eq.${saleId}&business_id=eq.${businessId}`, {
        method: 'PATCH',
        body: JSON.stringify(updates),
        prefer: 'return=minimal',
      })
    },

    queuedSales() {
      return offline.all()
    },

    // Replays queued sales and returns how many landed. Called on dashboard
    // mount and from the manual Sync button.
    async syncQueued(businessId) {
      if (!isOnline()) return 0
      const queue = offline.all()
      if (!queue.length) return 0
      let count = 0
      for (const sale of queue) {
        try {
          const { _offline_id, ...data } = sale
          await request('sales', { method: 'POST', body: JSON.stringify({ ...data, business_id: businessId }) })
          count++
        } catch (e) {}
      }
      if (count > 0) offline.replace([])
      return count
    },
  }
}

export const saleRepository = createSaleRepository()
