import {
  presentNotification, notificationHref, safeInternalPath, orderIdOf, wantsOrderDetail,
  PLATFORM_LABEL, FORMER_MEMBER_LABEL,
} from './notificationPresentation'

const ORDER_ID = '3f2b8c1e-5a47-4d9e-9b1a-0c6d7e8f9a10'

// Every type that exists in production, with the message the database or the browser actually stores, taken from the
// live table (468 rows when this was written). 99 of them used to render as "Someone <sentence>".
const LIVE_ROWS = [
  { type: 'shop_order_pending', message: 'Order CF-000045 created — complete payment to confirm' },
  { type: 'shop_order_pending', message: 'Order CF-000046 received — the seller will quote delivery, then you can pay' },
  { type: 'shop_order_pending', message: 'Order CF-000047 is ready for payment — complete payment to confirm' },
  { type: 'shop_payment', message: 'Payment confirmed for order CF-000045' },
  { type: 'shop_order_status', message: 'Order CF-000045 is now ready_for_pickup' },
  { type: 'shop_order', message: 'Order CF-000012 placed — delivery quote pending' },
  { type: 'shop_order_paid', message: 'Payment confirmed for order CF-000012 — ₦18,500' },
  { type: 'shop_delivery_quoted', message: 'Delivery for order CF-000046 is ₦2,500.00' },
  { type: 'shop_order_cancelled', message: 'Order CF-000050 cancelled — payment was not received in time' },
  { type: 'shop_cancelled', message: 'Order CF-000051 cancelled. Your refund is on its way' },
  { type: 'shop_refund', message: 'Your refund for order CF-000045 has been processed.' },
  { type: 'return_approved', message: 'Your return for order CF-000045 has been approved' },
  { type: 'return_rejected', message: 'Your return for order CF-000045 was not approved' },
  { type: 'stock_alert', message: 'Vitamin C is back in stock' },
  { type: 'live_invite', message: 'invited you to co-host an upcoming live: "Skin Q&A"' },
  { type: 'like', message: 'liked your post' },
  { type: 'comment', message: 'commented on your post' },
  { type: 'comment_like', message: 'liked your comment' },
  { type: 'reply', message: 'replied to your comment' },
  { type: 'repost', message: 'reposted your post' },
  { type: 'follow', message: 'started following you' },
  { type: 'profile_view', message: 'viewed your profile' },
  { type: 'gift', message: 'sent you a gift' },
  { type: 'news_like', message: 'liked your article' },
  { type: 'news_comment', message: 'commented on your article' },
  { type: 'review', message: 'left you a 5-star review' },
]

