// ── Expiry Alerts — pure aggregation helpers ─────────────────────────────────
// Read-only projection over already tenant-scoped reads (stockRepository
// getBatches, warehouseRepository getAll, getProducts). No imports — dates are
// injected (`today`) so the horizon math is unit-testable and framework-free,
// the same pattern as modules/pos/batchAllocation.js.
//
// A batch enters the projection when the business can still lose money on it:
// it carries an expiry_date, a positive quantity, and a status of 'available'
// or 'expired' (the two statuses where stock is — or was — sellable). Batches
// with no expiry, zero/negative quantity, or a status outside those two are
// invisible here, and this file never needs to know why.
//
// Expected loss = quantity × batch.cost_price when the batch cost is a
// positive number, else quantity × product.cost_price (which may also be 0 or
// absent → loss 0, the row is still shown). A batch whose product_id does not
// match any product falls back to batch.product_name for display and 0 cost.

const DAY_MS = 24 * 60 * 60 * 1000
const LOSS_STATUSES = ['available', 'expired']

function daysLeft(expiryDate, today) {
  // Normalise both sides to calendar days in UTC so a batch expiring today
  // reads 0 and the arithmetic never depends on the machine's timezone.
  const expiry = new Date(String(expiryDate).slice(0, 10) + 'T00:00:00Z')
  const base = new Date(String(today).slice(0, 10) + 'T00:00:00Z')
  if (isNaN(expiry.getTime()) || isNaN(base.getTime())) return Infinity
  return Math.round((expiry - base) / DAY_MS)
}

// The unit cost to value this batch at: batch cost when positive, else the
// product's cost (also only when positive; 0/absent/negative → 0).
function unitCost(batch, product) {
  const batchCost = Number(batch.cost_price)
  if (batchCost > 0) return batchCost
  const productCost = Number(product && product.cost_price)
  return productCost > 0 ? productCost : 0
}

// batches  — stock_batches rows, already business-scoped
// products — product rows, already business-scoped
// options  — { today } as a YYYY-MM-DD string (injectable for tests)
//
// Returns derived rows with productName, unitCost, expectedLoss, daysLeft,
// status, plus the raw fields the dashboard renders and filters on.
export function deriveExpiryRows(batches = [], products = [], { today } = {}) {
  if (today == null) {
    const d = new Date()
    today = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
  }
  const productById = new Map(products.map(p => [p.id, p]))
  return batches
    .filter(b => b.expiry_date && Number(b.quantity) > 0 && LOSS_STATUSES.includes(b.status))
    .map(b => {
      const product = b.product_id ? productById.get(b.product_id) : null
      const quantity = Number(b.quantity)
      const cost = unitCost(b, product)
      return {
        id: b.id,
        batchNumber: b.batch_number || null,
        productId: b.product_id || null,
        productName: product && product.name ? product.name : b.product_name || 'Unknown product',
        quantity,
        unitCost: cost,
        expectedLoss: quantity * cost,
        expiryDate: b.expiry_date,
        daysLeft: daysLeft(b.expiry_date, today),
        status: b.status,
        locationId: b.location_id || null,
      }
    })
}

function inHorizon(row, horizon) {
  if (horizon === 'all' || horizon == null || horizon === '') return true
  const n = Number(horizon)
  if (isNaN(n)) return true
  if (n === 0) return row.daysLeft <= 0
  return row.daysLeft > 0 && row.daysLeft <= n
}

function inWarehouse(row, warehouseId) {
  if (warehouseId === 'all' || warehouseId == null || warehouseId === '') return true
  if (warehouseId === 'unassigned') return row.locationId == null
  return row.locationId === warehouseId
}

// rows               — derived rows (from deriveExpiryRows)
// options.horizon    — 30 | 15 | 7 | 0 | 'all' (null/undefined/'' = no filter)
// options.warehouseId — 'all' | 'unassigned' | a warehouse id (null = no filter)
//
// "0 days" is already expired (daysLeft <= 0); 7/15/30 is 0 < daysLeft <= N.
// Null-location batches appear only under the 'unassigned' scope, never under
// a specific warehouse. Returns { rows, summary } where summary carries
// count, expectedLoss and expiredCount for the filtered set.
export function filterExpiryRows(rows = [], { horizon, warehouseId } = {}) {
  const filtered = rows.filter(r => inHorizon(r, horizon) && inWarehouse(r, warehouseId))
  return {
    rows: filtered,
    summary: {
      count: filtered.length,
      expectedLoss: filtered.reduce((s, r) => s + (r.expectedLoss || 0), 0),
      // A batch marked 'expired' is a definite loss even if its expiry_date is
      // still ahead (data can be inconsistent); treat it as already expired.
      expiredCount: filtered.filter(r => r.daysLeft <= 0 || r.status === 'expired').length,
    },
  }
}