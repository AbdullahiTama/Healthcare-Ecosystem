// The wiring of the reconciliation pass: the replay must use the SAME processor as the live webhook, and a payment the pass settles
// must run the same side effects the webhook runs.
const h = vi.hoisted(() => ({ runReconciliation: vi.fn(), processWebhookEvent: vi.fn(), runSettlementEffects: vi.fn(), provider: { name: 'paystack' } }))
vi.mock('@care-ecosystem/shared-payments', () => ({ runReconciliation: h.runReconciliation }))
vi.mock('../payments.js', () => ({ getPaystackProvider: () => h.provider, paymentLogger: { info() {}, warn() {}, error() {} } }))
vi.mock('../webhookProcessor.js', () => ({ processWebhookEvent: h.processWebhookEvent }))
vi.mock('../settlementEffects.js', () => ({ runSettlementEffects: h.runSettlementEffects }))

import { runFinanceReconciliation } from '../financeReconcile.js'

describe('runFinanceReconciliation', () => {
  it('hands the engine the live webhook processor and the settlement effects', async () => {
    h.runReconciliation.mockResolvedValue({ failed: [] })
    const supabase = { id: 'sb' }
    expect(await runFinanceReconciliation(supabase)).toEqual({ failed: [] })
    const [sb, provider, opts] = h.runReconciliation.mock.calls[0]
    expect(sb).toBe(supabase)
    expect(provider).toBe(h.provider)
    await opts.processEvent({ event: 'charge.success' })
    expect(h.processWebhookEvent).toHaveBeenCalledWith(supabase, { event: 'charge.success' })
    await opts.onSettled({ outcome: 'settled' })
    expect(h.runSettlementEffects).toHaveBeenCalledWith(supabase, { outcome: 'settled' })
  })
})
