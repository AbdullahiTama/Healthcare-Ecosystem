import { sbFetch } from '../../../services/supabase'

// ── Stock repository ──────────────────────────────────────────────────────────
// A deep module over the `stock_batches` table and the `stock_movements` audit
// log that records every change to it. The interface is small; the
// implementation owns the PostgREST query shape, tenant scoping (every read and
// write is filtered by business_id) and — more importantly — the two multi-step
// operations that must not be reassembled by callers.
//
// Its only outside dependency is `request`, a function with sbFetch's shape:
// (path, options) => Promise<rows>. Production binds the real PostgREST-backed
// sbFetch (the default); tests bind an in-memory adapter. That injected
// transport is the seam — one interface, two adapters.
//
// Unlike `orders`, which injects `upload` and `notify` because those are other
// systems, the movement log is not a collaborator: it is the same database
// reached through the same transport, and it is part of this aggregate. Writing
// a batch change without its movement row is not a valid state, so no caller is
// given the option — and since `transfer` and `adjust` became RPCs, that is now
// enforced by the database transaction rather than by convention here.
export function createStockRepository({ request = sbFetch } = {}) {
  return {
    async getBatches(businessId) {
      return request(`stock_batches?business_id=eq.${businessId}&order=created_at.desc&select=*`)
    },

    async createBatch(businessId, batch) {
      return request('stock_batches', {
        method: 'POST',
        body: JSON.stringify({ ...batch, business_id: businessId }),
      })
    },

    // Previously an id-only PATCH in services/supabase.js. Drives the
    // available/reserved/damaged/returned/expired status buttons.
    async updateBatch(batchId, businessId, updates) {
      return request(`stock_batches?id=eq.${batchId}&business_id=eq.${businessId}`, {
        method: 'PATCH',
        body: JSON.stringify(updates),
        prefer: 'return=minimal',
      })
    },

    // Previously an id-only DELETE with no business filter — same class as the
    // appointments delete, and destructive in the same way.
    async deleteBatch(batchId, businessId) {
      return request(`stock_batches?id=eq.${batchId}&business_id=eq.${businessId}`, {
        method: 'DELETE',
        prefer: 'return=minimal',
      })
    },

    // Moves stock between warehouses, via the transfer_stock_batch RPC
    // (20260805_atomic_stock_transfer.sql). Moving the whole batch relocates
    // it; moving part of it splits the batch. Either way the batch change and
    // its movement row happen in ONE database transaction.
    //
    // This used to be three client-issued writes. The partial path — decrement
    // the source, then insert the destination — could lose stock outright: if
    // the insert failed after the decrement landed, the units were debited and
    // arrived nowhere, and since the movement row was written last, nothing
    // recorded the loss. It also raced: two users transferring from the same
    // batch each validated against a quantity neither had locked. The RPC takes
    // a row lock and does the whole thing atomically.
    //
    // The checks below are kept for the message and the fast fail — Stock.jsx
    // renders `e.message` straight into a toast, so these strings are part of
    // the contract. They are NOT the authoritative check: the RPC re-validates
    // against the locked row, which is the only quantity that cannot go stale
    // between reading the page and pressing the button.
    async transfer(businessId, { batch, toLocationId, qty, movedBy }) {
      const amount = Number(qty)
      if (!amount || amount <= 0) throw new Error('Enter a quantity greater than zero.')
      if (amount > batch.quantity) throw new Error('You only have ' + batch.quantity + ' units in this batch.')

      const result = await request('rpc/transfer_stock_batch', {
        method: 'POST',
        body: JSON.stringify({
          p_batch_id: batch.id,
          p_business_id: businessId,
          p_to_location_id: toLocationId,
          p_qty: amount,
          p_moved_by: movedBy || null,
        }),
      })
      // The destination batch id, or null when no row matched (wrong tenant,
      // deleted batch) — the same no-op the scoped PATCH used to produce.
      return Array.isArray(result) ? result[0] : result
    },

    // Corrects a batch to a counted quantity, via the adjust_stock_batch RPC.
    // The movement records the signed difference, not the new total, so the log
    // reads as a ledger.
    //
    // The difference is computed inside the database from the locked row, not
    // here. The previous implementation subtracted against whatever quantity
    // the page had loaded, so a batch that changed in the meantime was
    // journalled with a difference that never happened.
    async adjust(businessId, { batch, newQty, reason, movedBy }) {
      const amount = Number(newQty)
      if (isNaN(amount) || amount < 0) throw new Error('Enter a valid quantity.')

      const result = await request('rpc/adjust_stock_batch', {
        method: 'POST',
        body: JSON.stringify({
          p_batch_id: batch.id,
          p_business_id: businessId,
          p_qty: amount,
          p_reason: reason || null,
          p_moved_by: movedBy || null,
        }),
      })
      // The signed difference actually applied, or null when no row matched.
      return Array.isArray(result) ? result[0] : result
    },
  }
}

export const stockRepository = createStockRepository()
