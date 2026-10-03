// Financial audit F-03: wallet-transactions used to check only that the business EXISTS, so any
// signed-in user could read any business's wallet balances and ledger.
const h = vi.hoisted(() => {
  const s = { user: { id: 'u1', email: 'Owner@Clinic.com' }, businesses: {}, reads: [] }
  const builderFor = (table) => {
    const filters = {}
    const b = {
      select: () => b,
      eq: (k, v) => { filters[k] = v; return b },
      order: () => b,
      limit: () => b,
      maybeSingle: async () => {
        s.reads.push(table)
        if (table === 'businesses') return { data: s.businesses[filters.id] || null }
        if (table === 'business_wallets') return { data: { business_id: filters.business_id, held_balance: 5, available_balance: 7 } }
        return { data: null }
      },
      then: (resolve) => { s.reads.push(table); resolve({ data: table === 'business_wallet_transactions' ? [{ id: 't1' }] : null }) },
    }
    return b
  }
  s.client = { from: builderFor }
  return s
})

vi.mock('@supabase/supabase-js', () => ({ createClient: () => h.client }))
vi.mock('../_lib/verifyUser.js', () => ({ verifyUser: async () => h.user }))

import handler from './wallet-transactions.js'

function call(query) {
  const res = { statusCode: 0, body: null, status(c) { this.statusCode = c; return this }, json(b) { this.body = b; return this } }
  return handler({ method: 'GET', query, headers: {} }, res).then(() => res)
}

beforeEach(() => {
  h.user = { id: 'u1', email: 'Owner@Clinic.com' }
  h.reads.length = 0
  h.businesses = {
    b1: { id: 'b1', email: 'owner@clinic.com', parent_business_id: null },
    branch1: { id: 'branch1', email: 'branch@clinic.com', parent_business_id: 'b1' },
    other: { id: 'other', email: 'someone@else.com', parent_business_id: null },
  }
})

describe('wallet-transactions authorization', () => {
  it('returns the wallet to the business owner (email matched case-insensitively)', async () => {
    const res = await call({ business_id: 'b1' })
    expect(res.statusCode).toBe(200)
    expect(res.body.wallet.available_balance).toBe(7)
  })

  it("lets the parent's owner read a branch wallet", async () => {
    const res = await call({ business_id: 'branch1' })
    expect(res.statusCode).toBe(200)
  })

  it("refuses a signed-in user who does not own the business, and reads no wallet data", async () => {
    const res = await call({ business_id: 'other' })
    expect(res.statusCode).toBe(404)
    expect(h.reads).not.toContain('business_wallets')
    expect(h.reads).not.toContain('business_wallet_transactions')
  })

  it('answers an unknown business the same way as a business the caller does not own', async () => {
    const res = await call({ business_id: 'nope' })
    expect(res.statusCode).toBe(404)
  })

  it('refuses a user whose auth email is missing', async () => {
    h.user = { id: 'u2', email: null }
    const res = await call({ business_id: 'b1' })
    expect(res.statusCode).toBe(404)
  })
})
