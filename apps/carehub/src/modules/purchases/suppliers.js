// Supplier matching for the Record / Edit purchase form. Purchases are keyed by
// supplier_name: the database groups names ignoring case and surrounding spaces
// (lower(btrim(name)), get_supplier_balances and the analytics). Picking an
// existing supplier, rather than retyping it, is what keeps one supplier's
// spending and debts together.

// The database's grouping key.
export const supplierKey = (name) => String(name || '').trim().toLowerCase()

// A looser key for "did you mean": punctuation, spacing and the usual company
// suffixes ignored, so "Medsupply Ltd." and "MedSupply Limited" meet.
const SUFFIXES = /\b(ltd|limited|plc|nig|nigeria|enterprises?|ent|co|company|inc|ventures?|int'?l|international|and|&)\b/g
export function looseSupplierKey(name) {
  return String(name || '').toLowerCase().replace(/[.,'()&-]/g, ' ').replace(SUFFIXES, ' ').replace(/[^a-z0-9]/g, '')
}

// One shape for supplier rows from get_purchase_supplier_stats (carehub_20261229)
// or get_supplier_balances (older databases).
export function toSupplier(row) {
  return {
    key: row.supplier_key || supplierKey(row.supplier_name),
    name: String(row.supplier_name || '').trim(),
    purchaseCount: Number(row.purchase_count) || 0,
    totalSpent: Number(row.total_spent ?? row.total_cost) || 0,
    paid: Number(row.amount_paid) || 0,
    balance: Number(row.balance) || 0,
    lastDate: row.last_date || (row.last_purchase_at ? String(row.last_purchase_at).slice(0, 10) : null),
    lastTotal: row.last_total != null ? Number(row.last_total) : null,
  }
}

// What the typed text means against the known suppliers:
//   exact     the supplier it is (same key), or null;
//   similar   suppliers it probably duplicates (same loose key, or one name
//             containing the other), when it is not exact;
//   matches   suggestions for the list, best first, at most `limit`.
export function matchSupplier(suppliers, text, limit = 8) {
  const typed = String(text || '').trim()
  const key = supplierKey(typed)
  const loose = looseSupplierKey(typed)
  const list = suppliers || []
  const exact = key ? list.find((s) => s.key === key) || null : null
  const similar = !exact && loose.length >= 3
    ? list.filter((s) => {
      const other = looseSupplierKey(s.name)
      return other && (other === loose || (other.length >= 4 && loose.length >= 4 && (other.includes(loose) || loose.includes(other))))
    }).slice(0, 3)
    : []
  const rank = (s) => (s.key === key ? 0 : s.key.startsWith(key) ? 1 : 2)
  const matches = (key ? list.filter((s) => s.key.includes(key) || looseSupplierKey(s.name).includes(loose)) : list)
    .slice()
    .sort((a, b) => rank(a) - rank(b) || (b.lastDate || '').localeCompare(a.lastDate || '') || a.name.localeCompare(b.name))
    .slice(0, limit)
  return { exact, similar, matches }
}
