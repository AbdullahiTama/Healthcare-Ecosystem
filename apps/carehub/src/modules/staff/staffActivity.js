// ── Staff activity: the arithmetic and the filters ───────────────────────────
// Pure, so what the Owner reads per person is pinned by a test
// (staffActivity.test.js). The feed itself comes from the database function
// staff_activity(); nothing here talks to the network.

import { businessPeriod } from '../../lib/businessDay'

export const KINDS = {
  sale: 'Sale', credit_sale: 'Credit sale', held: 'Held sale', refund: 'Refund', repayment: 'Repayment',
  purchase: 'Purchase', supplier_payment: 'Supplier payment', debt: 'Debt recorded',
  sale_edited: 'Sale edited', sale_deleted: 'Sale deleted', expense: 'Expense',
  stock: 'Stock change', checkin: 'Attendance', field_visit: 'Field visit',
  shift_open: 'Shift opened', shift_close: 'Shift closed',
}
export const kindLabel = (k) => KINDS[k] || k

// Kinds the Owner will want to look at first: money going back or being changed.
export const SENSITIVE = new Set(['refund', 'sale_edited', 'sale_deleted', 'stock'])

export const PERIODS = [['today', 'Today'], ['week', 'This week'], ['month', 'This month'], ['custom', 'Custom']]

// [start, end) on the business day (lib/businessDay.js), the same days as the
// dashboard and the reports. Weeks start on Monday. Custom is inclusive of
// both days, limited to the 366 days the database accepts; a reversed,
// unreadable or too long range returns null.
export function periodRange(period, { now = new Date(), from, to } = {}) {
  const r = businessPeriod(period, { now, from, to })
  if (!r) return null
  return (r.end - r.start) / 864e5 > 366 ? null : r
}

// Stable identity of the person behind a row: the staff id, else the recorded
// name (the Owner and unlinked users have no staff row).
export const personKey = (r) => r.staff_id || 'name:' + String(r.actor_name || 'Owner or unlinked').toLowerCase()

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0 }
const money = (v) => Math.round(num(v) * 100) / 100

export function filterActivity(rows, { person = '', role = '', kind = '', query = '' } = {}) {
  const q = String(query || '').trim().toLowerCase()
  return (rows || []).filter((r) =>
    (!person || personKey(r) === person) &&
    (!role || (r.actor_role || 'Owner or unlinked') === role) &&
    (!kind || r.kind === kind) &&
    (!q || (String(r.summary || '') + ' ' + String(r.ref || '') + ' ' + String(r.actor_name || '')).toLowerCase().includes(q)))
}

// One line per person: how much of each thing they did. Sales value counts
// completed sales only (held sales are not takings); refunds are shown apart
// and never netted away.
export function summarisePeople(rows) {
  const by = new Map()
  for (const r of rows || []) {
    const k = personKey(r)
    if (!by.has(k)) by.set(k, { key: k, name: r.actor_name || 'Owner or unlinked', role: r.actor_role || null, counts: {}, total: 0, salesValue: 0, refundValue: 0, last: null })
    const p = by.get(k)
    p.counts[r.kind] = (p.counts[r.kind] || 0) + 1
    p.total++
    if (r.kind === 'sale' || r.kind === 'credit_sale') p.salesValue += num(r.amount)
    if (r.kind === 'refund') p.refundValue += num(r.amount)
    if (!p.last || new Date(r.occurred_at) > new Date(p.last)) p.last = r.occurred_at
  }
  return [...by.values()]
    .map((p) => ({ ...p, salesValue: money(p.salesValue), refundValue: money(p.refundValue), sensitive: Object.entries(p.counts).filter(([k]) => SENSITIVE.has(k)).reduce((n, [, c]) => n + c, 0) }))
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name))
}

export function filterChoices(rows) {
  const people = new Map(); const roles = new Set(); const kinds = new Set()
  for (const r of rows || []) {
    people.set(personKey(r), r.actor_name || 'Owner or unlinked')
    roles.add(r.actor_role || 'Owner or unlinked'); kinds.add(r.kind)
  }
  const sort = (m) => [...m.entries()].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label))
  return { people: sort(people), roles: [...roles].sort().map((r) => ({ value: r, label: r })), kinds: [...kinds].sort().map((k) => ({ value: k, label: kindLabel(k) })) }
}
