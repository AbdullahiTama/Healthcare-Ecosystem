const h = vi.hoisted(() => ({ withdrawals: vi.fn(), commissions: vi.fn(), refunds: vi.fn(), refundApplied: [] }))
vi.mock('../_lib/supabase.js', () => ({ supabase: {} }))
vi.mock('../_lib/withdrawalRecovery.js', () => ({ reconcileBusinessWithdrawals: h.withdrawals }))
vi.mock('../_lib/commissionReconcile.js', () => ({ reconcileCommissions: h.commissions }))
vi.mock('../_lib/refundEffects.js', () => ({ applyRefundResult: async (_s, result) => { h.refundApplied.push(result) } }))
vi.mock('@care-ecosystem/shared-payments', () => ({ runRefundSweeps: (...a) => h.refunds(...a) }))
vi.mock('../_lib/payments.js', () => ({ getPaystackProvider: () => ({}), paymentLogger: {} }))

import handler from '../_handlers/cron-reconcile-payments.js'

const res = () => { const r = { statusCode: 0, body: null }; r.status = (c) => { r.statusCode = c; return r }; r.json = (b) => { r.body = b; return r }; return r }
const call = async (headers = {}, method = 'GET') => { const r = res(); await handler({ method, headers }, r); return r }

beforeEach(() => {
  process.env.CRON_SECRET = 'cron-secret'
  h.refundApplied.length = 0
  h.withdrawals.mockReset().mockResolvedValue({ checked: 2, refunded: 1, completed: 1, waiting: 0, errors: 0 })
  h.refunds.mockReset().mockResolvedValue({ sweep: {}, unapplied: {}, cancelled: {} })
  h.commissions.mockReset().mockResolvedValue({ checked: 1, created: 1, problems: 0, byKind: {}, errors: 0 })
})

describe('reconcile-payments cron (it moves money, so it fails closed)', () => {
  it('refuses to run with no CRON_SECRET configured', async () => {
    delete process.env.CRON_SECRET
    expect((await call({ authorization: 'Bearer x' })).statusCode).toBe(500)
    expect(h.withdrawals).not.toHaveBeenCalled()
  })
  it('rejects a missing or wrong token', async () => {
    expect((await call()).statusCode).toBe(401)
    expect((await call({ authorization: 'Bearer nope' })).statusCode).toBe(401)
    expect(h.withdrawals).not.toHaveBeenCalled()
    expect(h.commissions).not.toHaveBeenCalled()
  })
  it('rejects other methods', async () => {
    expect((await call({ authorization: 'Bearer cron-secret' }, 'DELETE')).statusCode).toBe(405)
  })
  it('runs both jobs and reports both', async () => {
    const r = await call({ authorization: 'Bearer cron-secret' })
    expect(r.statusCode).toBe(200)
    expect(r.body.withdrawals.refunded).toBe(1)
    expect(r.body.commissions.created).toBe(1)
  })
  it('one job failing does not stop the other, and the run is reported as failed', async () => {
    h.withdrawals.mockRejectedValue(new Error('db down'))
    const r = await call({ authorization: 'Bearer cron-secret' })
    expect(r.statusCode).toBe(500)
    expect(r.body.withdrawals).toEqual({ error: 'db down' })
    expect(r.body.commissions.created).toBe(1)
  })

  it('also runs the refund sweep (finish unanswered card refunds, refund unapplied payments, refund cancelled-but-paid appointments)', async () => {
    h.refunds.mockResolvedValue({ sweep: { checked: 1 }, unapplied: { checked: 0 }, cancelled: { checked: 2 } })
    const r = await call({ authorization: 'Bearer cron-secret' })
    expect(r.statusCode).toBe(200)
    expect(r.body.refunds.cancelled.checked).toBe(2)
    expect(h.refunds).toHaveBeenCalledTimes(1)
  })
  it('hands the refund effect seam to the refund sweep so a completed refund can email the payer', async () => {
    await call({ authorization: 'Bearer cron-secret' })
    const opts = h.refunds.mock.calls[0][2]
    expect(typeof opts.onSettled).toBe('function')
    await opts.onSettled({ result: 'completed', id: 'rf1' })
    expect(h.refundApplied).toEqual([{ result: 'completed', id: 'rf1' }])
  })
  it('a refund sweep failure is reported as a failed run but never stops the other jobs', async () => {
    h.refunds.mockRejectedValue(new Error('refunds down'))
    const r = await call({ authorization: 'Bearer cron-secret' })
    expect(r.statusCode).toBe(500)
    expect(r.body.refunds).toEqual({ error: 'refunds down' })
    expect(r.body.withdrawals.refunded).toBe(1)
    expect(r.body.commissions.created).toBe(1)
  })
})
