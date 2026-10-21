import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { financialEligibility } from '../financialEligibility.js'
import { BUSINESS_TYPES } from '../../config/constants.js'

// Every id the platform has ever stored: the signup taxonomy plus the legacy types.
const LEGACY = ['skincare', 'dental', 'optical', 'wellness', 'manufacturer_importer', 'wholesale']
const ALL = [...new Set([...BUSINESS_TYPES.map((t) => t.id), ...LEGACY])]

describe('financial eligibility matrix', () => {
  it.each(ALL)('%s: the owner can view, top up and withdraw from the wallet', (type) => {
    const e = financialEligibility(type)
    expect(e.wallet).toEqual({ view: true, topUp: true, withdraw: true })
  })

  it('an unknown or empty type still gets the wallet (it normalises to "other")', () => {
    for (const t of ['', null, undefined, 'something-new']) expect(financialEligibility(t).wallet.view).toBe(true)
  })

  it('Importers/Manufacturers are not special: every type has the same wallet rights', () => {
    const importer = financialEligibility('manufacturer_importer').wallet
    for (const t of ALL) expect(financialEligibility(t).wallet).toEqual(importer)
  })

  it('identity verification is off by default and never a payment prerequisite', () => {
    for (const t of ALL) {
      const e = financialEligibility(t)
      expect(e.kyc.interface).toBe(false)
      expect(e.kyc.requiredForPayments).toBe(false)
    }
  })

  it('when the platform switch is on, KYC is offered to every type, not one', () => {
    for (const t of ALL) expect(financialEligibility(t, { kycEnabled: true }).kyc.interface).toBe(true)
  })
})

// The UI matrix above is only meaningful if the money paths cannot disagree with it.
// Backend and database were checked directly (no wallet/KYC function reads business_type;
// the policies are tenancy-based). This guard keeps it that way for the code in this repo.
describe('wallet and payment code does not gate on business type', () => {
  const root = resolve(__dirname, '../../..')
  const files = (dir) => readdirSync(dir).flatMap((n) => {
    const p = join(dir, n)
    if (statSync(p).isDirectory()) return n === 'node_modules' || n === '__tests__' ? [] : files(p)
    return /\.(js|jsx)$/.test(n) && !/\.test\./.test(n) ? [p] : []
  })
  const money = [
    ...files(join(root, 'src/modules/wallet')),
    ...['initiate-business-withdrawal', 'initiate-wallet-topup', 'verify-wallet-topup', 'payout-accounts', 'kyc', 'withdrawal-pin', 'resolve-account']
      .map((h) => join(root, 'api/_handlers', h + '.js')),
  ]

  it.each(money.map((f) => [f.slice(root.length + 1).replace(/\\/g, '/'), f]))('%s', (_n, f) => {
    const src = readFileSync(f, 'utf8')
    expect(src, 'must not branch on business_type / manufacturer / importer').not.toMatch(/business_type|businessType|manufacturer_importer|isEnterprise/)
  })
})
