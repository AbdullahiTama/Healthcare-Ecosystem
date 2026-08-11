import { sbFetch } from '../../../services/supabase'
import { translateConstraintError } from '../../../lib/dbErrors'

// Four tables reference enterprise_locations and none of those foreign keys
// cascade, so deleting a location that is still in use is refused by the
// database. That refusal is correct; these are the reasons, phrased for
// someone who just pressed Delete. See lib/dbErrors for why the match is on
// the constraint name.
const DELETE_BLOCKERS = [
  ['stock_batches_location_id_fkey', 'still holds stock. Transfer or remove its batches first.'],
  ['orders_location_id_fkey', 'has orders raised against it. Close or reassign those orders first.'],
  ['stock_movements_from_location_id_fkey', 'has stock movement history, which is kept as an audit record and cannot be removed.'],
  ['stock_movements_to_location_id_fkey', 'has stock movement history, which is kept as an audit record and cannot be removed.'],
  ['enterprise_locations_parent_location_id_fkey', 'has other locations under it. Reassign or delete those first.'],
]

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
    // `name` is only used to build a readable failure message. The page already
    // has the row in hand, so this costs nothing and avoids a lookup here.
    async delete(locationId, businessId, name = 'This location') {
      try {
        return await request(`enterprise_locations?id=eq.${locationId}&business_id=eq.${businessId}`, {
          method: 'DELETE',
          prefer: 'return=minimal',
        })
      } catch (e) {
        // The database is the authority on whether a location is still in use;
        // this only translates its answer. Anything unrecognised is rethrown
        // untouched rather than being flattened into a wrong explanation.
        throw translateConstraintError(name, e, DELETE_BLOCKERS)
      }
    },
  }
}

export const warehouseRepository = createWarehouseRepository()
