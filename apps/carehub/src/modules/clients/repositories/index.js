import { isCompletedSale } from '../../pos/salesReport'
import { sbFetch } from '../../../services/supabase'
import { pagedQuery } from '../../../lib/pagedQuery'
import { isDuplicateError } from '../../../lib/dbErrors'
import { translateBulkDeleteError, groupDeletions } from '../../../lib/bulkDelete'

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
    //   created  — the saved rows (with their ids), for anything the import links to them (opening balances).
    async createMany(businessId, clients, batchSize = 20) {
      let added = 0
      let skipped = 0
      const failed = []
      const created = []
      for (let i = 0; i < clients.length; i += batchSize) {
        const batch = clients.slice(i, i + batchSize)
        const results = await Promise.all(batch.map(c =>
          create(businessId, c)
            .then((rows) => ({ row: Array.isArray(rows) ? rows[0] : rows }))
            .catch(err => {
              if (isDuplicateError(err)) return 'skipped'
              return { full_name: c.full_name || 'Unknown', message: err.message || 'error' }
            })
        ))
        results.forEach(r => {
          if (r && typeof r === 'object' && 'row' in r) { added++; if (r.row) created.push(r.row) }
          else if (r === 'skipped') skipped++
          else failed.push(r)
        })
      }
      return { added, skipped, failed, created }
    },

    // Edit Client: saves one client's changed details, tenant-scoped, and returns the saved row. Nothing matched (a
    // client of another business, or deleted meanwhile) is an error, not a silent "saved".
    async update(clientId, businessId, updates) {
      const rows = await request(`clients?id=eq.${clientId}&business_id=eq.${businessId}`, {
        method: 'PATCH',
        body: JSON.stringify(updates),
        prefer: 'return=representation',
      })
      if (Array.isArray(rows) && rows.length === 0) throw new Error('This client could not be found. They may have been deleted.')
      return Array.isArray(rows) ? rows[0] : rows
    },

    // The same changes for many clients, one request per 100 (bulk edit on the Clients page). Tenant-scoped like
    // update(); returns the saved rows.
    async updateMany(businessId, clientIds, updates) {
      const ids = [...new Set((clientIds || []).map(String))]
      const rows = []
      for (let i = 0; i < ids.length; i += 100) {
        const chunk = ids.slice(i, i + 100)
        const saved = await request(`clients?business_id=eq.${businessId}&id=in.(${chunk.join(',')})`, {
          method: 'PATCH',
          body: JSON.stringify(updates),
          prefer: 'return=representation',
        })
        rows.push(...(Array.isArray(saved) ? saved : []))
      }
      return rows
    },

    // Deletes clients through delete_clients (carehub_20270111): clients with sales, appointments, consultations,
    // debts, customer requests or linked records are kept and returned with their reasons; the rest are copied (for
    // restore) and deleted. Returns { deletion_id, deleted, kept: [{ id, name, reasons }], not_found }.
    async deleteMany(businessId, clientIds) {
      try {
        const result = await request('rpc/delete_clients', { method: 'POST', body: JSON.stringify({ p_business_id: businessId, p_client_ids: clientIds }) })
        return Array.isArray(result) ? result[0] : result
      } catch (e) {
        throw translateBulkDeleteError(e, 'client')
      }
    },

    // Puts a deletion's clients back (restore_deleted_clients). Returns { restored, skipped_already_back,
    // skipped_phone_taken }.
    async restoreDeleted(businessId, deletionId) {
      try {
        const result = await request('rpc/restore_deleted_clients', { method: 'POST', body: JSON.stringify({ p_business_id: businessId, p_deletion_id: deletionId }) })
        return Array.isArray(result) ? result[0] : result
      } catch (e) {
        throw translateBulkDeleteError(e, 'client')
      }
    },

    // Bulk deletions of this business's clients, newest first, one entry per deletion.
    async getDeletions(businessId) {
      try {
        const rows = await pagedQuery(request,
          `deleted_clients?business_id=eq.${businessId}&order=deleted_at.desc,id.asc&select=id,deletion_id,client_name,deleted_at,deleted_by_name,restored_at`)
        return groupDeletions(rows, 'client_name')
      } catch (e) {
        throw translateBulkDeleteError(e, 'client')
      }
    },

    // ── Per-client history ────────────────────────────────────────────────────
    // Linked via the client_id columns added in
    // 20260801_customer_and_requisition_modules.sql. Each of these four tables
    // also carries business_id — stamped at every insert site in the app — so
    // each read is scoped by both: a client id belonging to another tenant
    // returns nothing rather than that tenant's sales, debts or clinical notes.

    async getSales(clientId, businessId) {
      // Completed sales only: held, deleted and resumed rows are not purchases.
      const rows = await request(`sales?client_id=eq.${clientId}&business_id=eq.${businessId}&order=created_at.desc&select=*`)
      return (rows || []).filter(isCompletedSale)
    },

    async getAppointments(clientId, businessId) {
      return request(`appointments?client_id=eq.${clientId}&business_id=eq.${businessId}&order=date.asc&select=*`)
    },

    async getDebts(clientId, businessId) {
      return request(`debts?client_id=eq.${clientId}&business_id=eq.${businessId}&order=created_at.desc&select=*`)
    },

    // ── Client Account (clientLedger.js) ─────────────────────────────────────────
    // Everything the account is built from, scoped by client AND business: the client's sales (every status; the
    // ledger keeps completed ones), the payments ledger rows of those sales, the client's debts, and the payments on
    // them. Ids go into `in.(...)` lists of at most 100 to keep URLs short.
    async getAccountRecords(clientId, businessId) {
      const sales = await pagedQuery(request, `sales?client_id=eq.${clientId}&business_id=eq.${businessId}&order=created_at.asc,id.asc&select=id,txn_no,created_at,total,amount_paid,balance,refunded_amount,status,is_on_hold,payment_method,items,client_name`)
      const debts = await pagedQuery(request, `debts?client_id=eq.${clientId}&business_id=eq.${businessId}&order=created_at.asc,id.asc&select=id,direction,party_name,amount,amount_paid,balance,status,description,source,source_ref,created_at,due_date`)
      const inChunks = async (table, column, ids, select) => {
        const rows = []
        for (let i = 0; i < ids.length; i += 100) {
          rows.push(...await pagedQuery(request, `${table}?business_id=eq.${businessId}&${column}=in.(${ids.slice(i, i + 100).join(',')})&order=id.asc&select=${select}`))
        }
        return rows
      }
      const manualIds = debts.filter((d) => (d.source || 'manual') === 'manual').map((d) => d.id)
      const [salePayments, debtPayments] = await Promise.all([
        inChunks('sale_payments', 'sale_id', sales.map((x) => x.id), 'id,sale_id,kind,method,amount,received_at,note'),
        inChunks('debt_payments', 'debt_id', manualIds, 'id,debt_id,kind,method,amount,paid_on,created_at,note'),
      ])
      return { sales, salePayments, debts, debtPayments }
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
