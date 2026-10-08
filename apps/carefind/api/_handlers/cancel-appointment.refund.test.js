// Cancelling a paid appointment refunds it through the refund engine (confirmed owner policy: the business may cancel any
// time, a patient 24h or more ahead; the platform absorbs the provider's fee). Node moves no money: it asks the database for
// the refund, sends a card refund to Paystack AFTER that request committed, and the cron finishes anything that did not.
const h = vi.hoisted(() => {
  const s = { rpcCalls: [], routes: {}, tables: [], appt: null, refundPayment: vi.fn() }
  const builderFor = (table) => {
    const b = {
      select: () => b, eq: () => b,
      update: (v) => { s.tables.push([table, 'update', v]); return b },
      insert: (v) => { s.tables.push([table, 'insert', v]); return Promise.resolve({ error: null }) },
      maybeSingle: async () => (table === 'appointments' ? { data: s.appt } : { data: null }),
      then: (resolve) => resolve({ error: null }),
    }
    return b
  }
  s.client = { from: builderFor, rpc: async (n, a) => { s.rpcCalls.push([n, a]); const r = s.routes[n]; return typeof r === 'function' ? r(a) : r || { data: null } } }
  return s
})

vi.mock('@supabase/supabase-js', () => ({ createClient: () => h.client }))
vi.mock('../_lib/verifyUser.js', () => ({ verifyUser: async () => ({ id: 'owner-1', email: 'o@x.com' }) }))
vi.mock('../_lib/businessOwnership.js', () => ({ userOwnsBusiness: async () => true }))
vi.mock('../_lib/emailService.js', () => ({ enqueue: vi.fn(async () => {}), processBatch: vi.fn(async () => {}) }))
vi.mock('../_lib/payments.js', () => ({ getPaystackProvider: () => ({ refundPayment: h.refundPayment }), paymentLogger: { info() {}, warn() {}, error() {} } }))

import { ProviderError } from '@care-ecosystem/shared-payments'
import handler from './cancel-appointment.js'

const call = (body = { appointment_id: 'a1', cancelled_by: 'owner' }) => {
  const res = { statusCode: 0, body: null, status(c) { this.statusCode = c; return this }, json(b) { this.body = b; return this } }
  return handler({ method: 'POST', body, headers: {} }, res).then(() => res)
}
const soon = () => new Date(Date.now() + 2 * 3600 * 1000)
const requested = { data: { outcome: 'requested', id: 'rf1', reference: 'rf_1', kind: 'card', amount_kobo: 1000000, provider_transaction_reference: 'chapp_1_abcdefgh' } }
const rpcs = (n) => h.rpcCalls.filter(([name]) => name === n).map(([, a]) => a)

beforeEach(() => {
  h.rpcCalls.length = 0
  h.tables.length = 0
  h.routes = { request_refund: requested, mark_refund_processing: { data: 'ok' }, settle_refund: { data: { result: 'completed' } } }
  h.refundPayment.mockReset().mockResolvedValue({ providerRefundId: '77', status: 'processing', amountKobo: 1000000 })
  const d = soon()
  h.appt = { id: 'a1', business_id: 'b1', status: 'confirmed', payment_status: 'paid', payment_channel: 'card', fee_amount: 1000000, date: d.toISOString().slice(0, 10), time: d.toISOString().slice(11, 16), client_name: 'Ada', payment_reference: 'chapp_1_abcdefgh' }
})

