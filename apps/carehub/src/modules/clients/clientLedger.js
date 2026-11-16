// Client Account: the client's ledger, financial summary and statements, built from the records the business already
// keeps. Pure (no I/O), so the screen, the Excel file and the printed statement show the same figures.
//
// Sources, all linked to the client by client_id:
//   sales            completed sales (held, resumed, converted and deleted rows are not sales)
//   sale_payments    'sale' and 'collection' rows are payments; 'refund' rows are money handed back for a return.
//                    A sale recorded before the payments ledger has no rows: what it says was paid counts as paid at
//                    the sale (the rule refund_sale uses).
//   debts            hand-recorded debts (source 'manual'): opening balances (source_ref 'opening_balance'), debts
//                    recorded by hand ("owes us") and credits to the client ("we owe"). Credit-sale debts are NOT
//                    used: they mirror the sale's balance, and counting both would double it.
//   debt_payments    payments on those debts (by the client on an "owes us" debt; to the client on a "we owe" one).
//
// Accounting: a DEBIT increases what the client owes; a CREDIT reduces it. Balance = debits − credits, so a positive
// balance is "Client owes us" and a negative one "We owe client" (available credit). A return is a credit (the goods
// came back) and its refund a debit (the money went back), so a refunded return leaves the balance where it was, as
// it does on the sale. Nothing here writes: quotations, which are proposals, never appear.
// Docs: docs/architecture/Client-Account.md.
import { businessDateOf, parseDbTime } from '../../lib/businessDay'
import { isCompletedSale, parseItems } from '../pos/salesReport'
import { OPENING_SOURCE_REF } from './clientImport'

const kobo = (n) => Math.round((Number(n) || 0) * 100)
const naira = (k) => k / 100
const when = (v) => { const d = parseDbTime(v); return d ? d.toISOString() : String(v || '') }
const debtRef = (d) => 'D-' + String(d?.id || '').replace(/-/g, '').slice(0, 8).toUpperCase()
const PAY_LABEL = { sale: 'Payment at sale', collection: 'Payment received' }

// Order within the same moment: what was bought before what paid for it.
const RANK = { opening: 0, sale: 1, adjustment: 1, payment: 2, return: 3, refund: 4, payout: 5 }

