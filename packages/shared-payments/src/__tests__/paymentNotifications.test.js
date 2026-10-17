// H05: the decisions that decide WHEN a money e-mail goes out - the slow-transfer notice, the declined-payment notice, and the
// PIN reset notice - and that each carries a stable key, so a replay of any seam cannot send a second one.
import { describe, it, expect, vi } from 'vitest'
import { sweepWithdrawals, IN_FLIGHT_GRACE_MS } from '../withdrawals.js'
import { createSettlementEffects } from '../effects.js'
import { setWithdrawalPin, hashPin, randomPinSalt } from '../pin.js'

process.env.OTP_HMAC_SECRET = 'test-secret'

// ---- the slow-transfer notice -------------------------------------------------------------------------------------------
describe('sweepWithdrawals: the in-flight notice', () => {
  const NOW = Date.parse('2026-10-10T12:00:00Z')
  const old = new Date(NOW - IN_FLIGHT_GRACE_MS - 60_000).toISOString()
  const row = (over = {}) => ({ id: 'w1', user_id: 'u1', amount: 10, status: 'processing', paystack_reference: 'cf_wd_1', paystack_transfer_code: 'TRF_1', created_at: old, updated_at: old, ...over })
  const fake = (rows, settle = () => ({ result: 'refunded' })) => ({
    rpc: async (_n, args) => ({ data: settle(args), error: null }),
    from: () => { const b = { select: () => b, in: () => b, not: () => b, lt: () => b, order: () => b, limit: async () => ({ data: rows, error: null }) }; return b },
  })
  const quiet = { error() {}, warn() {} }

  it.each(['pending', 'otp', 'processing', 'queued', 'received'])('a transfer Paystack still reports as %s past the grace period is handed to onInFlight, and never settled', async (status) => {
    const onInFlight = vi.fn(async () => {})
    const settle = vi.fn(() => ({ result: 'refunded' }))
    const out = await sweepWithdrawals(fake([row()], settle), 'carefind', { now: NOW, getStatus: async () => status, onInFlight, logger: quiet })
    expect(onInFlight).toHaveBeenCalledTimes(1)
    expect(onInFlight.mock.calls[0][0]).toMatchObject({ id: 'w1', paystack_reference: 'cf_wd_1' })
    expect(settle).not.toHaveBeenCalled()
    expect(out).toMatchObject({ checked: 1, waiting: 1, refunded: 0, completed: 0, inFlight: 1 })
  })

  it('a completed, refunded, unconfirmable or unknown-status transfer is not announced as "in flight"', async () => {
    const onInFlight = vi.fn()
    for (const [status, settle] of [['success', () => ({ result: 'completed', id: 'w1' })], ['failed', () => ({ result: 'refunded', id: 'w1' })], ['something_new', () => ({})]]) {
      await sweepWithdrawals(fake([row()], settle), 'carefind', { now: NOW, getStatus: async () => status, onInFlight, logger: quiet })
    }
    await sweepWithdrawals(fake([row()]), 'carefind', { now: NOW, getStatus: async () => { throw new Error('socket hang up') }, onInFlight, logger: quiet })
    expect(onInFlight).not.toHaveBeenCalled()
  })

  it('a hook that throws is logged and never fails or stops the sweep', async () => {
    const logger = { error: vi.fn(), warn() {} }
    const out = await sweepWithdrawals(fake([row({ id: 'a' }), row({ id: 'b', paystack_reference: 'cf_wd_2' })]), 'carefind', {
      now: NOW, getStatus: async () => 'pending', onInFlight: async () => { throw new Error('mailer down') }, logger,
    })
    expect(out.checked).toBe(2)
    expect(out.errors).toBe(0)
    expect(logger.error).toHaveBeenCalledWith('withdrawal.sweep.on_in_flight_failed', expect.objectContaining({ message: 'mailer down' }))
  })
})

