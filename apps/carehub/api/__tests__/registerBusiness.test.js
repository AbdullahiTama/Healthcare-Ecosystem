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
    expect(h.sendAuthEmail).toHaveBeenCalledTimes(1)
    const sent = h.sendAuthEmail.mock.calls[0][0]
    expect(sent).toMatchObject({
      action: 'owner_setup', email: 'ada@lifeline.test',
      redirectTo: 'https://carefindhub.com/reset-password?welcome=1', app: 'carehub',
    })
    // A public endpoint must not put caller-chosen text into a branded email: the template falls back to neutral copy.
    expect(sent).not.toHaveProperty('fullName')
    expect(sent).not.toHaveProperty('businessName')
  })

  it('refuses to register when no app URL is configured, before creating anything', async () => {
    vi.stubEnv('CAREHUB_APP_URL', '')
    vi.stubEnv('APP_URL', '')
    const res = await call(valid)
    expect(res.statusCode).toBe(500)
    expect(res.body).toEqual({ error: 'Server misconfigured: CAREHUB_APP_URL is not set' })
    expect(h.rpc).not.toHaveBeenCalled()
    expect(h.sendAuthEmail).not.toHaveBeenCalled()
  })

  it('falls back to APP_URL for the redirect when CAREHUB_APP_URL is unset', async () => {
    vi.stubEnv('CAREHUB_APP_URL', '')
    vi.stubEnv('APP_URL', 'https://app.test')
    expect((await call(valid)).statusCode).toBe(200)
    expect(h.sendAuthEmail.mock.calls[0][0].redirectTo).toBe('https://app.test/reset-password?welcome=1')
  })

  describe('input validation', () => {
    const rejects = async (body, error) => {
      const res = await call(body)
      expect(res.statusCode).toBe(400)
      expect(res.body).toEqual({ error })
      expect(h.rpc).not.toHaveBeenCalled()
    }

    it('rejects non-object bodies with the missing-email error', async () => {
      await rejects('name=x', 'A valid email is required.')
      await rejects([valid], 'A valid email is required.')
      await rejects(null, 'A valid email is required.')
    })

    it('rejects text fields that are not strings', async () => {
      await rejects({ ...valid, name: { $gt: '' } }, 'Invalid name')
      await rejects({ ...valid, owner: ['Ada'] }, 'Invalid owner')
      await rejects({ ...valid, email: { a: 1 } }, 'Invalid email')
      for (const field of ['phone', 'whatsapp', 'address', 'state', 'city', 'business_type', 'hours', 'maps_link', 'website', 'referral_code_used']) {
        await rejects({ ...valid, [field]: 12 }, `Invalid ${field}`)
      }
    })

    it('enforces length limits', async () => {
      await rejects({ ...valid, name: 'x'.repeat(161) }, 'Invalid name')
      await rejects({ ...valid, owner: 'x'.repeat(121) }, 'Invalid owner')
      await rejects({ ...valid, email: `${'a'.repeat(250)}@x.co` }, 'Invalid email')
      await rejects({ ...valid, address: 'x'.repeat(501) }, 'Invalid address')
      expect((await call({ ...valid, name: 'x'.repeat(160), owner: 'y'.repeat(120), address: 'z'.repeat(500) })).statusCode).toBe(200)
    })

    it('requires lat and lng to be finite and in range, accepting numeric strings and forwarding numbers', async () => {
      await rejects({ ...valid, lat: 'abc' }, 'Invalid lat')
      await rejects({ ...valid, lat: 91 }, 'Invalid lat')
      await rejects({ ...valid, lng: -180.5 }, 'Invalid lng')
      await rejects({ ...valid, lng: { n: 1 } }, 'Invalid lng')
      await rejects({ ...valid, lat: 'Infinity' }, 'Invalid lat')
      const res = await call({ ...valid, lat: '6.4474', lng: 3.4359 })
      expect(res.statusCode).toBe(200)
      expect(h.rpc.mock.calls[0][1].p_business).toMatchObject({ lat: 6.4474, lng: 3.4359 })
    })

    it('requires visible_on_carefind to be a boolean', async () => {
      await rejects({ ...valid, visible_on_carefind: 'yes' }, 'Invalid visible_on_carefind')
      expect((await call({ ...valid, visible_on_carefind: false })).statusCode).toBe(200)
    })

    it('passes a full valid body through unchanged apart from the lowercased email', async () => {
      const full = {
        name: 'Lifeline Pharmacy', owner: 'Ada Eze', email: 'Ada@Lifeline.test', phone: '0800', whatsapp: '0801',
        address: '1 Road', state: 'Lagos', city: 'Ikeja', business_type: 'pharmacy', hours: '9-5',
        maps_link: 'https://maps.test/x', lat: 6.4474, lng: 3.4359, website: 'https://lifeline.test',
        visible_on_carefind: true, referral_code_used: 'REF1',
      }
      expect((await call(full)).statusCode).toBe(200)
      expect(h.rpc.mock.calls[0][1].p_business).toEqual({ ...full, email: 'ada@lifeline.test' })
    })
  })

  it('passes readable RPC validation errors through, but hides unexpected database errors', async () => {
    h.rpc.mockResolvedValueOnce({ data: null, error: { code: 'P0001', message: 'An account with this email already exists. Please sign in, or use "Forgot password" if you have not set a password yet.' } })
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
