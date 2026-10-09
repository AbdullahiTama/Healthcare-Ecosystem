import { describe, it, expect } from 'vitest'
import {
  formatNaira, formatCoins, coinsForNaira, formatDateTime, formatDate,
  describeNotification, buildPurchaseAnnouncement, bookingPaidStaffNotice,
  isPaymentType, safeInternalLink,
} from './notificationCatalog.js'

describe('safeInternalLink', () => {
  it('keeps in-app paths', () => {
    expect(safeInternalLink('/wallet')).toBe('/wallet')
    expect(safeInternalLink('/feed?post=abc')).toBe('/feed?post=abc')
    expect(safeInternalLink('  /u/123 ')).toBe('/u/123')
  })

  it('refuses anything that could leave the app', () => {
    for (const link of [
      'https://evil.example', 'http://evil.example', '//evil.example', '/\\evil.example',
      'javascript:alert(1)', 'wallet', '', '   ', null, undefined, 42, '/\nx', '/\tfoo',
    ]) {
      expect(safeInternalLink(link), String(link)).toBeNull()
    }
  })
})

describe('formatting', () => {
  it('formats whole naira without decimals and keeps a kobo part when present', () => {
    expect(formatNaira(500000)).toBe('₦5,000')
    expect(formatNaira(500050)).toBe('₦5,000.50')
    expect(formatNaira(12345600)).toBe('₦123,456')
  })

  it('never prints NaN/undefined for a bad amount', () => {
    expect(formatNaira(undefined)).toBe('—')
    expect(formatNaira('abc')).toBe('—')
    expect(formatCoins(undefined)).toBe('—')
  })

  it('pluralises coins', () => {
    expect(formatCoins(1)).toBe('1 CareCoin')
    expect(formatCoins(25)).toBe('25 CareCoins')
  })

  it('rounds coins up, as the wallet RPCs do', () => {
    expect(coinsForNaira(5000)).toBe(25)
    expect(coinsForNaira(5001)).toBe(26)
    expect(coinsForNaira(0)).toBe(0)
  })

  it('shows Nigerian time, not the server clock', () => {
    // 23:30 UTC on the 9th is 00:30 on the 10th in Lagos (UTC+1).
    expect(formatDateTime('2026-10-09T23:30:00Z')).toBe('10 Oct 2026, 00:30 WAT')
    expect(formatDate('2026-10-09T23:30:00Z')).toBe('10 Oct 2026')
    expect(formatDateTime('not a date')).toBe('—')
  })
})

describe('describeNotification — activity', () => {
  it('prefixes the actor name when there is one', () => {
    const d = describeNotification({ type: 'like', message: 'liked your post' }, { actorName: 'Ada Obi' })
    expect(d.title).toBe('Ada Obi liked your post')
    expect(d.lead).toBe('Ada Obi')
    expect(d.category).toBe('activity')
    expect(d.iconKey).toBe('heart')
  })

  it('has no lead when there is no actor in the sentence', () => {
    expect(describeNotification({ type: 'like', message: 'liked your post' }).lead).toBeNull()
    expect(describeNotification({ type: 'payment_topup', title: 'T', message: 'm' }).lead).toBeNull()
  })

  it('never falls back to "Someone" — it writes a sentence that stands alone', () => {
    const types = [
      'like', 'comment', 'comment_like', 'reply', 'repost', 'mention', 'follow', 'profile_view',
      'gift', 'news_like', 'news_comment', 'live', 'consultation', 'product_available', 'live_invite',
    ]
    for (const type of types) {
      const d = describeNotification({ type, message: 'did something' })
      expect(d.title, type).not.toMatch(/someone/i)
      expect(d.title, type).not.toMatch(/undefined|null|NaN/)
      expect(d.title.length, type).toBeGreaterThan(10)
    }
    expect(describeNotification({ type: 'like', message: 'liked your post' }).title).toBe('Your post received a like')
  })

  it('keeps the show title for a co-host invite that has no actor', () => {
    const d = describeNotification({ type: 'live_invite', message: 'invited you to co-host a live: "Skin Q&A"' })
    expect(d.title).toBe('You were invited to co-host a live: "Skin Q&A"')
  })

  it('capitalises the stored message for an unknown type with no actor', () => {
    expect(describeNotification({ type: 'new_thing', message: 'a product you wanted is back' }).title)
      .toBe('A product you wanted is back')
  })

  it('has a last-resort sentence for an empty row', () => {
    expect(describeNotification({}).title).toBe('You have a new notification')
    expect(describeNotification({}).iconKey).toBe('bell')
  })

  it('names the actor even for an unknown type', () => {
    expect(describeNotification({ type: 'x', message: 'poked you' }, { actorName: 'Ada' }).title).toBe('Ada poked you')
  })
})

