// Who a debt belongs to: the client record (money owed to us) or the supplier account (money we owe).
// Pure: decides from the lists it is given and never touches the database. Used by Record Debt (live, while typing)
// and by "Link to clients". Docs: docs/architecture/Debt-Accounts-and-POS-Stock-Limits.md §2
//
// Clients are rows of the `clients` table. Suppliers have no table: a supplier account is every purchase and every
// hand-recorded "we owe" debt (supply record) under one name, grouped by the database's key lower(btrim(name))
// (purchases/suppliers.js, get_supplier_accounts). So linking a supplier debt means saving it under the supplier's
// existing spelling; a new name starts a new account. The Excel/CSV import applies the same rules in the database
// (import_debts, carehub_20270117); this module is the Record Debt form's side.
import { exactClient } from '../pos/customerPick'
import { supplierKey, matchSupplier } from '../purchases/suppliers'

const norm = (v) => String(v || '').toLowerCase().replace(/\s+/g, ' ').trim()
// A phone number compared by its digits, without the +234 / 0 prefix.
export const phoneKey = (v) => String(v || '').replace(/\D/g, '').replace(/^(234|0)/, '')
const MIN_PHONE_DIGITS = 7

export const MAX_PARTY_NAME = 200

/**
 * input: { direction: 'owes_us' | 'we_owe', partyName, phone?, clientId? (a client picked from the list) }
 * ctx:   { clients: client rows, suppliers: [{ key, name }] }
 *
 * Returns one of:
 *   { kind: 'client', client, name, note? }       an existing client (note: why, when matched by phone)
 *   { kind: 'new-client', name, phone }          no client by that name or phone: one is created, then linked
 *   { kind: 'ambiguous', name, choices }         two or more clients share the name: the person must pick one
 *   { kind: 'supplier', key, name }              an existing supplier; name is their saved spelling
 *   { kind: 'new-supplier', key, name, similar } a new supplier account; similar: names it may duplicate
 *   { kind: 'invalid', error }
 */
export function resolveDebtParty(input, { clients = [], suppliers = [] } = {}) {
  const name = String(input?.partyName || '').trim().replace(/\s+/g, ' ')
  if (!name) return { kind: 'invalid', error: 'Party name is missing.' }
  if (name.length > MAX_PARTY_NAME) return { kind: 'invalid', error: 'Party name is too long (200 characters at most).' }

  if (input?.direction === 'we_owe') {
    // Trimmed only: the supplier key is lower(btrim(name)), so inner spacing is kept exactly as the database groups it.
    const typed = String(input.partyName).trim()
    const { exact, similar } = matchSupplier(suppliers, typed)
    if (exact) return { kind: 'supplier', key: exact.key, name: exact.name }
    return { kind: 'new-supplier', key: supplierKey(typed), name: typed, similar: similar.map((s) => s.name) }
  }
  if (input?.direction !== 'owes_us') return { kind: 'invalid', error: 'Direction must be "Owed to us" or "We owe".' }
  if (norm(name) === 'walk-in') return { kind: 'invalid', error: 'Use the customer\'s name, not Walk-in, so the debt can be followed up.' }

  // A client picked from the list wins while the name still matches it.
  const picked = input?.clientId ? clients.find((c) => String(c.id) === String(input.clientId)) : null
  if (picked && norm(picked.full_name) === norm(name)) return { kind: 'client', client: picked, name: picked.full_name }

  const phone = String(input?.phone || '').trim()
  const pk = phoneKey(phone)
  if (pk.length >= MIN_PHONE_DIGITS) {
    const byPhone = clients.filter((c) => phoneKey(c.phone) === pk)
    if (byPhone.length === 1) {
      const c = byPhone[0]
      return { kind: 'client', client: c, name: c.full_name, note: norm(c.full_name) === norm(name) ? undefined : `Phone ${phone} belongs to ${c.full_name}; the debt is linked to them.` }
    }
  }

  const exact = exactClient(clients, name)
  if (exact) return { kind: 'client', client: exact, name: exact.full_name }
  const same = clients.filter((c) => norm(c.full_name) === norm(name))
  if (same.length > 1) return { kind: 'ambiguous', name, choices: same }
  return { kind: 'new-client', name, phone: pk.length >= MIN_PHONE_DIGITS ? phone : '' }
}

/** One line for the person: where the debt will go. */
export function describeParty(r) {
  switch (r?.kind) {
    case 'client': return `Linked to client ${r.name}`
    case 'new-client': return `New client record for ${r.name}`
    case 'ambiguous': return `${r.choices.length} clients are named ${r.name}: pick one`
    case 'supplier': return `Added to supplier ${r.name}`
    case 'new-supplier': return `New supplier account for ${r.name}`
    default: return r?.error || ''
  }
}

/**
 * Every supplier to offer and match against: those bought from (the purchases' supplier directory) plus those known
 * only from a "we owe" debt already recorded by hand (`debts`: the Debts page's rows). One entry per supplier key
 * (the database's lower(btrim(name)), so the list shows the accounts exactly as the supplier summary groups them).
 */
export function knownSuppliers(directory = [], debts = []) {
  const byKey = new Map((directory || []).filter((s) => s?.key).map((s) => [s.key, { key: s.key, name: s.name }]))
  for (const d of debts || []) {
    // A "we owe" debt linked to a client is what the business owes that client (an opening balance), not a supplier.
    if (d?.direction !== 'we_owe' || d.source === 'purchase' || d.source === 'credit_sale' || d.client_id) continue
    const key = supplierKey(d.party_name)
    if (key && !byKey.has(key)) byKey.set(key, { key, name: String(d.party_name).trim() })
  }
  return [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name))
}
