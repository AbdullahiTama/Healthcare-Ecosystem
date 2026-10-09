// What a notification SAYS and where it GOES. Pure: no React, no Supabase, so the rules are unit-testable and the page
// stays a thin view (the same split CareHub already uses in apps/carehub/src/lib/notificationCategories.js).
//
// Two kinds of row live in `notifications`, and they were being rendered as if they were one:
//
//   ACTOR rows  - another member did something to you (like, follow, reply...). Written by the member's browser with
//                 actor_id set. The stored message is a verb phrase ("liked your post") that completes
//                 "<name> <message>".
//
//   SYSTEM rows - the platform tells you something about YOUR order or payment ("Payment confirmed for order CF-1").
//                 Written by SECURITY DEFINER database functions with no actor. The stored message is already a
//                 complete sentence.
//
// The page glued "<actor name || 'Someone'>" in front of every message, so each system row read "Someone Payment
// confirmed for order CF-1". System rows now get a headline of their own and show the stored sentence as the detail;
// they never get a name in front of them. An actor row whose actor can no longer be shown reads as a complete
// sentence too, never "Someone".
//
// No schema change is needed for any of this: type + message + link are enough, and order detail (total, items) is
// read from the customer's own orders, fail-soft, by the page.

import { STATUS_CONFIG, formatKobo } from '../shop/orderConstants'

// Platform voice for rows the database writes. headline() gets the stored message so a type with two shapes
// (an order that needs a delivery quote first) can still say the right thing.
const SYSTEM = {
  shop_order_pending:   { iconKey: 'bag',     tone: 'warning', headline: (m) => (/quote delivery/i.test(m) ? 'Delivery quote pending' : 'Order awaiting payment'), order: true },
  shop_order:           { iconKey: 'bag',     tone: 'warning', headline: () => 'Order placed', order: true },
  shop_payment:         { iconKey: 'card',    tone: 'success', headline: () => 'Payment confirmed', order: true },
  shop_order_paid:      { iconKey: 'card',    tone: 'success', headline: () => 'Payment confirmed', order: true },
  shop_order_status:    { iconKey: 'package', tone: 'brand',   headline: () => 'Order update' },
  shop_delivery_quoted: { iconKey: 'truck',   tone: 'info',    headline: () => 'Delivery quoted' },
  shop_order_cancelled: { iconKey: 'cancel',  tone: 'danger',  headline: () => 'Order cancelled', order: true },
  shop_cancelled:       { iconKey: 'cancel',  tone: 'danger',  headline: () => 'Order cancelled', order: true },
  shop_refund:          { iconKey: 'refund',  tone: 'success', headline: () => 'Refund processed', order: true },
  return_approved:      { iconKey: 'refund',  tone: 'success', headline: () => 'Return approved' },
  return_rejected:      { iconKey: 'cancel',  tone: 'danger',  headline: () => 'Return declined' },
  stock_alert:          { iconKey: 'pill',    tone: 'success', headline: () => 'Back in stock' },
  // 'stock_alert' is what the database writes; the UI has always known it as 'product_available'.
  product_available:    { iconKey: 'pill',    tone: 'success', headline: () => 'Back in stock' },
}

// Icon and tint for rows another member wrote.
const ACTOR = {
  like:         { iconKey: 'heart',       tone: 'danger' },
  news_like:    { iconKey: 'heart',       tone: 'danger' },
  comment_like: { iconKey: 'heart',       tone: 'danger' },
  comment:      { iconKey: 'message',     tone: 'info' },
  news_comment: { iconKey: 'message',     tone: 'info' },
  reply:        { iconKey: 'reply',       tone: 'info' },
  mention:      { iconKey: 'mention',     tone: 'brand' },
  gift:         { iconKey: 'gift',        tone: 'brand' },
  follow:       { iconKey: 'follow',      tone: 'brand' },
  profile_view: { iconKey: 'follow',      tone: 'muted' },
  repost:       { iconKey: 'repost',      tone: 'info' },
  review:       { iconKey: 'star',        tone: 'warning' },
  consultation: { iconKey: 'stethoscope', tone: 'brand' },
  live:         { iconKey: 'live',        tone: 'danger' },
  live_invite:  { iconKey: 'live',        tone: 'brand' },
}

const DEFAULT = { iconKey: 'bell', tone: 'muted' }

// Verb-phrase rows the PLATFORM writes with no member behind them (an admin-scheduled live show). Everything else
// without a resolvable actor is a member whose account is gone (profiles.actor_id is ON DELETE SET NULL).
const PLATFORM_ACTOR_TYPES = new Set(['live_invite'])
export const PLATFORM_LABEL = 'CareFind'
export const FORMER_MEMBER_LABEL = 'A former member'

