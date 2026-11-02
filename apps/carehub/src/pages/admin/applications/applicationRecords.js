// Applications from three tables, normalised into one shape the admin can list, open in full and export.
//
//   applications            unified table (type agent | ecommerce | team), answers in `details`
//   agent_applications      the public "become an agent / ambassador" form: requested_city, requested_area,
//                           contact_phone and the free-form answers in `applicant_details`
//   ecommerce_applications  online-store applications; reviewed in CareFind Admin > Shop (terms, commission and
//                           segment are decided there), so they are view-only here
//
// Every free-form answer key is shown and exported, so a question added to a form later appears without code changes.

import { fieldsFromObject, flattenSections, formatValue } from '../shared/RecordFields'

export const TYPE_LABELS = { agent: 'Ambassador (agent)', ecommerce: 'Online store', team: 'Team' }
export const typeLabel = (t) => TYPE_LABELS[t] || (t ? t.charAt(0).toUpperCase() + t.slice(1) : 'Application')

const pick = (...values) => values.find(v => v !== undefined && v !== null && String(v).trim() !== '') ?? null

// "Ikeja, Yaba; Surulere" → ['Ikeja', 'Yaba', 'Surulere']. Arrays pass through.
export function splitAreas(value) {
  if (Array.isArray(value)) return value.map(v => String(v).trim()).filter(Boolean)
  if (value === null || value === undefined) return []
  return String(value).split(/[,;\n|]+/).map(s => s.trim()).filter(Boolean)
}

// Bank account numbers are shown and exported by their last four digits only.
export function maskAccount(value) {
  const digits = String(value || '').replace(/\s+/g, '')
  if (!digits) return null
  return digits.length <= 4 ? digits : `•••• ${digits.slice(-4)}`
}

const normalStatus = (s) => (s === 'submitted' || s === 'under_review' ? 'pending' : s || 'pending')

const UNIFIED_KNOWN = ['name', 'full_name', 'email', 'phone', 'contact_phone', 'city', 'requested_city', 'state', 'area', 'areas', 'requested_area', 'selected_areas', 'lga']
const ECOM_SENSITIVE = ['account_number', 'bvn', 'nin']

export function fromUnified(a) {
  const d = a.details && typeof a.details === 'object' ? a.details : {}
  return {
    key: `applications:${a.id}`, source: 'applications', id: a.id, type: a.type || 'application',
    name: pick(a.applicant_name, d.name, d.full_name, a.applicant_ref), email: pick(a.applicant_email, d.email),
    phone: pick(d.phone, d.contact_phone), city: pick(d.city, d.requested_city), state: pick(d.state), lga: pick(d.lga),
    areas: splitAreas(pick(d.selected_areas, d.areas, d.area, d.requested_area)),
    status: normalStatus(a.status), submittedAt: pick(a.submitted_at, a.created_at), reviewedAt: a.reviewed_at || null,
    reviewNotes: a.review_notes || null, reference: a.applicant_ref || null,
    answers: fieldsFromObject(d, { exclude: UNIFIED_KNOWN }), reviewable: true, raw: a,
  }
}

export function fromAgentApplication(a) {
  const d = a.applicant_details && typeof a.applicant_details === 'object' ? a.applicant_details : {}
  return {
    key: `agent_applications:${a.id}`, source: 'agent_applications', id: a.id, type: 'agent',
    name: a.applicant_name || null, email: a.contact_email || null, phone: a.contact_phone || null,
    city: a.requested_city || null, state: pick(d.state), lga: pick(d.lga),
    areas: splitAreas(pick(a.requested_area, d.selected_areas, d.areas)),
    status: normalStatus(a.status), submittedAt: a.submitted_at || null, reviewedAt: a.reviewed_at || null,
    reviewNotes: a.review_notes || null, reference: null,
    answers: fieldsFromObject(d, { exclude: ['state', 'lga', 'selected_areas', 'areas'] }), reviewable: true, raw: a,
  }
}

