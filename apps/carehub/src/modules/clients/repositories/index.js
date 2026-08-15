import { sbFetch } from '../../../services/supabase'
import { pagedQuery } from '../../../lib/pagedQuery'
import { isDuplicateError } from '../../../lib/dbErrors'

// `isDuplicateError` (the duplicate-key shape recogniser) moved to
// lib/dbErrors.js — it is now shared with the sale repository's dispense_ref
// guard. Re-exported here so existing importers of this module are unchanged.
export { isDuplicateError }

// ── Client repository ─────────────────────────────────────────────────────────
// A deep module over the `clients` aggregate and the per-client history the
// client detail view is built from. Its interface is small (getAll/create/
// update + four history reads); the implementation owns the PostgREST query
// shapes and, above all, tenant scoping — every read and write is filtered by
// business_id so one organisation can never see or touch another's rows.
//
// The history reads (sales/appointments/consultations/debts) are deliberately
// part of THIS aggregate rather than the sales/appointments/... modules: they
// are not those aggregates' own collections, they are projections of one
// client's record. The owning modules keep their own collection-level reads.
//
// The repository's only outside dependency is `request`, a function with
// sbFetch's shape: (path, options) => Promise<rows>. Production binds the real
// PostgREST-backed sbFetch (the default below); tests bind an in-memory adapter.
// That injected transport is the seam — one interface, two adapters.
export function createClientRepository(request = sbFetch) {
  // Detached (no `this`), so callers can pass it around — the codebase rule:
  // "No `this` anywhere in here: callers routinely detach these methods."
  const create = async (businessId, client) =>
    request('clients', {
      method: 'POST',
      body: JSON.stringify({ ...client, business_id: businessId }),
    })

  return {
    // Paged like every tenant collection: PostgREST clamps responses to
    // db-max-rows (1000), so an unlimitable query would silently drop clients
    // past the cap — the bulk CSV upload makes a >1000-client list realistic.
    // `id.asc` pins the order so pages cannot shift rows.
    async getAll(businessId) {
      return pagedQuery(request, `clients?business_id=eq.${businessId}&order=full_name.asc,id.asc&select=*`)
    },

    async create(businessId, client) {
      return create(businessId, client)
    },

    // Bulk import (CSV upload): many creates in safe-sized parallel batches,
    // with per-row error capture so one bad row can never sink the whole file.
    // Returns { added, skipped, failed }:
    //   added    — rows written to the database
    //   skipped  — rows the SERVER refused as duplicate phones (the unique
    //              index), reported so the page can say "skipped, not
    //              duplicated" — the template's own promise — rather than
    //              surfacing a raw constraint error.
    //   failed   — [{ full_name, message }] for every other kind of write
    //              failure. The page reports the counts and the first few.
    async createMany(businessId, clients, batchSize = 20) {
      let added = 0
      let skipped = 0
      const failed = []
      for (let i = 0; i < clients.length; i += batchSize) {
        const batch = clients.slice(i, i + batchSize)
        const results = await Promise.all(batch.map(c =>
          create(businessId, c)
            .then(() => true)
            .catch(err => {
              if (isDuplicateError(err)) return 'skipped'
              return { full_name: c.full_name || 'Unknown', message: err.message || 'error' }
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

    // No UI calls this yet — it replaces a dead `updateClient` in
    // services/supabase.js that PATCHed by id alone, so any future edit screen
    // reaches for a tenant-scoped write instead of an unscoped one.
    async update(clientId, businessId, updates) {
      return request(`clients?id=eq.${clientId}&business_id=eq.${businessId}`, {
        method: 'PATCH',
        body: JSON.stringify(updates),
        prefer: 'return=minimal',
      })
    },

    // ── Per-client history ────────────────────────────────────────────────────
    // Linked via the client_id columns added in
    // 20260801_customer_and_requisition_modules.sql. Each of these four tables
    // also carries business_id — stamped at every insert site in the app — so
    // each read is scoped by both: a client id belonging to another tenant
    // returns nothing rather than that tenant's sales, debts or clinical notes.

    async getSales(clientId, businessId) {
      return request(`sales?client_id=eq.${clientId}&business_id=eq.${businessId}&order=created_at.desc&select=*`)
    },

    async getAppointments(clientId, businessId) {
      return request(`appointments?client_id=eq.${clientId}&business_id=eq.${businessId}&order=date.asc&select=*`)
    },

    async getDebts(clientId, businessId) {
      return request(`debts?client_id=eq.${clientId}&business_id=eq.${businessId}&order=created_at.desc&select=*`)
    },

    // `consultation_forms` is the skincare/pharmacy consultation table. The
    // hospital module owns a separate `consultations` table keyed by patient_id
    // — the two workflows never share a table.
    async getConsultations(clientId, businessId) {
      return request(`consultation_forms?client_id=eq.${clientId}&business_id=eq.${businessId}&order=consultation_date.desc&select=*`)
    },
  }
}

export const clientRepository = createClientRepository()
