// Supplier accounts: pure helpers for the Supplier Payment Summary (Purchases › Supplier summary).
// A supplier's account is its purchases (with products, from Record Purchase) plus its supply records (amounts owed
// without products: opening balances, imported invoices). Rows come from get_supplier_accounts (carehub_20270117).
// Docs: docs/architecture/Debt-Accounts-and-POS-Stock-Limits.md §3.
import { supplierKey } from './suppliers'
import { lookupKey } from '../business-directory/services/normalize'

const toKobo = (n) => Math.round((Number(n) || 0) * 100)

// One shape for a supplier account row.
export function toAccount(row) {
  return {
    key: row.supplier_key ?? supplierKey(row.supplier_name),
    name: String(row.supplier_name || '').trim() || 'No supplier name',
    purchases: Number(row.purchase_count) || 0,
    supplies: Number(row.supply_count) || 0,
    supplied: Number(row.supplied_total) || 0,
    paid: Number(row.paid_total) || 0,
    balance: Math.max(Number(row.balance) || 0, 0),
    open: Number(row.open_count) || 0,
    mismatches: Number(row.mismatch_count) || 0,
    lastSupply: row.last_supply_at ? String(row.last_supply_at).slice(0, 10) : '',
  }
}

// Totals of the accounts shown, in whole kobo.
export function accountTotals(accounts = []) {
  let supplied = 0
  let paid = 0
  let balance = 0
  let mismatches = 0
  let owing = 0
  for (const a of accounts) {
    supplied += toKobo(a.supplied); paid += toKobo(a.paid); balance += toKobo(a.balance)
    mismatches += a.mismatches || 0
    if (a.balance > 0) owing++
  }
  return { supplied: supplied / 100, paid: paid / 100, balance: balance / 100, mismatches, owing, count: accounts.length }
}

export const ACCOUNT_SORTS = {
  owed: { label: 'Most owed', compare: (a, b) => b.balance - a.balance || a.name.localeCompare(b.name) },
  supplied: { label: 'Most supplied', compare: (a, b) => b.supplied - a.supplied || a.name.localeCompare(b.name) },
  recent: { label: 'Latest supply', compare: (a, b) => (b.lastSupply || '').localeCompare(a.lastSupply || '') || a.name.localeCompare(b.name) },
  name: { label: 'Supplier A–Z', compare: (a, b) => a.name.localeCompare(b.name) },
}

// Accounts matching the search (every word, any order), sorted; `owingOnly` keeps those with a balance.
export function filterAccounts(accounts, { query = '', sort = 'owed', owingOnly = false } = {}) {
  const words = lookupKey(query).split(' ').filter(Boolean)
  return (accounts || [])
    .filter((a) => (!owingOnly || a.balance > 0) && words.every((w) => lookupKey(a.name).includes(w)))
    .sort((ACCOUNT_SORTS[sort] || ACCOUNT_SORTS.owed).compare)
}

// The payments of one supplier payment spread over several items share an allocation id: group them so the history
// shows one payment with where it went. Payments without one stay single. Newest first.
export function groupSupplierPayments(payments = []) {
  const groups = new Map()
  const out = []
  for (const p of payments) {
    if (p.allocation_id) {
      if (!groups.has(p.allocation_id)) {
        const g = { ...p, id: 'alloc-' + p.allocation_id, amount: 0, parts: [] }
        groups.set(p.allocation_id, g)
        out.push(g)
      }
      const g = groups.get(p.allocation_id)
      g.amount = Math.round((g.amount + Number(p.amount || 0)) * 100) / 100
      g.parts.push(p)
      g.balance_after = undefined
    } else out.push(p)
  }
  return out
}

export const SUPPLIER_EXPORT_COLUMNS = [
  { key: 'name', header: 'Supplier' },
  { key: 'purchases', header: 'Purchases' },
  { key: 'supplies', header: 'Supply Records' },
  { key: 'supplied', header: 'Total Supplied / Owed (NGN)' },
  { key: 'paid', header: 'Paid (NGN)' },
  { key: 'balance', header: 'Outstanding (NGN)' },
  { key: 'open', header: 'Open Items' },
  { key: 'lastSupply', header: 'Last Supply' },
]
