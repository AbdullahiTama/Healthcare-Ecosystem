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

export const PAYMENT_METHODS = ['Cash', 'Transfer', 'POS', 'Cheque', 'Other']
// How the expense stands when it is recorded: paid in full, part paid (a deposit), or not paid yet (a bill to pay).
export const EXPENSE_PAYMENT_CHOICES = [['paid', 'Paid in full'], ['partial', 'Part paid'], ['unpaid', 'Not paid yet']]

// What has been paid on an expense. An expense from before payment status existed (no amount_paid) was paid in full.
export function expensePaid(e) {
  const amount = Number(e?.amount) || 0
  if (e?.amount_paid === undefined || e?.amount_paid === null || e?.amount_paid === '') return amount
  return Math.min(Math.max(Number(e.amount_paid) || 0, 0), amount)
}
export function expenseBalance(e) {
  return Math.round(((Number(e?.amount) || 0) - expensePaid(e)) * 100) / 100
}
// 'paid' | 'partial' | 'unpaid', the same words as debts.
export function expensePaymentStatus(e) {
  const paid = expensePaid(e)
  if (expenseBalance(e) <= 0) return 'paid'
  return paid > 0 ? 'partial' : 'unpaid'
}

// Returns { ok, errors: { field: message }, value } — `value` is the payload to
// persist, only meaningful when ok. Payment: form.payment is 'paid' (default), 'partial' (form.amountPaid now) or
// 'unpaid'; form.paymentMethod says how anything paid now was paid.
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

  const payment = form?.payment || 'paid'
  let amountPaid = Number.isFinite(amount) ? amount : 0
  if (payment === 'unpaid') amountPaid = 0
  else if (payment === 'partial') {
    const part = parseAmount(form?.amountPaid)
    if (form?.amountPaid === undefined || String(form.amountPaid).trim() === '') errors.amountPaid = 'Enter how much was paid now.'
    else if (!Number.isFinite(part)) errors.amountPaid = 'Enter a valid amount with at most 2 decimal places.'
    else if (part <= 0) errors.amountPaid = 'A part payment must be more than zero. Choose "Not paid yet" if nothing was paid.'
    else if (Number.isFinite(amount) && part >= amount) errors.amountPaid = 'That covers the whole expense. Choose "Paid in full" instead.'
    else amountPaid = part
  } else if (payment !== 'paid') errors.payment = 'Choose whether the expense has been paid.'
  const method = form?.paymentMethod || 'Cash'
  if (amountPaid > 0 && !PAYMENT_METHODS.includes(method)) errors.paymentMethod = 'Choose how it was paid.'

  const ok = Object.keys(errors).length === 0
  return {
    ok,
    errors,
    value: ok ? {
      category, description, amount, date, staff_name: (form?.staffName || '').trim(),
      amount_paid: amountPaid, payment_method: amountPaid > 0 ? method : null,
    } : null,
  }
}

export function newExpenseId() {
  return globalThis.crypto.randomUUID()
}

// ── Monthly budget ───────────────────────────────────────────────────────────
// A budget is set per month (YYYY-MM). A month without its own budget uses the
// latest earlier one, so a budget carries over until the Owner changes it; a
// budget of 0 means "no budget from this month on". The database query
// (expenseRepository.getBudget) and the browser fallback below follow the same
// rule. Docs: docs/architecture/Expense-Budgets.md.

// The budget in force for `month` from { 'YYYY-MM': amount }: { amount, month }
// of the latest month on or before it, or null when there is none.
export function effectiveBudget(byMonth, month) {
  if (!month || !MONTH_RE.test(month) || !byMonth || typeof byMonth !== 'object') return null
  let best = null
  for (const [m, raw] of Object.entries(byMonth)) {
    const amount = Number(raw)
    if (!MONTH_RE.test(m) || m > month || !Number.isFinite(amount) || amount < 0) continue
    if (!best || m > best.month) best = { month: m, amount }
  }
  return best
}

// Budgets the old screen kept in this browser (localStorage
// carehub_expense_budget = { [businessId]: { 'YYYY-MM': amount } }), as valid
// [{ month, amount }] entries for one business, for moving to the database.
export function legacyBudgetEntries(stored, businessId) {
  const forBiz = stored && typeof stored === 'object' ? stored[businessId] : null
  if (!forBiz || typeof forBiz !== 'object') return []
  return Object.entries(forBiz)
    .map(([month, raw]) => ({ month, amount: Number(raw) }))
    .filter((e) => MONTH_RE.test(e.month) && Number.isFinite(e.amount) && e.amount > 0 && e.amount <= MAX_EXPENSE_AMOUNT)
    .sort((a, b) => (a.month < b.month ? -1 : 1))
}

// What the budget tracker shows for a budget and the month's spending (in kobo,
// so 0.1 + 0.2 style sums never show a stray remainder).
export function budgetSummary(budget, spent) {
  const b = toKobo(budget)
  const s = toKobo(spent)
  if (b <= 0) return { active: false, remaining: 0, pctUsed: 0, over: false, near: false }
  const pctUsed = Math.round((s / b) * 100)
  const over = s > b
  return { active: true, remaining: (b - s) / 100, pctUsed, over, near: !over && pctUsed >= 80 }
}
