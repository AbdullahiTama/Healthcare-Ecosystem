import { directoryRepository } from '../directory/repositories'
import { buildSearchParams, MAX_LIMIT } from './searchQuery'

// Business Discovery is READ-ONLY. Nothing in this file writes to the database:
// searching, viewing and exporting never create a field activity, a visit,
// attendance or a manager notification.

export const EXPORT_CAP = 1000

const CSV_COLUMNS = [
  ['name', 'Name'], ['category', 'Category'], ['address', 'Address'], ['city', 'City'], ['state', 'State'],
  ['lga', 'LGA'], ['phone', 'Phone'], ['email', 'Email'], ['website', 'Website'],
  ['verification_status', 'Verification'], ['data_source', 'Source'],
  ['distance_m', 'Straight-line distance (m)'], ['latitude', 'Latitude'], ['longitude', 'Longitude'],
]

// A cell starting with = + - @ or a tab/CR is executed as a formula by
// spreadsheet software; neutralise it, then quote per RFC 4180.
function csvCell(v) {
  let s = v == null ? '' : String(v)
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
}

// Contact person and internal notes are in a separate admin-only table and are
// never part of a search row, so they cannot appear here.
export function buildDirectoryCsv(rows, categories = []) {
  const catName = (id) => (categories.find((c) => c.id === id) || {}).name || ''
  const lines = [CSV_COLUMNS.map((c) => csvCell(c[1])).join(',')]
  for (const r of rows) {
    lines.push(CSV_COLUMNS.map(([key]) => csvCell(key === 'category' ? catName(r.category_id) : r[key])).join(','))
  }
  return lines.join('\r\n') + '\r\n'
}

export function createDiscoveryService(repo = directoryRepository) {
  return {
    // -> { rows, total, hasMore, distanceBasis, radiusM } or throws Error(message)
    async search(filters) {
      const { params, error } = buildSearchParams(filters)
      if (error) throw new Error(error)
      return repo.discover(params)
    },

    // Walks the SAME filters page by page (so the export matches what the user
    // sees), stopping at EXPORT_CAP. Reports whether the cap truncated it.
    async exportAll(filters, { cap = EXPORT_CAP, onProgress = () => {} } = {}) {
      const rows = []
      let offset = 0
      let total = 0
      let truncated = false
      for (;;) {
        const { params, error } = buildSearchParams({ ...filters, limit: MAX_LIMIT, offset })
        if (error) throw new Error(error)
        const page = await repo.discover(params)
        total = page.total
        rows.push(...page.rows)
        onProgress({ fetched: Math.min(rows.length, cap), total: Math.min(total, cap) })
        if (rows.length >= cap) { truncated = page.hasMore || rows.length > cap; break }
        if (!page.hasMore || page.rows.length === 0) break
        offset += page.rows.length
      }
      return { rows: rows.slice(0, cap), total, truncated }
    },
  }
}

export const discoveryService = createDiscoveryService()
