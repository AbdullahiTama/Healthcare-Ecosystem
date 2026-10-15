import { describe, it, expect } from 'vitest'
import { createAdrReportRepository } from './repositories/index.js'
import {
  PUBLIC_COMPANY_LABEL,
  REPORT_SOURCES,
  ROUTE_SELECTION_KINDS,
  ROUTE_STATUSES,
  buildIdempotencyKey,
  normalizeCompanyName,
  validateRouteInput,
  isEligibleBusinessType,
} from './routing.js'

const REPORT_ID = '11111111-1111-4111-8111-111111111111'
const PRODUCT_ID = '22222222-2222-4222-8222-222222222222'
const BUSINESS_ID = '33333333-3333-4333-8333-333333333333'

describe('routing constants', () => {
  it('uses the approved public label verbatim', () => {
    expect(PUBLIC_COMPANY_LABEL).toBe(
      'Company responsible for this medicine/product in your country (if known)'
    )
  })

  it('classifies the four required report sources', () => {
    expect([...REPORT_SOURCES].sort()).toEqual(
      ['business_facility', 'health_facility', 'public', 'unknown'].sort()
    )
  })

  it('supports the three selection kinds and three route statuses', () => {
    expect([...ROUTE_SELECTION_KINDS].sort()).toEqual(
      ['unknown', 'unverified_candidate', 'verified'].sort()
    )
    expect([...ROUTE_STATUSES].sort()).toEqual(['pending', 'routed', 'verified'].sort())
  })
})

describe('normalizeCompanyName', () => {
  it('trims, collapses spaces and lowercases (matches SQL normalization)', () => {
    expect(normalizeCompanyName('  Fidson   Healthcare  PLC ')).toBe('fidson healthcare plc')
  })

  it('returns empty string for blank input', () => {
    expect(normalizeCompanyName('   ')).toBe('')
    expect(normalizeCompanyName(null)).toBe('')
  })
})

describe('buildIdempotencyKey', () => {
  it('is stable for identical inputs', () => {
    const a = buildIdempotencyKey({ reportId: REPORT_ID, productId: PRODUCT_ID, kind: 'verified', businessId: BUSINESS_ID })
    const b = buildIdempotencyKey({ reportId: REPORT_ID, productId: PRODUCT_ID, kind: 'verified', businessId: BUSINESS_ID })
    expect(a).toBe(b)
    expect(a.length).toBeGreaterThan(0)
  })

  it('distinguishes selection kinds for the same product', () => {
    const verified = buildIdempotencyKey({ reportId: REPORT_ID, productId: PRODUCT_ID, kind: 'verified', businessId: BUSINESS_ID })
    const unknown = buildIdempotencyKey({ reportId: REPORT_ID, productId: PRODUCT_ID, kind: 'unknown' })
    expect(verified).not.toBe(unknown)
  })

  it('normalizes candidate text so retries with different spacing collide', () => {
    const a = buildIdempotencyKey({ reportId: REPORT_ID, productId: PRODUCT_ID, kind: 'unverified_candidate', candidateName: 'Acme  Labs' })
    const b = buildIdempotencyKey({ reportId: REPORT_ID, productId: PRODUCT_ID, kind: 'unverified_candidate', candidateName: '  acme labs ' })
    expect(a).toBe(b)
  })

  it('distinguishes different businesses on the same product', () => {
    const a = buildIdempotencyKey({ reportId: REPORT_ID, productId: PRODUCT_ID, kind: 'verified', businessId: BUSINESS_ID })
    const b = buildIdempotencyKey({ reportId: REPORT_ID, productId: PRODUCT_ID, kind: 'verified', businessId: '44444444-4444-4444-8444-444444444444' })
    expect(a).not.toBe(b)
  })
})

