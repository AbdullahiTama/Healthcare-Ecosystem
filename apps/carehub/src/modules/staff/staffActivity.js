// ── Staff activity: the arithmetic and the filters ───────────────────────────
// Pure, so what the Owner reads per person is pinned by a test
// (staffActivity.test.js). The feed itself comes from the database function
// staff_activity(); nothing here talks to the network.

export const KINDS = {
  sale: 'Sale', held: 'Held sale', refund: 'Refund', repayment: 'Repayment',
  sale_edited: 'Sale edited', sale_deleted: 'Sale deleted', expense: 'Expense',
  stock: 'Stock change', checkin: 'Attendance', field_visit: 'Field visit',
  shift_open: 'Shift opened', shift_close: 'Shift closed',
}
export const kindLabel = (k) => KINDS[k] || k

// Kinds the Owner will want to look at first: money going back or being changed.
export const SENSITIVE = new Set(['refund', 'sale_edited', 'sale_deleted', 'stock'])

export const PERIODS = [['today', 'Today'], ['week', 'This week'], ['month', 'This month'], ['custom', 'Custom']]

const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate())
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)
const parseLocalDate = (s) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''))
  if (!m) return null
  const d = new Date(+m[1], +m[2] - 1, +m[3])
  return d.getMonth() === +m[2] - 1 ? d : null
}

// [start, end) on the device's calendar. Weeks start on Monday. Custom is
// inclusive of both days, limited to the 366 days the database accepts; a
// reversed, unreadable or too long range returns null.
export function periodRange(period, { now = new Date(), from, to } = {}) {
  const today = startOfDay(now)
  switch (period) {
    case 'today': return { start: today, end: addDays(today, 1) }
    case 'week': { const start = addDays(today, -((today.getDay() + 6) % 7)); return { start, end: addDays(start, 7) } }
    case 'month': return { start: new Date(today.getFullYear(), today.getMonth(), 1), end: new Date(today.getFullYear(), today.getMonth() + 1, 1) }
    case 'custom': {
      const a = parseLocalDate(from); const b = parseLocalDate(to)
      if (!a || !b || a > b) return null
      const end = addDays(b, 1)
      return (end - a) / 864e5 > 366 ? null : { start: a, end }
    }
    default: return null
  }
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
    if (r.kind === 'sale') p.salesValue += num(r.amount)
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
