// H05: the outbox stores payloads, so a credential must never be queued. The guard is central (EmailService.enqueue), on key
// names at any depth, and refuses BEFORE any row is written.
import { describe, it, expect } from 'vitest'
import { EmailService, findCredentialField } from '../EmailService.js'

const capture = () => {
  const state = { rows: [], logs: [] }
  state.db = {
    from: (t) => (t === 'email_outbox'
      ? { insert: (r) => { state.rows.push(r); return { select: () => ({ single: async () => ({ data: { id: 'o1', ...r }, error: null }) }) } } }
      : { insert: async (r) => { state.logs.push(r); return { data: null, error: null } } }),
  }
  return state
}
const enqueue = (state, payload) => new EmailService({ supabase: state.db }).enqueue({
  templateKey: 'withdrawal_completed', toEmail: 'a@example.com', fromEmail: 'CareFind <support@mail.carefind.app>', payload,
})

describe('findCredentialField', () => {
  it.each(['otp', 'OTP', 'code', 'pin', 'password', 'passwd', 'secret', 'apiKey', 'api_key', 'access_token', 'refreshToken', 'token', 'session', 'verificationCode', 'one_time_code'])('names %s', (key) => {
    expect(findCredentialField({ [key]: 'x' })).toBe(`payload.${key}`)
  })

  it('looks inside objects and arrays and reports the path', () => {
    expect(findCredentialField({ a: { b: [{ c: 1 }, { pin: '1234' }] } })).toBe('payload.a.b[1].pin')
  })

  it.each([
    ['resetLink', 'https://x/auth/verify?token=abc'], ['orderRef', 'CF-1'], ['accountNumber', '••••6789'], ['fullName', 'Ada'],
    ['trackingToken', 'abc'], ['promoCode', 'SAVE10'], ['postcode', '100001'], ['reference', 'cf_wd_1'],
  ])('does not flag the legitimate field %s', (key, value) => {
    expect(findCredentialField({ [key]: value })).toBeNull()
  })

  it('is total: null, strings and numbers are fine', () => {
    for (const v of [null, undefined, 'x', 5, true]) expect(findCredentialField(v)).toBeNull()
  })
})

describe('EmailService.enqueue refuses a credential payload before writing anything', () => {
  it.each([[{ otp: '123456' }], [{ nested: { code: '482913' } }], [{ items: [{ password: 'hunter2' }] }], [{ pin: '4821' }]])('payload %j', async (payload) => {
    const state = capture()
    await expect(enqueue(state, payload)).rejects.toThrow(/credential-like field .* is not allowed/)
    expect(state.rows).toEqual([])
    expect(state.logs).toEqual([])
  })

  it('an ordinary payment payload goes through and is stored exactly as given', async () => {
    const state = capture()
    const payload = { fullName: 'Ada', amount: '₦1,600', coins: '10', reference: 'cf_wd_1', bankName: 'GTBank', accountNumber: '••••6789' }
    await enqueue(state, payload)
    expect(state.rows).toHaveLength(1)
    expect(state.rows[0].payload).toEqual(payload)
  })

  it('the error never echoes the value', async () => {
    const state = capture()
    await expect(enqueue(state, { otp: '913742' })).rejects.toThrow()
    try { await enqueue(state, { otp: '913742' }) } catch (e) { expect(e.message).not.toContain('913742') }
  })
})
