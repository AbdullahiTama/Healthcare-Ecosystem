import { matchesText } from '../../lib/recordFilters'

// Whole kobo, so adding many naira amounts never drifts (0.1 + 0.2).
const toKobo = (n) => Math.round((Number(n) || 0) * 100)

// Outstanding totals for a list of debts: what clients owe the business and what it owes others, with how many debts
// in each direction still have a balance. `outstanding` is both directions together (everything still to settle).
// Used for the whole list and for the rows the filters leave.
export function debtTotals(debts = []) {
  let owedToUs = 0
  let weOwe = 0
  const t = { openOwedToUs: 0, openWeOwe: 0, count: 0 }
  for (const d of debts) {
    t.count++
    const bal = Math.max(toKobo(d.balance), 0)
    if (d.direction === 'owes_us') { owedToUs += bal; if (bal > 0) t.openOwedToUs++ }
    else if (d.direction === 'we_owe') { weOwe += bal; if (bal > 0) t.openWeOwe++ }
  }
  return { ...t, owedToUs: owedToUs / 100, weOwe: weOwe / 100, outstanding: (owedToUs + weOwe) / 100 }
}

// Does a debt match the party-name search (case and extra spaces ignored)?
export function matchesParty(debt, search) {
  return matchesText([debt?.party_name], search)
}
