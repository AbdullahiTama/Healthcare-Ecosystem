// H06: identity verification (KYC) is OFF and must stay OUT of the payment path. This is the guard against a hidden dependency:
// it enumerates the source and fails if a payment, withdrawal, refund, wallet or e-mail module starts to read KYC data or build
// the paid provider, and it pins the few places that are ALLOWED to know about KYC (all of them behind the kyc_enabled switch).
import { describe, it, expect, afterEach } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { hashIdentifier } from '../kyc/identity.js'

const repo = path.resolve(fileURLToPath(new URL('../../../../', import.meta.url)))
const SKIP = new Set(['node_modules', 'dist', '.git', '__tests__', 'test', 'tests'])

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue
    const p = path.join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) walk(p, out)
    else if (/\.(js|jsx|mjs)$/.test(name) && !/\.test\.(js|jsx)$/.test(name)) out.push(p)
  }
  return out
}
const rel = (p) => path.relative(repo, p).split(path.sep).join('/')
const sources = [
  ...walk(path.join(repo, 'packages/shared-payments/src')),
  ...walk(path.join(repo, 'packages/shared-email/src')),
  ...walk(path.join(repo, 'apps/carefind/api')),
  ...walk(path.join(repo, 'apps/carehub/api')),
]
const text = new Map(sources.map((p) => [rel(p), readFileSync(p, 'utf8')]))

// Everything that may mention KYC data or the paid provider, and why.
const ALLOWED = new Set([
  'packages/shared-payments/src/kyc/DojahProvider.js',      // the provider itself
  'packages/shared-payments/src/kyc/identity.js',           // verification logic, reached only from the switch-gated handler
  'packages/shared-payments/src/kyc/nameMatch.js',          // pure name comparison (also used by identity.js)
  'packages/shared-payments/src/payoutHandlers.js',         // createKycHandler: checks the switch first
  'packages/shared-payments/src/withdrawalLimits.js',       // kycTier(): read only when config.kycEnabled
  'packages/shared-payments/src/payoutAccounts.js',         // listPayoutAccounts: tier shown only when config.kycEnabled
  'packages/shared-payments/src/index.js',                  // exports
  'apps/carefind/api/_handlers/kyc.js',                     // route -> createKycHandler
  'apps/carehub/api/_handlers/kyc.js',
  'apps/carefind/api/router.js',
  'apps/carehub/api/router.js',
])
const KYC_DATA_OR_PROVIDER = /kyc_verifications|kyc_begin_attempt|kyc_save_verified|kyc_save_selfie|createDojahFromEnv|DojahProvider|kycTier|hashIdentifier/

describe('KYC stays out of the payment path (H06)', () => {
  it('finds the source it is guarding (a vacuous pass is a failure)', () => {
    expect(text.size).toBeGreaterThan(100)
    expect(text.has('packages/shared-payments/src/withdrawals.js')).toBe(true)
    expect(text.has('apps/carefind/api/_handlers/initiate-withdrawal.js')).toBe(true)
  })

  it('no module outside the allowlist reads KYC data or builds the paid provider', () => {
    const offenders = [...text].filter(([file, src]) => !ALLOWED.has(file) && KYC_DATA_OR_PROVIDER.test(src)).map(([file]) => file)
    expect(offenders).toEqual([])
  })

  it('the withdrawal, refund, settlement, intent, OTP, PIN and e-mail modules do not mention identity verification at all', () => {
    const core = [
      'packages/shared-payments/src/withdrawals.js', 'packages/shared-payments/src/refunds.js', 'packages/shared-payments/src/settlement.js',
      'packages/shared-payments/src/intents.js', 'packages/shared-payments/src/otp.js', 'packages/shared-payments/src/pin.js',
      'packages/shared-payments/src/effects.js', 'packages/shared-payments/src/requestSettlement.js', 'packages/shared-payments/src/reconciliation.js',
      'packages/shared-payments/src/refundEffects.js', 'packages/shared-payments/src/businessWithdrawalEffects.js',
      'apps/carefind/api/_handlers/initiate-withdrawal.js', 'apps/carehub/api/_handlers/initiate-business-withdrawal.js',
      'apps/carefind/api/_lib/withdrawalEffects.js', 'apps/carefind/api/_lib/moneyNotifications.js',
    ]
    for (const file of core) {
      expect(text.has(file), `${file} exists`).toBe(true)
      expect(text.get(file), `${file} must not mention KYC`).not.toMatch(/kyc|dojah|bvn|\bnin\b/i)
    }
  })

  it('the only way the withdrawal handlers reach KYC is through the limit helper, which reads a KYC row only when the switch is on', () => {
    const limits = text.get('packages/shared-payments/src/withdrawalLimits.js')
    // kycTier() is called in exactly one place, and that call is guarded by the switch
    const calls = limits.match(/await kycTier\(/g) || []
    expect(calls).toHaveLength(1)
    expect(limits).toMatch(/kycOn && ownerType === 'user' && saved \? await kycTier/)
  })

  it('the KYC endpoint is gated by the switch before any other work', () => {
    const handlers = text.get('packages/shared-payments/src/payoutHandlers.js')
    const gate = handlers.indexOf('isKycEnabled(supabase)')
    const firstUse = handlers.indexOf('getProvider()')
    expect(gate).toBeGreaterThan(-1)
    expect(gate).toBeLessThan(firstUse)
  })
})

describe('the identity hash key (only matters when identity verification is re-enabled)', () => {
  const keep = { ...process.env }
  afterEach(() => { process.env = { ...keep } })

  it('production requires its own KYC_HASH_SECRET: neither the one-time-code key nor the service-role key is accepted', () => {
    process.env.NODE_ENV = 'production'
    delete process.env.KYC_HASH_SECRET
    process.env.OTP_HMAC_SECRET = 'otp-key'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key'
    expect(() => hashIdentifier('bvn', '22222222222')).toThrow(/KYC_HASH_SECRET must be set in production/)
  })

  it('with its own key it works and is keyed and domain-separated', () => {
    process.env.NODE_ENV = 'production'
    process.env.KYC_HASH_SECRET = 'kyc-key'
    const a = hashIdentifier('bvn', '22222222222')
    expect(a).toMatch(/^[0-9a-f]{64}$/)
    expect(hashIdentifier('nin', '22222222222')).not.toBe(a)
    process.env.KYC_HASH_SECRET = 'another-key'
    expect(hashIdentifier('bvn', '22222222222')).not.toBe(a)
  })

  it('outside production the older fallbacks still let local runs work', () => {
    process.env.NODE_ENV = 'test'
    delete process.env.KYC_HASH_SECRET
    process.env.OTP_HMAC_SECRET = 'otp-key'
    expect(hashIdentifier('bvn', '22222222222')).toMatch(/^[0-9a-f]{64}$/)
  })
})
