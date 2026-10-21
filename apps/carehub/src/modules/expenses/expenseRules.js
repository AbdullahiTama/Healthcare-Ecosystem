// Pure rules for the expenses module: validation, the date an expense belongs
// to, and totals. No React, no network, so the Expenses page and the Reports
// page share one definition and cannot drift apart.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/
export const MAX_EXPENSE_AMOUNT = 1_000_000_000_000

function isRealDate(s) {
  if (!DATE_RE.test(s)) return false
  const d = new Date(s + 'T00:00:00Z')
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
}

// Mirrors public.expense_effective_date() in the database: the date the user
// recorded when it is a real YYYY-MM-DD, otherwise the day the row was created.
export function expenseDate(e) {
  if (e?.date && isRealDate(e.date)) return e.date
  return (e?.created_at || '').slice(0, 10)
}

export function inMonth(e, month) {
  if (!month) return true
  return MONTH_RE.test(month) && expenseDate(e).startsWith(month)
}

// Whole kobo, so that adding 0.1 + 0.2 never produces 0.30000000000000004.
const toKobo = (n) => Math.round((Number(n) || 0) * 100)

export function sumExpenses(list) {
  return (list || []).reduce((kobo, e) => kobo + toKobo(e.amount), 0) / 100
}

export function sumByCategory(list) {
  const kobo = {}
  for (const e of list || []) kobo[e.category] = (kobo[e.category] || 0) + toKobo(e.amount)
  return Object.fromEntries(Object.entries(kobo).map(([k, v]) => [k, v / 100]))
}

// Accepts what a person types into an amount box: "1,250.50", " 300 ".
export function parseAmount(raw) {
  const s = String(raw ?? '').replace(/[,\s]/g, '')
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return NaN
  return Number(s)
}

// Returns { ok, errors: { field: message }, value } — `value` is the payload to
// persist, only meaningful when ok.
export function validateExpense(form, categories) {
  const errors = {}
  const category = (form?.category || '').trim()
  if (!category) errors.category = 'Choose a category.'
  else if (categories && !categories.includes(category)) errors.category = 'Choose a category from the list.'

  const amount = parseAmount(form?.amount)
  if (form?.amount === undefined || String(form.amount).trim() === '') errors.amount = 'Enter the amount.'
  else if (!Number.isFinite(amount)) errors.amount = 'Enter a valid amount with at most 2 decimal places.'
  else if (amount <= 0) errors.amount = 'The amount must be greater than zero.'
  else if (amount > MAX_EXPENSE_AMOUNT) errors.amount = 'That amount is too large.'

  const date = form?.date
  if (!date) errors.date = 'Choose the date of the expense.'
  else if (!isRealDate(date)) errors.date = 'Enter a valid date.'

  const description = (form?.description || '').trim()
  if (description.length > 500) errors.description = 'Keep the description under 500 characters.'

  const ok = Object.keys(errors).length === 0
  return {
    ok,
    errors,
    value: ok ? { category, description, amount, date, staff_name: (form?.staffName || '').trim() } : null,
  }
}

export function newExpenseId() {
  return globalThis.crypto.randomUUID()
}
