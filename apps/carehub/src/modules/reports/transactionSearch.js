// ── Financial Reports: transaction search ────────────────────────────────────
// Pure, so what the Owner can find is pinned by a test (transactionSearch.test.js).
// Every whitespace-separated word must match somewhere on the transaction
// (AND), so "ada 1500" narrows to Ada's ₦1,500 sale. A word matches:
//   * text      customer name, receipt/invoice number, payment method, cashier,
//               note, product names, and the status words Paid, Part-paid,
//               Unpaid, Credit, Refunded
//   * numbers   total, subtotal, discount, paid, balance and refunded — typed
//               with or without ₦ and thousands commas ("₦1,500", "1500", "1500.5")
//   * dates     the sale date as YYYY-MM-DD
import { parseItems, paymentStatus, saleRefunded } from '../pos/salesReport'

const norm = (v) => String(v ?? '').toLowerCase()
const amountText = (v) => {
  const n = Number(v)
  return Number.isFinite(n) && n !== 0 ? String(Math.round(n * 100) / 100) : ''
}

export function searchableText(s) {
  const status = paymentStatus(s)
  return [
    s.client_name || 'Walk-in', s.txn_no, s.payment_method, s.staff_name, s.notes,
    ...parseItems(s.items).map((it) => it.name),
    status, s.is_credit ? 'credit' : '', saleRefunded(s) > 0 ? 'refunded refund' : '',
    String(s.created_at || '').slice(0, 10),
  ].map(norm).join(' | ')
}

function amounts(s) {
  return [s.total, s.subtotal, s.discount, s.amount_paid, s.balance, s.refunded_amount].map(amountText).filter(Boolean)
}

export function matchesQuery(sale, query) {
  const words = norm(query).split(/\s+/).filter(Boolean)
  if (!words.length) return true
  const text = searchableText(sale)
  const nums = amounts(sale)
  return words.every((w) => {
    if (text.includes(w)) return true
    const n = w.replace(/[₦,]/g, '')
    return /^\d+(\.\d+)?$/.test(n) && nums.some((a) => a.includes(n))
  })
}

export const searchSales = (sales, query) => (String(query || '').trim() ? (sales || []).filter((s) => matchesQuery(s, query)) : (sales || []))
