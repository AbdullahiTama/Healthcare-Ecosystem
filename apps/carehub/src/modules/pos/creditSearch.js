// Finding and summarising outstanding credit sales on the POS Credit tab.
// Pure functions: the list is the open credit sales already loaded by
// useOpenSales (paged, so every outstanding sale is there), and searching it in
// memory is instant even for hundreds of customers.

function norm(value) {
  return String(value || '').toLowerCase().replace(/\s+/g, ' ').trim()
}

// Matches the customer's name or the transaction number, ignoring case and
// extra spaces. Every word typed must appear (so "ada obi" finds "Obi Ada").
// A transaction number also matches without its separators ("TXN1234" finds
// "TXN-1234").
export function matchesCreditSearch(sale, query) {
  const q = norm(query)
  if (!q) return true
  const name = norm(sale.client_name || 'Walk-in')
  const txn = norm(sale.txn_no)
  const compact = (s) => s.replace(/[^a-z0-9]/g, '')
  if (txn.includes(q) || (compact(q) && compact(txn).includes(compact(q)))) return true
  return q.split(' ').every((word) => name.includes(word) || txn.includes(word))
}

export const CREDIT_SORTS = {
  newest: { label: 'Newest first', compare: (a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')) },
  oldest: { label: 'Oldest first', compare: (a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')) },
  balance: { label: 'Largest balance', compare: (a, b) => (Number(b.balance) || 0) - (Number(a.balance) || 0) },
  name: { label: 'Customer A–Z', compare: (a, b) => norm(a.client_name || 'Walk-in').localeCompare(norm(b.client_name || 'Walk-in')) },
}

// The outstanding credit sales that match, sorted, with their total balance.
export function searchCreditSales(sales, { query = '', sort = 'newest' } = {}) {
  const open = (sales || []).filter((s) => s.is_credit && Number(s.balance) > 0 && !s.is_on_hold)
  const results = open.filter((s) => matchesCreditSearch(s, query))
  results.sort((CREDIT_SORTS[sort] || CREDIT_SORTS.newest).compare)
  const outstanding = Math.round(results.reduce((sum, s) => sum + (Number(s.balance) || 0), 0) * 100) / 100
  return { results, outstanding, totalOpen: open.length }
}