describe('describeNotification — payments', () => {
  const row = {
    type: 'payment_topup',
    title: 'Wallet top-up successful',
    message: 'You paid ₦5,000 and 25 CareCoins were added to your wallet.',
    metadata: { amount_kobo: 500000, coins: 25, reference: 'cf_ab12cd34_ef56' },
  }

  it('renders a server-authored row as headline, detail and facts', () => {
    const d = describeNotification(row)
    expect(d.category).toBe('payment')
    expect(d.title).toBe('Wallet top-up successful')
    expect(d.body).toBe(row.message)
    expect(d.facts).toEqual([
      { label: 'Amount', value: '₦5,000' },
      { label: 'CareCoins', value: '25' },
      { label: 'Ref', value: 'cf_ab12cd34_ef56', mono: true },
    ])
  })

  it('does not trust a title on a row that is not a payment type', () => {
    const d = describeNotification({ type: 'like', title: 'Your account is suspended', message: 'liked your post' }, { actorName: 'Ada' })
    expect(d.title).toBe('Ada liked your post')
    expect(d.category).toBe('activity')
  })

  it('does not present an untitled payment-prefixed row as a payment', () => {
    const d = describeNotification({ type: 'payment_topup', message: 'you won ₦1,000,000, click here' }, { actorName: 'Mallory' })
    expect(d.category).toBe('activity')
    expect(d.title).toBe('Mallory you won ₦1,000,000, click here')
  })

  it('tolerates missing or malformed metadata', () => {
    expect(describeNotification({ ...row, metadata: null }).facts).toEqual([])
    expect(describeNotification({ ...row, metadata: 'oops' }).facts).toEqual([])
  })

  it('recognises payment types by prefix', () => {
    expect(isPaymentType('payment_booking')).toBe(true)
    expect(isPaymentType('like')).toBe(false)
    expect(isPaymentType(undefined)).toBe(false)
  })
})

