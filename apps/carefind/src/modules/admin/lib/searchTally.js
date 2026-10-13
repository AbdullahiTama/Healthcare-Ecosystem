const keyOf = (row) => (typeof row?.query === 'string' ? row.query.toLowerCase().trim() : '')

function tally(rows, limit) {
  const counts = new Map()
  for (const row of rows) {
    const key = keyOf(row)
    if (key) counts.set(key, (counts.get(key) || 0) + 1)
  }
  // Array.prototype.sort is stable, so ties keep first-seen order.
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit)
}

export const tallyTerms = (rows, limit = 12) => tally(rows, limit)
export const demandGaps = (rows, limit = 15) => tally(rows.filter(r => !r.found), limit)
