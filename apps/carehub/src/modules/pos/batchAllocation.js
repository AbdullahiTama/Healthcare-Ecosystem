// ── FEFO batch allocation ────────────────────────────────────────────────────
// FEFO (First-Expiry, First-Out) is a picking PREFERENCE, not an authorization
// boundary: the hard rule — never sell an expired or unavailable batch — is
// enforced server-side by guard_sale_batch_expiry
// (20260819_sale_batch_attribution.sql), which runs for every sale path (POS
// online, offline queue replay, PharmacyForm dispense). This helper lives
// client-side so the till can present FEFO-split lines to the database; the
// database still decides what a non-owner may sell.
//
// A line without a product id (a service), a product with no batches, or a
// non-positive quantity passes through untouched — products without batches
// keep today's behavior exactly.

const SORT_LATEST = '9999-12-31'

const todayDate = () => new Date().toISOString().split('T')[0]

// A batch is sellable when it is 'available' and not past its expiry date. A
// missing expiry is treated as never-expiring (Purchases only writes one when
// the user supplies it). Expiry on today's date is still sellable through the
// day. Must match the guard trigger's definition exactly — this is the one
// place the two sides are allowed to agree by convention.
export function isSellableBatch(batch, date = todayDate()) {
  return batch && batch.status === 'available' && (!batch.expiry_date || batch.expiry_date >= date)
}

const byExpiryAsc = (a, b) => ((a.expiry_date || SORT_LATEST) < (b.expiry_date || SORT_LATEST) ? -1 : 1)

// The sellable batches for a product, sorted FEFO-first (soonest expiry). Used
// both by allocateBatches and by POS to preview which batch a cart line will
// draw from before charging. A batch with zero quantity is never sellable.
export function sellableBatches(batches = [], date = todayDate()) {
  return batches
    .filter((b) => isSellableBatch(b, date) && Number(b.quantity) > 0)
    .sort(byExpiryAsc)
}

// Greedily splits `qty` across `batches` (already sorted FEFO-first), emitting
// one line per batch used. `override` marks every emitted line as an owner
// override — used only for the expired/unavailable fill.
function splitAcross(batches, item, qty, override) {
  const lines = []
  let need = qty
  for (const b of batches) {
    if (need <= 0) break
    const take = Math.min(need, Number(b.quantity) || 0)
    if (take <= 0) continue
    lines.push({
      ...item,
      qty: take,
      batch_id: b.id,
      batch_number: b.batch_number,
      batch_expiry: b.expiry_date,
      ...(override ? { override_expired: true } : {}),
    })
    need -= take
  }
  return { lines, need }
}

// items            — cart lines: { ...product, qty, price?, source? }, where
//                    the product id is `id` (POS) or `product_id`
// batchesByProduct — map of productId → stock_batches rows, already
//                    tenant-scoped (stockRepository.getBatches is business-scoped)
// options          — { date, isOwner }; date is the sale day (YYYY-MM-DD),
//                    isOwner is `role === 'Owner'`
//
// Returns a new array of lines. Lines for batched products are split across
// FEFO-sorted sellable batches; a line that must dip into expired/unavailable
// stock carries `override_expired: true` and is only emitted when `isOwner`.
// Throws when a line's qty exceeds what can be sold without an override (the
// cashier will see the message as a toast — it is never allowed to reach the
// server as a non-owner line).
export function allocateBatches(items, batchesByProduct = {}, { date = todayDate(), isOwner = false } = {}) {
  return items.flatMap((item) => {
    const productId = item.id || item.product_id
    const batches = productId ? (batchesByProduct[productId] || []) : []
    if (!productId || batches.length === 0) return [item]

    const qty = Number(item.qty) || 0
    if (qty <= 0) return [item]

    const sellable = sellableBatches(batches, date)

    const sellableTotal = sellable.reduce((s, b) => s + Number(b.quantity), 0)

    if (qty > sellableTotal && !isOwner) {
      throw new Error(
        `Not enough unexpired stock for "${item.name}" — only ${sellableTotal} unit(s) available across sellable batches for ${qty} requested.`
      )
    }

    // Sellable batches first (FEFO); the owner override path only starts where
    // they run out.
    const fromSellable = splitAcross(sellable, item, Math.min(qty, sellableTotal), false)
    if (qty <= sellableTotal) return fromSellable.lines

    if (!isOwner) return fromSellable.lines

    // Owner override: fill the remainder from the non-sellable batches
    // (expired / reserved / damaged / returned), oldest-first, each line
    // flagged so the database guard lets it through.
    const remainingNeed = qty - fromSellable.lines.reduce((s, l) => s + l.qty, 0)
    const rest = batches
      .filter((b) => !sellable.includes(b) && Number(b.quantity) > 0)
      .sort(byExpiryAsc)
    const remainder = splitAcross(rest, item, remainingNeed, true)
    if (remainder.need > 0) {
      throw new Error(
        `Not enough stock in ANY batch for "${item.name}" — still ${remainder.need} unit(s) short.`
      )
    }
    return [...fromSellable.lines, ...remainder.lines]
  })
}