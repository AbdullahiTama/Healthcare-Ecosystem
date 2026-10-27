// ── Owner edit of a completed sale: the arithmetic ───────────────────────────
// Pure, so every figure the Owner sees before saving is pinned by a test
// (saleEdit.test.js). It MIRRORS edit_sale() in the database
// (carehub_20261216_sales_owner_corrections.sql), which recomputes everything
// on the server and is the figure of record; this is the live preview and the
// first line of validation.
import { parseItems, saleReceived } from './salesReport'

const num = (v) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}
const money = (v) => Math.round(num(v) * 100) / 100

// Editable copy of a sale's lines. Every other key on a line (id, batch_id, …)
// is kept untouched so stock and batches still reconcile; qty/price become
// strings only while being typed, so they are coerced back in toPayload().
export function draftLines(sale) {
  return parseItems(sale?.items).map((it) => ({ ...it, qty: num(it.qty) || 1, price: num(it.price) }))
}

export function addLine(lines, product) {
  const i = lines.findIndex((l) => l.id === product.id)
  if (i >= 0) return lines.map((l, k) => (k === i ? { ...l, qty: num(l.qty) + 1 } : l))
  return [...lines, { id: product.id, name: product.name, price: num(product.price), qty: 1 }]
}

export function lineErrors(line) {
  if (!String(line.name || '').trim()) return 'Name is required'
  const q = Number(line.qty)
  if (!Number.isInteger(q) || q <= 0) return 'Quantity must be a whole number above zero'
  const p = Number(line.price)
  if (!Number.isFinite(p) || p < 0) return 'Price must be zero or more'
  return null
}

// What the sale becomes. `paid` is money actually received (never more than the
// old total: the cash path stores cash tendered), so a higher total leaves a
// balance (credit), and a lower one leaves `overpaid` for the Owner to refund.
export function editTotals(lines, discount, sale) {
  const subtotal = money(lines.reduce((n, l) => n + num(l.qty) * num(l.price), 0))
  const disc = money(discount)
  const total = money(subtotal - disc)
  const paid = saleReceived(sale)
  return {
    subtotal, discount: disc, total, paid,
    balance: money(Math.max(total - paid, 0)),
    overpaid: money(Math.max(paid - total, 0)),
    discountError: disc < 0 || disc > subtotal ? `Discount must be between ₦0 and ${subtotal}` : null,
  }
}

export function validateEdit(lines, discount, sale, reason) {
  if (!lines.length) return 'A sale needs at least one product. To remove the sale, delete it instead.'
  for (const l of lines) { const e = lineErrors(l); if (e) return `${l.name || 'A line'}: ${e}` }
  const t = editTotals(lines, discount, sale)
  if (t.discountError) return t.discountError
  if (String(reason || '').trim().length < 3) return 'Give a reason for the edit.'
  return null
}

export function toPayload(lines) {
  return lines.map((l) => ({ ...l, qty: Number(l.qty), price: Number(l.price) }))
}

// Human text for one audit_log row of a sale.
const ACTIONS = { 'sale.edited': 'Edited', 'sale.refunded': 'Refunded', 'sale.deleted': 'Deleted' }
export function describeCorrection(row) {
  const m = row?.metadata || {}
  const label = ACTIONS[row?.action] || row?.action || 'Changed'
  let detail = ''
  if (row?.action === 'sale.edited') detail = `Total ${m.before?.total ?? '?'} → ${m.after?.total ?? '?'}`
  else if (row?.action === 'sale.refunded') detail = `${m.amount ?? '?'} by ${m.method || 'unspecified'}`
  else if (row?.action === 'sale.deleted') detail = m.reversed_payments ? `${m.reversed_payments} of payments reversed` : ''
  return { label, detail, reason: m.reason || '' }
}
