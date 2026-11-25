// Shared building blocks for checking and saving bulk uploads from Excel / CSV (Inventory; Purchases uses the
// value parsers and table reader). Reading the file is lib/spreadsheet.js. Pure, except saveInBatches.
//
// The rule every upload follows: each row submitted is accounted for. A row is
// saved, skipped as a duplicate, refused with the reason, or failed with the
// database's reason; never silently dropped. The rows that were not saved can
// be downloaded as a file in the same columns, fixed and uploaded again; the
// rows already saved are then recognised as duplicates, so nothing is saved
// twice.
//
// Docs: docs/architecture/Bulk-Uploads-and-Debt-Linking.md

import { lookupKey } from '../modules/business-directory/services/normalize'

function realDate(y, m, d) {
  const dt = new Date(Date.UTC(y, m - 1, d))
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/**
 * A spreadsheet date as 'YYYY-MM-DD', '' when blank, or null when it cannot be
 * read for certain. Accepts ISO dates, an Excel date cell (read as an ISO
 * timestamp at UTC midnight), an Excel serial number, and day-first dates
 * (DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY: the Nigerian convention). Month-first
 * dates are not guessed: 05/11/2026 is 5 November.
 */
export function parseImportDate(value) {
  const v = String(value ?? '').trim()
  if (!v) return ''
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:T00:00:00(?:\.000)?Z?)?$/.exec(v)
  if (m) return realDate(+m[1], +m[2], +m[3])
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(v)
  if (m) return realDate(+m[3], +m[2], +m[1])
  if (/^\d{5}$/.test(v)) {
    const n = Number(v)
    if (n < 20000 || n > 80000) return null
    const dt = new Date(Date.UTC(1899, 11, 30) + n * 86400000)
    return dt.toISOString().slice(0, 10)
  }
  return null
}

/** "₦1,250.50" → 1250.5; '' when blank; NaN when not a number. */
export function parseImportNumber(value) {
  const v = String(value ?? '').replace(/[₦,\s]/g, '').replace(/^NGN/i, '')
  if (v === '') return ''
  return /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : NaN
}

/** The reason a write failed, without the transport's "Supabase error (400): " prefix. */
export function cleanError(e) {
  return String(e?.message || e || 'Unknown error').replace(/^Supabase error \(\d{3}\):\s*/, '')
}

// A failure worth one more try: the request never reached the database, or the
// server failed. A refusal (4xx: a rule, a permission, a bad value) is final.
export function isTransientError(e) {
  const m = /^Supabase error \((\d{3})\)/.exec(String(e?.message || ''))
  if (!m) return !/session expired/i.test(String(e?.message || ''))
  return Number(m[1]) >= 500 || Number(m[1]) === 408 || Number(m[1]) === 429
}

async function withRetry(fn) {
  try {
    return await fn()
  } catch (e) {
    if (!isTransientError(e)) throw e
    return fn()
  }
}

/**
 * Saves `items` in batches and accounts for every one.
 *
 *   createMany(records) → saved rows, in order (one request per batch)
 *   createOne(record)   → saved row(s)
 *   toRecord(item)      → what is written for an item
 *
 * A batch is written in one request. If that request fails (one bad row fails
 * the whole statement, and a plan-limit trigger refuses a statement that goes
 * over), the batch is written again one row at a time, so the good rows are
 * saved and each bad row gets its own reason. Network and server errors are
 * retried once. Never throws.
 *
 * Returns { saved: [{ item, row }], failed: [{ item, message }] }.
 */
