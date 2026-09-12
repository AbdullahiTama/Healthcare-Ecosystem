import { sbFetch } from '../../../services/supabase'
import { translateConstraintError, isDuplicateError } from '../../../lib/dbErrors'

// Four tables reference `territories` and none of those foreign keys cascade.
// The rep-assignment one is the reachable case: assigning a rep is a normal
// action right on this page, and doing so silently makes the territory
// undeletable until the rep is removed.
const DELETE_BLOCKERS = [
  ['rep_territories_territory_id_fkey', 'has reps assigned to it. Unassign them first.'],
  ['orders_territory_id_fkey', 'has orders raised against it. Close or reassign those orders first.'],
  ['field_activities_territory_id_fkey', 'has field activity recorded against it, which is kept as an audit record and cannot be removed.'],
  ['territories_parent_territory_id_fkey', 'has other territories under it. Reassign or delete those first.'],
]

// ── Territory repository ──────────────────────────────────────────────────────
// A deep module over `territories` — the regions, states or coverage areas a
// field-sales business works — and `rep_territories`, the join that assigns
// staff to them.
//
// Its only outside dependency is `request`, a function with sbFetch's shape:
// (path, options) => Promise<rows>. Production binds the real PostgREST-backed
// sbFetch (the default); tests bind an in-memory adapter. That injected
// transport is the seam — one interface, two adapters.
//
// TENANCY IS NOT UNIFORM ACROSS THIS AGGREGATE, and that is the thing to
// understand before changing anything here:
//
//   `territories`      has business_id. Scoped directly, like every other
//                      aggregate in this codebase.
//   `rep_territories`  has NO business_id — only staff_id and territory_id.
//                      Its live RLS policy derives tenancy through the parent:
//                        territory_id IN (SELECT id FROM territories
//                                         WHERE business_id IN current_business_ids())
//                      That is a good design, not an omission, so this
//                      repository does not invent a business_id filter it has
//                      no column for. It scopes join rows by *territory* —
//                      ids that themselves came from a business-scoped list —
//                      which is the same boundary RLS enforces server-side.
export function createTerritoryRepository(request = sbFetch) {
  return {
    // created_at.asc: a stable list of places, so the first territory a
    // business created stays at the top rather than the list reshuffling.
    async getAll(businessId) {
      return request(`territories?business_id=eq.${businessId}&order=created_at.asc&select=*`)
    },

    async create(businessId, territory) {
      return request('territories', {
        method: 'POST',
        body: JSON.stringify({ ...territory, business_id: businessId }),
      })
    },

    // Bulk import (CSV upload): same contract as the clients repository —
    // many creates in safe-sized parallel batches with per-row error capture,
    // so one bad row can never sink the whole file. Returns
    // { added, skipped, failed } where skipped counts rows the SERVER refused
    // as duplicates and failed is [{ name, message }] for everything else.
    async createMany(businessId, territories, batchSize = 20) {
      let added = 0
      let skipped = 0
      const failed = []
      for (let i = 0; i < territories.length; i += batchSize) {
        const batch = territories.slice(i, i + batchSize)
        const results = await Promise.all(batch.map(t =>
          request('territories', {
            method: 'POST',
            body: JSON.stringify({ ...t, business_id: businessId }),
          })
            .then(() => true)
            .catch(err => {
              if (isDuplicateError(err)) return 'skipped'
              return { name: t.name || 'Unknown', message: err.message || 'error' }
            })
        ))
        results.forEach(r => {
          if (r === true) added++
          else if (r === 'skipped') skipped++
          else failed.push(r)
        })
      }
      return { added, skipped, failed }
    },

    // Previously an id-only PATCH in services/supabase.js.
    async update(territoryId, businessId, updates) {
      return request(`territories?id=eq.${territoryId}&business_id=eq.${businessId}`, {
        method: 'PATCH',
        body: JSON.stringify(updates),
        prefer: 'return=minimal',
      })
    },

    // Previously an id-only DELETE with no business filter. `name` is only used
    // to build a readable failure message; the page already has the row.
    async delete(territoryId, businessId, name = 'This territory') {
      try {
        return await request(`territories?id=eq.${territoryId}&business_id=eq.${businessId}`, {
          method: 'DELETE',
          prefer: 'return=minimal',
        })
      } catch (e) {
        throw translateConstraintError(name, e, DELETE_BLOCKERS)
      }
    },

    // Rep assignments for a set of territories, with each rep's name embedded
    // so the page can render without a second lookup. The territory ids are
    // the scope (see the note above) — an empty list is a no-op rather than an
    // unscoped `in.()`, which would be a malformed request.
    async getAssignments(territoryIds) {
      if (!territoryIds || territoryIds.length === 0) return []
      return request(
        `rep_territories?territory_id=in.(${territoryIds.join(',')})` +
          '&select=id,staff_id,territory_id,staff:staff_id(id,full_name,public_title)'
      )
    },

    async assignRep(staffId, territoryId) {
      return request('rep_territories', {
        method: 'POST',
        body: JSON.stringify({ staff_id: staffId, territory_id: territoryId }),
      })
    },

    // Scoped by the parent territory as well as the row id. The previous
    // `removeRepFromTerritory(id)` filtered on id alone; there is no
    // business_id here to use instead, so the territory is the boundary — the
    // same one RLS applies.
    async unassignRep(assignmentId, territoryId) {
      return request(`rep_territories?id=eq.${assignmentId}&territory_id=eq.${territoryId}`, {
        method: 'DELETE',
        prefer: 'return=minimal',
      })
    },
  }
}

export const territoryRepository = createTerritoryRepository()