// ---- the declined-payment notice ----------------------------------------------------------------------------------------
describe('createSettlementEffects: a payment the provider declined', () => {
  const fake = ({ user = { email: 'ada@example.com', user_metadata: { full_name: 'Ada Obi' } }, biz = null, appt = null } = {}) => ({
    auth: { admin: { getUserById: async () => (user ? { data: { user } } : { data: null }) } },
    from: (table) => {
      const b = { select: () => b, eq: () => b, maybeSingle: async () => ({ data: table === 'businesses' ? biz : table === 'appointments' ? appt : null }), insert: async () => ({}) }
      return b
    },
  })
  const intent = (over = {}) => ({ id: 'i1', reference: 'cf_topup_1', purpose: 'wallet_topup', status: 'pending', application: 'carefind', customer_id: 'u1', expected_amount: 22000, ...over })
  const setup = (opts = {}) => {
    const sent = []
    const run = createSettlementEffects({ supabase: fake(opts), send: async (m) => { sent.push(m) }, logger: { error() {} } })
    return { run, sent }
  }

  it('sends one payment_failed e-mail with the real name, the naira amount and the reference', async () => {
    const { run, sent } = setup()
    await run({ outcome: 'not_paid', providerStatus: 'failed', purpose: 'wallet_topup', intent: intent() })
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({
      templateKey: 'payment_failed', toEmail: 'ada@example.com', app: 'carefind', sourceId: 'i1',
      subject: 'CareFind: your payment did not go through', idempotencyKey: 'payment-failed:cf_topup_1',
    })
    expect(sent[0].payload).toMatchObject({ fullName: 'Ada Obi', reference: 'cf_topup_1', purpose: 'CareCoin deposit' })
    expect(sent[0].payload.amount).toContain('220')
  })

  it('an abandoned checkout, a still-pending payment and an intent already closed send nothing', async () => {
    const { run, sent } = setup()
    await run({ outcome: 'not_paid', providerStatus: 'abandoned', purpose: 'wallet_topup', intent: intent() })
    await run({ outcome: 'not_paid', providerStatus: 'pending', purpose: 'wallet_topup', intent: intent() })
    await run({ outcome: 'not_paid', providerStatus: 'not_found', purpose: 'wallet_topup', intent: intent() })
    await run({ outcome: 'not_paid', providerStatus: 'failed', purpose: 'wallet_topup', intent: intent({ status: 'failed' }) })
    await run({ outcome: 'not_paid', providerStatus: 'failed', purpose: 'wallet_topup', intent: intent({ status: 'expired' }) })
    expect(sent).toEqual([])
  })

  it('a business payment goes to the owner under the CareHub brand', async () => {
    const { run, sent } = setup({ biz: { name: 'Sunrise Clinic', owner_name: 'Ada', owner_email: 'owner@clinic.com', email: 'biz@clinic.com' } })
    await run({ outcome: 'not_paid', providerStatus: 'failed', purpose: 'business_wallet_topup', intent: intent({ purpose: 'business_wallet_topup', application: 'carehub', customer_id: null, business_id: 'b1', reference: 'ch_topup_1' }) })
    expect(sent[0]).toMatchObject({ templateKey: 'payment_failed', toEmail: 'owner@clinic.com', app: 'carehub', subject: 'CareHub: your payment did not go through' })
    expect(sent[0].payload.purpose).toBe('Wallet deposit')
  })

  it('a guest booking goes to the address on the appointment', async () => {
    const { run, sent } = setup({ appt: { client_email: 'guest@example.com', client_name: 'Guest' } })
    await run({ outcome: 'not_paid', providerStatus: 'failed', purpose: 'booking', intent: intent({ purpose: 'booking', customer_id: null, entity_type: 'appointment', entity_id: 'a1', reference: 'chapp_1' }) })
    expect(sent[0]).toMatchObject({ toEmail: 'guest@example.com', idempotencyKey: 'payment-failed:chapp_1' })
  })

  it('the key is the reference: the redirect, the sweep and a retry all produce the SAME key', async () => {
    const { run, sent } = setup()
    for (let i = 0; i < 3; i++) await run({ outcome: 'not_paid', providerStatus: 'failed', purpose: 'wallet_topup', intent: intent() })
    expect(new Set(sent.map((m) => m.idempotencyKey))).toEqual(new Set(['payment-failed:cf_topup_1']))
  })

  it('an effect that throws never escapes into the caller', async () => {
    const run = createSettlementEffects({ supabase: { auth: { admin: { getUserById: async () => { throw new Error('auth down') } } }, from: () => ({}) }, send: async () => {}, logger: { error() {} } })
    await expect(run({ outcome: 'not_paid', providerStatus: 'failed', purpose: 'wallet_topup', intent: intent() })).resolves.toBeUndefined()
  })
})

// ---- PIN reset vs change ------------------------------------------------------------------------------------------------
describe('setWithdrawalPin: which notice is sent', () => {
  const salt = randomPinSalt()
  const user = { id: 'u1', email: 'ada@example.com', email_confirmed_at: '2026-01-01' }
  const db = (hasPin) => ({
    rpc: vi.fn(async (fn) => {
      if (fn === 'get_withdrawal_pin') return { data: hasPin ? [{ pin_hash: hashPin('1234', salt), pin_salt: salt }] : [], error: null }
      if (fn === 'verify_otp') return { data: 'ok', error: null }
      if (fn === 'verify_withdrawal_pin') return { data: true, error: null }
      return { data: null, error: null }
    }),
  })
  const mailer = () => ({ sendPinChanged: vi.fn(async () => ({ ok: true })), sendPinReset: vi.fn(async () => ({ ok: true })) })

  it('"forgot PIN" sends the louder reset notice, and only that', async () => {
    const m = mailer()
    const r = await setWithdrawalPin(db(true), user, { pin: '5678', otp: '123456', forgot: true, mailer: m })
    expect(r.status).toBe(200)
    expect(m.sendPinReset).toHaveBeenCalledWith({ to: 'ada@example.com' })
    expect(m.sendPinChanged).not.toHaveBeenCalled()
  })

  it('replacing with the current PIN, and setting a first PIN, send the ordinary change notice', async () => {
    const replace = mailer()
    await setWithdrawalPin(db(true), user, { pin: '5678', otp: '123456', currentPin: '1234', mailer: replace })
    expect(replace.sendPinChanged).toHaveBeenCalledTimes(1)
    expect(replace.sendPinReset).not.toHaveBeenCalled()
    const first = mailer()
    await setWithdrawalPin(db(false), user, { pin: '5678', otp: '123456', mailer: first })
    expect(first.sendPinChanged).toHaveBeenCalledTimes(1)
  })

  it('a mailer without sendPinReset falls back to the change notice; a failing notice never fails the change', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const old = { sendPinChanged: vi.fn(async () => ({ ok: false, error: 'provider_down' })) }
    const r = await setWithdrawalPin(db(true), user, { pin: '5678', otp: '123456', forgot: true, mailer: old })
    expect(r.status).toBe(200)
    expect(old.sendPinChanged).toHaveBeenCalled()
    expect(warn.mock.calls.map((c) => c[0]).join(' ')).toContain('alert.failed')
    warn.mockRestore()
  })
})