export function fromEcommerceApplication(e, businessName) {
  const info = e.seller_info && typeof e.seller_info === 'object' ? e.seller_info : {}
  return {
    key: `ecommerce_applications:${e.id}`, source: 'ecommerce_applications', id: e.id, type: 'ecommerce',
    name: pick(businessName, info.business_name, info.name, e.business_id), email: pick(info.email, info.contact_email),
    phone: pick(info.phone, info.contact_phone), city: pick(info.city), state: pick(info.state), lga: pick(info.lga), areas: [],
    status: normalStatus(e.status), submittedAt: pick(e.submitted_at, e.created_at), reviewedAt: e.reviewed_at || null,
    reviewNotes: e.rejection_reason || null, reference: e.business_id || null,
    answers: [
      ['Segment', e.segment], ['Terms accepted', e.terms_accepted], ['Commission rate accepted', e.accepted_commission_rate],
      ['Terms accepted at', e.acceptance_timestamp], ['Approved at', e.approval_timestamp],
      ['Payout account', maskAccount(e.account_number || info.account_number)],
      ...fieldsFromObject(info, { exclude: ['email', 'contact_email', 'phone', 'contact_phone', 'city', 'state', 'lga', ...ECOM_SENSITIVE] }),
    ],
    reviewable: false, raw: e,
  }
}

export function normalizeApplications({ unified = [], agentLegacy = [], ecommerce = [], businessNames = new Map() } = {}) {
  return [
    ...(unified || []).map(fromUnified),
    ...(agentLegacy || []).map(fromAgentApplication),
    ...(ecommerce || []).map(e => fromEcommerceApplication(e, businessNames.get(e.business_id))),
  ].sort((a, b) => new Date(b.submittedAt || 0) - new Date(a.submittedAt || 0))
}

export function filterApplications(list, { type = 'all', status = '', search = '' } = {}) {
  const q = search.trim().toLowerCase()
  return (list || []).filter(a => {
    if (type !== 'all' && a.type !== type) return false
    if (status && a.status !== status) return false
    if (!q) return true
    return [a.name, a.email, a.phone, a.city, a.state, a.lga, ...a.areas].some(v => String(v || '').toLowerCase().includes(q))
  })
}

// The sections shown when an application is opened — and exported for a single record.
export function applicationSections(a) {
  if (!a) return []
  return [
    { title: 'Applicant', fields: [['Name', a.name], ['Email', a.email], ['Phone', a.phone], ['Application type', typeLabel(a.type)], ...(a.reference ? [['Reference', a.reference]] : [])] },
    { title: 'Location', fields: [['City', a.city], ['State', a.state], ['LGA', a.lga], [a.type === 'agent' ? 'Selected areas' : 'Areas', a.areas]] },
    { title: 'Application responses', fields: a.answers },
    { title: 'Review', fields: [['Status', a.status], ['Submitted', a.submittedAt], ['Reviewed', a.reviewedAt], [a.source === 'ecommerce_applications' ? 'Rejection reason' : 'Review notes', a.reviewNotes]] },
  ]
}

export const applicationRecordFields = (a) => flattenSections(applicationSections(a))

export const APPLICATION_EXPORT_COLUMNS = [
  { label: 'Type', get: a => typeLabel(a.type) },
  { label: 'Name', key: 'name' },
  { label: 'Email', key: 'email' },
  { label: 'Phone', key: 'phone' },
  { label: 'City', key: 'city' },
  { label: 'State', key: 'state' },
  { label: 'LGA', key: 'lga' },
  { label: 'Selected areas', get: a => a.areas.join('; ') },
  { label: 'Status', key: 'status' },
  { label: 'Submitted', get: a => a.submittedAt || '' },
  { label: 'Reviewed', get: a => a.reviewedAt || '' },
  { label: 'Review notes', key: 'reviewNotes' },
  { label: 'Responses', get: a => a.answers.map(([k, v]) => { const f = formatValue(v); return f == null ? null : `${k}: ${f}` }).filter(Boolean).join(' | ') },
  { label: 'Record', get: a => `${a.source}:${a.id}` },
]
