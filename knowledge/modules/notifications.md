# Notifications — Business Domain

## Purpose
In-app alert delivery, plus (CareFind) payment confirmations by email — each product has its own independent implementation with no shared code or table.

## Files
CareHub: `apps/carehub/src/components/layout/NotificationBell.jsx`, `lib/supabase.js` (`notify`, `getMyNotifications`, `markNotificationRead`, `markAllNotificationsRead`), `lib/realtime.js` (live subscription).

CareFind:
- `apps/carefind/src/services/notificationCatalog.js` — **what a notification says.** Pure (no React/Supabase/Vite), imported by both the browser and the API.
- `apps/carefind/src/services/notify.js` — browser helper for *activity* notifications.
- `apps/carefind/src/modules/account/Notifications.jsx` — the page; renders rows through the catalog.
- `apps/carefind/api/_lib/purchaseAnnouncements.js` — `announcePurchase()`: in-app notices + receipt email after money moves.
- `apps/carefind/api/_lib/email.js` — Resend transport and the receipt layout.
- `apps/carefind/api/_lib/bookingPaid.js` — appointment-payment variant (also notifies the business).
- `apps/carefind/api/_handlers/purchase-receipt.js` — confirms CareCoin purchases the browser settled itself.
- `apps/carefind/sql/20261009_notifications_structured.sql` — columns + RLS (see Status).

## Two kinds of CareFind notification
| | Activity | Payment |
|---|---|---|
| Examples | like, comment, follow, gift, live invite | `payment_topup`, `payment_consultation`, `payment_subscription`, `payment_booking`, `payment_received_consultation`, `payment_received_subscription` |
| Written by | the actor's browser (`notify()`) | the API only (service role) after the payment is verified/recorded |
| `actor_id` | always the signed-in user | always null |
| Shown as | "**Ada Obi** liked your post" | headline + detail + facts (amount, CareCoins, reference) |
| `title` / `metadata` / `dedupe_key` | never set | always set |

The `payment_` type prefix is reserved: RLS refuses browser inserts of it (and of any row with a title, metadata, dedupe key or no actor). That is what makes it safe to present these as trusted system messages — without it any user could put a "Payment received" notice in another user's inbox.

Activity notifications never render as "Someone …": when the actor cannot be resolved, `describeNotification()` uses a self-contained sentence ("Your post received a like"). Only in-app paths are followed from a notification (`safeInternalLink`); an external or protocol-relative URL in `link` is ignored (the notification is still shown, just not clickable).

## Purchase flows covered
CareFind has **no cart or product checkout** (the marketplace is discovery + "Where to buy"/WhatsApp). The money events are:
| Event | Settled by | Announced by |
|---|---|---|
| CareCoin top-up (card) | `verify-payment` / `paystack-webhook` → `credit_wallet_topup` | whichever call actually credited |
| Consultation (card) | `verify-consultation-payment` / webhook → `settle_consultation_payment` | whichever call created the booking |
| Subscription (card) | `verify-subscription-payment` / webhook | both call; deduped by Paystack reference |
| Appointment (card) | `verify-booking-payment` / webhook → `settle_card_booking` | the call that got `'ok'` |
| Appointment (CareCoins) | `booking` `pay-credits` | same request, on `'ok'` |
| Consultation / subscription / **auto-renewal** (CareCoins) | browser RPC | browser calls `POST /api/purchase-receipt`; server reads the booking/subscription row itself |

Each announcement: buyer's in-app notice + buyer's receipt email + (consultation, subscription) the payee's "you were paid" notice; for bookings the business gets a CareHub `staff_notifications` row. Gifts remain activity notifications.

Idempotency: the buyer's notification row carries `dedupe_key` under a unique index `(recipient_id, dedupe_key)`. The call that inserts it owns the receipt email, so a webhook/redirect race or a reload sends one email. Email is therefore at-most-once.

## Email configuration (Vercel project for `apps/carefind`, server env)
`RESEND_API_KEY` (required to send), `EMAIL_FROM` (**must be on a Resend-verified domain** — the default `onboarding@resend.dev` only delivers to the Resend account owner), `SUPPORT_EMAIL` (optional), `CAREFIND_APP_URL` (optional; else Vercel's `VERCEL_PROJECT_PRODUCTION_URL`; else emails carry no button — the link host is never taken from request headers). Not set ⇒ nothing is emailed, nothing breaks. Anonymous card bookings are emailed only if the patient typed an address on the booking form.

## Services
CareHub: `notify(businessId, recipients, kind, title, body, link)` — called internally by `sendMessage`, `createOrder`, `advanceOrder`, `logActivity`, and `commentOnActivity` from within `lib/supabase.js` itself; deliberately swallows its own errors so a failed notification never blocks the action that triggered it.

CareFind: `notify({ recipientId, actorId, type, message, link, postId })` for activity (requires an actor; refuses `payment_` types); `announcePurchase(kind, facts, ctx)` for money events (never throws; failure is logged and returned).

## Database Tables
CareHub: `staff_notifications` (`id, business_id, staff_id, is_owner, kind, title, body, link, read_at, created_at`).
CareFind: `notifications` (`recipient_id, actor_id, type, message, link, post_id, read, created_at` + `title, metadata jsonb, dedupe_key`).

## Status
`20261009_notifications_structured.sql` is **written and verified against a scratch Postgres 16, not yet applied to production.** Apply it before deploying the code that ships with it. Until then the Notifications page's `select` of the new columns fails and the announcer logs `notification insert failed` (the receipt email is still sent).

## CareHub notes (not changed by the CareFind work)
- **Component:** `NotificationBell.jsx` — a sidebar-embedded bell with unread count and a slide-out panel; it reads the logged-in user via a direct `localStorage` parse rather than the app's own `useAuth()` context, the one place in CareHub's component tree where auth state is read two different ways.
- **Live updates:** CareHub's version is the only consumer, alongside `LiveActivity.jsx`, of `lib/realtime.js`'s `watchTable('staff_notifications', ...)`. CareFind's page loads on open and has no live-update mechanism.
- **Cross-product write:** CareFind's booking handlers write `staff_notifications` rows (`booking_created`, `booking_paid`) into CareHub's table via the service role — that is how a business hears about a paid appointment.
- **Missing documentation:** no document records that both products independently built a notifications system with no attempt to share the table or delivery mechanism, despite the "one ecosystem" framing; nor how `NotificationBell.jsx` came to bypass the app's auth context.

## Known gaps
- Withdrawal outcomes (`transfer.success` / `transfer.failed` in the webhook) still notify nobody.
- CareHub's `email.js` and CareFind's `api/_lib/email.js` are two copies of a small Resend transport (the apps deploy separately). Extract to `packages/` if a third sender appears.
- `packages/shared-notifications` is not used by CareFind's live code path (`services/notify.js` + the catalog are); it still describes the older shape.
- `transactions.naira_amount` is kobo for top-ups and subscription card payments but naira for consultations and bookings; the announcer takes explicit kobo from Paystack or the fee rows and never reads that column.
