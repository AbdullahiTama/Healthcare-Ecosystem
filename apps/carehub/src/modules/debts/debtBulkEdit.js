// Bulk edit for Debts: what a set of changes does to the debts the user marked. Pure, pinned by debtBulkEdit.test.js;
// sending uses the shared lib/bulkUpdates.js.
//
// Editable: the due date (any debt) and the description (debts recorded by hand only). A debt raised by a credit sale
// or a purchase describes that record, so its description is left alone. Never editable here: the amount, what was
// paid, the balance and the status (payments go through Mark paid / the sale / the purchase, so they stay in step),
// and who recorded it (stamped by the database).

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const realDate = (s) => DATE_RE.test(s) && new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) === s

export const DUE_MODES = [['set', 'Set a due date'], ['clear', 'Remove the due date']]
export const EMPTY_DEBT_BULK_EDIT = Object.freeze({ dueMode: '', dueDate: '', description: '' })

export const isManualDebt = (d) => !d?.source || d.source === 'manual'
export const debtLabel = (d) => d?.party_name || 'Unnamed'

export function validateDebtBulkEdit(changes) {
  const c = { ...EMPTY_DEBT_BULK_EDIT, ...changes }
  const errors = {}
  if (c.dueMode === 'set' && !realDate(c.dueDate)) errors.dueDate = 'Enter a valid due date.'
  if (c.description.trim().length > 500) errors.description = 'Keep the description under 500 characters.'
  return { errors, ok: Object.keys(errors).length === 0, hasChanges: !!(c.dueMode || c.description.trim()) }
}

// One entry per debt that would actually change: { id, label, updates, before }.
export function planDebtBulkEdit(debts, changes) {
  const c = { ...EMPTY_DEBT_BULK_EDIT, ...changes }
  if (!validateDebtBulkEdit(c).ok) return []
  const description = c.description.trim()
  const plan = []
  for (const d of debts || []) {
    const updates = {}
    const before = {}
    const due = c.dueMode === 'set' ? c.dueDate : c.dueMode === 'clear' ? '' : null
    if (due !== null && (d.due_date || '') !== due) { updates.due_date = due; before.due_date = d.due_date || '' }
    if (description && isManualDebt(d) && (d.description || '').trim() !== description) { updates.description = description; before.description = d.description || '' }
    if (Object.keys(updates).length) plan.push({ id: d.id, label: debtLabel(d), updates, before })
  }
  return plan
}

// How many marked debts keep their description because a sale or a purchase raised them (shown in the dialog).
export const descriptionLockedCount = (debts) => (debts || []).filter((d) => !isManualDebt(d)).length
