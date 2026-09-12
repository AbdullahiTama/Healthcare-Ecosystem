// Pure CSV-import helpers for the Inventory bulk upload. Extracted from
// Inventory.jsx so the parsing rules are unit-testable and the component only
// orchestrates file reading and state.
//
// Column contract (positional — the header row is display-only):
//   0 Product Name · 1 Generic Name · 2 Category · 3 Selling Price (NGN) ·
//   4 Cost Price (NGN) · 5 Stock Quantity · 6 Reorder Level · 7 Barcode ·
//   8 List on CareFind (yes/no) · 9 Expiry Date
//
// Columns 0–8 are the original template; column 9 is optional so legacy
// 9-column files keep importing with a null expiry.

/**
 * Coerces a spreadsheet expiry value to an ISO `YYYY-MM-DD` string, or null.
 * Blank → null (the products.expiry_date column is nullable). Unparseable or
 * impossible dates → null rather than a guess: JS silently rolls overflow
 * dates (2027-02-31 → March 3), which would store a day the user never typed.
 */
export function normalizeExpiryDate(value) {
  const v = String(value ?? '').trim()
  if (!v) return null

  // ISO input is a pure calendar date: validated in UTC so no timezone can
  // shift it, and impossible dates (2027-02-31) fail the component check
  // instead of silently rolling over.
  const isoMatch = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(v)
  if (isoMatch) {
    const y = Number(isoMatch[1])
    const m = Number(isoMatch[2])
    const d = Number(isoMatch[3])
    const dt = new Date(Date.UTC(y, m - 1, d))
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null
    return `${isoMatch[1]}-${isoMatch[2].padStart(2, '0')}-${isoMatch[3].padStart(2, '0')}`
  }

  // Other formats go through the engine's parser; the result is read back in
  // local components so "5/31/2027" stays May 31 whatever the TZ offset.
  const t = Date.parse(v)
  if (Number.isNaN(t)) return null
  const dt = new Date(t)
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
}

/**
 * Parses uploaded inventory CSV text into product rows.
 * Returns { rows, error } — error is null on success, otherwise a
 * user-facing message. Rows without a product name are skipped.
 */
export function parseInventoryCsv(text) {
  const lines = String(text || '').split('\n').filter(l => l.trim())
  if (lines.length < 2) return { rows: [], error: 'File is empty or has no products.' }

  const rows = []
  for (const line of lines.slice(1)) {
    // Quote-aware split: commas inside "quoted values" don't break columns.
    const cols = line.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map(c => c.replace(/^"|"$/g, '').trim())
    if (!cols[0]) continue
    rows.push({
      name: cols[0] || '',
      generic_name: cols[1] || '',
      category: cols[2] || 'Medicines',
      price: parseFloat(cols[3]) || 0,
      cost_price: parseFloat(cols[4]) || 0,
      stock: cols[5] !== '' ? parseInt(cols[5]) || 0 : 999,
      reorder_level: parseInt(cols[6]) || 5,
      barcode: cols[7] || '',
      list_on_carefind: (cols[8] || 'yes').toLowerCase() !== 'no',
      expiry_date: normalizeExpiryDate(cols[9]),
      emoji: '💊',
    })
  }

  if (rows.length === 0) return { rows: [], error: 'No valid products found.' }
  return { rows, error: null }
}
