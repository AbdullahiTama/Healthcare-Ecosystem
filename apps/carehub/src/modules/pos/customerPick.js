// Finding the customer record a sale (above all a credit sale) belongs to.
// Pure functions over the business's client list (useClients, every row).

const norm = (v) => String(v || '').toLowerCase().replace(/\s+/g, ' ').trim()
const digits = (v) => String(v || '').replace(/\D/g, '')

// Customers matching what the cashier typed: every word of the name in any
// order, or the phone number (3+ digits, spaces and +234/0 prefixes ignored).
// Name-prefix matches first, then alphabetical.
export function findClientMatches(clients, query, limit = 8) {
  const q = norm(query)
  if (!q) return []
  const words = q.split(' ')
  const qDigits = digits(q)
  const phoneTail = qDigits.replace(/^(234|0)/, '')
  const hits = (clients || []).filter((c) => {
    const name = norm(c.full_name)
    if (words.every((w) => name.includes(w))) return true
    if (phoneTail.length >= 3) return digits(c.phone).replace(/^(234|0)/, '').includes(phoneTail)
    return false
  })
  hits.sort((a, b) => {
    const pa = norm(a.full_name).startsWith(q) ? 0 : 1
    const pb = norm(b.full_name).startsWith(q) ? 0 : 1
    return pa - pb || norm(a.full_name).localeCompare(norm(b.full_name))
  })
  return hits.slice(0, limit)
}

// The one customer whose name is exactly this (case and spacing ignored), or
// null when there is none or more than one: two "Ada Obi" records must be told
// apart by the cashier, never guessed.
export function exactClient(clients, name) {
  const n = norm(name)
  if (!n || n === 'walk-in') return null
  const found = (clients || []).filter((c) => norm(c.full_name) === n)
  return found.length === 1 ? found[0] : null
}

// The customer a credit sale is recorded against: the one the cashier picked,
// as long as the name on the sale still matches it; otherwise an unambiguous
// exact match on the typed name; otherwise none (the sale cannot proceed).
export function creditCustomerFor(selected, typedName, clients) {
  if (selected && norm(selected.full_name) === norm(typedName)) return selected
  return exactClient(clients, typedName)
}
