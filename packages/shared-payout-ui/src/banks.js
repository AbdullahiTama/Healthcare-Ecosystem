// Payout bank list helpers. Pure functions only: this module is imported by
// the browser bundles (search/sort) and by the serverless APIs (merge/rank).
//
// The authoritative bank list is ALWAYS Paystack's own /bank response. Bank
// codes are never hand-typed here: a wrong code sends money to the wrong
// institution, and fintech codes (OPay, PalmPay, Kuda, Moniepoint) are not the
// CBN codes people assume. We only decide ORDER (popular first) and pick them
// out by name. If Paystack is unreachable the caller serves its last good copy
// or fails — the same outage would also break account resolution, so a
// static fallback list would only let people pick a bank they cannot use.

// Display order of the banks people ask for most. Each entry matches the
// normalised provider name (see normalizeBankName); the first provider bank
// that matches wins its slot. "Money Point" is Moniepoint.
const POPULAR_MATCHERS = [
  { key: 'access', test: (n) => /^access bank(?! \(diamond\))/.test(n) },
  { key: 'gtbank', test: (n) => n.includes('guaranty trust') || n.includes('gtbank') },
  { key: 'uba', test: (n) => n.includes('united bank for africa') || n === 'uba' },
  { key: 'zenith', test: (n) => n.startsWith('zenith') },
  { key: 'firstbank', test: (n) => n.startsWith('first bank') },
  { key: 'fcmb', test: (n) => n.includes('first city monument') || n === 'fcmb' },
  { key: 'sterling', test: (n) => n.startsWith('sterling') },
  { key: 'fidelity', test: (n) => n.startsWith('fidelity') },
  { key: 'stanbic', test: (n) => n.startsWith('stanbic') },
  { key: 'union', test: (n) => n.startsWith('union bank') },
  { key: 'wema', test: (n) => n === 'wema bank' },
  { key: 'polaris', test: (n) => n.startsWith('polaris') },
  { key: 'jaiz', test: (n) => n.startsWith('jaiz') },
  { key: 'opay', test: (n) => n.startsWith('opay') },
  { key: 'palmpay', test: (n) => n.startsWith('palmpay') },
  { key: 'moniepoint', test: (n) => n.startsWith('moniepoint') },
  { key: 'kuda', test: (n) => n.startsWith('kuda') },
]

export function normalizeBankName(name) {
  return String(name || '').toLowerCase().replace(/\s+/g, ' ').trim()
}

// Takes the raw provider list and returns one entry per bank code, popular
// banks first (in POPULAR_MATCHERS order) then the rest A–Z. Entries without a
// code or name are dropped. The input is not mutated.
export function rankBanks(providerBanks) {
  const byCode = new Map()
  for (const b of providerBanks || []) {
    if (!b || !b.code || !b.name) continue
    const code = String(b.code)
    if (!byCode.has(code)) byCode.set(code, { code, name: String(b.name).trim(), slug: b.slug || '' })
  }

  const all = Array.from(byCode.values())
  const claimed = new Set()
  const popular = []
  for (const matcher of POPULAR_MATCHERS) {
    const hit = all.find((b) => !claimed.has(b.code) && matcher.test(normalizeBankName(b.name)))
    if (hit) {
      claimed.add(hit.code)
      popular.push({ ...hit, popular: true })
    }
  }

  const rest = all
    .filter((b) => !claimed.has(b.code))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((b) => ({ ...b, popular: false }))

  return [...popular, ...rest]
}

// Case-insensitive substring search used by the bank picker. Matches every
// whitespace-separated token anywhere in the name, so "gt bank" finds
// "Guaranty Trust Bank" only if both tokens occur, and "mon" finds Moniepoint.
// Popular banks keep their lead position among matches.
export function searchBanks(banks, query) {
  const tokens = normalizeBankName(query).split(' ').filter(Boolean)
  if (tokens.length === 0) return banks
  return banks.filter((b) => {
    const n = normalizeBankName(b.name)
    return tokens.every((t) => n.includes(t))
  })
}

// Account numbers are NUBAN: exactly 10 digits.
export function isValidAccountNumber(value) {
  return typeof value === 'string' && /^\d{10}$/.test(value)
}