describe('cancel-appointment refunds through the refund engine', () => {
  it('a paid card booking: asks for the refund, then sends it to Paystack for the payment\'s reference and exact amount', async () => {
    const res = await call()
    expect(res.statusCode).toBe(200)
    expect(rpcs('request_refund')).toEqual([{ p_cause: 'booking_cancelled', p_entity_type: 'appointment', p_entity_id: 'a1', p_requested_by: null, p_reason: 'appointment cancelled', p_platform_funded: false }])
    expect(h.refundPayment).toHaveBeenCalledWith({ reference: 'chapp_1_abcdefgh', amountKobo: 1000000, reason: 'Appointment cancelled' })
    expect(res.body).toMatchObject({ success: true, refund_processed: true, refund: { status: 'processing' } })
  })

  it('moves no money from Node: no wallet ledger insert, no direct appointment refund, no fake withdrawal', async () => {
    await call()
    expect(h.tables.some(([t, op]) => t === 'business_wallet_transactions' && op === 'insert')).toBe(false)
    expect(h.tables.some(([t, op, v]) => t === 'appointments' && op === 'update' && v.payment_status === 'refunded')).toBe(false)
    expect(h.rpcCalls.map(([n]) => n)).not.toContain('request_business_withdrawal')
  })

  it('the provider confirms at once: the refund is settled as processed and reported completed', async () => {
    h.refundPayment.mockResolvedValue({ providerRefundId: '77', status: 'completed', amountKobo: 1000000 })
    const res = await call()
    expect(rpcs('settle_refund')[0]).toMatchObject({ p_outcome: 'processed', p_refund_id: 'rf1', p_amount_kobo: 1000000 })
    expect(res.body.refund).toEqual({ status: 'completed' })
  })

  it('a CareCoin booking is refunded entirely inside the database: Paystack is never called', async () => {
    h.routes.request_refund = { data: { outcome: 'completed', id: 'rf2', kind: 'carecoin', coins: 5 } }
    const res = await call()
    expect(h.refundPayment).not.toHaveBeenCalled()
    expect(res.body.refund).toEqual({ status: 'completed' })
  })

  it('an unpaid booking asks for nothing', async () => {
    h.appt.payment_status = 'unpaid'; h.appt.fee_amount = 0
    const res = await call()
    expect(rpcs('request_refund')).toHaveLength(0)
    expect(res.body).toMatchObject({ refund_processed: false, refund: { status: 'none' } })
  })

  it('a booking paid at the POS / by transfer is not the platform\'s to refund: reported as offline, nothing sent', async () => {
    h.routes.request_refund = { data: { outcome: 'not_refundable_by_platform', channel: 'pos' } }
    const res = await call()
    expect(h.refundPayment).not.toHaveBeenCalled()
    expect(res.body.refund).toEqual({ status: 'offline' })
  })

  it('a refund that already exists is not repeated', async () => {
    h.routes.request_refund = { data: { outcome: 'already_requested', id: 'rf1' } }
    const res = await call()
    expect(h.refundPayment).not.toHaveBeenCalled()
    expect(res.body.refund).toEqual({ status: 'already' })
  })

  it('the cancellation stands even when the refund request fails: it is left pending for the cron, never lost, never half-sent', async () => {
    h.routes.request_refund = { data: null, error: { message: 'db down' } }
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await call()
    expect(res.statusCode).toBe(200)
    expect(h.tables.some(([t, op, v]) => t === 'appointments' && op === 'update' && v.status === 'cancelled')).toBe(true)
    expect(res.body.refund).toEqual({ status: 'pending' })
    expect(h.refundPayment).not.toHaveBeenCalled()
    err.mockRestore()
  })

  it('a provider timeout leaves the refund requested (pending), never failed: the cron asks Paystack before sending again', async () => {
    h.refundPayment.mockRejectedValue(new ProviderError({ code: 'timeout', message: 'timed out', ambiguous: true, operation: 'refundPayment' }))
    const res = await call()
    expect(res.body.refund).toEqual({ status: 'pending' })
    expect(rpcs('settle_refund')).toHaveLength(0)
  })

  it('a definite Paystack refusal fails the refund so the business gets its share back', async () => {
    h.refundPayment.mockRejectedValue(new ProviderError({ code: 'provider_rejected', message: 'Refund amount exceeds the transaction', operation: 'refundPayment' }))
    h.routes.settle_refund = { data: { result: 'failed' } }
    const res = await call()
    expect(rpcs('settle_refund')[0]).toMatchObject({ p_outcome: 'failed', p_refund_id: 'rf1' })
    expect(res.body.refund).toEqual({ status: 'failed' })
  })

  it('the patient-window rule is unchanged: a patient inside 24h cannot cancel, so nothing is refunded', async () => {
    const res = await call({ appointment_id: 'a1', cancelled_by: 'patient' })
    expect(res.statusCode).toBe(400)
    expect(rpcs('request_refund')).toHaveLength(0)
  })
})
