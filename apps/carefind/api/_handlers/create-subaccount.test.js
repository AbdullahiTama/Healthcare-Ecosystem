// Paystack subaccounts are retired (financial audit C-6): charges are not split at the gateway. The endpoint must stay dead.
const h = vi.hoisted(() => ({ paystackFetch: vi.fn(), verifyUser: vi.fn() }))
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: () => { throw new Error('the database must not be touched') } }) }))
vi.mock('../_lib/paystack.js', () => ({ paystackFetch: h.paystackFetch }))
vi.mock('../_lib/verifyUser.js', () => ({ verifyUser: h.verifyUser }))
import handler from './create-subaccount.js'

const res = () => { const r = { statusCode: null, body: null }; r.status = (c) => { r.statusCode = c; return r }; r.json = (b) => { r.body = b; return r }; return r }

describe('create-subaccount (retired)', () => {
  it('answers 410 to a signed-in verified professional, and never contacts Paystack or reads a user', async () => {
    h.verifyUser.mockResolvedValue({ id: 'u1', email: 'a@b.com' })
    const r = res()
    await handler({ method: 'POST', headers: {}, body: { bankCode: '058', accountNumber: '0123456789', accountName: 'Ada' } }, r)
    expect(r.statusCode).toBe(410)
    expect(h.paystackFetch).not.toHaveBeenCalled()
    expect(h.verifyUser).not.toHaveBeenCalled()
  })

  it('still answers 405 to the wrong method', async () => {
    const r = res()
    await handler({ method: 'GET', headers: {}, body: {} }, r)
    expect(r.statusCode).toBe(405)
  })
})