describe('buildPurchaseAnnouncement', () => {
  const paidAt = '2026-10-09T10:00:00Z'

  it('top-up: names the amount, the coins and the new balance', () => {
    const a = buildPurchaseAnnouncement('topup', {
      buyerId: 'u1', buyerName: 'Ada', reference: 'cf_u1_abc', amountKobo: 500000, coins: 25, newBalance: 40, paidAt,
    })
    expect(a.buyer).toMatchObject({
      recipientId: 'u1', type: 'payment_topup', title: 'Wallet top-up successful', link: '/wallet',
      dedupeKey: 'topup:cf_u1_abc',
    })
    expect(a.buyer.message).toBe('You paid ₦5,000 and 25 CareCoins were added to your wallet. New balance: 40 CareCoins.')
    expect(a.buyer.metadata).toEqual({ amount_kobo: 500000, coins: 25, reference: 'cf_u1_abc', method: 'card' })
    expect(a.seller).toBeNull()
    expect(a.email.subject).toBe('Receipt: 25 CareCoins added to your wallet — ₦5,000')
    expect(a.email.intro).toContain('Ada')
    expect(Object.fromEntries(a.email.rows)).toMatchObject({
      'Amount paid': '₦5,000', 'New wallet balance': '40 CareCoins', Reference: 'cf_u1_abc',
    })
  })

  it('top-up: singular grammar for one coin', () => {
    const a = buildPurchaseAnnouncement('topup', { buyerId: 'u1', reference: 'r', amountKobo: 20000, coins: 1, paidAt })
    expect(a.buyer.message).toBe('You paid ₦200 and 1 CareCoin was added to your wallet.')
  })

  it('consultation by card: tells the patient AND the professional what happened', () => {
    const a = buildPurchaseAnnouncement('consultation', {
      buyerId: 'p1', buyerName: 'Ada', professionalId: 'd1', professionalName: 'Dr Bello',
      amountKobo: 500000, method: 'card', reference: 'cf_consult_1', paidAt,
    })
    expect(a.buyer.title).toBe('Consultation booked with Dr Bello')
    expect(a.buyer.message).toBe('You paid ₦5,000 by card or bank transfer. Dr Bello has been notified.')
    expect(a.buyer.link).toBe('/u/d1')
    expect(a.seller).toMatchObject({ recipientId: 'd1', type: 'payment_received_consultation', link: '/u/p1' })
    expect(a.seller.title).toBe('New consultation booking from Ada')
    expect(a.seller.message).toBe('Ada paid ₦5,000. 25 CareCoins were credited to your wallet.')
    expect(a.seller.dedupeKey).toBe(a.buyer.dedupeKey)
  })

  it('consultation by coins: states the coins taken and uses dedupeId for the key', () => {
    const a = buildPurchaseAnnouncement('consultation', {
      buyerId: 'p1', professionalId: 'd1', professionalName: 'Dr Bello', amountKobo: 500000,
      coins: 25, method: 'coins', reference: 'consult_1234abcd', dedupeId: 'row-uuid', paidAt,
    })
    expect(a.buyer.message).toBe('25 CareCoins (₦5,000) were deducted from your wallet. Dr Bello has been notified.')
    expect(a.buyer.dedupeKey).toBe('consultation:row-uuid')
    expect(Object.fromEntries(a.email.rows)['CareCoins used']).toBe('25 CareCoins')
    expect(Object.fromEntries(a.email.rows)['Payment method']).toBe('CareCoins')
  })

  it('consultation: a missing buyer name reads naturally, not "undefined"', () => {
    const a = buildPurchaseAnnouncement('consultation', {
      buyerId: 'p1', professionalId: 'd1', amountKobo: 500000, method: 'card', reference: 'r', paidAt,
    })
    expect(JSON.stringify(a)).not.toMatch(/undefined|null|NaN/)
    expect(a.seller.title).toBe('New consultation booking from A patient')
  })

  it('subscription: first purchase vs renewal', () => {
    const base = {
      buyerId: 'u1', buyerName: 'Ada', creatorId: 'c1', creatorName: 'Chi', coins: 12, amountKobo: 240000,
      method: 'coins', reference: 'sub_1', expiresAt: '2026-11-08T10:00:00Z', paidAt,
    }
    const first = buildPurchaseAnnouncement('subscription', base)
    expect(first.buyer.title).toBe('Subscribed to Chi')
    expect(first.buyer.message).toBe('12 CareCoins (₦2,400) were deducted from your wallet. Access runs until 8 Nov 2026.')
    expect(first.seller.title).toBe('Ada subscribed to your content')

    const renewal = buildPurchaseAnnouncement('subscription', { ...base, renewal: true })
    expect(renewal.buyer.title).toBe('Subscription renewed — Chi')
    expect(renewal.seller.title).toBe('Ada renewed their subscription')
    expect(renewal.email.heading).toBe('Subscription renewed')
  })

  it('subscription: says 30 days when the expiry is not known yet', () => {
    const a = buildPurchaseAnnouncement('subscription', {
      buyerId: 'u1', creatorId: 'c1', creatorName: 'Chi', coins: 1, amountKobo: 20000, method: 'card', reference: 'r', paidAt,
    })
    expect(a.buyer.message).toContain('Access lasts 30 days.')
  })

  it('booking: signed-in buyer gets an in-app row; anonymous card buyer gets only the email content', () => {
    const facts = {
      businessId: 'b1', businessName: 'GreenLeaf Pharmacy', date: '2026-10-12', time: '10:00',
      bookingType: 'physical', amountKobo: 300000, method: 'card', reference: 'bk_1', paidAt,
    }
    const anon = buildPurchaseAnnouncement('booking', facts)
    expect(anon.buyer).toBeNull()
    expect(anon.email.subject).toBe('Receipt: appointment at GreenLeaf Pharmacy — ₦3,000')
    expect(Object.fromEntries(anon.email.rows)).toMatchObject({
      Business: 'GreenLeaf Pharmacy', Appointment: '2026-10-12 at 10:00', 'Visit type': 'In person',
    })

    const signedIn = buildPurchaseAnnouncement('booking', { ...facts, buyerId: 'u1', method: 'coins', coins: 15 })
    expect(signedIn.buyer).toMatchObject({ recipientId: 'u1', type: 'payment_booking', dedupeKey: 'booking:bk_1', link: '/business/b1' })
    expect(signedIn.buyer.message).toContain('15 CareCoins (₦3,000) were deducted from your wallet.')
  })

  it('every payment row uses a payment_ type, so the database can refuse them from browsers', () => {
    const kinds = {
      topup: { buyerId: 'u', reference: 'r', amountKobo: 1, coins: 1, paidAt },
      consultation: { buyerId: 'u', professionalId: 'p', amountKobo: 1, method: 'card', reference: 'r', paidAt },
      subscription: { buyerId: 'u', creatorId: 'c', coins: 1, amountKobo: 1, method: 'card', reference: 'r', paidAt },
      booking: { buyerId: 'u', businessId: 'b', amountKobo: 1, method: 'card', reference: 'r', paidAt },
    }
    for (const [kind, facts] of Object.entries(kinds)) {
      const a = buildPurchaseAnnouncement(kind, facts)
      for (const row of [a.buyer, a.seller].filter(Boolean)) expect(isPaymentType(row.type), `${kind}:${row.type}`).toBe(true)
    }
  })

  it('rejects an unknown kind loudly', () => {
    expect(() => buildPurchaseAnnouncement('gift-card', {})).toThrow(/Unknown purchase kind/)
  })
})

describe('bookingPaidStaffNotice', () => {
  it('is clean text (the old inline copy shipped corrupted characters)', () => {
    const n = bookingPaidStaffNotice({ clientName: 'Ada', date: '2026-10-12', time: '10:00', amountKobo: 300000, method: 'card' })
    expect(n).toEqual({
      kind: 'booking_paid',
      title: 'Payment received — Ada',
      body: '2026-10-12 at 10:00 — ₦3,000 paid by card',
    })
    expect(JSON.stringify(n)).not.toMatch(/Γ/)
  })

  it('says CareCoins when paid that way, and copes with no name', () => {
    const n = bookingPaidStaffNotice({ date: 'd', time: 't', amountKobo: 20000, method: 'coins' })
    expect(n.title).toBe('Payment received — a patient')
    expect(n.body).toBe('d at t — ₦200 paid by CareCoins')
  })
})
