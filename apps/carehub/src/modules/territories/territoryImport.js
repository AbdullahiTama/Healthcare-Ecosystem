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
 * Turns parsed rows into insertable payloads against the business's existing
 * territories. Returns:
 *   fresh            — [{ name, level, parent_territory_id }] ready to insert
 *   skipped          — names already in the database or duplicated in-file
 *                      (case-insensitive)
 *   invalid          — file positions of rows with no name ("row 3")
 *   unresolvedParents— count of rows whose "Sits Under" name matches nothing
 *                      that exists yet (including names later in the same
 *                      file). They import as top-level rather than pointing at
 *                      a row parallel batch inserts cannot guarantee exists.
 */
export function resolveTerritoryUpload(rows, existingTerritories) {
  const known = new Map(
    (existingTerritories || []).filter(t => t && t.name).map(t => [t.name.toLowerCase(), t]),
  )
  const fresh = []
  const skipped = []
  const invalid = []
  let unresolvedParents = 0

  rows.forEach((r, i) => {
    const name = String(r?.name || '').trim()
    if (!name) { invalid.push('row ' + (i + 1)); return }
    const key = name.toLowerCase()
    if (known.has(key)) { skipped.push(name); return }

    const parentName = String(r?.parent_name || '').trim().toLowerCase()
    let parent_territory_id = null
    if (parentName) {
      const parent = known.get(parentName)
      if (parent?.id) parent_territory_id = parent.id
      else unresolvedParents++
    }

    fresh.push({ name, level: String(r?.level || '').trim() || null, parent_territory_id })
    // Register only AFTER dedupe checks so a later duplicate of this name is
    // skipped — but deliberately NOT as a resolvable parent: parents must
    // already exist in the database (see unresolvedParents above).
    known.set(key, { name })
  })

  return { fresh, skipped, invalid, unresolvedParents }
}
