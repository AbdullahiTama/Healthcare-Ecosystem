// Pure CSV-import helpers for the Territories bulk upload, extracted from the
// page so the rules are unit-testable. Mirrors inventory/csvImport.js.
//
// Column contract (positional — the header row is display-only):
//   0 Territory Name · 1 Level (optional) · 2 Sits Under (name, optional)
//
// The parent is referenced BY NAME because a spreadsheet author cannot know
// database ids; resolution against existing territories happens in
// resolveTerritoryUpload at import time.

/**
 * Parses uploaded territory CSV text into { name, level, parent_name } rows.
 * Returns { rows, error } — error is null on success, otherwise a
 * user-facing message. Rows without a name are skipped.
 */
export function parseTerritoryCsv(text) {
  const lines = String(text || '').split('\n').filter(l => l.trim())
  if (lines.length < 2) return { rows: [], error: 'File is empty or has no territories.' }

  const rows = []
  for (const line of lines.slice(1)) {
    // Quote-aware split: commas inside "quoted values" don't break columns.
    const cols = line.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map(c => c.replace(/^"|"$/g, '').trim())
    if (!cols[0]) continue
    rows.push({ name: cols[0], level: cols[1] || '', parent_name: cols[2] || '' })
  }

  if (rows.length === 0) return { rows: [], error: 'No valid territories found.' }
  return { rows, error: null }
}

/**
 * Turns parsed rows into a two-pass upload plan against the business's
 * existing territories:
 *   creates     — [{ name, level, parent_territory_id }] first-pass inserts.
 *                 parent_territory_id is set only when the parent ALREADY
 *                 exists in the database; everything else inserts top-level.
 *   parentLinks — [{ name, parent_name }] second-pass PATCHes: children whose
 *                 parent is created by this same file. The caller resolves
 *                 names to ids after the inserts land and patches each child.
 *   skipped     — names already in the database or duplicated in-file
 *                 (case-insensitive)
 *   invalid     — file positions of rows with no name ("row 3")
 *   failed      — [{ name, row, reason }] rows that can never link: unknown
 *                 parent name, or membership in / hanging off a circular
 *                 hierarchy inside the file.
 */
export function resolveTerritoryUpload(rows, existingTerritories) {
  const known = new Map(
    (existingTerritories || []).filter(t => t && t.name).map(t => [t.name.toLowerCase(), t]),
  )
  const pending = [] // rows that will definitely be created (parent already in DB, or no parent)
  const deferred = new Map() // lower(name) -> { name, level, row, parent_name }
  const skipped = []
  const invalid = []

  // Pass 1: park every valid row; defer any whose parent isn't already in the
  // database (it may be created later in this same file).
  rows.forEach((r, i) => {
    const name = String(r?.name || '').trim()
    if (!name) { invalid.push('row ' + (i + 1)); return }
    const key = name.toLowerCase()
    if (known.has(key)) { skipped.push(name); return }

    const parentName = String(r?.parent_name || '').trim()
    let parent_territory_id = null
    if (parentName) {
      const parent = known.get(parentName.toLowerCase())
      if (parent?.id) parent_territory_id = parent.id
    }

    if (parentName && !parent_territory_id) {
      deferred.set(key, { name, level: String(r?.level || '').trim() || null, row: i + 1, parent_name: parentName })
    } else {
      pending.push({ name, level: String(r?.level || '').trim() || null, parent_territory_id, row: i + 1 })
    }
    // Register only AFTER dedupe checks so a later duplicate of this name is
    // skipped — and WITHOUT an id, so it can never serve as an existing parent.
    known.set(key, { name })
  })

  // Pass 2 classification: walk each deferred child up its in-file parent
  // chain. A chain terminates safely when it reaches a row that resolved to a
  // real id in pass 1; it dead-ends at a name nothing created (unknown) or
  // loops forever (cycle). Memoized so shared tails are walked once.
  const statusOf = new Map() // key -> true (resolvable) | false (circular)

  const resolves = (key, path) => {
    if (statusOf.has(key)) return statusOf.get(key)
    const node = deferred.get(key)
    if (!node) return true // not deferred → its parent got a real id in pass 1
    const cycleStart = path.indexOf(key)
    if (cycleStart !== -1) {
      for (let i = cycleStart; i < path.length; i++) statusOf.set(path[i], false)
      return false
    }
    const ok = resolves(node.parent_name.toLowerCase(), [...path, key])
    statusOf.set(key, ok)
    return ok
  }

  const creates = []
  const parentLinks = []
  const failed = []

  pending.forEach(p => creates.push({ name: p.name, level: p.level, parent_territory_id: p.parent_territory_id }))
  deferred.forEach((node, key) => {
    if (!pending.some(p => p.name.toLowerCase() === node.parent_name.toLowerCase()) &&
        !deferred.has(node.parent_name.toLowerCase())) {
      failed.push({ name: node.name, row: node.row, reason: 'Unknown parent "' + node.parent_name + '"' })
      return
    }
    if (resolves(key, [])) {
      creates.push({ name: node.name, level: node.level, parent_territory_id: null })
      parentLinks.push({ name: node.name, parent_name: node.parent_name })
    } else {
      failed.push({ name: node.name, row: node.row, reason: 'Circular hierarchy detected' })
    }
  })

  // Restore file order so previews read like the spreadsheet.
  const rowIndex = new Map()
  rows.forEach((r, i) => { if (r?.name) rowIndex.set(String(r.name).trim().toLowerCase(), i) })
  creates.sort((a, b) => (rowIndex.get(a.name.toLowerCase()) ?? 0) - (rowIndex.get(b.name.toLowerCase()) ?? 0))

  return { creates, parentLinks, skipped, invalid, failed }
}
