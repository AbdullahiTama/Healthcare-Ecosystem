import { describe, it, expect, vi, beforeEach } from 'vitest'

const inserted = []
const notifyMock = vi.hoisted(() => vi.fn(async () => ({ ok: true })))
vi.mock('./notify.js', () => ({
  notify: notifyMock,
  NOTIF_MESSAGES: {},
}))

import { notifyReview, resolveBusinessOwner, resolveProductOwner, REVIEW_MESSAGES } from './reviewNotifications.js'

// Minimal PostgREST-shaped stub: from(table) -> chainable -> maybeSingle(),
// plus rpc() for business_claim_owner. `rpcs` maps a business id to its
// approved claimant, the way the SECURITY DEFINER function does.
function stubSupabase(tables, rpcs = {}) {
  return {
    async rpc(name, args) {
      if (name !== 'business_claim_owner') return { data: null, error: { message: `no rpc ${name}` } }
      return { data: rpcs[args.p_business_id] ?? null, error: null }
    },
    from(table) {
      const rows = tables[table] || []
      const filters = {}
      const chain = {
        select: () => chain,
        eq: (col, val) => { filters[col] = val; return chain },
        limit: () => chain,
        maybeSingle: async () => {
          const match = rows.find((r) => Object.entries(filters).every(([k, v]) => r[k] === v))
          return { data: match || null, error: null }
        },
      }
      return chain
    },
  }
}

beforeEach(() => {
  notifyMock.mockClear()
  inserted.length = 0
})

describe('recipient resolution (issue #7: "or with the wrong recipient ID")', () => {
  it('a review of a person goes to the person reviewed, not the reviewer', async () => {
    const result = await notifyReview(stubSupabase({}), {
      kind: 'user', actorId: 'reviewer', subjectId: 'reviewed-person', rating: 5,
    })
    expect(result.sent).toBe(true)
    expect(result.recipientId).toBe('reviewed-person')
    expect(notifyMock).toHaveBeenCalledWith(expect.objectContaining({
      recipientId: 'reviewed-person',
      actorId: 'reviewer',
      type: 'review',
      message: 'left you a 5-star review',
    }))
  })

  it('a review of a business goes to the user whose claim was approved', async () => {
    const supabase = stubSupabase({}, { biz1: 'owner-user' })
    expect(await resolveBusinessOwner(supabase, 'biz1')).toBe('owner-user')
    const result = await notifyReview(supabase, { kind: 'business', actorId: 'reviewer', businessId: 'biz1', rating: 4 })
    expect(result.recipientId).toBe('owner-user')
    expect(result.message).toBe('left a 4-star review on your business')
  })

  // Regression: reading business_claims directly runs under the REVIEWER's
  // RLS, which scopes SELECT to the claimant — so it returns nothing and the
  // notification is silently skipped. Resolution must go through the
  // SECURITY DEFINER RPC.
  it('resolves the business owner through the RPC, not a direct table read', async () => {
    const calls = []
    const supabase = {
      async rpc(name, args) { calls.push({ name, args }); return { data: 'owner-user', error: null } },
      from() { throw new Error('must not read business_claims directly — RLS hides it from the reviewer') },
    }
    expect(await resolveBusinessOwner(supabase, 'biz1')).toBe('owner-user')
    expect(calls).toEqual([{ name: 'business_claim_owner', args: { p_business_id: 'biz1' } }])
  })

  it('a review of a product goes to the listing owner', async () => {
    const supabase = stubSupabase({ products: [{ id: 'prod1', owner_id: 'seller' }] })
    expect(await resolveProductOwner(supabase, 'prod1')).toBe('seller')
    const result = await notifyReview(supabase, { kind: 'product', actorId: 'buyer', productId: 'prod1', rating: 3 })
    expect(result.recipientId).toBe('seller')
    expect(result.message).toBe('left a 3-star review on your product')
  })
})

describe('cases with nobody to notify', () => {
  it('an unclaimed business notifies nobody, and says why', async () => {
    const result = await notifyReview(stubSupabase({}, {}), {
      kind: 'business', actorId: 'reviewer', businessId: 'biz-unclaimed', rating: 5,
    })
    expect(result.sent).toBe(false)
    expect(result.reason).toMatch(/no recipient/)
    expect(notifyMock).not.toHaveBeenCalled()
  })

  it('a CareHub-sourced product with no owner_id notifies nobody', async () => {
    const result = await notifyReview(stubSupabase({ products: [{ id: 'p', owner_id: null }] }), {
      kind: 'product', actorId: 'buyer', productId: 'p', rating: 5,
    })
    expect(result.sent).toBe(false)
    expect(notifyMock).not.toHaveBeenCalled()
  })

  it('never notifies someone about their own review', async () => {
    const result = await notifyReview(stubSupabase({}), {
      kind: 'user', actorId: 'me', subjectId: 'me', rating: 5,
    })
    expect(result.sent).toBe(false)
    expect(result.reason).toBe('self-review')
    expect(notifyMock).not.toHaveBeenCalled()
  })

  it('reports an unknown review kind rather than guessing a recipient', async () => {
    const result = await notifyReview(stubSupabase({}), { kind: 'nonsense', actorId: 'a', rating: 5 })
    expect(result.sent).toBe(false)
    expect(result.reason).toMatch(/unknown review kind/)
  })
})

describe('messages carry the rating the reviewer gave', () => {
  it('a 5-star review reads as five stars', () => {
    expect(REVIEW_MESSAGES.user(5)).toBe('left you a 5-star review')
    expect(REVIEW_MESSAGES.business(1)).toBe('left a 1-star review on your business')
    expect(REVIEW_MESSAGES.product(2)).toBe('left a 2-star review on your product')
  })
})
