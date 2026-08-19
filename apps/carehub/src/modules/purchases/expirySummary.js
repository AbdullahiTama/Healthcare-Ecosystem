// Pure helper so the earliest-expiry/batch aggregation is unit-testable
// outside the React component's save() handler. Items with an empty expiry or
// batch are ignored; a purchase with none of either stores nulls, matching the
// purchases table's nullable expiry/batch columns.
export function purchaseExpirySummary(items = []) {
  const nonEmpty = (v) => typeof v === 'string' && v.trim() !== ''
  const rows = items.filter(Boolean)
  const expiries = rows.map((i) => i.expiry).filter(nonEmpty)
  const batches = [...new Set(rows.map((i) => (typeof i.batch === 'string' ? i.batch.trim() : '')).filter(nonEmpty))]
  return {
    expiry: expiries.length > 0 ? expiries.reduce((a, b) => (a < b ? a : b)) : null,
    batch: batches.length > 0 ? batches.join(', ') : null,
  }
}