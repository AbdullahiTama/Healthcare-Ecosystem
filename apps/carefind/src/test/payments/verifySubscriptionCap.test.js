import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockSupabase, mockVerifyUser, mockPaystackFetch } = vi.hoisted(() => ({
  mockSupabase: {},
  mockVerifyUser: vi.fn(),
  mockPaystackFetch: vi.fn(),
}))

vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn(() => mockSupabase) }))
vi.mock('../../../api/_lib/verifyUser.js', () => ({ verifyUser: mockVerifyUser }))
vi.mock('../../../api/_lib/paystack.js', () => ({ paystackFetch: mockPaystackFetch }))
vi.mock('../../../api/_lib/emailService.js', () => ({ enqueue: vi.fn().mockResolvedValue({}), processBatch: vi.fn().mockResolvedValue({}) }))

import handler from '../../../api/_handlers/verify-subscription-payment.js'

function makeReq(body){ return { method:'POST', headers:{}, body } }
function makeRes(){ const res={statusCode:200, body:null}; res.status=(c)=>{res.statusCode=c; return res}; res.json=(o)=>{res.body=o; return res}; return res }

describe('verify-subscription MAX 12 guard', () => {
  beforeEach(() => {
    mockVerifyUser.mockReset().mockResolvedValue({ id:'user-1', email:'a@b.com' })
    mockPaystackFetch.mockReset().mockResolvedValue({
      status: true,
      data: { status:'success', amount: 1000*100, metadata:{ user_id:'user-1', creator_id:'creator-1', coins:5, purpose:'subscription' } }
    })
    mockSupabase.rpc = vi.fn().mockResolvedValue({ data:[{ already_processed:false }], error:null })
    mockSupabase.from = vi.fn().mockReturnValue({ select:()=>({ eq:()=>({ maybeSingle:()=>Promise.resolve({ data:{ display_name:'Creator' } }) }) }) })
    mockSupabase.auth = { admin: { getUserById: vi.fn().mockResolvedValue({ data:{ user:{ email:'a@b.com' } } }) } }
  })
  it('rejects coins 13', async () => {
    mockPaystackFetch.mockResolvedValueOnce({
      status:true, data:{ status:'success', amount:1300*100, metadata:{ user_id:'user-1', creator_id:'creator-1', coins:13, purpose:'subscription' } }
    })
    const res = await handler(makeReq({ reference:'ref13' }), makeRes())
    expect(res.statusCode).toBe(400)
    expect(res.body.error).toMatch('1-12')
    expect(mockSupabase.rpc).not.toHaveBeenCalledWith('settle_subscription_payment', expect.anything())
  })
  it('rejects float coins 5.5', async () => {
    mockPaystackFetch.mockResolvedValueOnce({
      status:true, data:{ status:'success', amount:550*100, metadata:{ user_id:'user-1', creator_id:'creator-1', coins:'5.5', purpose:'subscription' } }
    })
    const res = await handler(makeReq({ reference:'ref' }), makeRes())
    expect(res.statusCode).toBe(400)
  })
  it('allows 12', async () => {
    mockPaystackFetch.mockResolvedValueOnce({
      status:true, data:{ status:'success', amount:2400*100, metadata:{ user_id:'user-1', creator_id:'creator-1', coins:12, purpose:'subscription' } }
    })
    const res = await handler(makeReq({ reference:'ref12' }), makeRes())
    expect(res.statusCode).toBe(200)
  })
})
