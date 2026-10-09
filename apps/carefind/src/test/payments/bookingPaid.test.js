import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockAnnounce } = vi.hoisted(() => ({ mockAnnounce: vi.fn() }))
vi.mock('../../../api/_lib/purchaseAnnouncements.js', () => ({ announcePurchase: mockAnnounce }))

import { announceBookingPaid } from '../../../api/_lib/bookingPaid.js'

const APPT = {
  id: 'a1', business_id: 'b1', client_name: 'Ada', booking_type: 'physical',
  date: '2026-10-12', time: '10:00', fee_amount: 290000,
}
const quietLogger = () => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn() })

function fakeSupabase({ staffError = null, businessName = 'GreenLeaf Pharmacy', throwOnStaff = false } = {}) {
  const inserts = []
  return {
    inserts,
    from(table) {
      if (table === 'staff_notifications') {
        return { insert: async (row) => { if (throwOnStaff) throw new Error('db down'); inserts.push(row); return { error: staffError } } }
      }
      if (table === 'businesses') {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: businessName ? { name: businessName } : null }) }) }) }
      }
      throw new Error(`unexpected ${table}`)
    },
  }
}

beforeEach(() => mockAnnounce.mockReset().mockResolvedValue({ announced: true }))

describe('announceBookingPaid', () => {
  it('card: tells the business in clean text and sends the patient the exact amount charged', async () => {
    const supabase = fakeSupabase()
    await announceBookingPaid(supabase, { appt: APPT, method: 'card', reference: 'bk_1', buyerEmail: 'p@example.com', appUrl: 'https://x.example', logger: quietLogger() })

    expect(supabase.inserts).toEqual([{
      business_id: 'b1', staff_id: null, is_owner: true, kind: 'booking_paid',
      title: 'Payment received — Ada',
      body: '2026-10-12 at 10:00 — ₦2,900 paid by card',
      link: '/dashboard/appointments', read_at: null,
    }])
    expect(JSON.stringify(supabase.inserts)).not.toMatch(/Γ/)

    expect(mockAnnounce).toHaveBeenCalledWith('booking', {
      buyerId: null, businessId: 'b1', businessName: 'GreenLeaf Pharmacy', date: '2026-10-12', time: '10:00',
      bookingType: 'physical', amountKobo: 290000, coins: undefined, method: 'card', reference: 'bk_1',
    }, expect.objectContaining({ supabase, appUrl: 'https://x.example', buyerEmail: 'p@example.com' }))
  })

  it('coins: whole coins are what was charged, so that is the amount on both notices', async () => {
    const supabase = fakeSupabase()
    await announceBookingPaid(supabase, { appt: APPT, method: 'coins', reference: 'bk_1', buyerId: 'u1', buyerEmail: 'a@example.com', logger: quietLogger() })

    // ₦2,900 => 15 coins => ₦3,000 actually deducted.
    expect(supabase.inserts[0].body).toBe('2026-10-12 at 10:00 — ₦3,000 paid by CareCoins')
    expect(mockAnnounce.mock.calls[0][1]).toMatchObject({ buyerId: 'u1', amountKobo: 300000, coins: 15, method: 'coins' })
  })

  it('a failed business notice never stops the patient getting their receipt', async () => {
    for (const supabase of [fakeSupabase({ staffError: { message: 'rls' } }), fakeSupabase({ throwOnStaff: true })]) {
      mockAnnounce.mockClear()
      const logger = quietLogger()
      await announceBookingPaid(supabase, { appt: APPT, method: 'card', reference: 'bk_1', logger })
      expect(logger.error).toHaveBeenCalled()
      expect(mockAnnounce).toHaveBeenCalledTimes(1)
    }
  })

  it('still announces when the business name cannot be read', async () => {
    await announceBookingPaid(fakeSupabase({ businessName: null }), { appt: APPT, method: 'card', reference: 'bk_1', logger: quietLogger() })
    expect(mockAnnounce.mock.calls[0][1].businessName).toBeUndefined()
  })
})
