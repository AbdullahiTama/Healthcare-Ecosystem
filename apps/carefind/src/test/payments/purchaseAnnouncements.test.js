import { describe, it, expect, vi } from 'vitest'
import { announcePurchase, appUrlFor } from '../../../api/_lib/purchaseAnnouncements.js'

const quietLogger = () => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn() })

// Minimal in-memory stand-in for the service-role client: profiles lookup,
// auth.admin.getUserById and a notifications table with the real unique
// (recipient_id, dedupe_key) behaviour.
function fakeSupabase({ profiles = [], users = {}, seenKeys = new Set(), insertError = null, throwOnInsert = false } = {}) {
  const rows = []
  return {
    rows,
    from(table) {
      if (table === 'profiles') {
        return { select: () => ({ in: async (_col, ids) => ({ data: profiles.filter((p) => ids.includes(p.id)), error: null }) }) }
      }
      if (table === 'notifications') {
        return {
          insert: async (row) => {
            if (throwOnInsert) throw new Error('connection lost')
            if (insertError) return { error: insertError }
            const key = `${row.recipient_id}|${row.dedupe_key}`
            if (row.dedupe_key && seenKeys.has(key)) return { error: { code: '23505', message: 'duplicate key value' } }
            seenKeys.add(key)
            rows.push(row)
            return { error: null }
          },
        }
      }
      throw new Error(`unexpected table ${table}`)
    },
    auth: { admin: { getUserById: async (id) => ({ data: { user: users[id] ? { email: users[id] } : null } }) } },
  }
}

const sentOk = () => vi.fn().mockResolvedValue({ sent: true })
const TOPUP = { buyerId: 'u1', reference: 'cf_u1_abc', amountKobo: 500000, coins: 25, newBalance: 40 }
const run = (kind, facts, ctx) => announcePurchase(kind, facts, { appUrl: 'https://carefind.example', logger: quietLogger(), env: {}, ...ctx })

