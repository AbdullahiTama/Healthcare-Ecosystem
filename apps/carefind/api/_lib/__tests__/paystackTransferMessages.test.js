import { describe, it, expect } from 'vitest'
import { isProviderBalanceShortfall, withdrawalFailureMessage } from '../paystackTransfer.js'

// The reported failure, verbatim, from a real provider response:
const PAYSTACK_SHORTFALL = 'Your balance is not enough to fulfil this request.'

describe('isProviderBalanceShortfall', () => {
  it('recognises Paystack\'s balance refusal, which is about the PLATFORM\'s naira, not the customer\'s coins', () => {
    expect(isProviderBalanceShortfall(PAYSTACK_SHORTFALL)).toBe(true)
    expect(isProviderBalanceShortfall('Insufficient balance')).toBe(true)
  })

  it('does not hijack a refusal that is actually useful to the person withdrawing', () => {
    expect(isProviderBalanceShortfall('Recipient is not enabled')).toBe(false)
    expect(isProviderBalanceShortfall('Invalid transfer reference')).toBe(false)
    expect(isProviderBalanceShortfall('')).toBe(false)
    expect(isProviderBalanceShortfall(undefined)).toBe(false)
  })
})

describe('withdrawalFailureMessage', () => {
  it('never tells a customer their wallet was short when the PLATFORM could not fund the payout', () => {
    const msg = withdrawalFailureMessage({ providerMessage: PAYSTACK_SHORTFALL, refunded: true, platformShortfall: true })
    // Must not forward the provider's own words, which blame a balance the customer does not hold.
    expect(msg).not.toContain(PAYSTACK_SHORTFALL)
    expect(msg).not.toMatch(/not enough/i)
    expect(msg).toMatch(/temporarily unable to send payouts/i)
    // It still states the part that matters: the coins are back, so they may try again.
    expect(msg).toMatch(/returned to your wallet/i)
  })

  it('a platform shortfall does not claim the coins are back while reconciliation is still open', () => {
    const msg = withdrawalFailureMessage({ providerMessage: PAYSTACK_SHORTFALL, refunded: false, platformShortfall: true })
    expect(msg).not.toMatch(/returned to your wallet/i)
    expect(msg).toMatch(/still checking/i)
  })

  it('still forwards a specific, useful provider refusal', () => {
    const msg = withdrawalFailureMessage({ providerMessage: 'Recipient is not enabled', refunded: true })
    expect(msg).toContain('Recipient is not enabled')
    expect(msg).toMatch(/returned to your wallet/i)
  })

  it('says the coins are back ONLY when the server actually refunded them', () => {
    expect(withdrawalFailureMessage({ providerMessage: 'x', refunded: true })).toMatch(/returned to your wallet/i)
    const pending = withdrawalFailureMessage({ providerMessage: 'x', refunded: false })
    expect(pending).not.toMatch(/returned to your wallet/i)
    expect(pending).toMatch(/still checking/i)
  })

  it('degrades to a plain sentence rather than an empty or "undefined" one', () => {
    expect(withdrawalFailureMessage({ refunded: true })).toMatch(/returned to your wallet/i)
    const blank = withdrawalFailureMessage({ providerMessage: '   ', refunded: true })
    expect(blank).not.toMatch(/undefined|null/)
    expect(blank.startsWith('.')).toBe(false)
  })
})