// ── Transaction search: Sales & Accounts and Financial Reports ───────────────
// Pure, so what staff can find is pinned by a test (transactionSearch.test.js).
// One search for both screens, so a receipt found on one is found on the other.
//
// Every whitespace-separated word must match somewhere on the transaction
// (AND), so "ada 1500" narrows to Ada's ₦1,500 sale. A word matches:
//   * text      customer name, receipt/invoice number, payment method, cashier,
//               note, product names, and the status words Paid, Part-paid,
//               Unpaid, Credit, Refunded
//   * numbers   total, subtotal, discount, paid, balance and refunded — typed
//               with or without ₦ and thousands commas ("₦1,500", "1500", "1500.5")
//   * dates     the sale date as YYYY-MM-DD (business day, Lagos)
//
// A long list is indexed once (createSearchIndex) and then searched on every
// keystroke without re-reading each sale's items.
import { businessDateOf } from '../../lib/businessDay'
import { parseItems, paymentStatus, saleRefunded } from './salesReport'

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
    businessDateOf(s.created_at),
  ].map(norm).join(' | ')
}

function amounts(s) {
  return [s.total, s.subtotal, s.discount, s.amount_paid, s.balance, s.refunded_amount].map(amountText).filter(Boolean)
}

// The words of a query, lower-cased; empty when there is nothing to search for.
export const queryWords = (query) => norm(query).split(/\s+/).filter(Boolean)

function entryMatches(entry, words) {
  return words.every((w) => {
    if (entry.text.includes(w)) return true
    const n = w.replace(/[₦,]/g, '')
    return /^\d+(\.\d+)?$/.test(n) && entry.nums.some((a) => a.includes(n))
  })
}

const entryFor = (sale) => ({ sale, text: searchableText(sale), nums: amounts(sale) })

export function matchesQuery(sale, query) {
  const words = queryWords(query)
  return !words.length || entryMatches(entryFor(sale), words)
}

// Index a list once; search it many times.
export function createSearchIndex(sales) {
  const entries = (sales || []).map(entryFor)
  const byId = new Map(entries.map((e) => [String(e.sale.id), e]))
  return {
    search(query) {
      const words = queryWords(query)
      return words.length ? entries.filter((e) => entryMatches(e, words)).map((e) => e.sale) : entries.map((e) => e.sale)
    },
    // Whether one sale (by id) matches: for rows that point at a sale, such as payments.
    matchesId(id, query) {
      const words = queryWords(query)
      if (!words.length) return true
      const e = byId.get(String(id))
      return !!e && entryMatches(e, words)
    },
  }
}

export const searchSales = (sales, query) => (queryWords(query).length ? createSearchIndex(sales).search(query) : (sales || []))

// A payments-ledger row matches when its sale matches, or the payment itself
// does: its method, who took it, its note, its kind, or its amount.
export function paymentMatches(payment, index, query) {
  const words = queryWords(query)
  if (!words.length) return true
  if (index.matchesId(payment.sale_id, query)) return true
  const own = {
    text: [payment.method, payment.staff_name, payment.note, payment.kind === 'collection' ? 'repayment' : payment.kind].map(norm).join(' | '),
    nums: [amountText(payment.amount)].filter(Boolean),
  }
  return entryMatches(own, words)
}

// Whether a query is worth looking up by receipt number across all dates:
// it carries at least three digits (receipt numbers are TXN + digits).
export function looksLikeReceipt(query) {
  const q = String(query || '').trim()
  return /\d{3,}/.test(q) && !/\s/.test(q)
}