describe('presentNotification', () => {
  it('never says "Someone", for any live type, with or without an actor', () => {
    for (const row of LIVE_ROWS) {
      for (const actorName of ['', 'Ada Obi']) {
        const v = presentNotification(row, { actorName })
        expect(`${v.headline} ${v.body ?? ''}`, `${row.type} / "${actorName}"`).not.toMatch(/someone/i)
        expect(v.headline.length, row.type).toBeGreaterThan(3)
      }
    }
  })

  it('gives every live type its own icon instead of the default bell', () => {
    for (const row of LIVE_ROWS) {
      expect(presentNotification(row, { actorName: 'Ada Obi' }).iconKey, row.type).not.toBe('bell')
    }
  })

  describe('system rows (written by the platform, no actor)', () => {
    it('payment confirmed: a headline of its own, the stored sentence as the detail, no name in front', () => {
      const v = presentNotification({ type: 'shop_payment', message: 'Payment confirmed for order CF-000045' })
      expect(v).toMatchObject({ voice: 'system', headline: 'Payment confirmed', body: 'Payment confirmed for order CF-000045', lead: null, tone: 'success' })
    })

    it('an unpaid order says what is needed, and a quote-first order says it is waiting for the vendor', () => {
      expect(presentNotification({ type: 'shop_order_pending', message: 'Order CF-1 created — complete payment to confirm' }).headline).toBe('Order awaiting payment')
      expect(presentNotification({ type: 'shop_order_pending', message: 'Order CF-1 received — the seller will quote delivery, then you can pay' }).headline).toBe('Delivery quote pending')
    })

    it('order status: the raw status key becomes the label the order page uses', () => {
      const v = presentNotification({ type: 'shop_order_status', message: 'Order CF-000045 is now ready_for_pickup' })
      expect(v).toMatchObject({
        headline: 'Order ready for pickup',
        body: 'Order CF-000045 is now ready for pickup',
        statusKey: 'ready_for_pickup',
      })
      for (const [key, label] of [['processing', 'processing'], ['accepted', 'accepted'], ['delivered', 'delivered'], ['pending_payment', 'pending payment']]) {
        const s = presentNotification({ type: 'shop_order_status', message: `Order CF-9 is now ${key}` })
        expect(s.headline, key).toBe(`Order ${label}`)
        expect(s.body, key).not.toMatch(/_/)
      }
    })

    it('an unknown status is shown as stored rather than guessed at', () => {
      const v = presentNotification({ type: 'shop_order_status', message: 'Order CF-1 is now teleported' })
      expect(v).toMatchObject({ headline: 'Order update', body: 'Order CF-1 is now teleported', statusKey: null })
    })

    it('treats the database stock alert and the UI product_available as one thing', () => {
      const a = presentNotification({ type: 'stock_alert', message: 'Vitamin C is back in stock' })
      const b = presentNotification({ type: 'product_available', message: 'Vitamin C is back in stock' })
      expect(a.headline).toBe('Back in stock')
      expect(b.headline).toBe(a.headline)
    })

    it('adds the order total and items when the order could be read, only for rows about a purchase', () => {
      const order = { total_kobo: 1850000, shop_order_items: [{ product_name: 'Paracetamol 500mg', quantity: 2 }, { product_name: 'Vitamin C', quantity: 1 }] }
      const paid = presentNotification({ type: 'shop_payment', message: 'Payment confirmed for order CF-1' }, { order })
      expect(paid.facts).toEqual([{ label: 'Total', value: '₦18,500' }, { label: 'Items', value: '2× Paracetamol 500mg +1 more' }])

      const status = presentNotification({ type: 'shop_order_status', message: 'Order CF-1 is now delivered' }, { order })
      expect(status.facts).toEqual([])
    })

    it('copes with an order that has no items or no total', () => {
      expect(presentNotification({ type: 'shop_payment', message: 'x' }, { order: { total_kobo: null, shop_order_items: [] } }).facts).toEqual([])
      expect(presentNotification({ type: 'shop_payment', message: 'x' }, { order: { total_kobo: 500000 } }).facts).toEqual([{ label: 'Total', value: '₦5,000' }])
      expect(presentNotification({ type: 'shop_payment', message: 'x' }, { order: null }).facts).toEqual([])
    })

    it('an empty message does not produce an empty detail line', () => {
      expect(presentNotification({ type: 'shop_payment', message: '' }).body).toBeNull()
    })
  })

  describe('actor rows (another member did something)', () => {
    it('reads "<name> <what they did>"', () => {
      const v = presentNotification({ type: 'like', message: 'liked your post' }, { actorName: 'Ada Obi' })
      expect(v).toMatchObject({ voice: 'actor', lead: 'Ada Obi', headline: 'Ada Obi liked your post', body: null })
    })

    it('a platform-written invite (admin-scheduled live) is from CareFind, keeping the show title', () => {
      const v = presentNotification({ type: 'live_invite', message: 'invited you to co-host an upcoming live: "Skin Q&A"' })
      expect(v.headline).toBe(`${PLATFORM_LABEL} invited you to co-host an upcoming live: "Skin Q&A"`)
      expect(v.lead).toBe(PLATFORM_LABEL)
    })

    it('a member whose account is gone is "a former member", not nobody', () => {
      const v = presentNotification({ type: 'like', message: 'liked your post' })
      expect(v.headline).toBe(`${FORMER_MEMBER_LABEL} liked your post`)
    })

    it('an empty message still makes a sentence', () => {
      expect(presentNotification({ type: 'follow', message: '' }, { actorName: 'Ada' }).headline).toBe('Ada sent you a notification')
    })
  })

  describe('a type we have never heard of', () => {
    it('with an actor, is attributed to them', () => {
      expect(presentNotification({ type: 'brand_new', message: 'poked you' }, { actorName: 'Ada' }).headline).toBe('Ada poked you')
    })

    it('without one, is the platform speaking: a generic headline and the stored sentence', () => {
      const v = presentNotification({ type: 'brand_new', message: 'Your something is ready' })
      expect(v).toMatchObject({ voice: 'system', headline: 'Notification', body: 'Your something is ready', iconKey: 'bell' })
    })

    it('an empty row does not throw or print undefined', () => {
      for (const row of [{}, null, undefined, { type: null, message: null }]) {
        const v = presentNotification(row)
        expect(JSON.stringify(v)).not.toMatch(/undefined|NaN/)
        expect(v.headline).toBe('Notification')
      }
    })
  })
})

