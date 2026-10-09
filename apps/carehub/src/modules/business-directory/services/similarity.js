// ── String similarity ─────────────────────────────────────────────────────────
// Two complementary measures, because each fails where the other works:
//  - edit-distance ratio catches typos and spelling variants ("Pharmacy"/"Pharmcy")
//  - token Dice catches reordering and extra words ("Alpha Pharmacy Yaba"/"Yaba Alpha Pharmacy")
// The score is the larger of the two.

export function levenshtein(a, b) {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  let prev = new Array(b.length + 1)
  let cur = new Array(b.length + 1)
  for (let j = 0; j <= b.length; j++) prev[j] = j
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost)
    }
    ;[prev, cur] = [cur, prev]
  }
  return prev[b.length]
}

export function editRatio(a, b) {
  if (!a || !b) return 0
  const max = Math.max(a.length, b.length)
  return 1 - levenshtein(a, b) / max
}

export function tokenDice(a, b) {
  const ta = new Set(String(a || '').split(' ').filter(Boolean))
  const tb = new Set(String(b || '').split(' ').filter(Boolean))
  if (!ta.size || !tb.size) return 0
  let hit = 0
  ta.forEach((t) => { if (tb.has(t)) hit++ })
  return (2 * hit) / (ta.size + tb.size)
}

/** Inputs must already be normalised. Returns 0..1. */
export function similarity(a, b) {
  if (!a || !b) return 0
  if (a === b) return 1
  return Math.max(editRatio(a, b), tokenDice(a, b))
}