/** Every entry on the client's account, oldest first: [{ id, date, at, ref, description, kind, debit, credit }] (naira). */
export function buildClientLedger({ sales = [], salePayments = [], debts = [], debtPayments = [] } = {}) {
  const out = []
  const push = (e) => out.push({ debit: 0, credit: 0, ...e, date: businessDateOf(e.at) })
  const completed = (sales || []).filter(isCompletedSale)
  const paysBySale = new Map()
  for (const p of salePayments || []) paysBySale.set(String(p.sale_id), [...(paysBySale.get(String(p.sale_id)) || []), p])

  for (const s of completed) {
    const items = parseItems(s.items)
    const lines = items.length ? ` · ${items.length} item${items.length === 1 ? '' : 's'}` : ''
    push({ id: 'sale:' + s.id, at: s.created_at, ref: s.txn_no || '', kind: 'sale', description: `Sale${lines}`, debit: naira(kobo(s.total)), saleId: s.id })
    const pays = paysBySale.get(String(s.id)) || []
    if (!pays.length) {
      const paid = Math.min(kobo(s.amount_paid), kobo(s.total))
      if (paid > 0) push({ id: 'salepaid:' + s.id, at: s.created_at, ref: s.txn_no || '', kind: 'payment', description: `Payment at sale${s.payment_method ? ' · ' + s.payment_method : ''}`, credit: naira(paid), saleId: s.id })
      continue
    }
    // Payments count up to the sale's total: more than that was change handed back (live 2026-11-16: TXN432747 has
    // ₦65,500 of payment rows on a ₦63,500 sale). The sale's own balance is capped the same way.
    let room = kobo(s.total)
    for (const p of [...pays].sort((a, b) => when(a.received_at).localeCompare(when(b.received_at)))) {
      const amt = naira(kobo(p.amount))
      if (p.kind !== 'refund') {
        const k = Math.min(kobo(p.amount), Math.max(room, 0))
        room -= k
        if (k <= 0) continue
        push({ id: 'pay:' + p.id, at: p.received_at, ref: s.txn_no || '', kind: 'payment', description: `${PAY_LABEL[p.kind] || 'Payment'}${p.method ? ' · ' + p.method : ''}${k < kobo(p.amount) ? ` (₦${naira(kobo(p.amount) - k).toLocaleString('en-NG')} change)` : ''}`, credit: naira(k), saleId: s.id })
        continue
      }
      // A refund: the goods came back (credit) and the money went back (debit).
      const why = p.note ? ` · ${p.note}` : ''
      push({ id: 'return:' + p.id, at: p.received_at, ref: s.txn_no || '', kind: 'return', description: `Return accepted${why}`, credit: amt, saleId: s.id })
      push({ id: 'refund:' + p.id, at: p.received_at, ref: s.txn_no || '', kind: 'refund', description: `Refund paid${p.method ? ' · ' + p.method : ''}`, debit: amt, saleId: s.id })
    }
  }

  const manual = (debts || []).filter((d) => (d.source || 'manual') === 'manual' && (d.direction === 'owes_us' || d.direction === 'we_owe'))
  const debtById = new Map(manual.map((d) => [String(d.id), d]))
  for (const d of manual) {
    const opening = d.source_ref === OPENING_SOURCE_REF
    const owesUs = d.direction === 'owes_us'
    const amt = naira(kobo(d.amount))
    const desc = opening
      ? (owesUs ? 'Opening balance: client owes us' : 'Opening balance: we owe client')
      : (owesUs ? `Debt recorded${d.description ? ': ' + d.description : ''}` : `Credit to client${d.description ? ': ' + d.description : ''}`)
    push({ id: 'debt:' + d.id, at: d.created_at, ref: debtRef(d), kind: opening ? 'opening' : 'adjustment', description: desc,
      debit: owesUs ? amt : 0, credit: owesUs ? 0 : amt, debtId: d.id })
  }
  for (const p of debtPayments || []) {
    const d = debtById.get(String(p.debt_id))
    if (!d) continue
    const owesUs = d.direction === 'owes_us'
    const amt = naira(kobo(p.amount))
    // A 'before_history' row is what was already paid when payment history began: it belongs to the debt's date.
    const at = p.kind === 'before_history' ? d.created_at : (p.paid_on || p.created_at || d.created_at)
    push({ id: 'debtpay:' + p.id, at, ref: debtRef(d), kind: owesUs ? 'payment' : 'payout',
      description: owesUs ? `Payment on ${d.source_ref === OPENING_SOURCE_REF ? 'opening balance' : 'debt'}${p.method ? ' · ' + p.method : ''}` : `Paid to client${p.method ? ' · ' + p.method : ''}`,
      debit: owesUs ? 0 : amt, credit: owesUs ? amt : 0, debtId: d.id })
  }

  return out.sort((a, b) => a.date.localeCompare(b.date) || when(a.at).localeCompare(when(b.at)) || (RANK[a.kind] - RANK[b.kind]) || a.id.localeCompare(b.id))
}

/** What a balance means: { status, label, amount } (amount never negative). */
export function balanceStatus(balance) {
  const k = kobo(balance)
  if (k > 0) return { status: 'owes', label: 'Client owes us', amount: naira(k) }
  if (k < 0) return { status: 'credit', label: 'We owe client', amount: naira(-k) }
  return { status: 'clear', label: 'Settled', amount: 0 }
}

const CATEGORY = { sale: 'purchases', payment: 'payments', return: 'returns', refund: 'refunds', opening: 'openings', adjustment: 'adjustments', payout: 'adjustments' }

