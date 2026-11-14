import { sbFetch } from '../../../services/supabase'
import { pagedQuery } from '../../../lib/pagedQuery'
import { translateBulkDeleteError, groupDeletions } from '../../../lib/bulkDelete'

// ── Debt repository ───────────────────────────────────────────────────────────
// A deep module over the `debts` table. The interface is small
// (getAll/create/update/findOpenBySource/recordUnderpayment); the implementation
// owns the PostgREST query shape and tenant scoping — every read and write is
// filtered by business_id so one organisation can never touch another's rows.
//
// Its only outside dependency is `request`, a function with sbFetch's shape:
// (path, options) => Promise<rows>. Production binds the real PostgREST-backed
// sbFetch (the default); tests bind an in-memory adapter. That injected
// transport is the seam — one interface, two adapters.
//
// This aggregate is read by two other modules (POS's credit collection and
// Purchases' mark-paid). They import this repository rather than re-deriving
// the query shape, the same way Purchases imports the inventory repository.
export function createDebtRepository(request = sbFetch) {
  const repo = {
    // Paged: a single request is capped at 1000 rows by the server, which
    // silently dropped the rest.
    async getAll(businessId) {
      return pagedQuery(request, `debts?business_id=eq.${businessId}&order=created_at.desc,id.asc&select=*`)
    },

    // Every debt of several locations (an owner's main business and its branches), for the Debts page's location
    // filter. Each row keeps its business_id. The database decides what is visible: an owner reads their own
    // locations; a staff member reads only their one business, so another id simply returns nothing.
    async getForBusinesses(businessIds) {
      const ids = [...new Set((businessIds || []).filter((id) => /^[0-9a-f-]{36}$/i.test(String(id))))]
      if (ids.length === 0) return []
      if (ids.length === 1) return repo.getAll(ids[0])
      return pagedQuery(request, `debts?business_id=in.(${ids.join(',')})&order=created_at.desc,id.asc&select=*`)
    },

    // Debts still open (not paid, something left to pay), for the Owner's
    // follow-ups: only what needs chasing, not the whole history.
    async getOpen(businessId) {
      return pagedQuery(request, `debts?business_id=eq.${businessId}&status=neq.paid&balance=gt.0&order=created_at.desc,id.asc&select=*`)
    },

    async create(businessId, debt) {
      return request('debts', {
        method: 'POST',
        body: JSON.stringify({ ...debt, business_id: businessId }),
      })
    },

    // Previously an id-only PATCH in services/supabase.js — the last unscoped
    // write on a money table. Callers passed ids drawn from business-scoped
    // lists, so it was a latent exposure rather than a live leak, but it is now
    // scoped like every other write here.
    async update(debtId, businessId, updates) {
      return request(`debts?id=eq.${debtId}&business_id=eq.${businessId}`, {
        method: 'PATCH',
        body: JSON.stringify(updates),
        prefer: 'return=minimal',
      })
    },

    // Bulk edit: the same changes on many debts of this business, 100 ids per request. Returns the saved rows. The
    // caller (debtBulkEdit.js) only ever sends due_date and, for debts recorded by hand, description.
    async updateMany(businessId, debtIds, updates) {
      const ids = [...new Set((debtIds || []).map(String))]
      const rows = []
      for (let i = 0; i < ids.length; i += 100) {
        const chunk = ids.slice(i, i + 100)
        const saved = await request(`debts?business_id=eq.${businessId}&id=in.(${chunk.join(',')})`, {
          method: 'PATCH', body: JSON.stringify(updates), prefer: 'return=representation',
        })
        rows.push(...(Array.isArray(saved) ? saved : []))
      }
      return rows
    },

    // Deletes debts through delete_debts (carehub_20270113): only debts recorded by hand are deleted (kept in a copy
    // for restore, audited); a debt from a credit sale or a purchase is kept and reported with the reason.
    // Returns { deletion_id, deleted, kept: [{ id, name, reasons, ref }], not_found }.
    async deleteMany(businessId, debtIds) {
      try {
        const result = await request('rpc/delete_debts', { method: 'POST', body: JSON.stringify({ p_business_id: businessId, p_debt_ids: debtIds }) })
        return Array.isArray(result) ? result[0] : result
      } catch (e) {
        throw translateBulkDeleteError(e, 'debt')
      }
    },

    // Puts a deletion's debts back (same ids, amounts, status, recorder). Returns { restored, skipped_already_back,
    // client_unlinked }.
    async restoreDeleted(businessId, deletionId) {
      try {
        const result = await request('rpc/restore_deleted_debts', { method: 'POST', body: JSON.stringify({ p_business_id: businessId, p_deletion_id: deletionId }) })
        return Array.isArray(result) ? result[0] : result
      } catch (e) {
        throw translateBulkDeleteError(e, 'debt')
      }
    },

    // Deletions of this business's debts, newest first, one entry per deletion.
    async getDeletions(businessId) {
      try {
        const rows = await pagedQuery(request, `deleted_debts?business_id=eq.${businessId}&order=deleted_at.desc,id.asc&select=id,deletion_id,party_name,deleted_at,deleted_by_name,restored_at`)
        return groupDeletions(rows, 'party_name')
      } catch (e) {
        throw translateBulkDeleteError(e, 'debt')
      }
    },

    // A full or part payment on a debt recorded by hand (or imported), through record_debt_payment
    // (carehub_20270117): the debt and its history row move together. A sale or purchase debt is refused by the
    // database with where to pay it. Returns { payment_id, amount, amount_paid, balance, status }.
    async recordPayment(debtId, { amount, method = 'Cash', paidOn = null, note = null, staffName = null } = {}) {
      const result = await request('rpc/record_debt_payment', {
        method: 'POST',
        body: JSON.stringify({ p_debt_id: debtId, p_amount: amount, p_method: method, p_paid_on: paidOn || null, p_note: note || null, p_staff_name: staffName || null }),
      })
      return Array.isArray(result) ? result[0] : result
    },

    // The payment history of one hand-recorded debt, newest first.
    async getPayments(businessId, debtId) {
      return request(`debt_payments?business_id=eq.${businessId}&debt_id=eq.${debtId}&order=paid_on.desc,created_at.desc&select=*`)
    },

    // Imports receivables (owes_us) or payables (we_owe) through import_debts (carehub_20270117). `rows` come from
    // debtImport.js. With dryRun the database does everything and rolls it back: the preview is the real code path.
    // Returns { dry_run, direction, summary, rows: [{ row, status, kind, party, matched_by, note, message, ... }] }.
    async importRows(businessId, direction, rows, { dryRun = true, allowDuplicates = false } = {}) {
      const result = await request('rpc/import_debts', {
        method: 'POST',
        body: JSON.stringify({ p_business_id: businessId, p_direction: direction, p_rows: rows, p_dry_run: dryRun, p_allow_duplicates: allowDuplicates }),
      })
      return Array.isArray(result) ? result[0] : result
    },

    // Finds the open debt raised by a given sale or purchase, so settling the
    // source can settle the debt with it. POS and Purchases both used to fetch
    // *every* debt for the business and scan it in JavaScript for this; the
    // filter belongs in the query, and having one definition means the two
    // call sites cannot drift apart the way their underpayment rules once did.
    //
    // `order=created_at.desc` + first row preserves the previous behaviour
    // exactly: Array.find over a list already sorted newest-first.
    //
    // The "not settled" test stays in JavaScript deliberately. In PostgREST,
    // `status=neq.paid` drops rows where status is NULL (SQL three-valued
    // logic), whereas the `d.status !== 'paid'` this replaces matched them.
    // Every debt the app writes sets a status, but nothing in the schema
    // guarantees it, and silently skipping a NULL-status debt would leave a
    // real balance outstanding after its sale or purchase was settled. The
    // narrowing that actually mattered — business, source and source_ref, in
    // place of fetching every debt in the business — is done server-side.
    async findOpenBySource(source, sourceRef, businessId) {
      if (!sourceRef) return null
      const ref = encodeURIComponent(sourceRef)
      const rows = await request(
        `debts?business_id=eq.${businessId}&source=eq.${source}&source_ref=eq.${ref}` +
          '&order=created_at.desc&select=*'
      )
      return rows.find((d) => d.status !== 'paid') || null
    },

    // The "an underpaid sale or purchase automatically creates a debt" rule.
    // Moved here from services/supabase.js unchanged: it is a debt-domain rule,
    // and its three call sites (POS's charge/chargeCredit, Purchases' save)
    // had each reimplemented it independently and drifted before it was
    // consolidated.
    //
    // Never throws — a failed debt write must not undo an already-completed
    // sale or purchase. Returns null when there is nothing owed.
    async recordUnderpayment({
      businessId,
      direction,
      partyName,
      amount,
      amountPaid,
      dueDate = '',
      description,
      source,
      sourceRef,
      clientId = null,
    }) {
      const balance = amount - amountPaid
      if (balance <= 0) return null
      try {
        return await repo.create(businessId, {
          client_id: clientId,
          direction,
          party_name: partyName,
          amount,
          amount_paid: amountPaid,
          balance,
          due_date: dueDate,
          status: 'pending',
          description,
          source,
          source_ref: sourceRef,
        })
      } catch (e) {
        return null
      }
    },
  }

  return repo
}

export const debtRepository = createDebtRepository()
