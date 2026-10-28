import { describe, it, expect, vi } from 'vitest'
import { attemptStatus, buildReceiptHtml, confirmPlanPayment, methodLabel, usageMeters } from './billing'

const payment = {
  id: 'p1', receipt_number: 'CH-2026-000007', reference: 'ch_plan_x', plan: 'basic', months: 12, amount: 50000, currency: 'NGN',
  payment_method: 'paystack', provider_transaction_id: '6647230774', period_start: '2026-10-11T00:00:00Z', period_end: '2027-10-11T00:00:00Z',
  paid_at: '2026-10-11T13:08:48Z',
}

describe('receipt', () => {
  it('shows the receipt number, plan, period, method, references and amount', () => {
    const html = buildReceiptHtml(payment, { name: 'Ada Pharmacy', email: 'ada@x.com', city: 'Ikeja', state: 'Lagos' })
    for (const s of ['CH-2026-000007', 'Basic plan — 12 months', 'Paystack (card / bank)', 'ch_plan_x', '6647230774', '₦50,000', 'Ada Pharmacy', 'Ikeja, Lagos', 'PAID']) {
      expect(html).toContain(s)
    }
  })

  it('escapes owner-typed business details', () => {
    const html = buildReceiptHtml(payment, { name: '<img src=x onerror=alert(1)>' })
    expect(html).not.toContain('<img src=x')
    expect(html).toContain('&lt;img src=x')
  })

  it('omits the Paystack id for a wallet payment', () => {
    const html = buildReceiptHtml({ ...payment, payment_method: 'wallet', provider_transaction_id: null }, {})
    expect(html).toContain('CareHub wallet')
    expect(html).not.toContain('Paystack transaction ID')
  })
})

describe('labels', () => {
  it('methods', () => {
    expect(methodLabel('manual')).toBe('Recorded by CareHub')
    expect(methodLabel(null)).toBe('—')
  })

  it('attempts: Paystack attempts can be checked unless held for refund; wallet ones cannot', () => {
    expect(attemptStatus({ status: 'pending', purpose: 'plan_renewal' })).toMatchObject({ label: 'Awaiting confirmation', canCheck: true })
    expect(attemptStatus({ status: 'failed', purpose: 'plan_renewal' })).toMatchObject({ label: 'Not completed', canCheck: true })
    expect(attemptStatus({ status: 'expired', purpose: 'plan_renewal' })).toMatchObject({ label: 'Abandoned', canCheck: true })
    expect(attemptStatus({ status: 'needs_refund', purpose: 'plan_renewal' })).toMatchObject({ label: 'Under review', canCheck: false })
    expect(attemptStatus({ status: 'refunded', purpose: 'plan_renewal' }).canCheck).toBe(false)
    expect(attemptStatus({ status: 'pending', purpose: 'plan_renewal_wallet' }).canCheck).toBe(false)
  })
})

describe('usageMeters', () => {
  it('flags near and full limits; null is unlimited', () => {
    const m = usageMeters({ usage: { staff: 5, locations: 1, products: 4100 }, limits: { staff: 5, locations: 2, products: 5000 } })
    expect(m.map((x) => x.tone)).toEqual(['full', 'ok', 'near'])
    const u = usageMeters({ usage: { staff: 40 }, limits: { staff: null } })[0]
    expect(u).toMatchObject({ limit: null, tone: 'ok' })
  })
})

describe('confirmPlanPayment', () => {
  const session = () => Promise.resolve({ data: { session: { access_token: 'tok' } } })

  it('posts the reference with the session token', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ credited: true, newExpiry: '2027-01-01' }) }))
    expect(await confirmPlanPayment('ref1', { fetchImpl, getSession: session })).toEqual({ credited: true, newExpiry: '2027-01-01' })
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe('/api/verify-plan-payment')
    expect(init.headers.Authorization).toBe('Bearer tok')
    expect(JSON.parse(init.body)).toEqual({ reference: 'ref1' })
  })

  it('throws the server reason; refuses without a session', async () => {
    const fetchImpl = async () => ({ ok: false, json: async () => ({ error: 'Payment not confirmed by Paystack' }) })
    await expect(confirmPlanPayment('r', { fetchImpl, getSession: session })).rejects.toThrow('Payment not confirmed by Paystack')
    await expect(confirmPlanPayment('r', { fetchImpl, getSession: async () => ({ data: {} }) })).rejects.toThrow('sign in')
  })
})
