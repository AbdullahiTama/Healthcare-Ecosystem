import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockSupabase, mockVerifyUser, mockPaystackFetch } = vi.hoisted(() => ({
  mockSupabase: {},
  mockVerifyUser: vi.fn(),
  mockPaystackFetch: vi.fn(),
}))

vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn(() => mockSupabase) }))
vi.mock('../../../api/_lib/verifyUser.js', () => ({ verifyUser: mockVerifyUser }))
vi.mock('../../../api/_lib/paystack.js', () => ({ paystackFetch: mockPaystackFetch, getPaystackSecretKey: vi.fn(() => 'sk_test_dummy') }))

import handler from '../../../api/_handlers/charge-subscription.js'

function makeReq(body){ return { method: 'POST', headers:{}, body } }
function makeRes(){ const res={statusCode:200, body:null}; res.status=(c)=>{res.statusCode=c; return res}; res.json=(o)=>{res.body=o; return res}; return res }

describe('charge-subscription MAX 12 guard', () => {
  beforeEach(() => {
    mockVerifyUser.mockReset().mockResolvedValue({ id: 'user-1', email: 'a@b.com' })
    mockSupabase.from = vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ maybeSingle: vi.fn().mockResolvedValue({ data: null }) }) }) })
    mockPaystackFetch.mockReset()
  })
  it('rejects price 13', async () => {
    const res = await handler(makeReq({ creatorId: 'creator-1', priceCoins: 13, callback_url: 'https://cb' }), makeRes())
    expect(res.statusCode).toBe(400)
    expect(res.body.error).toMatch('1-12')
    expect(mockPaystackFetch).not.toHaveBeenCalled()
  })
  it('rejects price 100 (old limit)', async () => {
    const res = await handler(makeReq({ creatorId: 'creator-1', priceCoins: 100, callback_url: 'https://cb' }), makeRes())
    expect(res.statusCode).toBe(400)
    expect(mockPaystackFetch).not.toHaveBeenCalled()
  })
  it('allows price 12 and calls Paystack', async () => {
    mockPaystackFetch.mockResolvedValue({ status: true, data: { authorization_url: 'https://paystack', reference: 'ref' } })
    const res = await handler(makeReq({ creatorId: 'creator-1', priceCoins: 12, callback_url: 'https://cb' }), makeRes())
    expect(res.statusCode).toBe(200)
    expect(mockPaystackFetch).toHaveBeenCalled()
    const body = JSON.parse(mockPaystackFetch.mock.calls[0][1].body)
    expect(body.amount).toBe(12*200*100)
  })
  it('rejects float price 5.5', async () => {
    const res = await handler(makeReq({ creatorId: 'creator-1', priceCoins: '5.5', callback_url: 'https://cb' }), makeRes())
    expect(res.statusCode).toBe(400)
    expect(mockPaystackFetch).not.toHaveBeenCalled()
  })
  it('allows price 1 and calls Paystack', async () => {
    mockPaystackFetch.mockResolvedValue({ status: true, data: { authorization_url: 'https://paystack', reference: 'ref' } })
    const res = await handler(makeReq({ creatorId: 'creator-1', priceCoins: 1, callback_url: 'https://cb' }), makeRes())
    expect(res.statusCode).toBe(200)
  })
})
