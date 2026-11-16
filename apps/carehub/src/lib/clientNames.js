// A client's CURRENT name wherever a record is linked to them (client_id), while the record itself keeps the name it
// was saved with. Sales keep `client_name` and debts `party_name` as written at the time (receipts, the audit trail):
// editing a client never rewrites them. Screens show the current name through these helpers, so an edit is reflected
// in the POS, Debts and reports at once, and say what the record was saved as when the two differ.
// Docs: docs/architecture/Client-Edit.md.

/** Clients by id (string), for the lookups below. */
export function clientsById(clients) {
  return new Map((clients || []).map((c) => [String(c.id), c]))
}

/**
 * { name, recordedAs } for one record: `name` is the linked client's current full name, or the saved name when the
 * record is not linked (or its client is not in the list); `recordedAs` is the saved name when it differs, else ''.
 */
export function currentClientName(record, byId, field, fallback = '') {
  const saved = String(record?.[field] ?? '').trim()
  const client = record?.client_id != null ? byId?.get(String(record.client_id)) : null
  const current = String(client?.full_name ?? '').trim()
  if (!current) return { name: saved || fallback, recordedAs: '' }
  return { name: current, recordedAs: saved && saved !== current ? saved : '' }
}

/**
 * The rows with `field` set to the linked client's current name (for display, search, sort and export) and
 * `recorded_name` holding the saved name when it differs. Rows without a linked client are returned as they are.
 * Never write these copies back: they are a view.
 */
export function withCurrentClientNames(rows, byId, field) {
  if (!byId || !byId.size) return rows || []
  return (rows || []).map((r) => {
    if (r?.client_id == null) return r
    const { name, recordedAs } = currentClientName(r, byId, field)
    return name === r[field] && !recordedAs ? r : { ...r, [field]: name, recorded_name: recordedAs }
  })
}
