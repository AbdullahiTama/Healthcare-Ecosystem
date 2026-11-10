// Shared by the bulk deletes on Inventory (delete_products) and Clients (delete_clients): turning the database
// functions' refusal codes into sentences, and grouping the restorable copies (deleted_products / deleted_clients)
// into one entry per deletion.

const refusals = (noun) => ({
  DELETE_NOT_ALLOWED: 'Only the owner, or a role allowed to delete, can do this.',
  DELETE_ALL_OWNER_ONLY: `Only the owner can delete every ${noun}.`,
  DELETE_ALL_CONFIRM: 'Type DELETE ALL PRODUCTS exactly to confirm.',
  DELETE_NONE: `Choose at least one ${noun}.`,
  DELETE_TOO_MANY: `Delete at most 5,000 ${noun}s at a time.`,
  RESTORE_NOT_FOUND: 'That deletion was not found. It may have been restored already.',
})

// Only the functions' own codes become sentences (`.code` kept). A missing function (the update is not installed
// yet) becomes code DELETE_UNAVAILABLE; anything else (a network failure above all) is returned untouched.
export function translateBulkDeleteError(error, noun = 'record') {
  const msg = String(error?.message || '')
  if (/PGRST20[25]|Could not find the (function|table)/i.test(msg)) {
    const e = new Error('Bulk delete needs the latest CareHub update, which is not installed yet.')
    e.code = 'DELETE_UNAVAILABLE'
    return e
  }
  const table = refusals(noun)
  const code = Object.keys(table).find((c) => msg.includes(c))
  if (!code) return error
  const friendly = new Error(table[code])
  friendly.code = code
  return friendly
}

// Rows of deleted_products / deleted_clients (newest first) → one entry per deletion:
// { deletion_id, deleted_at, by, all, count, restored, names (first three) }.
export function groupDeletions(rows, nameKey) {
  const by = new Map()
  for (const r of rows || []) {
    if (!by.has(r.deletion_id)) by.set(r.deletion_id, { deletion_id: r.deletion_id, deleted_at: r.deleted_at, by: r.deleted_by_name || null, all: !!r.deleted_all, count: 0, restored: 0, names: [] })
    const d = by.get(r.deletion_id)
    d.count++
    if (r.restored_at) d.restored++
    if (d.names.length < 3 && r[nameKey]) d.names.push(r[nameKey])
  }
  return [...by.values()]
}
