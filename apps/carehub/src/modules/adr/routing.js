// ── ADR product-owner routing helpers (Phase 1, Unified PV) ─────────────────
// Pure functions only: no network, no storage. The SQL migration
// `carehub_20261102_adr_routing_foundation.sql` is the authoritative gate;
// these helpers let the UI build valid RPC payloads and stable idempotency
// keys without duplicating the server's coherence rules by accident.
//
// Normalization rule (must match SQL): trim, collapse inner whitespace to a
// single space, lowercase.

export const PUBLIC_COMPANY_LABEL =
  'Company responsible for this medicine/product in your country (if known)'

export const REPORT_SOURCES = ['public', 'health_facility', 'business_facility', 'unknown']

export const ROUTE_SELECTION_KINDS = ['verified', 'unknown', 'unverified_candidate']

export const ROUTE_STATUSES = ['pending', 'verified', 'routed']

const ELIGIBLE_BUSINESS_TYPES = ['manufacturer_importer', 'wholesale']

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function normalizeCompanyName(name) {
  if (name === null || name === undefined) return ''
  return String(name).trim().replace(/\s+/g, ' ').toLowerCase()
}

function isUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value)
}

export function isEligibleBusinessType(businessType) {
  return ELIGIBLE_BUSINESS_TYPES.includes(businessType)
}

// Stable idempotency key for create_adr_product_route retries: same logical
// selection always maps to the same key, so a retry returns the existing row
// instead of creating a duplicate assignment.
export function buildIdempotencyKey({ reportId, productId, kind, businessId = '', candidateName = '' } = {}) {
  const normCandidate = kind === 'unverified_candidate' ? normalizeCompanyName(candidateName) : ''
  const normBusiness = kind === 'verified' ? String(businessId || '').toLowerCase() : ''
  return [reportId, productId, kind, normBusiness, normCandidate].join(':')
}

// Client-side coherence check mirroring the RPC guard. Returns
// { ok: true } or { ok: false, error } — the server re-validates everything.
export function validateRouteInput({ reportId, productId, kind, businessId = null, candidateName = null } = {}) {
  if (!reportId || !productId) {
    return { ok: false, error: 'Report and product are required' }
  }
  if (!ROUTE_SELECTION_KINDS.includes(kind)) {
    return { ok: false, error: 'Unknown selection kind' }
  }
  const hasBusiness = businessId !== null && businessId !== undefined && String(businessId).length > 0
  const hasCandidate =
    candidateName !== null && candidateName !== undefined && String(candidateName).trim().length > 0

  if (kind === 'verified') {
    if (!hasBusiness) return { ok: false, error: 'Verified selection requires a business' }
    if (!isUuid(businessId)) return { ok: false, error: 'Business id is not a valid identifier' }
    // Manual text must never ride along with a verified selection: it would
    // be ambiguous which reference the server should trust.
    if (hasCandidate) return { ok: false, error: 'Verified selection must not carry candidate text' }
    return { ok: true }
  }
  if (kind === 'unknown') {
    if (hasBusiness || hasCandidate) {
      return { ok: false, error: 'Unknown selection carries no company reference' }
    }
    return { ok: true }
  }
  // unverified_candidate: manual text only — never a business id, so typed
  // text can never be mistaken for (or promoted to) a verified organisation.
  if (!hasCandidate) return { ok: false, error: 'Candidate selection requires the company name as typed' }
  if (hasBusiness) return { ok: false, error: 'Candidate selection must not carry a business id' }
  return { ok: true }
}