export async function saveInBatches(items, { createMany, createOne, toRecord = (x) => x, batchSize = 100, concurrency = 10, onProgress, shouldCancel } = {}) {
  const saved = []
  const failed = []
  let done = 0
  for (let i = 0; i < items.length; i += batchSize) {
    if (shouldCancel?.()) break
    const batch = items.slice(i, i + batchSize)
    let rows = null
    if (createMany && batch.length > 1) {
      try {
        const out = await withRetry(() => createMany(batch.map(toRecord)))
        rows = Array.isArray(out) ? out : null
      } catch (e) {
        console.warn('[import] a batch of', batch.length, 'was refused; saving its rows one by one:', cleanError(e))
      }
    }
    if (rows && rows.length === batch.length) {
      batch.forEach((item, k) => saved.push({ item, row: rows[k] }))
    } else {
      for (let k = 0; k < batch.length; k += concurrency) {
        const part = batch.slice(k, k + concurrency)
        const results = await Promise.all(part.map(async (item) => {
          try {
            const out = await withRetry(() => createOne(toRecord(item)))
            return { item, row: Array.isArray(out) ? out[0] : out }
          } catch (e) {
            return { item, message: cleanError(e) }
          }
        }))
        for (const r of results) {
          if (r.message !== undefined) failed.push({ item: r.item, message: r.message })
          else saved.push({ item: r.item, row: r.row })
        }
      }
    }
    done += batch.length
    onProgress?.(done, items.length)
  }
  return { saved, failed }
}

function csvEscape(v) {
  const s = v == null ? '' : String(v)
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
}

/**
 * A CSV of rows that were not saved, in the upload's own columns plus a
 * "Problem" column (ignored when the file is uploaded again).
 * columns: [{ key, header }]; entries: [{ cells: { key: text }, problem }].
 */
export function buildRowsToFixCsv(columns, entries) {
  const header = [...columns.map(c => c.header), 'Problem']
  const lines = entries.map(e => [...columns.map(c => e.cells?.[c.key] ?? ''), e.problem || ''])
  return toCsv([header, ...lines])
}

/** Rows of cells → CSV text that Excel opens as UTF-8 (₦ intact). */
export function toCsv(rows) {
  return '\ufeff' + rows.map(r => r.map(csvEscape).join(',')).join('\r\n') + '\r\n'
}

/**
 * Rows of cells (the first non-empty row is the header) → { rows, missing, ignored }.
 * columns: [{ key, header, aliases, required }]; header cells are matched by
 * lookupKey against each column's header and aliases. When no header
 * cell is recognised at all and `positional` is true, the first row is taken as
 * a header in the template's column order (older files with renamed headers).
 * rows: [{ rowNumber, cells: { key: text } }]; rowNumber is the spreadsheet row.
 */
export function readTableByHeader(rawRows, columns, { maxRows, positional = false } = {}) {
  const indexed = (rawRows || []).map((r, i) => ({ r, n: i + 1 })).filter(x => (x.r || []).some(c => String(c ?? '').trim() !== ''))
  if (!indexed.length) throw new Error('The file is empty.')
  const byAlias = new Map()
  for (const c of columns) for (const a of [c.header, ...(c.aliases || [])]) byAlias.set(lookupKey(a), c)
  const header = indexed[0].r
  let keyByIndex = {}
  const ignored = []
  header.forEach((h, i) => {
    const col = byAlias.get(lookupKey(String(h ?? '')))
    if (col && !Object.values(keyByIndex).includes(col.key)) keyByIndex[i] = col.key
    else if (String(h ?? '').trim()) ignored.push(String(h).trim())
  })
  if (positional && Object.keys(keyByIndex).length === 0) {
    // `positional`: true reads the columns in `columns` order; an array of keys reads them in that order instead
    // (a layout older than the current columns).
    const order = Array.isArray(positional) ? positional : columns.map(c => c.key)
    keyByIndex = Object.fromEntries(order.map((k, i) => [i, k]))
    ignored.length = 0
  }
  const present = new Set(Object.values(keyByIndex))
  const missing = columns.filter(c => c.required && !present.has(c.key)).map(c => c.header)
  const rows = indexed.slice(1).map(({ r, n }) => {
    const cells = {}
    Object.entries(keyByIndex).forEach(([i, k]) => { cells[k] = String(r[i] ?? '').trim() })
    return { rowNumber: n, cells }
  })
  if (!rows.length) throw new Error('The file has headers but no rows.')
  if (maxRows && rows.length > maxRows) throw new Error(`The file has ${rows.length.toLocaleString()} rows; the limit is ${maxRows.toLocaleString()} per upload. Split it into smaller files.`)
  return { rows, missing, ignored }
}
