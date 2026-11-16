// Edit Client: the rules for changing one client's details. Pure, pinned by clientEdit.test.js.
//
// Editable: name, phone, email, address, gender, date of birth, notes; and, for the Owner or staff whose role has
// canAdjustClientTotals, visits and total spent (the database enforces this: carehub_20270122). Those two are kept
// from sales, so the client's next sale recalculates them. Never editable: the business. Saving changes only the client
// record: sales, payments, debts and history keep what they were saved with and stay linked by client_id, so the new
// name shows wherever they appear (lib/clientNames.js).
// Docs: docs/architecture/Client-Edit.md.
import { CLIENT_GENDERS } from './clientBulkEdit'
import { isValidEmail } from '../business-directory/services/normalize'

export const CLIENT_EDIT_FIELDS = ['full_name', 'phone', 'email', 'address', 'gender', 'date_of_birth', 'notes']
// Sales-derived figures, offered only with { totals: true } (the Owner or canAdjustClientTotals).
export const CLIENT_TOTAL_FIELDS = ['visit_count', 'total_spend']
const LIMITS = { full_name: 200, phone: 40, email: 254, address: 300, notes: 2000 }

// The database's duplicate rule (clients_phone_unique_per_business): digits only, per business.
export const phoneDigits = (p) => String(p || '').replace(/[^0-9]/g, '')

const tidy = (k, v) => (k === 'full_name' ? String(v ?? '').trim().replace(/\s+/g, ' ') : String(v ?? '').trim())

/** The form's starting values for a client. */
export function clientEditForm(client) {
  return Object.fromEntries([...CLIENT_EDIT_FIELDS, ...CLIENT_TOTAL_FIELDS].map((k) => [k, String(client?.[k] ?? (CLIENT_TOTAL_FIELDS.includes(k) ? 0 : ''))]))
}

/**
 * Field errors ({ field: message }) for the form. `clients` is the business's client list, to catch a phone number
 * another client already has before the database refuses it; `today` is 'YYYY-MM-DD'.
 */
export function validateClientEdit(form, { client, clients = [], today, totals = false } = {}) {
  const v = Object.fromEntries(CLIENT_EDIT_FIELDS.map((k) => [k, tidy(k, form?.[k])]))
  const errors = {}
  if (!v.full_name) errors.full_name = "Enter the client's name."
  const digits = phoneDigits(v.phone)
  if (!v.phone) errors.phone = 'Enter a phone number.'
  else if (/[a-z]/i.test(v.phone) || digits.length < 7 || digits.length > 15) errors.phone = 'Enter a valid phone number (7 to 15 digits).'
  else {
    const other = (clients || []).find((c) => String(c.id) !== String(client?.id) && phoneDigits(c.phone) === digits)
    if (other) errors.phone = `${other.full_name || 'Another client'} already has this phone number.`
  }
  if (!isValidEmail(v.email)) errors.email = 'Enter a valid email address.'
  if (v.gender && !CLIENT_GENDERS.includes(v.gender)) errors.gender = 'Choose Male, Female or Other.'
  if (v.date_of_birth) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v.date_of_birth) || Number.isNaN(Date.parse(v.date_of_birth))) errors.date_of_birth = 'Enter a valid date.'
    else if (today && v.date_of_birth > today) errors.date_of_birth = 'The date of birth cannot be in the future.'
  }
  if (totals) {
    const visits = String(form?.visit_count ?? '').trim()
    if (!/^\d{1,6}$/.test(visits)) errors.visit_count = 'Enter a whole number of visits (0 or more).'
    const spend = String(form?.total_spend ?? '').trim().replace(/,/g, '')
    if (!/^\d{1,12}(\.\d{1,2})?$/.test(spend)) errors.total_spend = 'Enter an amount of 0 or more, in naira.'
  }
  for (const [k, max] of Object.entries(LIMITS)) {
    if (!errors[k] && v[k].length > max) errors[k] = `Keep this under ${max.toLocaleString()} characters.`
  }
  return errors
}

/** Only what changed, tidied: { field: newValue }. Empty when nothing would change. Totals only with { totals: true }. */
export function clientEditChanges(client, form, { totals = false } = {}) {
  const changes = {}
  for (const k of CLIENT_EDIT_FIELDS) {
    const next = tidy(k, form?.[k])
    if (next !== String(client?.[k] ?? '').trim()) changes[k] = next
  }
  if (totals) {
    const visits = Number(String(form?.visit_count ?? '').trim())
    const spend = Math.round(Number(String(form?.total_spend ?? '').trim().replace(/,/g, '')) * 100) / 100
    if (Number.isFinite(visits) && visits !== (Number(client?.visit_count) || 0)) changes.visit_count = visits
    if (Number.isFinite(spend) && spend !== Math.round((Number(client?.total_spend) || 0) * 100) / 100) changes.total_spend = spend
  }
  return changes
}

const LABELS = { full_name: 'name', phone: 'phone number', email: 'email', address: 'address', gender: 'gender', date_of_birth: 'date of birth', notes: 'notes', visit_count: 'visits', total_spend: 'total spent' }
/** "name and phone number" for the confirmation message. */
export function describeClientChanges(changes) {
  const names = Object.keys(changes).map((k) => LABELS[k])
  return names.length <= 1 ? (names[0] || '') : names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1]
}
