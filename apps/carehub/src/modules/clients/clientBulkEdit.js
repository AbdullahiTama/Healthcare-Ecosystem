// Bulk edit for Clients: what a set of changes does to the clients the user marked. Pure, pinned by
// clientBulkEdit.test.js. Sending uses the shared lib/bulkUpdates.js.
//
// Deliberately not editable here: name, phone and email (each client's own; the phone is also the duplicate check),
// and visits / total spent, which the database keeps from sales (refresh_client_totals).

export const CLIENT_GENDERS = ['Male', 'Female', 'Other']
export const EMPTY_CLIENT_BULK_EDIT = Object.freeze({ gender: '', address: '', note: '' })
const MAX_NOTES = 2000

// Field errors ({ field: message }) and whether anything would change.
export function validateClientBulkEdit(changes) {
  const c = { ...EMPTY_CLIENT_BULK_EDIT, ...changes }
  const errors = {}
  if (c.gender && !CLIENT_GENDERS.includes(c.gender)) errors.gender = 'Choose Male, Female or Other.'
  if (c.address.trim().length > 300) errors.address = 'Keep the address under 300 characters.'
  if (c.note.trim().length > 500) errors.note = 'Keep the note under 500 characters.'
  return { errors, ok: Object.keys(errors).length === 0, hasChanges: !!(c.gender || c.address.trim() || c.note.trim()) }
}

// A note is added to the end of each client's notes, dated, so nothing already written is lost.
export function appendNote(existing, note, today) {
  const line = `${today}: ${note.trim().replace(/\s+/g, ' ')}`
  const prev = String(existing || '').trim()
  return (prev ? prev + '\n' + line : line).slice(-MAX_NOTES)
}

// One entry per client that would actually change: { id, name, updates, before }.
export function planClientBulkEdit(clients, changes, { today }) {
  const c = { ...EMPTY_CLIENT_BULK_EDIT, ...changes }
  if (!validateClientBulkEdit(c).ok) return []
  const plan = []
  for (const cl of clients || []) {
    const updates = {}
    const before = {}
    if (c.gender && cl.gender !== c.gender) { updates.gender = c.gender; before.gender = cl.gender || null }
    const address = c.address.trim()
    if (address && (cl.address || '').trim() !== address) { updates.address = address; before.address = cl.address || null }
    if (c.note.trim()) { updates.notes = appendNote(cl.notes, c.note, today); before.notes = cl.notes || null }
    if (Object.keys(updates).length) plan.push({ id: cl.id, name: cl.full_name, updates, before })
  }
  return plan
}
