// Notification catalog — the single place that decides what a CareFind
// notification SAYS.
//
// This module is deliberately pure: no Supabase, no React, no Vite env. It is
// imported by two very different runtimes —
//   * the browser (Notifications.jsx renders rows through describeNotification)
//   * the serverless API (api/_lib/purchaseAnnouncements.js builds the rows and
//     receipt emails for money events)
// so what the receipt email says and what the bell says can never drift apart.
//
// Two kinds of notification exist, and they are presented differently:
//
//   ACTIVITY  — somebody did something to you (like, follow, reply, gift…).
//               Written by the browser, always with actor_id = the actor. Shown
//               as "<Name> <what they did>".
//
//   PAYMENT   — money moved (top-up, consultation, subscription, booking).
//               Written ONLY by the server (service role), with no actor and a
//               server-authored title. Shown as a headline + detail + facts.
//               Types start with PAYMENT_TYPE_PREFIX; the database refuses
//               browser inserts of that prefix (see
//               sql/20261009_notifications_structured.sql), which is what makes
//               it safe to render these as trusted system messages.

export const PAYMENT_TYPE_PREFIX = 'payment_'

export const isPaymentType = (type) => typeof type === 'string' && type.startsWith(PAYMENT_TYPE_PREFIX)

// 1 CareCoin = ₦200 (kept in step with the wallet RPCs and topupPackages).
export const NAIRA_PER_COIN = 200

// ── Formatting ───────────────────────────────────────────────────────────────

// Kobo → "₦5,000" (or "₦5,000.50" when there is a kobo part). Money is carried
// around as integer kobo everywhere in this module to avoid float drift and the
// naira/kobo ambiguity the transactions table already suffers from.
export function formatNaira(kobo) {
  const value = Math.round(Number(kobo))
  if (!Number.isFinite(value)) return '—'
  const hasKobo = value % 100 !== 0
  return '₦' + (value / 100).toLocaleString('en-US', {
    minimumFractionDigits: hasKobo ? 2 : 0,
    maximumFractionDigits: 2,
  })
}

export function formatCoins(coins) {
  const n = Number(coins)
  if (!Number.isFinite(n)) return '—'
  return `${n.toLocaleString('en-US')} CareCoin${n === 1 ? '' : 's'}`
}

// Whole-naira fee → coins, rounded up so the platform never over-credits.
export function coinsForNaira(naira) {
  const n = Number(naira) || 0
  return n > 0 ? Math.ceil(n / NAIRA_PER_COIN) : 0
}

// Built lazily, never at import: this module is loaded by the whole client
// bundle, and a runtime without IANA time-zone data must degrade to a slightly
// wrong clock on a receipt, not throw while the app is starting.
const formatters = {}
function formatter(key, options) {
  if (!formatters[key]) {
    try {
      formatters[key] = new Intl.DateTimeFormat('en-GB', { ...options, timeZone: 'Africa/Lagos' })
    } catch {
      formatters[key] = new Intl.DateTimeFormat('en-GB', options)
    }
  }
  return formatters[key]
}
const DATE_TIME_OPTS = { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }
const DATE_OPTS = { day: 'numeric', month: 'short', year: 'numeric' }

// Nigerian time, always — a receipt that shows the server's UTC clock reads as
// an hour wrong to the people it is for.
export function formatDateTime(value) {
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? '—' : `${formatter('dateTime', DATE_TIME_OPTS).format(d)} WAT`
}

export function formatDate(value) {
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? '—' : formatter('date', DATE_OPTS).format(d)
}

const capitalize = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s)

// A notification's `link` is written by whoever created the row, and activity
// rows are written by other users' browsers. Only ever follow an in-app path:
// an absolute URL (`https://evil.example`, `//evil.example`, `/\evil.example`
// — browsers read the last as the second) would turn a notification into a
// phishing link. Returns the path, or null when it is not safe to follow.
export function safeInternalLink(link) {
  if (typeof link !== 'string') return null
  const l = link.trim()
  if (!l.startsWith('/') || l.startsWith('//') || l.startsWith('/\\') || /[\u0000-\u001f]/.test(l)) return null
  return l
}

// ── Activity notifications (browser-written, actor-driven) ───────────────────

