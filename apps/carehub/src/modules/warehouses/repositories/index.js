import { sbFetch } from '../../../services/supabase'

// ── Warehouse (enterprise location) repository ────────────────────────────────
// A deep module over `enterprise_locations` — the warehouses, hubs and regional
// offices an enterprise business operates. The implementation owns the
// PostgREST query shape and tenant scoping: every read and write is filtered by
// business_id so one organisation can never touch another's rows.
//
// Its only outside dependency is `request`, a function with sbFetch's shape:
// (path, options) => Promise<rows>. Production binds the real PostgREST-backed
// sbFetch (the default); tests bind an in-memory adapter. That injected
// transport is the seam — one interface, two adapters.
//
// This aggregate is read by three other modules — Stock (which warehouse a
// batch sits in), Orders (which location an order is raised for), and the
// Warehouses page itself. They import this repository rather than each keeping
// a copy of the query.
//
// Ordering is created_at.asc, not the desc used by the transactional
// aggregates: this is a stable list of places, so the first one a business
// created should stay at the top rather than the list reshuffling.
export function createWarehouseRepository(request = sbFetch) {
  return {
    async getAll(businessId) {
      return request(`enterprise_locations?business_id=eq.${businessId}&order=created_at.asc&select=*`)
    },

    async create(businessId, location) {
      return request('enterprise_locations', {
        method: 'POST',
        body: JSON.stringify({ ...location, business_id: businessId }),
      })
    },

    // Previously an id-only PATCH in services/supabase.js.
    async update(locationId, businessId, updates) {
      return request(`enterprise_locations?id=eq.${locationId}&business_id=eq.${businessId}`, {
        method: 'PATCH',
        body: JSON.stringify(updates),
        prefer: 'return=minimal',
      })
    },

    // Previously an id-only DELETE with no business filter.
    //
    // Note this can legitimately fail: four tables reference
    // enterprise_locations (stock_batches.location_id,
    // stock_movements.from/to_location_id, orders.location_id) and none of
    // those foreign keys cascade. Deleting a warehouse that still holds stock
    // or has orders against it raises a foreign-key violation, which is the
    // correct outcome — the location is still in use. The Warehouses page
    // guards only against child *locations*; see CODE_AUDIT for the error
    // message that reaches the user.
    async delete(locationId, businessId) {
      return request(`enterprise_locations?id=eq.${locationId}&business_id=eq.${businessId}`, {
        method: 'DELETE',
        prefer: 'return=minimal',
      })
    },
  }
}

export const warehouseRepository = createWarehouseRepository()