// Types whose target is a single feed post: with a post_id they open that post, whatever link the row stored
// (the stored link for a like is '/', the marketing page).
const POST_LINK_TYPES = new Set(['like', 'comment', 'comment_like', 'reply', 'repost', 'gift', 'mention'])

const STATUS_AT_END = /\bis now ([a-z_]+)\s*$/i
const ORDER_LINK = /^\/orders\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i

const clean = (v) => (typeof v === 'string' ? v.trim() : '')

/** The order a notification is about, from its stored link ('/orders/<uuid>'), or null. */
export function orderIdOf(row) {
  const m = ORDER_LINK.exec(clean(row?.link))
  return m ? m[1].toLowerCase() : null
}

/** Whether the page should look up this row's order to show its total and items. */
export function wantsOrderDetail(row) {
  return !!SYSTEM[row?.type]?.order && !!orderIdOf(row)
}

// Browsers strip tabs and newlines inside a URL, so "/\t/evil.example" would become "//evil.example".
const hasControlChar = (s) => Array.from(s).some((ch) => ch.charCodeAt(0) < 32)

/**
 * Only ever follow an in-app path. The link is written by whoever created the row, and the page passes it to the
 * router, which renders absolute and protocol-relative URLs as ordinary external links: a forged notification could
 * otherwise carry a phishing link. Returns the path, or null when the row should simply not be clickable.
 */
export function safeInternalPath(link) {
  const l = clean(link)
  if (!l.startsWith('/') || l.startsWith('//') || l.startsWith('/\\') || hasControlChar(l)) return null
  return l
}

/** Where tapping the row goes. */
export function notificationHref(row) {
  if (row?.post_id && POST_LINK_TYPES.has(row.type)) return `/post/${encodeURIComponent(row.post_id)}`
  return safeInternalPath(row?.link)
}

// "Paracetamol +2 more" - the first line says what it was, the count says there is more.
function itemsSummary(items) {
  const list = Array.isArray(items) ? items.filter((i) => clean(i?.product_name)) : []
  if (!list.length) return ''
  const first = list[0]
  const qty = Number(first.quantity) > 1 ? `${Number(first.quantity)}× ` : ''
  const more = list.length > 1 ? ` +${list.length - 1} more` : ''
  return `${qty}${clean(first.product_name)}${more}`
}

/**
 * @param {object} row            a notifications row (type, message, link, post_id...)
 * @param {object} [ctx]
 * @param {string} [ctx.actorName]   the resolved display name of row.actor_id, if any
 * @param {object} [ctx.order]       the row's order ({total_kobo, shop_order_items[]}), when it could be read
 * @returns {{ voice: 'system'|'actor', iconKey: string, tone: string, statusKey: string|null,
 *             lead: string|null, headline: string, body: string|null, facts: Array<{label:string,value:string}> }}
 *   For voice 'actor', headline is the whole line and starts with `lead` (the name, so the page can embolden it and
 *   add the verified badge). For voice 'system', headline is a short title and body is the stored sentence.
 */
export function presentNotification(row, { actorName = '', order = null } = {}) {
  const type = clean(row?.type)
  const message = clean(row?.message)
  const name = clean(actorName)

  const system = SYSTEM[type]
  if (system) {
    const statusKey = type === 'shop_order_status' ? (STATUS_AT_END.exec(message)?.[1]?.toLowerCase() || null) : null
    const status = statusKey ? STATUS_CONFIG[statusKey] : null
    const facts = []
    if (order && system.order) {
      if (order.total_kobo !== null && order.total_kobo !== undefined) facts.push({ label: 'Total', value: formatKobo(order.total_kobo) })
      const items = itemsSummary(order.shop_order_items)
      if (items) facts.push({ label: 'Items', value: items })
    }
    return {
      voice: 'system',
      iconKey: system.iconKey,
      tone: system.tone,
      statusKey: status ? statusKey : null,
      lead: null,
      headline: status ? `Order ${status.label.toLowerCase()}` : system.headline(message),
      // The database stores the raw status key ("is now ready_for_pickup"); say it the way the order page does.
      body: (status ? message.replace(STATUS_AT_END, `is now ${status.label.toLowerCase()}`) : message) || null,
      facts,
    }
  }

  const look = ACTOR[type] || DEFAULT

  // A type we have never heard of, with nobody to attribute it to: say what it says, as the platform.
  if (!ACTOR[type] && !name) {
    return { voice: 'system', ...DEFAULT, statusKey: null, lead: null, headline: 'Notification', body: message || null, facts: [] }
  }

  const lead = name || (PLATFORM_ACTOR_TYPES.has(type) ? PLATFORM_LABEL : FORMER_MEMBER_LABEL)
  return {
    voice: 'actor',
    iconKey: look.iconKey,
    tone: look.tone,
    statusKey: null,
    lead,
    headline: `${lead} ${message || 'sent you a notification'}`,
    body: null,
    facts: [],
  }
}
