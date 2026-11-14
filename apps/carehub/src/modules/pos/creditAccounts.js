// POS › Credit: one account per customer instead of one card per credit sale.
//
// Pure functions over the open credit sales the till already holds (useOpenSales, paged) and the client list. A
// customer's account gathers every credit sale (visit) still owing; each sale stays a separate record, with its own
// items, payments and balance, so nothing is merged in the database and every purchase and payment remains
// traceable. Docs: docs/architecture/Debt-Accounts-and-POS-Stock-Limits.md §4.
//
// Who is the same customer:
//   * sales linked to a client record (client_id) belong to that client;
//   * a sale with no link whose name matches exactly one client (case and spacing ignored) joins that client's account;
//   * other named sales are grouped by name (flagged when several clients share the name, so nobody is merged by
//     guesswork into the wrong record);
//   * a walk-in sale with no name is its own account (an unknown person cannot be consolidated).
import { isCollectable } from './creditSearch'

const norm = (v) => String(v || '').toLowerCase().replace(/\s+/g, ' ').trim()
const toKobo = (n) => Math.round((Number(n) || 0) * 100)
const owedOf = (s) => Math.max(toKobo(s.total) - Math.min(toKobo(s.amount_paid), toKobo(s.total)), 0)
const isWalkIn = (name) => !norm(name) || norm(name) === 'walk-in' || norm(name).startsWith('walk-in ·')

export function groupCreditAccounts(sales, clients = []) {
  const clientById = new Map((clients || []).map((c) => [String(c.id), c]))
  const clientsByName = new Map()
  for (const c of clients || []) {
    const k = norm(c.full_name)
    if (!k) continue
    clientsByName.set(k, [...(clientsByName.get(k) || []), c])
  }
  const accounts = new Map()
  for (const s of (sales || []).filter(isCollectable)) {
    let key
    let client = s.client_id ? clientById.get(String(s.client_id)) : null
    let ambiguous = false
    if (s.client_id) key = 'c:' + s.client_id
    else if (isWalkIn(s.client_name)) key = 's:' + s.id
    else {
      const same = clientsByName.get(norm(s.client_name)) || []
      if (same.length === 1) { client = same[0]; key = 'c:' + client.id }
      else { key = 'n:' + norm(s.client_name); ambiguous = same.length > 1 }
    }
    if (!accounts.has(key)) {
      accounts.set(key, {
        key, clientId: client?.id || (key.startsWith('c:') ? key.slice(2) : null),
        name: client?.full_name || (isWalkIn(s.client_name) ? `Walk-in (${s.txn_no})` : String(s.client_name).trim()),
        phone: client?.phone || '', walkIn: key.startsWith('s:'), ambiguous, unlinked: 0, sales: [],
      })
    }
    const a = accounts.get(key)
    a.sales.push(s)
    if (!s.client_id && !a.walkIn) a.unlinked++
    if (ambiguous) a.ambiguous = true
  }
  return [...accounts.values()].map((a) => {
    a.sales.sort((x, y) => String(x.created_at || '').localeCompare(String(y.created_at || '')) || String(x.id).localeCompare(String(y.id)))
    let total = 0; let paid = 0; let owed = 0
    for (const s of a.sales) { total += toKobo(s.total); paid += Math.min(toKobo(s.amount_paid), toKobo(s.total)); owed += owedOf(s) }
    return {
      ...a,
      visits: a.sales.length,
      total: total / 100, paid: paid / 100, balance: owed / 100,
      oldest: a.sales[0]?.created_at || null,
      latest: a.sales[a.sales.length - 1]?.created_at || null,
    }
  })
}

// What each visit still owes, in naira.
export const visitOwed = (s) => owedOf(s) / 100

export const ACCOUNT_SORTS = {
  balance: { label: 'Largest balance', compare: (a, b) => b.balance - a.balance || a.name.localeCompare(b.name) },
  oldest: { label: 'Owing longest', compare: (a, b) => String(a.oldest || '').localeCompare(String(b.oldest || '')) },
  latest: { label: 'Latest visit', compare: (a, b) => String(b.latest || '').localeCompare(String(a.latest || '')) },
  visits: { label: 'Most visits', compare: (a, b) => b.visits - a.visits || b.balance - a.balance },
  name: { label: 'Customer A–Z', compare: (a, b) => a.name.localeCompare(b.name) },
}

// Accounts matching a name, phone or any of their transaction numbers (every word typed must appear), sorted, with
// the outstanding total of those shown.
export function searchCreditAccounts(accounts, { query = '', sort = 'balance' } = {}) {
  const q = norm(query)
  const compact = (v) => v.replace(/[^a-z0-9]/g, '')
  const results = (accounts || []).filter((a) => {
    if (!q) return true
    const txns = a.sales.map((s) => norm(s.txn_no))
    if (compact(q) && txns.some((t) => compact(t).includes(compact(q)))) return true
    const hay = [norm(a.name), norm(a.phone).replace(/\s/g, ''), ...txns].join(' ')
    return q.split(' ').every((w) => hay.includes(w))
  })
  results.sort((ACCOUNT_SORTS[sort] || ACCOUNT_SORTS.balance).compare)
  const outstanding = results.reduce((sum, a) => sum + toKobo(a.balance), 0) / 100
  return { results, outstanding, totalAccounts: (accounts || []).length }
}

// Every purchase and payment on an account, one list, oldest first: each credit sale ("purchase") and each ledger
// row (paid at the sale, a later payment, a refund), with the account balance after it. `sales` and `payments` come
// from the account (or, for a customer record, all their credit sales) and the POS ledger.
export function accountTransactions(sales = [], payments = []) {
  const byId = new Map(sales.map((s) => [String(s.id), s]))
  const events = [
    ...sales.map((s) => ({ type: 'purchase', at: s.created_at, sale: s, amount: Number(s.total) || 0 })),
    ...payments.filter((p) => byId.has(String(p.sale_id))).map((p) => ({ type: p.kind === 'refund' ? 'refund' : 'payment', at: p.received_at, sale: byId.get(String(p.sale_id)), payment: p, amount: Number(p.amount) || 0 })),
  ].sort((a, b) => String(a.at || '').localeCompare(String(b.at || '')) || (a.type === 'purchase' ? -1 : 1))
  let bal = 0
  return events.map((e) => {
    bal += toKobo(e.type === 'purchase' ? e.amount : e.type === 'refund' ? 0 : -e.amount)
    return { ...e, balance: Math.max(bal, 0) / 100 }
  })
}

// Credit accounts as export rows.
export const CREDIT_EXPORT_COLUMNS = [
  { key: 'name', header: 'Customer' },
  { key: 'phone', header: 'Phone' },
  { key: 'visits', header: 'Visits Owing' },
  { key: 'total', header: 'Total Purchased (NGN)' },
  { key: 'paid', header: 'Paid (NGN)' },
  { key: 'balance', header: 'Outstanding (NGN)' },
  { key: 'oldest', header: 'Owing Since' },
  { key: 'latest', header: 'Latest Visit' },
  { key: 'transactions', header: 'Transactions' },
]
export function creditExportRows(accounts = []) {
  return accounts.map((a) => ({
    name: a.name, phone: a.phone || '', visits: a.visits, total: a.total, paid: a.paid, balance: a.balance,
    oldest: String(a.oldest || '').slice(0, 10), latest: String(a.latest || '').slice(0, 10),
    transactions: a.sales.map((s) => `${s.txn_no} (${visitOwed(s)})`).join('; '),
  }))
}