// What to say when the row has NO resolvable actor (deleted account, a profile
// the viewer cannot read, or a legacy row written without actor_id). The old
// UI filled the gap with "Someone", which says nothing; each of these is a
// complete sentence that stands on its own.
const ANONYMOUS_PHRASES = {
  like: 'Your post received a like',
  comment: 'Your post received a new comment',
  comment_like: 'Your comment received a like',
  reply: 'You received a reply to your comment',
  repost: 'Your post was reposted',
  mention: 'You were mentioned in a comment',
  follow: 'You have a new follower',
  profile_view: 'Your profile was viewed',
  gift: 'You received a gift',
  news_like: 'Your article received a like',
  news_comment: 'Your article received a new comment',
  live: 'A creator you follow is live now',
  consultation: 'A patient booked a consultation with you',
  product_available: 'A product you wanted is now available',
  live_invite: (message) => {
    const show = /"([^"]+)"/.exec(message || '')?.[1]
    return show ? `You were invited to co-host a live: "${show}"` : 'You were invited to co-host a live show'
  },
}

// iconKey/tone are plain strings so this module stays React-free; the page maps
// them to lucide components and theme colours.
const PRESENTATION = {
  like: ['heart', 'danger'],
  news_like: ['heart', 'danger'],
  comment_like: ['heart', 'danger'],
  comment: ['message', 'info'],
  news_comment: ['message', 'info'],
  reply: ['reply', 'info'],
  mention: ['mention', 'brand'],
  gift: ['gift', 'brand'],
  follow: ['follow', 'brand'],
  repost: ['repost', 'brand'],
  profile_view: ['follow', 'muted'],
  live: ['live', 'danger'],
  live_invite: ['live', 'danger'],
  consultation: ['stethoscope', 'brand'],
  product_available: ['pill', 'success'],
  payment_topup: ['wallet', 'success'],
  payment_consultation: ['stethoscope', 'success'],
  payment_received_consultation: ['wallet', 'success'],
  payment_subscription: ['unlock', 'success'],
  payment_received_subscription: ['wallet', 'success'],
  payment_booking: ['calendar', 'success'],
}

const DEFAULT_PRESENTATION = ['bell', 'muted']

// Facts shown beneath a payment notification. Read from the row's `metadata`
// (written by the server alongside the human text) so the page never has to
// parse them back out of a sentence.
function factsFromMetadata(metadata) {
  const m = metadata && typeof metadata === 'object' ? metadata : {}
  const facts = []
  if (m.amount_kobo != null) facts.push({ label: 'Amount', value: formatNaira(m.amount_kobo) })
  if (m.coins != null) facts.push({ label: 'CareCoins', value: String(m.coins) })
  if (m.reference) facts.push({ label: 'Ref', value: String(m.reference), mono: true })
  return facts
}

/**
 * Turn a notifications row into what the page renders.
 *
 * @param {object} row    notifications row (type, title, message, metadata…)
 * @param {object} [opts]
 * @param {string} [opts.actorName]  resolved display name of row.actor_id, if any
 * @returns {{ category: 'payment'|'activity', iconKey: string, tone: string,
 *             title: string, lead: string|null, body: string|null,
 *             facts: Array<{label,value,mono?}> }}
 *   `lead` is the actor name `title` starts with (so the page can bold it and
 *   add a verified badge), or null when the title has no actor in it.
 */
export function describeNotification(row, { actorName = '' } = {}) {
  const type = row?.type || ''
  const [iconKey, tone] = PRESENTATION[type] || DEFAULT_PRESENTATION
  const message = (row?.message || '').trim()

  // Server-authored (structured) rows carry their own headline. Only payment
  // rows are trusted to — the database stops browsers from writing a title.
  if (isPaymentType(type) && row?.title) {
    return {
      category: 'payment',
      iconKey, tone,
      title: row.title,
      lead: null,
      body: message || null,
      facts: factsFromMetadata(row.metadata),
    }
  }

  const name = (actorName || '').trim()
  let title
  if (name) {
    title = `${name} ${message || 'sent you a notification'}`
  } else {
    const phrase = ANONYMOUS_PHRASES[type]
    title = typeof phrase === 'function'
      ? phrase(message)
      : phrase || capitalize(message) || 'You have a new notification'
  }

  // Anything that reaches here is rendered as plain activity — including a
  // payment-prefixed row that has no server title, which is not one we wrote.
  return { category: 'activity', iconKey, tone, title, lead: name || null, body: null, facts: [] }
}

// ── Purchase notifications + receipts (server-built) ─────────────────────────

const METHOD_LABEL = { card: 'Card / bank transfer (Paystack)', coins: 'CareCoins' }

// Receipt rows are [label, value] pairs rendered as a table in the email.
const receiptRows = (pairs) => pairs.filter(([, value]) => value != null && value !== '')

const methodSentence = (method, coins, amountKobo) =>
  method === 'coins'
    ? `${formatCoins(coins)} (${formatNaira(amountKobo)}) were deducted from your wallet.`
    : `You paid ${formatNaira(amountKobo)} by card or bank transfer.`

