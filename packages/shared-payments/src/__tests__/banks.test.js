import { describe, it, expect } from 'vitest'
import * as payments from '../banks.js'

const { createBanksHandler } = payments
const NIGERIAN_BANKS = payments.NIGERIAN_BANKS

// The owner-approved withdrawal bank list. Codes and slugs are Paystack's own (verified against
// /bank?country=nigeria): the same code is sent to /bank/resolve (account-name lookup) and to
// /transferrecipient (the payout), and Paystack accepts only its own codes for either.
const SUPPORTED = [
  { code: '057',    name: 'Zenith Bank',            slug: 'zenith-bank' },
  { code: '999992', name: 'OPay',                   slug: 'paycom' },
  { code: '999991', name: 'PalmPay',                slug: 'palmpay' },
  { code: '011',    name: 'First Bank of Nigeria',  slug: 'first-bank-of-nigeria' },
  { code: '033',    name: 'United Bank for Africa', slug: 'united-bank-for-africa' },
  { code: '301',    name: 'Jaiz Bank',              slug: 'jaiz-bank' },
  { code: '063',    name: 'Diamond Bank',           slug: 'access-bank-diamond' },
  { code: '50211',  name: 'Kuda',                   slug: 'kuda-bank' },
  { code: '232',    name: 'Sterling Bank',          slug: 'sterling-bank' },
  { code: '058',    name: 'GTBank',                 slug: 'guaranty-trust-bank' },
  { code: '044',    name: 'Access Bank',            slug: 'access-bank' },
  { code: '214',    name: 'First City Monument Bank', slug: 'first-city-monument-bank' },
  { code: '070',    name: 'Fidelity Bank',          slug: 'fidelity-bank' },
  { code: '221',    name: 'Stanbic IBTC Bank',      slug: 'stanbic-ibtc-bank' },
  { code: '032',    name: 'Union Bank of Nigeria',  slug: 'union-bank-of-nigeria' },
  { code: '035',    name: 'Wema Bank',              slug: 'wema-bank' },
  { code: '076',    name: 'Polaris Bank',           slug: 'polaris-bank' },
  { code: '050',    name: 'Ecobank Nigeria',        slug: 'ecobank-nigeria' },
  { code: '068',    name: 'Standard Chartered Bank', slug: 'standard-chartered-bank' },
  { code: '082',    name: 'Keystone Bank',          slug: 'keystone-bank' },
  { code: '215',    name: 'Unity Bank',             slug: 'unity-bank' },
  { code: '101',    name: 'Providus Bank',          slug: 'providus-bank' },
  { code: '023',    name: 'Citibank Nigeria',       slug: 'citibank-nigeria' },
  { code: '50515',  name: 'Moniepoint MFB',        slug: 'moniepoint-mfb-ng' },
  { code: '102',    name: 'Titan Bank',             slug: 'titan-bank' },
  { code: '00103',  name: 'Globus Bank',            slug: 'globus-bank' },
  { code: '107',    name: 'Optimus Bank Limited',   slug: 'optimus-bank-ltd' },
  { code: '104',    name: 'Parallex Bank',          slug: 'parallex-bank' },
  { code: '100',    name: 'Suntrust Bank',          slug: 'suntrust-bank' },
  { code: '035A',   name: 'ALAT by WEMA',           slug: 'alat-by-wema' },
]

const res = () => { const r = { code: 0, body: null }; r.status = (c) => { r.code = c; return r }; r.json = (b) => { r.body = b; return r }; return r }

describe('NIGERIAN_BANKS', () => {
  it('is exactly the supported banks, in the approved order', () => {
    expect(NIGERIAN_BANKS).toEqual(SUPPORTED)
  })

  it('carries one unique string code per bank, so a lookup cannot be ambiguous', () => {
    expect(NIGERIAN_BANKS).toBeDefined()
    const codes = NIGERIAN_BANKS.map((b) => b.code)
    expect(codes).toHaveLength(new Set(codes).size)
    expect(codes.every((c) => typeof c === 'string')).toBe(true)
  })
})

describe('createBanksHandler', () => {
  it('serves the fixed list on GET without contacting Paystack', async () => {
    const handler = createBanksHandler()
    const r = res()
    await handler({ method: 'GET' }, r)
    expect(r.code).toBe(200)
    expect(r.body).toEqual(SUPPORTED)
  })

  it('rejects non-GET methods with 405', async () => {
    const handler = createBanksHandler()
    const r = res()
    await handler({ method: 'POST' }, r)
    expect(r.code).toBe(405)
  })
})
