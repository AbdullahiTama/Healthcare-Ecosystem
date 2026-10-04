import { describe, it, expect, vi } from 'vitest'
import { isValidPin, randomPinSalt, hashPin, verifyPin, checkWithdrawalPin } from '../pin.js'

describe('PIN helpers', () => {
  it('accepts only 4-6 digits', () => {
    for (const ok of ['1234', '12345', '123456']) expect(isValidPin(ok)).toBe(true)
    for (const bad of ['123', '1234567', 'abcd', '12 34', '', null, undefined, 1234]) expect(isValidPin(bad)).toBe(false)
  })
  it('hashes deterministically per salt, differently across salts, and verifies in constant time', () => {
    const salt = randomPinSalt()
    expect(salt).toMatch(/^[0-9a-f]{32}$/)
    const h = hashPin('1234', salt)
    expect(h).toMatch(/^[0-9a-f]{128}$/)
    expect(hashPin('1234', salt)).toBe(h)
    expect(hashPin('1234', randomPinSalt())).not.toBe(h)
    expect(verifyPin('1234', salt, h)).toBe(true)
    expect(verifyPin('1235', salt, h)).toBe(false)
    expect(verifyPin('1234', salt, h.slice(0, -2))).toBe(false)
    expect(verifyPin('1234', salt, '')).toBe(false)
  })
})

describe('checkWithdrawalPin', () => {
  const salt = randomPinSalt()
  const stored = { pin_hash: hashPin('1234', salt), pin_salt: salt, locked_until: null }
  const client = ({ rows = [stored], getError = null, verified = true, verifyError = null } = {}) => {
    const calls = []
    return {
      calls,
      rpc: async (name, args) => {
        calls.push([name, args])
        if (name === 'get_withdrawal_pin') return { data: rows, error: getError }
        if (name === 'verify_withdrawal_pin') return { data: verified, error: verifyError }
        throw new Error(`unexpected rpc ${name}`)
      },
    }
  }

  it('the right PIN passes, and only the DERIVED hash is sent to the database', async () => {
    const c = client()
    expect(await checkWithdrawalPin(c, 'u1', '1234')).toEqual({ ok: true })
    const verify = c.calls.find(([n]) => n === 'verify_withdrawal_pin')[1]
    expect(verify).toEqual({ p_user_id: 'u1', p_pin_hash: stored.pin_hash, p_pin_salt: salt })
    expect(JSON.stringify(c.calls)).not.toContain('"1234"')
  })
  it('a malformed PIN is refused before touching the database', async () => {
    const c = client()
    expect(await checkWithdrawalPin(c, 'u1', 'abc')).toMatchObject({ ok: false, status: 400, code: 'invalid_pin' })
    expect(c.calls).toHaveLength(0)
  })
  it('no PIN set', async () => {
    expect(await checkWithdrawalPin(client({ rows: [] }), 'u1', '1234')).toMatchObject({ ok: false, status: 400, code: 'pin_not_set' })
  })
  it('a locked PIN is refused WITHOUT counting another attempt', async () => {
    const c = client({ rows: [{ ...stored, locked_until: new Date(Date.now() + 5 * 60000).toISOString() }] })
    const r = await checkWithdrawalPin(c, 'u1', '1234')
    expect(r).toMatchObject({ ok: false, status: 403, code: 'pin_locked' })
    expect(r.retryAfterMinutes).toBeGreaterThanOrEqual(1)
    expect(c.calls.map(([n]) => n)).toEqual(['get_withdrawal_pin'])
  })
  it('an expired lock no longer blocks', async () => {
    const c = client({ rows: [{ ...stored, locked_until: new Date(Date.now() - 1000).toISOString() }] })
    expect((await checkWithdrawalPin(c, 'u1', '1234')).ok).toBe(true)
  })
  it('a wrong PIN is refused, and so is a database that says no even if the local compare agrees', async () => {
    expect(await checkWithdrawalPin(client({ verified: false }), 'u1', '9999')).toMatchObject({ ok: false, status: 403, code: 'pin_incorrect' })
    expect(await checkWithdrawalPin(client({ verified: false }), 'u1', '1234')).toMatchObject({ ok: false, code: 'pin_incorrect' })
    expect(await checkWithdrawalPin(client({ verifyError: { message: 'x' } }), 'u1', '1234')).toMatchObject({ ok: false, code: 'pin_incorrect' })
  })
  it('a database error while reading the PIN is a 500, never a pass', async () => {
    expect(await checkWithdrawalPin(client({ getError: { message: 'down' } }), 'u1', '1234')).toMatchObject({ ok: false, status: 500 })
  })
})