/**
 * Build everything the server says about one completed purchase.
 *
 * @param {'topup'|'consultation'|'subscription'|'booking'} kind
 * @param {object} f  facts — see each branch. Amounts are integer KOBO.
 *   `reference` is what the customer sees on the receipt; `dedupeId` (optional,
 *   defaults to `reference`) is what makes announcing the same purchase twice
 *   a no-op — coin purchases have no Paystack reference, so they pass the id of
 *   the booking/subscription row instead.
 * @returns {{ buyer: object|null, seller: object|null, email: object }}
 *   buyer/seller are notifications rows minus the table plumbing:
 *   { recipientId, type, title, message, link, metadata, dedupeKey }.
 *   email is content only ({ subject, heading, intro, rows, cta, footnote });
 *   api/_lib/email.js owns the layout.
 */
export function buildPurchaseAnnouncement(kind, f) {
  switch (kind) {
    case 'topup': {
      const amount = formatNaira(f.amountKobo)
      const balance = f.newBalance != null ? ` New balance: ${formatCoins(f.newBalance)}.` : ''
      return {
        buyer: {
          recipientId: f.buyerId,
          type: 'payment_topup',
          title: 'Wallet top-up successful',
          message: `You paid ${amount} and ${formatCoins(f.coins)} ${f.coins === 1 ? 'was' : 'were'} added to your wallet.${balance}`,
          link: '/wallet',
          metadata: { amount_kobo: f.amountKobo, coins: f.coins, reference: f.reference, method: 'card' },
          dedupeKey: `topup:${f.reference}`,
        },
        seller: null,
        email: {
          subject: `Receipt: ${formatCoins(f.coins)} added to your wallet — ${amount}`,
          heading: 'Payment received',
          intro: `Thank you${f.buyerName ? `, ${f.buyerName}` : ''}. Your payment was successful and your CareCoins are in your wallet.`,
          rows: receiptRows([
            ['Item', `CareCoins top-up (${formatCoins(f.coins)})`],
            ['Amount paid', amount],
            ['Payment method', METHOD_LABEL.card],
            ['New wallet balance', f.newBalance != null ? formatCoins(f.newBalance) : null],
            ['Reference', f.reference],
            ['Date', formatDateTime(f.paidAt)],
          ]),
          cta: { label: 'View your wallet', path: '/wallet' },
        },
      }
    }

    case 'consultation': {
      const amount = formatNaira(f.amountKobo)
      const pro = f.professionalName || 'the professional'
      const buyer = f.buyerName || 'A patient'
      const coins = f.coins ?? coinsForNaira(f.amountKobo / 100)
      return {
        buyer: {
          recipientId: f.buyerId,
          type: 'payment_consultation',
          title: `Consultation booked with ${pro}`,
          message: `${methodSentence(f.method, coins, f.amountKobo)} ${pro} has been notified.`,
          link: `/u/${f.professionalId}`,
          metadata: { amount_kobo: f.amountKobo, coins, reference: f.reference, method: f.method, counterpart_id: f.professionalId },
          dedupeKey: `consultation:${f.dedupeId || f.reference}`,
        },
        seller: {
          recipientId: f.professionalId,
          type: 'payment_received_consultation',
          title: `New consultation booking from ${buyer}`,
          message: `${buyer} paid ${amount}. ${formatCoins(coins)} ${coins === 1 ? 'was' : 'were'} credited to your wallet.`,
          link: `/u/${f.buyerId}`,
          metadata: { amount_kobo: f.amountKobo, coins, reference: f.reference, method: f.method, counterpart_id: f.buyerId },
          dedupeKey: `consultation:${f.dedupeId || f.reference}`,
        },
        email: {
          subject: `Receipt: consultation with ${pro} — ${amount}`,
          heading: 'Consultation booked',
          intro: `Your consultation with ${pro} is confirmed and they have been notified.`,
          rows: receiptRows([
            ['Item', `Consultation with ${pro}`],
            ['Amount paid', amount],
            ['Payment method', METHOD_LABEL[f.method]],
            ['CareCoins used', f.method === 'coins' ? formatCoins(coins) : null],
            ['Reference', f.reference],
            ['Date', formatDateTime(f.paidAt)],
          ]),
          cta: { label: `View ${pro}'s profile`, path: `/u/${f.professionalId}` },
        },
      }
    }

    case 'subscription': {
      const amount = formatNaira(f.amountKobo)
      const creator = f.creatorName || 'this creator'
      const buyer = f.buyerName || 'A member'
      const until = f.expiresAt ? ` Access runs until ${formatDate(f.expiresAt)}.` : ' Access lasts 30 days.'
      return {
        buyer: {
          recipientId: f.buyerId,
          type: 'payment_subscription',
          title: f.renewal ? `Subscription renewed — ${creator}` : `Subscribed to ${creator}`,
          message: `${methodSentence(f.method, f.coins, f.amountKobo)}${until}`,
          link: `/u/${f.creatorId}`,
          metadata: { amount_kobo: f.amountKobo, coins: f.coins, reference: f.reference, method: f.method, counterpart_id: f.creatorId },
          dedupeKey: `subscription:${f.dedupeId || f.reference}`,
        },
        seller: {
          recipientId: f.creatorId,
          type: 'payment_received_subscription',
          title: f.renewal ? `${buyer} renewed their subscription` : `${buyer} subscribed to your content`,
          message: `${formatCoins(f.coins)} (${amount}) ${f.coins === 1 ? 'was' : 'were'} credited to your wallet.`,
          link: `/u/${f.buyerId}`,
          metadata: { amount_kobo: f.amountKobo, coins: f.coins, reference: f.reference, method: f.method, counterpart_id: f.buyerId },
          dedupeKey: `subscription:${f.dedupeId || f.reference}`,
        },
        email: {
          subject: `Receipt: ${f.renewal ? 'renewal of your subscription to' : 'subscription to'} ${creator} — ${amount}`,
          heading: f.renewal ? 'Subscription renewed' : 'Subscription confirmed',
          intro: f.renewal
            ? `Your subscription to ${creator} was renewed from your wallet.`
            : `You now have access to ${creator}'s subscriber-only content.`,
          rows: receiptRows([
            ['Item', `Subscription to ${creator} (30 days)`],
            ['Amount', amount],
            ['Payment method', METHOD_LABEL[f.method]],
            ['CareCoins used', f.method === 'coins' ? formatCoins(f.coins) : null],
            ['Access until', f.expiresAt ? formatDate(f.expiresAt) : null],
            ['Reference', f.reference],
            ['Date', formatDateTime(f.paidAt)],
          ]),
          cta: { label: `Open ${creator}'s profile`, path: `/u/${f.creatorId}` },
        },
      }
    }

    case 'booking': {
      const amount = formatNaira(f.amountKobo)
      const biz = f.businessName || 'the business'
      const when = [f.date, f.time].filter(Boolean).join(' at ')
      return {
        // A card-paid booking is anonymous (no account) — buyerId is then null
        // and only the email, if the patient gave an address, is sent.
        buyer: f.buyerId
          ? {
              recipientId: f.buyerId,
              type: 'payment_booking',
              title: 'Appointment payment confirmed',
              message: `${biz}${when ? ` — ${when}` : ''}. ${methodSentence(f.method, f.coins, f.amountKobo)} The business will confirm your appointment.`,
              link: `/business/${f.businessId}`,
              metadata: { amount_kobo: f.amountKobo, coins: f.coins, reference: f.reference, method: f.method, counterpart_id: f.businessId },
              dedupeKey: `booking:${f.reference}`,
            }
          : null,
        seller: null,
        email: {
          subject: `Receipt: appointment at ${biz} — ${amount}`,
          heading: 'Appointment payment confirmed',
          intro: `Your payment was received. ${biz} will confirm your appointment.`,
          rows: receiptRows([
            ['Business', biz],
            ['Appointment', when || null],
            ['Visit type', f.bookingType === 'online' ? 'Online' : f.bookingType === 'physical' ? 'In person' : null],
            ['Amount paid', amount],
            ['Payment method', METHOD_LABEL[f.method]],
            ['CareCoins used', f.method === 'coins' ? formatCoins(f.coins) : null],
            ['Reference', f.reference],
            ['Date', formatDateTime(f.paidAt)],
          ]),
          cta: { label: `View ${biz}`, path: `/business/${f.businessId}` },
        },
      }
    }

    default:
      throw new Error(`Unknown purchase kind: ${kind}`)
  }
}

// The business-side notice for a paid booking (CareHub's staff_notifications).
// One definition for the redirect handler, the webhook and CareCoin payments —
// they each used to hand-build it, one of them with corrupted characters.
export function bookingPaidStaffNotice({ clientName, date, time, amountKobo, method }) {
  const via = method === 'coins' ? 'CareCoins' : 'card'
  return {
    kind: 'booking_paid',
    title: `Payment received — ${clientName || 'a patient'}`,
    body: `${date} at ${time} — ${formatNaira(amountKobo)} paid by ${via}`,
  }
}
