const h = vi.hoisted(() => ({ rpc: vi.fn(), sendAuthEmail: vi.fn() }))

vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ rpc: (...a) => h.rpc(...a) }) }))
vi.mock('@care-ecosystem/shared-email', () => ({ sendAuthEmail: (...a) => h.sendAuthEmail(...a) }))

import handler from '../_handlers/register-business.js'

const call = async (body, method = 'POST') => {
  const res = { statusCode: 0, body: null, status(c) { this.statusCode = c; return this }, json(v) { this.body = v; return this } }
  await handler({ method, headers: {}, body }, res)
  return res
}
const valid = { name: 'Lifeline Pharmacy', owner: 'Ada Eze', email: 'Ada@Lifeline.test', state: 'Lagos' }

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('SUPABASE_URL', 'https://supabase.test')
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-key')
  vi.stubEnv('CAREHUB_APP_URL', 'https://carefindhub.com')
  h.rpc.mockResolvedValue({ data: 'biz-1', error: null })
  h.sendAuthEmail.mockResolvedValue({ ok: true, sent: true })
})

describe('POST /api/register-business', () => {
  it('rejects non-POST', async () => {
    expect((await call(valid, 'GET')).statusCode).toBe(405)
  })

  it('validates before touching the database', async () => {
    expect((await call({ ...valid, email: 'nope' })).statusCode).toBe(400)
    expect((await call({ ...valid, name: '' })).statusCode).toBe(400)
    expect(h.rpc).not.toHaveBeenCalled()
  })

  it('registers, lowercases the email, never forwards a password, and sends owner_setup', async () => {
    const res = await call({ ...valid, password: 'hunter2', is_platform_admin: true, status: 'approved' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ ok: true })
    const [fn, args] = h.rpc.mock.calls[0]
    expect(fn).toBe('register_business_unconfirmed')
    expect(args.p_business.email).toBe('ada@lifeline.test')
    // Only whitelisted business columns reach the database: a caller cannot set status or admin flags.
    expect(Object.keys(args.p_business).sort()).toEqual(['email', 'name', 'owner', 'state'])
    expect(JSON.stringify(args)).not.toContain('hunter2')
    expect(h.sendAuthEmail).toHaveBeenCalledWith(expect.objectContaining({
      action: 'owner_setup', email: 'ada@lifeline.test', fullName: 'Ada Eze', businessName: 'Lifeline Pharmacy',
      redirectTo: 'https://carefindhub.com/reset-password?welcome=1', app: 'carehub',
    }))
  })

  it('passes readable RPC validation errors through, but hides unexpected database errors', async () => {
    h.rpc.mockResolvedValueOnce({ data: null, error: { code: 'P0001', message: 'An account with this email already exists. Please sign in instead.' } })
    let res = await call(valid)
    expect(res.statusCode).toBe(400)
    expect(res.body.error).toMatch(/already exists/)

    h.rpc.mockResolvedValueOnce({ data: null, error: { code: '42P01', message: 'relation "auth.users" does not exist' } })
    res = await call(valid)
    expect(res.statusCode).toBe(500)
    expect(res.body.error).toBe('Registration failed. Please try again.')
    expect(JSON.stringify(res.body)).not.toContain('auth.users')
  })

  it('still succeeds when the setup email cannot be sent', async () => {
    h.sendAuthEmail.mockRejectedValueOnce(new Error('smtp down'))
    const res = await call(valid)
    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ ok: true })
  })
})
