// Bulk edit for Expenses: what a set of changes does to the expenses the user marked. Pure, pinned by
// expenseBulkEdit.test.js; sending uses the shared lib/bulkUpdates.js.
//
// Deliberately not editable here: the amount and anything paid (payments go through Record payment, and the database
// refuses a direct change to amount_paid), and who recorded it (stamped by the database).

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const realDate = (s) => DATE_RE.test(s) && new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) === s

export const EMPTY_EXPENSE_BULK_EDIT = Object.freeze({ category: '', date: '', staffName: '' })

export function validateExpenseBulkEdit(changes, { categories = [], today } = {}) {
  const c = { ...EMPTY_EXPENSE_BULK_EDIT, ...changes }
  const errors = {}
  if (c.category && categories.length && !categories.includes(c.category)) errors.category = 'Choose a category from the list.'
  if (c.date) {
    if (!realDate(c.date)) errors.date = 'Enter a valid date.'
    else if (today && c.date > today) errors.date = 'The date cannot be in the future.'
  }
  if (c.staffName.trim().length > 120) errors.staffName = 'Keep the name under 120 characters.'
  return { errors, ok: Object.keys(errors).length === 0, hasChanges: !!(c.category || c.date || c.staffName.trim()) }
}

// One entry per expense that would actually change: { id, label, updates, before }.
export function planExpenseBulkEdit(expenses, changes, opts = {}) {
  const c = { ...EMPTY_EXPENSE_BULK_EDIT, ...changes }
  if (!validateExpenseBulkEdit(c, opts).ok) return []
  const plan = []
  for (const e of expenses || []) {
    const updates = {}
    const before = {}
    if (c.category && e.category !== c.category) { updates.category = c.category; before.category = e.category || null }
    if (c.date && e.date !== c.date) { updates.date = c.date; before.date = e.date || null }
    const name = c.staffName.trim()
    if (name && (e.staff_name || '').trim() !== name) { updates.staff_name = name; before.staff_name = e.staff_name || null }
    if (Object.keys(updates).length) plan.push({ id: e.id, label: [e.category, e.description].filter(Boolean).join(' · ') || 'Expense', updates, before })
  }
  return plan
}
