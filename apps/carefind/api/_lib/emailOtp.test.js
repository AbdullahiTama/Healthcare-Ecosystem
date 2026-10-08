// Phase 16 A2: the OTP primitive. Only a hash is stored, the row burns on first use, attempts
// cap at 5, and requests are rate-limited to 3 per rolling hour — all enforced against the table,
// never in the handler.
import { describe, it, expect, beforeEach } from 'vitest'
import crypto from 'node:crypto'
import { requestWithdrawalOtp, verifyWithdrawalOtp, OTP_MAX_PER_HOUR, OTP_MAX_ATTEMPTS } from './emailOtp.js'

const hash = (code, userId) => crypto.createHash('sha256').update(`${code}:${userId}`).digest('hex')
const USER = { id: '00000000-0000-4000-8000-000000000001', email: 'u@example.com' }
let store

// Minimal stand-in for the supabase query builder surface this module uses.
function fakeSupabase() {
  return {
    from(table) {
      if (table !== 'withdrawal_email_otps') throw new Error(`unexpected table ${table}`)
      return {
        select(_cols, opts) {
          const q = {
            _tests: [],
            eq(k, v) { q._tests.push((r) => r[k] === v); return q },
            gte(k, v) { q._tests.push((r) => r[k] >= v); return q },
            is(k, v) { q._tests.push((r) => r[k] === v); return q },
            order(k, { ascending }) {
              q._order = { k, ascending }
              return q
            },
            limit(n) { q._limit = n; return q },
            then(resolve) {
              let rows = store.filter((r) => q._tests.every((t) => t(r)))
              if (q._order) rows = [...rows].sort((a, b) => (q._order.ascending ? 1 : -1) * (a[q._order.k] < b[q._order.k] ? -1 : 1))
              if (q._limit) rows = rows.slice(0, q._limit)
              if (opts?.head) return resolve({ count: rows.length, error: null })
              resolve({ data: rows, error: null })
            },
          }
          return q
        },
        insert(row) {
          store.push({ id: `row-${store.length}`, attempts: 0, consumed_at: null, created_at: new Date().toISOString(), ...row })
          return Promise.resolve({ error: null })
        },
        update(patch) {
          const q = {
            eq(k, v) { store.forEach((r) => { if (r[k] === v) Object.assign(r, patch) }); return q },
            then(resolve) { resolve({ error: null }) },
          }
          return q
        },
      }
    },
  }
}

const supabase = fakeSupabase()
const row = () => store[store.length - 1]

beforeEach(() => { store = [] })

describe('requestWithdrawalOtp', () => {
  it('stores only a 64-hex hash binding the code to this user, and returns the 6-digit code', async () => {
    const res = await requestWithdrawalOtp(supabase, USER)
    expect(res.code).toMatch(/^\d{6}$/)
    expect(row().code_hash).toBe(hash(res.code, USER.id))
    expect(row().code_hash).not.toContain(res.code)
    expect(row()).toMatchObject({ user_id: USER.id, purpose: 'withdrawal_pin', attempts: 0, consumed_at: null })
    expect(new Date(row().expires_at).getTime()).toBeGreaterThan(Date.now() + 9 * 60 * 1000)
    expect(new Date(row().expires_at).getTime()).toBeLessThanOrEqual(Date.now() + 10 * 60 * 1000)
  })

  it('allows exactly 3 requests in a rolling hour, then 429s without inserting', async () => {
    for (let i = 0; i < OTP_MAX_PER_HOUR; i++) {
      expect((await requestWithdrawalOtp(supabase, USER)).code).toBeTruthy()
    }
    const res = await requestWithdrawalOtp(supabase, USER)
    expect(res.status).toBe(429)
    expect(res.error).toContain('Too many codes')
    expect(store).toHaveLength(OTP_MAX_PER_HOUR)
  })

  it('does not count requests older than the hour', async () => {
    for (let i = 0; i < OTP_MAX_PER_HOUR; i++) {
      store.push({ id: `old-${i}`, user_id: USER.id, created_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString() })
    }
    expect((await requestWithdrawalOtp(supabase, USER)).code).toBeTruthy()
  })

  it('rate-limits per user, not globally', async () => {
    for (let i = 0; i < OTP_MAX_PER_HOUR; i++) store.push({ id: `x-${i}`, user_id: USER.id, created_at: new Date().toISOString() })
    const other = { ...USER, id: '00000000-0000-4000-8000-000000000002' }
    expect((await requestWithdrawalOtp(supabase, other)).code).toBeTruthy()
  })
})

describe('verifyWithdrawalOtp', () => {
  const request = async (user = USER) => (await requestWithdrawalOtp(supabase, user)).code

  it('accepts the emailed code once and burns the row', async () => {
    const code = await request()
    expect(await verifyWithdrawalOtp(supabase, USER.id, code)).toEqual({ ok: true })
    expect(row().consumed_at).not.toBeNull()
    // replaying the same code finds no unconsumed row
    const replay = await verifyWithdrawalOtp(supabase, USER.id, code)
    expect(replay.status).toBe(403)
  })

  it('rejects a malformed code without touching the row', async () => {
    await request()
    for (const code of [undefined, null, '12345', '1234567', 'abcdef', 123456]) {
      expect((await verifyWithdrawalOtp(supabase, USER.id, code)).status).toBe(400)
    }
    expect(row().attempts).toBe(0)
    expect(row().consumed_at).toBeNull()
  })

  it('counts wrong attempts and locks after 5', async () => {
    const code = await request()
    const wrong = code === '000000' ? '111111' : '000000'
    for (let i = 1; i <= OTP_MAX_ATTEMPTS; i++) {
      const res = await verifyWithdrawalOtp(supabase, USER.id, wrong)
      expect(res.status).toBe(403)
      expect(row().attempts).toBe(i)
    }
    const locked = await verifyWithdrawalOtp(supabase, USER.id, wrong)
    expect(locked.error).toContain('locked')
    // even the right code is refused once locked, and attempts stop incrementing
    expect((await verifyWithdrawalOtp(supabase, USER.id, code)).status).toBe(403)
    expect(row().attempts).toBe(OTP_MAX_ATTEMPTS)
    expect(row().consumed_at).toBeNull()
  })

  it('rejects an expired code', async () => {
    const code = await request()
    row().expires_at = new Date(Date.now() - 1000).toISOString()
    const res = await verifyWithdrawalOtp(supabase, USER.id, code)
    expect(res.status).toBe(403)
    expect(res.error).toMatch(/invalid or has expired/)
  })

  it('rejects an unknown code', async () => {
    await request()
    expect((await verifyWithdrawalOtp(supabase, USER.id, '999999')).status).toBe(403)
  })

  it('binds the hash to the user: another user cannot reuse the code', async () => {
    const code = await request()
    const attacker = { ...USER, id: '00000000-0000-4000-8000-000000000003' }
    const res = await verifyWithdrawalOtp(supabase, attacker.id, code)
    expect(res.status).toBe(403)
    expect(row().consumed_at).toBeNull()
  })
})
