// Withdrawal trust level (gates instant payouts, device trust and biometrics). Signed-in users only; a user can never raise their own level.
const h = vi.hoisted(() => ({ verifyUser: vi.fn(), rpc: vi.fn(), update: vi.fn(), updateError: null }))
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    rpc: (...a) => h.rpc(...a),
    from: (table) => ({ update: (patch) => ({ eq: async (k, v) => { h.update(table, patch, k, v); return { error: h.updateError } } }) }),
  }),
}))
vi.mock('../_lib/verifyUser.js', () => ({ verifyUser: h.verifyUser }))
import handler from './withdrawal-trust.js'

const res = () => { const r = { statusCode: null, body: null }; r.status = (c) => { r.statusCode = c; return r }; r.json = (b) => { r.body = b; return r }; return r }
const call = async (method, body) => { const r = res(); await handler({ method, headers: {}, body }, r); return r }
beforeEach(() => { h.verifyUser.mockReset().mockResolvedValue({ id: 'u1' }); h.rpc.mockReset(); h.update.mockReset(); h.updateError = null })

describe('withdrawal-trust', () => {
  it('needs a session for everything', async () => {
    h.verifyUser.mockResolvedValue(null)
    for (const m of ['GET', 'POST']) expect((await call(m, {})).statusCode).toBe(401)
    expect(h.rpc).not.toHaveBeenCalled()
  })

  it('GET returns the caller own trust summary (defaults for a new user), asking only about the authenticated user', async () => {
    h.rpc.mockResolvedValue({ data: [{ trust_level: 'trusted', total_withdrawals: 7, total_amount: 90, instant_threshold: 5, device_trust_enabled: true, biometric_enabled: false, consecutive_success: 4 }], error: null })
    const r = await call('GET')
    expect(r.body).toEqual({ trustLevel: 'trusted', totalWithdrawals: 7, totalAmount: 90, instantThreshold: 5, deviceTrustEnabled: true, biometricEnabled: false, consecutiveSuccess: 4 })
    expect(h.rpc).toHaveBeenCalledWith('get_withdrawal_trust', { p_user_id: 'u1' })
    h.rpc.mockResolvedValue({ data: null, error: null })
    expect((await call('GET')).body).toMatchObject({ trustLevel: 'new', totalWithdrawals: 0, deviceTrustEnabled: false })
    h.rpc.mockResolvedValue({ data: null, error: { message: 'secret' } })
    const bad = await call('GET')
    expect(bad.statusCode).toBe(500)
    expect(JSON.stringify(bad.body)).not.toMatch(/secret/)
  })

  it('enable_device needs a device id and a trusted level (the database decides)', async () => {
    expect((await call('POST', { action: 'enable_device' })).statusCode).toBe(400)
    h.rpc.mockResolvedValue({ data: false, error: null })
    expect((await call('POST', { action: 'enable_device', device_id: 'd1' })).statusCode).toBe(403)
    h.rpc.mockResolvedValue({ data: true, error: null })
    const r = await call('POST', { action: 'enable_device', device_id: 'd1' })
    expect(r).toMatchObject({ statusCode: 200, body: { ok: true } })
    expect(h.rpc).toHaveBeenLastCalledWith('enable_device_trust', { p_user_id: 'u1', p_device_id: 'd1' })
    h.rpc.mockResolvedValue({ data: null, error: { message: 'x' } })
    expect((await call('POST', { action: 'enable_device', device_id: 'd1' })).statusCode).toBe(500)
  })

  it('enable_biometric is refused for a new user and, for others, only ever updates the caller own row', async () => {
    h.rpc.mockResolvedValue({ data: [{ trust_level: 'new' }], error: null })
    expect((await call('POST', { action: 'enable_biometric', user_id: 'victim' })).statusCode).toBe(403)
    expect(h.update).not.toHaveBeenCalled()
    h.rpc.mockResolvedValue({ data: [{ trust_level: 'trusted' }], error: null })
    expect((await call('POST', { action: 'enable_biometric', user_id: 'victim' })).statusCode).toBe(200)
    expect(h.update).toHaveBeenCalledWith('withdrawal_trust', expect.objectContaining({ biometric_enabled: true }), 'user_id', 'u1')
    h.updateError = { message: 'x' }
    expect((await call('POST', { action: 'enable_biometric' })).statusCode).toBe(500)
    h.rpc.mockResolvedValue({ data: null, error: { message: 'x' } })
    expect((await call('POST', { action: 'enable_biometric' })).statusCode).toBe(500)
  })

  it('an unknown action and a wrong method are refused', async () => {
    expect((await call('POST', { action: 'make_me_trusted' })).statusCode).toBe(400)
    expect((await call('DELETE')).statusCode).toBe(405)
  })
})
