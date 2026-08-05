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
// given the option.
export function createStockRepository({ request = sbFetch } = {}) {
  // Every batch change is journalled here. Internal on purpose — `transfer` and
  // `adjust` are the only ways a movement should ever be written.
  async function logMovement(businessId, movement) {
    return request('stock_movements', {
      method: 'POST',
      body: JSON.stringify({ ...movement, business_id: businessId }),
    })
  }

  const repo = {
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

    // Moves stock between warehouses. Moving the whole batch relocates it;
    // moving part of it splits the batch, leaving the remainder behind and
    // creating a new one at the destination. Either way the move is journalled.
    //
    // The thrown messages are user-facing — Stock.jsx renders `e.message`
    // straight into a toast — so they are preserved verbatim from the
    // services/supabase.js implementation this replaces.
    //
    // KNOWN, PRE-EXISTING, DELIBERATELY NOT CHANGED HERE: the partial-transfer
    // path is two writes with no transaction. If the destination insert fails
    // after the source decrement succeeds, the units are debited from the
    // source batch and never arrive anywhere — stock silently vanishes. This
    // migration preserves the behaviour exactly as found; making it atomic
    // needs a database function (the same shape as increment_product_stock from
    // C5) and belongs in its own change. See CODE_AUDIT.md.
    async transfer(businessId, { batch, toLocationId, qty, movedBy }) {
      const amount = Number(qty)
      if (!amount || amount <= 0) throw new Error('Enter a quantity greater than zero.')
      if (amount > batch.quantity) throw new Error('You only have ' + batch.quantity + ' units in this batch.')

      if (amount === batch.quantity) {
        await repo.updateBatch(batch.id, businessId, { location_id: toLocationId })
      } else {
        await repo.updateBatch(batch.id, businessId, { quantity: batch.quantity - amount })
        await repo.createBatch(businessId, {
          location_id: toLocationId,
          product_id: batch.product_id,
          product_name: batch.product_name,
          batch_number: batch.batch_number,
          quantity: amount,
          expiry_date: batch.expiry_date,
          date_received: batch.date_received,
          supplier_source: batch.supplier_source,
          storage_location: batch.storage_location,
          status: batch.status,
          received_by: batch.received_by,
        })
      }

      return logMovement(businessId, {
        batch_id: batch.id,
        from_location_id: batch.location_id,
        to_location_id: toLocationId,
        movement_type: 'transfer',
        quantity: amount,
        reason: null,
        moved_by: movedBy,
      })
    },

    // Corrects a batch to a counted quantity. The movement records the signed
    // difference, not the new total, so the log reads as a ledger.
    async adjust(businessId, { batch, newQty, reason, movedBy }) {
      const amount = Number(newQty)
      if (isNaN(amount) || amount < 0) throw new Error('Enter a valid quantity.')
      const diff = amount - batch.quantity
      await repo.updateBatch(batch.id, businessId, { quantity: amount })
      return logMovement(businessId, {
        batch_id: batch.id,
        from_location_id: batch.location_id,
        to_location_id: null,
        movement_type: 'adjustment',
        quantity: diff,
        reason: reason || null,
        moved_by: movedBy,
      })
    },
  }

  return repo
}

export const stockRepository = createStockRepository()
