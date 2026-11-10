// Bulk edit for Purchases: what a set of header changes does to the purchases the user marked. Pure, pinned by
// purchaseBulkEdit.test.js. Saving goes through bulk_edit_purchases (carehub_20270114), which runs edit_purchase on
// each purchase, so the supplier's debt, the payment history and the audit follow exactly as for one edit.
//
// Editable: supplier name, supply date, due date (set or remove) and notes. Never here: lines, quantities, costs and
// the amount paid (they move stock and money: Edit purchase / Record payment, one purchase at a time).

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const realDate = (s) => DATE_RE.test(s) && new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) === s

export const DUE_MODES = [['set', 'Set a due date'], ['clear', 'Remove the due date']]
export const EMPTY_PURCHASE_BULK_EDIT = Object.freeze({ supplier: '', supplyDate: '', dueMode: '', dueDate: '', notes: '', reason: '' })
export const FIELD_NAMES = { supplier_name: 'supplier', supply_date: 'supply date', due_date: 'due date', notes: 'notes' }

export function validatePurchaseBulkEdit(changes, { today } = {}) {
  const c = { ...EMPTY_PURCHASE_BULK_EDIT, ...changes }
  const errors = {}
  if (c.supplier.trim().length > 200) errors.supplier = 'Keep the supplier name under 200 characters.'
  if (c.supplyDate) {
    if (!realDate(c.supplyDate)) errors.supplyDate = 'Enter a valid supply date.'
    else if (today && c.supplyDate > today) errors.supplyDate = 'The supply date cannot be in the future.'
  }
  if (c.dueMode === 'set' && !realDate(c.dueDate)) errors.dueDate = 'Enter a valid due date.'
  if (c.notes.trim().length > 1000) errors.notes = 'Keep the notes under 1,000 characters.'
  const hasChanges = !!(c.supplier.trim() || c.supplyDate || c.dueMode || c.notes.trim())
  const reason = c.reason.trim()
  if (hasChanges && (reason.length < 3 || reason.length > 300)) errors.reason = 'Say why these purchases are being changed (3 to 300 characters).'
  return { errors, ok: Object.keys(errors).length === 0, hasChanges }
}

// One entry per purchase that would actually change: { id, label, updates, before }. Updates use the database's
// column names; the server applies them through edit_purchase.
export function planPurchaseBulkEdit(purchases, changes, opts = {}) {
  const c = { ...EMPTY_PURCHASE_BULK_EDIT, ...changes }
  if (!validatePurchaseBulkEdit(c, opts).ok) return []
  const supplier = c.supplier.trim()
  const notes = c.notes.trim()
  const due = c.dueMode === 'set' ? c.dueDate : c.dueMode === 'clear' ? '' : null
  const plan = []
  for (const p of purchases || []) {
    const updates = {}
    const before = {}
    if (supplier && (p.supplier_name || '').trim() !== supplier) { updates.supplier_name = supplier; before.supplier_name = p.supplier_name || '' }
    if (c.supplyDate && (p.supply_date || '') !== c.supplyDate) { updates.supply_date = c.supplyDate; before.supply_date = p.supply_date || '' }
    if (due !== null && (p.due_date || '') !== due) { updates.due_date = due; before.due_date = p.due_date || '' }
    if (notes && (p.notes || '').trim() !== notes) { updates.notes = notes; before.notes = p.notes || '' }
    if (Object.keys(updates).length) plan.push({ id: p.id, label: purchaseLabel(p), updates, before })
  }
  return plan
}

export const purchaseLabel = (p) => `${p?.supplier_name || 'Unknown supplier'}${p?.supply_date ? ' · ' + p.supply_date : ''}`

// Why bulk_edit_purchases skipped a purchase (its lines would make an edit move stock).
export const SKIP_REASONS = {
  stock_differs: 'its stock in Inventory differs from its quantities',
  not_in_inventory: 'a line is not in Inventory yet',
}

// Why delete_purchases kept a purchase.
export function purchaseKeptText(reasons, kept) {
  const product = kept?.product ? ` (${kept.product})` : ''
  return (reasons || []).map((r) => ({
    stock_used: `some units${product} were sold or moved since, so its stock cannot be taken back. Lower the quantity with Edit purchase, or correct the stock first`,
    not_linked: `a line${product} was recorded before stock tracking and is not linked to a product, so its stock cannot be taken back`,
    no_batch: `a line${product} is tracked by batch but has no batch to take its stock from`,
    batch_gone: `the batch a line${product} filled no longer exists`,
    stock_check: `its stock${product} does not add up in Inventory; reconcile it first`,
  }[r] || r)).join('; ')
}

// Sends the planned groups through bulkEdit(ids, updates) (the repository bound to the business, reason and staff),
// 25 purchases per request. Never throws: resolves to the shape BulkEditShell shows ({ saved, failed, notes }), where
// `saved` are the purchases as stored now, `failed` can be retried, and `notes` say what was skipped or already set.
export async function runPurchaseBulkEdit(groups, bulkEdit, { onProgress, labels = {}, chunk = 25 } = {}) {
  const total = (groups || []).reduce((n, g) => n + g.ids.length, 0)
  const saved = []
  const failed = []
  const skipped = []
  let unchanged = 0
  let done = 0
  for (const g of groups || []) {
    for (let i = 0; i < g.ids.length; i += chunk) {
      const ids = g.ids.slice(i, i + chunk)
      try {
        const r = await bulkEdit(ids, g.updates)
        saved.push(...(r?.rows || []))
        unchanged += Number(r?.unchanged) || 0
        for (const f of r?.failed || []) failed.push({ ids: [f.id], updates: g.updates, message: `${labels[f.id] || f.name}: ${f.message}` })
        for (const s of r?.skipped || []) skipped.push(`${labels[s.id] || s.name} (${SKIP_REASONS[s.reason] || s.reason})`)
      } catch (e) {
        failed.push({ ids, updates: g.updates, message: e?.message || 'Could not save' })
      }
      done += ids.length
      onProgress?.(done, total)
    }
  }
  const notes = []
  if (skipped.length) notes.push(`${skipped.length} skipped, because changing them would also change stock: ${skipped.join('; ')}. Edit ${skipped.length === 1 ? 'it' : 'them'} one at a time.`)
  if (unchanged) notes.push(`${unchanged} already had these values.`)
  return { saved, failed, notes, total }
}