describe('announcePurchase', () => {
  it('writes a structured in-app confirmation and emails the receipt', async () => {
    const supabase = fakeSupabase({ users: { u1: 'ada@example.com' }, profiles: [{ id: 'u1', full_name: 'Ada Obi' }] })
    const sendEmail = sentOk()
    const r = await run('topup', TOPUP, { supabase, sendEmail })

    expect(r).toMatchObject({ announced: true, duplicate: false, emailed: true })
    expect(supabase.rows).toHaveLength(1)
    expect(supabase.rows[0]).toMatchObject({
      recipient_id: 'u1',
      actor_id: null,
      type: 'payment_topup',
      title: 'Wallet top-up successful',
      link: '/wallet',
      dedupe_key: 'topup:cf_u1_abc',
      read: false,
      metadata: { amount_kobo: 500000, coins: 25, reference: 'cf_u1_abc', method: 'card' },
    })
    expect(supabase.rows[0].message).toContain('₦5,000')

    const [mail] = sendEmail.mock.calls[0]
    expect(mail.to).toBe('ada@example.com')
    expect(mail.subject).toBe('Receipt: 25 CareCoins added to your wallet — ₦5,000')
    expect(mail.html).toContain('Ada Obi')
    expect(mail.html).toContain('href="https://carefind.example/wallet"')
    expect(mail.text).toContain('Reference: cf_u1_abc')
  })

  it('announcing the same purchase twice sends one email and one notification', async () => {
    // The webhook and the redirect handler both settle the same reference.
    const shared = new Set()
    const supabase = fakeSupabase({ users: { u1: 'ada@example.com' }, seenKeys: shared })
    const sendEmail = sentOk()
    const first = await run('topup', TOPUP, { supabase, sendEmail })
    const second = await run('topup', TOPUP, { supabase, sendEmail })

    expect(first.announced).toBe(true)
    expect(second).toMatchObject({ announced: false, duplicate: true, emailed: false, emailSkipped: 'already_announced' })
    expect(sendEmail).toHaveBeenCalledTimes(1)
    expect(supabase.rows).toHaveLength(1)
  })

  it('a failed email never fails the announcement and leaves the in-app row in place', async () => {
    const supabase = fakeSupabase({ users: { u1: 'ada@example.com' } })
    const sendEmail = vi.fn().mockResolvedValue({ sent: false, error: 'domain not verified' })
    const r = await run('topup', TOPUP, { supabase, sendEmail })
    expect(r).toMatchObject({ announced: true, emailed: false, emailSkipped: 'send_failed' })
    expect(supabase.rows).toHaveLength(1)
  })

  it('reports an unconfigured email provider as skipped, not failed', async () => {
    const supabase = fakeSupabase({ users: { u1: 'ada@example.com' } })
    const sendEmail = vi.fn().mockResolvedValue({ sent: false, skipped: 'not_configured' })
    const r = await run('topup', TOPUP, { supabase, sendEmail })
    expect(r.emailSkipped).toBe('not_configured')
  })

  it('still records the notification when the account has no email address', async () => {
    const supabase = fakeSupabase({ users: {} })
    const sendEmail = sentOk()
    const r = await run('topup', TOPUP, { supabase, sendEmail })
    expect(r).toMatchObject({ announced: true, emailed: false, emailSkipped: 'no_email' })
    expect(sendEmail).not.toHaveBeenCalled()
    expect(supabase.rows).toHaveLength(1)
  })

  it('prefers an address the caller already verified over a lookup', async () => {
    const supabase = fakeSupabase({ users: { u1: 'stale@example.com' } })
    const sendEmail = sentOk()
    await run('topup', TOPUP, { supabase, sendEmail, buyerEmail: 'fresh@example.com' })
    expect(sendEmail.mock.calls[0][0].to).toBe('fresh@example.com')
  })

  it('tells the professional too, naming the patient', async () => {
    const supabase = fakeSupabase({
      users: { p1: 'ada@example.com' },
      profiles: [{ id: 'p1', full_name: 'Ada Obi' }, { id: 'd1', display_name: 'Dr Bello' }],
    })
    const r = await run('consultation', {
      buyerId: 'p1', professionalId: 'd1', amountKobo: 500000, method: 'card', reference: 'cf_consult_1',
    }, { supabase, sendEmail: sentOk() })

    expect(r.sellerNotified).toBe(true)
    const byRecipient = Object.fromEntries(supabase.rows.map((row) => [row.recipient_id, row]))
    expect(byRecipient.p1.title).toBe('Consultation booked with Dr Bello')
    expect(byRecipient.d1).toMatchObject({
      type: 'payment_received_consultation',
      title: 'New consultation booking from Ada Obi',
      actor_id: null,
    })
    expect(byRecipient.d1.message).toBe('Ada Obi paid ₦5,000. 25 CareCoins were credited to your wallet.')
  })

  it('a retry after a lost payee row fills it in without re-emailing the buyer', async () => {
    const seen = new Set(['p1|consultation:cf_consult_1']) // buyer row already exists
    const supabase = fakeSupabase({ users: { p1: 'ada@example.com' }, seenKeys: seen })
    const sendEmail = sentOk()
    const r = await run('consultation', {
      buyerId: 'p1', professionalId: 'd1', amountKobo: 500000, method: 'card', reference: 'cf_consult_1',
    }, { supabase, sendEmail })
    expect(r).toMatchObject({ duplicate: true, emailed: false, sellerNotified: true })
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('escapes a display name that tries to inject markup into the email', async () => {
    const supabase = fakeSupabase({
      users: { p1: 'ada@example.com' },
      profiles: [{ id: 'd1', full_name: '<script>alert(1)</script>' }],
    })
    const sendEmail = sentOk()
    await run('consultation', { buyerId: 'p1', professionalId: 'd1', amountKobo: 500000, method: 'card', reference: 'r' }, { supabase, sendEmail })
    const { html } = sendEmail.mock.calls[0][0]
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('anonymous card booking: emails only if the patient gave an address, and writes no in-app row', async () => {
    const supabase = fakeSupabase()
    const sendEmail = sentOk()
    const facts = {
      businessId: 'b1', businessName: 'GreenLeaf Pharmacy', date: '2026-10-12', time: '10:00',
      amountKobo: 300000, method: 'card', reference: 'bk_1',
    }

    const withEmail = await run('booking', facts, { supabase, sendEmail, buyerEmail: 'patient@example.com' })
    expect(withEmail).toMatchObject({ announced: true, emailed: true })
    expect(supabase.rows).toHaveLength(0)
    expect(sendEmail.mock.calls[0][0].subject).toBe('Receipt: appointment at GreenLeaf Pharmacy — ₦3,000')

    sendEmail.mockClear()
    const without = await run('booking', facts, { supabase, sendEmail })
    expect(without).toMatchObject({ emailed: false, emailSkipped: 'no_email' })
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('unapplied migration: logs the failure loudly but still sends the receipt', async () => {
    const logger = quietLogger()
    const supabase = fakeSupabase({
      users: { u1: 'ada@example.com' },
      insertError: { code: 'PGRST204', message: "Could not find the 'dedupe_key' column of 'notifications'" },
    })
    const sendEmail = sentOk()
    const r = await announcePurchase('topup', TOPUP, { supabase, sendEmail, logger, env: {} })
    expect(r).toMatchObject({ announced: true, emailed: true })
    expect(logger.error).toHaveBeenCalledWith('[purchase] notification insert failed', expect.objectContaining({ code: 'PGRST204' }))
  })

  it('never throws, even when the database connection drops', async () => {
    const supabase = fakeSupabase({ users: { u1: 'ada@example.com' }, throwOnInsert: true })
    const sendEmail = sentOk()
    await expect(run('topup', TOPUP, { supabase, sendEmail })).resolves.toMatchObject({ announced: true, emailed: true })
  })

  it('returns an error value for an unknown kind instead of throwing', async () => {
    const r = await run('gift-card', {}, { supabase: fakeSupabase(), sendEmail: sentOk() })
    expect(r).toMatchObject({ announced: false, emailed: false })
    expect(r.error).toMatch(/Unknown purchase kind/)
  })
})

describe('appUrlFor', () => {
  it('prefers the configured URL and strips trailing slashes', () => {
    expect(appUrlFor({}, { CAREFIND_APP_URL: 'https://carefind.ng//', VERCEL_PROJECT_PRODUCTION_URL: 'x.vercel.app' })).toBe('https://carefind.ng')
  })

  it('falls back to Vercel\'s own production URL', () => {
    expect(appUrlFor({}, { VERCEL_PROJECT_PRODUCTION_URL: 'carefind.vercel.app' })).toBe('https://carefind.vercel.app')
  })

  it('never trusts request headers — a caller must not be able to choose the link host in a receipt', () => {
    const hostile = { headers: { 'x-forwarded-host': 'evil.example', host: 'evil.example' } }
    expect(appUrlFor(hostile, {})).toBe('')
    expect(appUrlFor(hostile, { CAREFIND_APP_URL: 'https://carefind.ng' })).toBe('https://carefind.ng')
  })
})
