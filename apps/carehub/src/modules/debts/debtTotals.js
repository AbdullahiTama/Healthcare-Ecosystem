// Outstanding totals for a list of debts: what clients owe the business and what it owes others, with how many debts
// in each direction still have a balance. Used for the whole list and for the rows a search or month filter leaves.
export function debtTotals(debts = []) {
  const t = { owedToUs: 0, weOwe: 0, openOwedToUs: 0, openWeOwe: 0, count: 0 }
  for (const d of debts) {
    t.count++
    const bal = Math.max(Number(d.balance) || 0, 0)
    if (d.direction === 'owes_us') { t.owedToUs += bal; if (bal > 0) t.openOwedToUs++ }
    else if (d.direction === 'we_owe') { t.weOwe += bal; if (bal > 0) t.openWeOwe++ }
  }
  return t
}

// Does a debt match the party-name search (case and extra spaces ignored)?
export function matchesParty(debt, search) {
  const q = String(search || '').toLowerCase().replace(/\s+/g, ' ').trim()
  if (!q) return true
  return String(debt?.party_name || '').toLowerCase().replace(/\s+/g, ' ').includes(q)
}
