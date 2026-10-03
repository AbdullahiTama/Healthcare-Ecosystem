import { describe, it, expect } from 'vitest'
import { computeCommission } from '../_lib/commissions.js'

// Regression for the financial audit's H-6: computeCommission referenced an undefined
// `isFirst` (the parameter is `isFirstPayment`), so it threw a ReferenceError for every
// active agent and verify-plan-payment swallowed it - no commission was ever recorded.

function fakeSupabase({ business, agent, insertError = null } = {}) {
  const inserted = []
  const flags = []
  const from = (table) => {
    const b = {
      select: () => b,
      eq: () => b,
      single: async () => ({ data: { id: 'commission-1' }, error: insertError }),
      maybeSingle: async () => ({ data: table === 'businesses' ? business : agent }),
      insert: (row) => {
        if (table === 'commissions') inserted.push(row)
        if (table === 'commission_review_flags') flags.push(row)
        return b
      },
    }
    return b
  }
  return { client: { from }, inserted, flags }
}

const referred = { id: 'biz-1', referring_agent_id: 'agent-1' }
const activeAgent = { id: 'agent-1', status: 'active' }

describe('computeCommission', () => {
  it('first payment from a referred business: one referral_bonus row at 40% of the charge', async () => {
    const { client, inserted } = fakeSupabase({ business: referred, agent: activeAgent })
    const r = await computeCommission(client, { paymentId: 'pay-1', businessId: 'biz-1', nairaCharged: 10000, isFirstPayment: true })
    expect(r.commission).toEqual({ id: 'commission-1' })
    expect(inserted).toHaveLength(1)
    expect(inserted[0]).toMatchObject({ agent_id: 'agent-1', business_id: 'biz-1', payment_id: 'pay-1', type: 'referral_bonus', rate: 0.4, amount: 4000, status: 'accrued' })
  })

  it('renewal: one residual row at 5%', async () => {
    const { client, inserted } = fakeSupabase({ business: referred, agent: activeAgent })
    await computeCommission(client, { paymentId: 'pay-2', businessId: 'biz-1', nairaCharged: 10000, isFirstPayment: false })
    expect(inserted).toHaveLength(1)
    expect(inserted[0]).toMatchObject({ type: 'residual', rate: 0.05, amount: 500 })
  })

  it('an unreferred business creates nothing', async () => {
    const { client, inserted } = fakeSupabase({ business: { id: 'biz-1', referring_agent_id: null } })
    const r = await computeCommission(client, { paymentId: 'pay-3', businessId: 'biz-1', nairaCharged: 10000, isFirstPayment: true })
    expect(r).toEqual({ commission: null, flag: null })
    expect(inserted).toHaveLength(0)
  })

  it('an inactive agent gets a review flag and no commission', async () => {
    const { client, inserted, flags } = fakeSupabase({ business: referred, agent: { id: 'agent-1', status: 'suspended' } })
    const r = await computeCommission(client, { paymentId: 'pay-4', businessId: 'biz-1', nairaCharged: 10000, isFirstPayment: true })
    expect(r.flag).toBe(true)
    expect(inserted).toHaveLength(0)
    expect(flags).toEqual([{ payment_id: 'pay-4', reason: 'agent_suspended' }])
  })

  it('a replay that hits UNIQUE(payment_id) is treated as already recorded, not an error', async () => {
    const { client } = fakeSupabase({ business: referred, agent: activeAgent, insertError: { code: '23505' } })
    const r = await computeCommission(client, { paymentId: 'pay-1', businessId: 'biz-1', nairaCharged: 10000, isFirstPayment: true })
    expect(r).toEqual({ commission: null, flag: null })
  })
})
