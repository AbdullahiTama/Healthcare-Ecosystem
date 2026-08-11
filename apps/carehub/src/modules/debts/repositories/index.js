import { sbFetch } from '../../../services/supabase'

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
    async getAll(businessId) {
      return request(`debts?business_id=eq.${businessId}&order=created_at.desc&select=*`)
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