function totalsOf(entries) {
  const t = { purchases: 0, payments: 0, returns: 0, refunds: 0, openingsDebit: 0, openingsCredit: 0, adjustmentsDebit: 0, adjustmentsCredit: 0, debit: 0, credit: 0 }
  for (const e of entries) {
    const d = kobo(e.debit)
    const c = kobo(e.credit)
    t.debit += d; t.credit += c
    const cat = CATEGORY[e.kind]
    if (cat === 'purchases') t.purchases += d
    else if (cat === 'payments') t.payments += c
    else if (cat === 'returns') t.returns += c
    else if (cat === 'refunds') t.refunds += d
    else if (cat === 'openings') { t.openingsDebit += d; t.openingsCredit += c } else { t.adjustmentsDebit += d; t.adjustmentsCredit += c }
  }
  return Object.fromEntries(Object.entries(t).map(([k, v]) => [k, naira(v)]))
}

/**
 * A statement for [from, to] (inclusive 'YYYY-MM-DD'; either may be empty for "from the start" / "to date"). Entries
 * before `from` are carried in as the opening balance, so one period's closing balance is the next one's opening.
 * Returns { from, to, opening, entries (with running balance), closing, totals, status }.
 */
export function clientStatement(ledger, { from = '', to = '' } = {}) {
  let open = 0
  const inPeriod = []
  for (const e of ledger || []) {
    if (from && e.date < from) { open += kobo(e.debit) - kobo(e.credit); continue }
    if (to && e.date > to) continue
    inPeriod.push(e)
  }
  let run = open
  const entries = inPeriod.map((e) => { run += kobo(e.debit) - kobo(e.credit); return { ...e, balance: naira(run) } })
  return { from, to, opening: naira(open), entries, closing: naira(run), totals: totalsOf(inPeriod), status: balanceStatus(naira(run)) }
}

/**
 * The account at a glance (all time): Total purchases, Payments received, Returns and credit notes, Outstanding balance,
 * Available credit and Account status, plus the open items count for the status.
 */
export function accountSummary(ledger, { openSales = 0, openDebts = 0 } = {}) {
  const st = clientStatement(ledger)
  const t = st.totals
  const owing = st.status.status === 'owes'
  return {
    purchases: t.purchases, payments: t.payments, returns: t.returns, refunds: t.refunds,
    openings: { debit: t.openingsDebit, credit: t.openingsCredit }, adjustments: { debit: t.adjustmentsDebit, credit: t.adjustmentsCredit },
    outstanding: owing ? st.status.amount : 0,
    availableCredit: st.status.status === 'credit' ? st.status.amount : 0,
    balance: st.closing,
    status: st.status,
    openItems: openSales + openDebts,
    entries: ledger.length,
  }
}

/** Summary statement lines: [label, amount, kind] (kind 'balance' for opening/closing rows). Zero lines are kept: a statement shows every heading. */
export function summaryLines(st) {
  const t = st.totals
  const lines = [
    [`Opening balance${st.from ? ' at ' + st.from : ''}`, st.opening, 'balance'],
    ['Purchases', t.purchases, 'debit'],
    ['Payments received', -t.payments, 'credit'],
    ['Returns and credit notes', -t.returns, 'credit'],
    ['Refunds paid to client', t.refunds, 'debit'],
  ]
  if (t.openingsDebit || t.openingsCredit) lines.push(['Opening balances recorded', t.openingsDebit - t.openingsCredit, 'adjustment'])
  lines.push(['Adjustments', t.adjustmentsDebit - t.adjustmentsCredit, 'adjustment'])
  lines.push([`Closing balance${st.to ? ' at ' + st.to : ''}`, st.closing, 'balance'])
  return lines
}

/** "₦3,000.00 owed by the client" / "₦500.00 in the client's favour" / "Settled" for a balance. */
export function balanceText(balance, fmt) {
  const s = balanceStatus(balance)
  if (s.status === 'owes') return `${fmt(s.amount)} owed by the client`
  if (s.status === 'credit') return `${fmt(s.amount)} in the client's favour`
  return 'Settled'
}
