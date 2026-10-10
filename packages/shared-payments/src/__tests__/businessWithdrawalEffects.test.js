import { describe, it, expect, vi } from 'vitest'
import { createBusinessWithdrawalEffects } from '../index.js'

// The best-effort email AFTER a CareHub business withdrawal settles: exactly the right owner gets exactly the right
// template for the one change that just happened, and nothing here may ever throw into the settlement that already
// committed. The recipient and bank details come from one lookup; a webhook, the reconcile path and the cron sweep
// all funnel through this single effect.
function fake({ row, throws = false } = {}) {
  const sent = []
  const sb = {
    from: (table) => {
      const b = {
        select: () => b,
        eq: () => b,
        maybeSingle: async () => {
          if (throws) throw new Error('db down')
          return { data: row ?? null, error: null }
        },
      }
      return b
    },
    sent,
  }
  return sb
}
const request = (over = {}, business = {}) => ({
  id: 'bw-1', amount: 500000, bank_name: 'GTB', account_number: '0123456789',
  paystack_reference: 'ch_wd_1', businesses: { name: 'Sunrise Clinic', owner_name: 'Ada', owner_email: 'ada@example.com', email: 'biz@example.com', ...business },
  ...over,
})
const setup = (opts = {}, send) => {
  const sent = []
  const logger = { error: vi.fn() }
  const sb = fake(opts)
  const apply = createBusinessWithdrawalEffects({ supabase: sb, send: send || (async (m) => { sent.push(m) }), logger })
  return { apply, sent, logger }
}
const settled = (result, over = {}) => ({ id: 'bw-1', business_id: 'biz-1', amount: 500000, reference: 'ch_wd_1', from_status: 'processing', result, ...over })

describe('createBusinessWithdrawalEffects', () => {
  it('completed: one settlement email to the owner with the full bank details, keyed by the reference', async () => {
    const { apply, sent } = setup({ row: request() })
    await apply(settled('completed'))
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({
      templateKey: 'withdrawal_completed', toEmail: 'ada@example.com', app: 'carehub',
      subject: 'CareHub: withdrawal settled', sourceId: 'bw-1', idempotencyKey: 'business-withdrawal-completed:ch_wd_1',
    })
    expect(sent[0].payload).toMatchObject({ businessName: 'Ada', reference: 'ch_wd_1', bankName: 'GTB', accountNumber: '0123456789' })
    expect(sent[0].payload.amount).toContain('5,000')
  })

  it('refunded: the failure email, keyed by the same reference', async () => {
    const { apply, sent } = setup({ row: request() })
    await apply(settled('refunded'))
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({
      templateKey: 'withdrawal_failed', toEmail: 'ada@example.com', app: 'carehub',
      subject: 'CareHub: withdrawal failed', idempotencyKey: 'business-withdrawal-failed:ch_wd_1',
    })
  })

  it('no owner_email: falls back to the business email', async () => {
    const { apply, sent } = setup({ row: request({}, { owner_email: null }) })
    await apply(settled('completed'))
    expect(sent[0].toEmail).toBe('biz@example.com')
  })

  it('no address anywhere: nothing is sent and nothing throws', async () => {
    const { apply, sent, logger } = setup({ row: request({}, { owner_email: null, email: null }) })
    await expect(apply(settled('completed'))).resolves.toBeUndefined()
    expect(sent).toEqual([])
    expect(logger.error).toHaveBeenCalled()
  })

  it('results that changed nothing (replays, not_found) send nothing', async () => {
    const { apply, sent } = setup({ row: request() })
    for (const r of ['already_completed', 'already_refunded', 'not_found', 'conflict_paid_after_refund', undefined]) await apply(settled(r))
    expect(sent).toEqual([])
  })

  it('a send that throws and a lookup that throws are both swallowed: the settlement never fails', async () => {
    const { apply, logger } = setup({ row: request() }, async () => { throw new Error('smtp down') })
    await expect(apply(settled('completed'))).resolves.toBeUndefined()
    expect(logger.error).toHaveBeenCalled()
    const { apply: apply2, sent: sent2, logger: logger2 } = setup({ throws: true })
    await expect(apply2(settled('completed'))).resolves.toBeUndefined()
    expect(sent2).toEqual([])
    expect(logger2.error).toHaveBeenCalled()
  })

  it('no row for the id: nothing is sent, nothing throws', async () => {
    const { apply, sent } = setup({ row: null })
    await expect(apply(settled('completed'))).resolves.toBeUndefined()
    expect(sent).toEqual([])
  })
})
