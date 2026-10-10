// resolve-account turns a bank code + account number into the account holder's name (used by the withdrawal form). It validates the
// input locally before spending a Paystack call, and maps Paystack's refusals to messages that do not leak internals.
const h = vi.hoisted(() => ({ resolveAccount: vi.fn(), user: { id: 'u1' } }))
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({}) }))
vi.mock('../_lib/verifyUser.js', () => ({ verifyUser: async () => h.user }))
vi.mock('../_lib/paystackTransfer.js', () => ({ resolveAccount: h.resolveAccount }))
import handler from './resolve-account.js'

const res = () => { const r = { statusCode: null, body: null }; r.status = (c) => { r.statusCode = c; return r }; r.json = (b) => { r.body = b; return r }; return r }
const call = async (body, method = 'POST') => { const r = res(); await handler({ method, body }, r); return r }
beforeEach(() => { h.resolveAccount.mockReset(); h.user = { id: 'u' + Math.random() }; vi.spyOn(console, 'error').mockImplementation(() => {}) })

describe('resolve-account', () => {
  it('returns the account name for a valid bank and 10-digit number (trimmed)', async () => {
    h.resolveAccount.mockResolvedValue({ accountName: 'ADA OBI' })
    const r = await call({ bankCode: ' 058 ', accountNumber: ' 0123456789 ' })
    expect(r).toMatchObject({ statusCode: 200, body: { accountName: 'ADA OBI' } })
    expect(h.resolveAccount).toHaveBeenCalledWith({ bankCode: '058', accountNumber: '0123456789' })
  })

  it('validates locally and never calls Paystack for bad input', async () => {
    expect((await call(undefined, 'GET')).statusCode).toBe(405)
    expect((await call({ bankCode: '058' })).statusCode).toBe(400)
    expect((await call({ accountNumber: '0123456789' })).statusCode).toBe(400)
    for (const bad of ['123', '01234567890', 'abcdefghij', '0123 45678', "0123456789'; drop"]) expect((await call({ bankCode: '058', accountNumber: bad })).statusCode, bad).toBe(400)
    expect(h.resolveAccount).not.toHaveBeenCalled()
  })

  it.each([
    ['Bank is not supported for resolution', /does not support automatic/, true],
    ['Account not found', /Account not found/, false],
    ['network exploded', /Could not verify account/, false],
  ])('maps the Paystack failure "%s" to a user message', async (msg, expected, unsupported) => {
    h.resolveAccount.mockRejectedValue(Object.assign(new Error(msg), { paystackMessage: msg }))
    const r = await call({ bankCode: '058', accountNumber: '0123456789' })
    expect(r.statusCode).toBe(400)
    expect(r.body.error).toMatch(expected)
    expect(r.body.unsupportedBank).toBe(unsupported)
  })

  it('is for signed-in users only, and rate limited per user (10 a minute) before any Paystack call', async () => {
    h.user = null
    expect((await call({ bankCode: '058', accountNumber: '0123456789' })).statusCode).toBe(401)
    expect(h.resolveAccount).not.toHaveBeenCalled()
    h.user = { id: 'heavy-user' }
    h.resolveAccount.mockResolvedValue({ accountName: 'ADA OBI' })
    const codes = []
    for (let i = 0; i < 12; i++) codes.push((await call({ bankCode: '058', accountNumber: '0123456789' })).statusCode)
    expect(codes.filter((c) => c === 200)).toHaveLength(10)
    expect(codes.slice(10)).toEqual([429, 429])
    expect(h.resolveAccount).toHaveBeenCalledTimes(10)
  })
})