describe('notificationHref / safeInternalPath', () => {
  it('opens the specific post for post-type rows, whatever link they stored', () => {
    for (const type of ['like', 'comment', 'comment_like', 'reply', 'repost', 'gift', 'mention']) {
      expect(notificationHref({ type, post_id: 'p-1', link: '/' }), type).toBe('/post/p-1')
    }
  })

  it('news rows keep their article link even though post_id holds the article id', () => {
    expect(notificationHref({ type: 'news_like', post_id: 'a-1', link: '/news/a-1' })).toBe('/news/a-1')
  })

  it('opens the order for order rows', () => {
    expect(notificationHref({ type: 'shop_payment', link: `/orders/${ORDER_ID}` })).toBe(`/orders/${ORDER_ID}`)
  })

  it('never follows anything that could leave the app', () => {
    for (const link of [
      'https://evil.example/login', 'http://evil.example', '//evil.example', '/\\evil.example',
      'javascript:alert(1)', 'orders/1', '', '   ', null, undefined, 42, '/x\ny', '/x\ty',
    ]) {
      expect(notificationHref({ type: 'shop_payment', link }), String(link)).toBeNull()
      expect(safeInternalPath(link), String(link)).toBeNull()
    }
  })

  it('a hostile post_id cannot break out of the path', () => {
    expect(notificationHref({ type: 'like', post_id: '../../evil?x=1#', link: null })).toBe('/post/..%2F..%2Fevil%3Fx%3D1%23')
  })

  it('keeps ordinary in-app paths, with a query string', () => {
    expect(safeInternalPath('/shop/abc?x=1')).toBe('/shop/abc?x=1')
    expect(safeInternalPath('  /u/123 ')).toBe('/u/123')
  })
})

describe('order lookup helpers', () => {
  it('finds the order a purchase notification is about', () => {
    expect(orderIdOf({ link: `/orders/${ORDER_ID}` })).toBe(ORDER_ID)
    expect(orderIdOf({ link: `/orders/${ORDER_ID.toUpperCase()}` })).toBe(ORDER_ID)
    for (const link of ['/orders', '/orders/not-a-uuid', `/orders/${ORDER_ID}/extra`, `https://x.example/orders/${ORDER_ID}`, null]) {
      expect(orderIdOf({ link }), String(link)).toBeNull()
    }
  })

  it('asks for order detail only for purchase rows that point at an order', () => {
    expect(wantsOrderDetail({ type: 'shop_payment', link: `/orders/${ORDER_ID}` })).toBe(true)
    expect(wantsOrderDetail({ type: 'shop_order_status', link: `/orders/${ORDER_ID}` })).toBe(false)
    expect(wantsOrderDetail({ type: 'like', link: `/orders/${ORDER_ID}` })).toBe(false)
    expect(wantsOrderDetail({ type: 'shop_payment', link: null })).toBe(false)
  })
})