describe('validateRouteInput', () => {
  it('accepts a verified selection with a business id', () => {
    expect(validateRouteInput({ reportId: REPORT_ID, productId: PRODUCT_ID, kind: 'verified', businessId: BUSINESS_ID }).ok).toBe(true)
  })

  it('accepts an explicit unknown selection with no company reference', () => {
    expect(validateRouteInput({ reportId: REPORT_ID, productId: PRODUCT_ID, kind: 'unknown' }).ok).toBe(true)
  })

  it('accepts an unverified candidate with manual text only', () => {
    expect(validateRouteInput({ reportId: REPORT_ID, productId: PRODUCT_ID, kind: 'unverified_candidate', candidateName: 'Acme Labs' }).ok).toBe(true)
  })

  it('rejects missing report or product ids', () => {
    expect(validateRouteInput({ productId: PRODUCT_ID, kind: 'unknown' }).ok).toBe(false)
    expect(validateRouteInput({ reportId: REPORT_ID, kind: 'unknown' }).ok).toBe(false)
  })

  it('rejects unknown selection kinds', () => {
    expect(validateRouteInput({ reportId: REPORT_ID, productId: PRODUCT_ID, kind: 'maybe' }).ok).toBe(false)
  })

  it('rejects verified without a business id', () => {
    const result = validateRouteInput({ reportId: REPORT_ID, productId: PRODUCT_ID, kind: 'verified' })
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/business/i)
  })

  it('rejects verified carrying candidate text (never auto-verify manual text)', () => {
    const result = validateRouteInput({ reportId: REPORT_ID, productId: PRODUCT_ID, kind: 'verified', businessId: BUSINESS_ID, candidateName: 'Acme' })
    expect(result.ok).toBe(false)
  })

  it('rejects unknown carrying any company reference', () => {
    expect(validateRouteInput({ reportId: REPORT_ID, productId: PRODUCT_ID, kind: 'unknown', businessId: BUSINESS_ID }).ok).toBe(false)
    expect(validateRouteInput({ reportId: REPORT_ID, productId: PRODUCT_ID, kind: 'unknown', candidateName: 'Acme' }).ok).toBe(false)
  })

  it('rejects unverified candidate without manual text', () => {
    expect(validateRouteInput({ reportId: REPORT_ID, productId: PRODUCT_ID, kind: 'unverified_candidate' }).ok).toBe(false)
    expect(validateRouteInput({ reportId: REPORT_ID, productId: PRODUCT_ID, kind: 'unverified_candidate', candidateName: '  ' }).ok).toBe(false)
  })

  it('rejects unverified candidate carrying a business id', () => {
    const result = validateRouteInput({ reportId: REPORT_ID, productId: PRODUCT_ID, kind: 'unverified_candidate', candidateName: 'Acme', businessId: BUSINESS_ID })
    expect(result.ok).toBe(false)
  })

  it('rejects malformed business ids', () => {
    const result = validateRouteInput({ reportId: REPORT_ID, productId: PRODUCT_ID, kind: 'verified', businessId: 'not-a-uuid' })
    expect(result.ok).toBe(false)
  })
})

describe('isEligibleBusinessType', () => {
  it('is true only for manufacturer_importer and wholesale', () => {
    expect(isEligibleBusinessType('manufacturer_importer')).toBe(true)
    expect(isEligibleBusinessType('wholesale')).toBe(true)
    expect(isEligibleBusinessType('pharmacy')).toBe(false)
    expect(isEligibleBusinessType('hospital')).toBe(false)
    expect(isEligibleBusinessType(null)).toBe(false)
  })
})

describe('adrReportRepository routing methods', () => {
  function recordingRepo() {
    const calls = []
    const repo = createAdrReportRepository({
      request: async (path, options) => {
        calls.push({ path, method: options?.method || 'GET', body: options?.body ? JSON.parse(options.body) : null })
        return []
      },
    })
    return { calls, repo }
  }

  it('getProductRoutes scopes reads to the parent report', async () => {
    const { calls, repo } = recordingRepo()
    await repo.getProductRoutes(REPORT_ID)
    expect(calls).toEqual([
      { path: `adr_product_company_routes?report_id=eq.${REPORT_ID}&order=created_at.asc&select=*`, method: 'GET', body: null },
    ])
  })

  it('createProductRoute posts the idempotent RPC with a generated key', async () => {
    const { calls, repo } = recordingRepo()
    await repo.createProductRoute({ reportId: REPORT_ID, productId: PRODUCT_ID, kind: 'verified', businessId: BUSINESS_ID })
    expect(calls).toHaveLength(1)
    expect(calls[0].path).toBe('rpc/create_adr_product_route')
    expect(calls[0].method).toBe('POST')
    expect(calls[0].body.p_report_id).toBe(REPORT_ID)
    expect(calls[0].body.p_product_id).toBe(PRODUCT_ID)
    expect(calls[0].body.p_selection_kind).toBe('verified')
    expect(calls[0].body.p_responsible_business_id).toBe(BUSINESS_ID)
    expect(calls[0].body.p_idempotency_key).toBe(
      buildIdempotencyKey({ reportId: REPORT_ID, productId: PRODUCT_ID, kind: 'verified', businessId: BUSINESS_ID })
    )
  })

  it('createProductRoute passes an explicit idempotency key through for retries', async () => {
    const { calls, repo } = recordingRepo()
    await repo.createProductRoute({ reportId: REPORT_ID, productId: PRODUCT_ID, kind: 'unknown', idempotencyKey: 'retry-key-1' })
    expect(calls[0].body.p_idempotency_key).toBe('retry-key-1')
    expect(calls[0].body.p_selection_kind).toBe('unknown')
  })

  it('searchEligibleCompanies posts the type-ahead RPC with defaults', async () => {
    const { calls, repo } = recordingRepo()
    await repo.searchEligibleCompanies('fidson')
    expect(calls).toEqual([
      { path: 'rpc/search_eligible_product_companies', method: 'POST', body: { p_query: 'fidson', p_limit: 20 } },
    ])
  })
})
