import { describe, it, expect, vi } from 'vitest'
import { createPayoutAccountReviewEffects } from '../payoutReviewEffects.js'

// The owner's email AFTER an admin reviews their saved payout account. The row is re-read (the update has
// already committed), the outcome decides the wording, and the brand follows the owner: a CareFind user gets
// CareFind, a CareHub business gets CareHub. The account number is masked to the last four; nothing here may
// ever throw into the review that already committed.
function fake({ account, business, authUser = null, authThrows = false, throws = false } = {}) {
  return {
    auth: {
      admin: {
        getUserById: async () => {
          if (authThrows) throw new Error('auth down')
          return authUser ? { data: { user: authUser }, error: null } : { data: null, error: { message: 'not found' } }
        },
      },
    },
    from: (table) => {
      const b = {
        select: () => b,
        eq: () => b,
        maybeSingle: async () => {
          if (throws) throw new Error('db down')
          const row = table === 'payout_accounts' ? (account ?? null) : table === 'businesses' ? (business ?? null) : null
          return { data: row, error: null }
        },
      }
      return b
    },
  }
}

const account = (over = {}) => ({
  id: 'pa1', owner_user_id: 'u1', owner_business_id: null,
  bank_name: 'GTBank', account_number: '0123456789', status: 'verified', ...over,
})

function setup(opts = {}, send) {
  const sent = []
  const logger = { error: vi.fn() }
  const notify = createPayoutAccountReviewEffects({ supabase: fake(opts), send: send || (async (m) => { sent.push(m) }), logger })
  return { notify, sent, logger }
}

describe('createPayoutAccountReviewEffects', () => {
  it('verified for a CareFind user: the owner gets the review email, CareFind brand, masked to the last four', async () => {
    const { notify, sent } = setup({ account: account(), authUser: { email: 'tunde@example.com', user_metadata: { full_name: 'Tunde Bakare' } } })
    await notify('pa1')
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({
      templateKey: 'payout_account_review', toEmail: 'tunde@example.com', app: 'carefind',
      subject: 'CareFind: payout account verified', sourceId: 'pa1', idempotencyKey: 'payout-review:pa1:verified',
    })
    expect(sent[0].payload).toMatchObject({ fullName: 'Tunde Bakare', outcome: 'verified', bankName: 'GTBank', accountNumber: '******6789' })
  })

  it('failed is its own outcome and its own idempotency key', async () => {
    const { notify, sent } = setup({ account: account({ status: 'failed' }), authUser: { email: 'tunde@example.com', user_metadata: {} } })
    await notify('pa1')
    expect(sent[0]).toMatchObject({
      subject: 'CareFind: payout account failed', idempotencyKey: 'payout-review:pa1:failed',
    })
    expect(sent[0].payload.outcome).toBe('failed')
  })

  it('a business-owned account: CareHub brand and subject, to the business owner', async () => {
    const { notify, sent } = setup({
      account: account({ owner_user_id: null, owner_business_id: 'biz1' }),
      business: { name: 'Sunrise Clinic', owner_name: 'Ada', owner_email: 'ada@example.com', email: 'biz@example.com' },
    })
    await notify('pa1')
    expect(sent[0]).toMatchObject({
      toEmail: 'ada@example.com', app: 'carehub', subject: 'CareHub: payout account verified',
    })
    expect(sent[0].payload.fullName).toBe('Ada')
  })

  it('an account still pending (or anything outside verified/failed) notifies nobody', async () => {
    const { notify, sent } = setup({ account: account({ status: 'pending_review' }), authUser: { email: 't@example.com' } })
    await notify('pa1')
    expect(sent).toEqual([])
  })

  it('no address anywhere: nothing is sent, nothing throws, and it is logged', async () => {
    const { notify, sent, logger } = setup({ account: account() })
    await expect(notify('pa1')).resolves.toBeUndefined()
    expect(sent).toEqual([])
    expect(logger.error).toHaveBeenCalled()
  })

  it('no row, no id: nothing is sent', async () => {
    const { notify, sent } = setup({ account: null })
    await notify('pa1')
    await notify(null)
    expect(sent).toEqual([])
  })

  it('a database error, an auth failure, and a send that throws are all swallowed: the review never fails', async () => {
    const { notify, logger } = setup({ throws: true })
    await expect(notify('pa1')).resolves.toBeUndefined()
    expect(logger.error).toHaveBeenCalled()
    const { notify: notify2, logger: logger2 } = setup({ account: account(), authThrows: true })
    await expect(notify2('pa1')).resolves.toBeUndefined()
    expect(logger2.error).toHaveBeenCalled()
    const { notify: notify3, logger: logger3 } = setup(
      { account: account(), authUser: { email: 't@example.com', user_metadata: {} } },
      async () => { throw new Error('smtp down') },
    )
    await expect(notify3('pa1')).resolves.toBeUndefined()
    expect(logger3.error).toHaveBeenCalled()
  })
})
