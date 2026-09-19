---
title: 'Appointment & Service Booking — Professional Configuration'
type: 'feature'
created: '2026-08-28'
status: 'done'
baseline_commit: 'e0485273aab3c22499cf0264c2595b3212a8cc6a'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Settings Appointment section only supports generic booking_type/slots/fees. Business owners cannot create/list services, set per-service prices/fees, or manage available dates/slots professionally. Customers cannot select a service, pick a date+time, and pay in advance; booked slots do not become unavailable reliably in UI.

**Approach:** Add Services management under Settings (CRUD, price, duration), enhance availability to date-specific slots, allow customers on BusinessProfile to select service → choose available date/time → pay in advance → receive confirmation, with booked slots becoming unavailable and payment fixed.

## Boundaries & Constraints

**Always:** Services stored in `business_services` table (business_id, name, price_kobo, duration_minutes, description, is_active) with RLS tenant isolation. Availability remains in `businesses.booking_slots` for daily times plus optional `service_availability` (business_id, service_id, date, time, is_booked). Bookings use existing `appointments` with service_id/service_name/fee_amount. Payment via existing Paystack/CareCoins flow; never expose secrets client-side. Loading/error/empty/responsive/a11y required.

**Ask First:** If new table migration cannot be applied yet, fallback to JSON in businesses.services column.

**Never:** Do not duplicate booking logic; do not weaken RLS; do not modify pricing/email/wallet/referrer beyond booking integration.

## I/O & Edge-Case Matrix

| Scenario | Input | Expected Output | Error |
|----------|-------|-----------------|-------|
| Create service | Owner enters name, price, duration | Service appears in list, available for booking | Validate name non-empty, price >=0 |
| List services | Settings load | Shows services with price/duration, empty state if none | — |
| Set available dates/slots | Owner picks date + times per service | Slots saved, shown on BusinessProfile as selectable | Validate date >=today, time not duplicate |
| Customer selects service | BookingCard, choose service | Shows price, available dates/times for that service | If no slots, show "No availability" |
| Book appointment | Customer picks date/time, pays | Appointment created with payment_status, slot marked booked, confirmation shown | If slot already taken (409), show "That time was just taken" and refresh slots |
| Payment | Advance pay via Paystack/CareCoins | verify-booking-payment settles, wallet credited | If payment fails, appointment stays unpaid, allow retry |

</frozen-after-approval>

## Code Map

- `apps/carehub/src/modules/settings/Settings.jsx:327` -- Booking card: generic type/slots/fees. Add Services subsection + date/slot manager below it.
- `apps/carehub/src/modules/settings/repositories/index.js:85` -- saveBookingConfig handles businesses.booking_* columns. Add service CRUD methods.
- `apps/carehub/api/_lib/booking.js` equivalent -- none; booking via `apps/carefind/api/_handlers/booking.js:1` handles clash + fee.
- `apps/carefind/src/modules/business-profiles-reviews/BusinessProfile.jsx:21` -- BookingCard: date/slot picker, payMethod, submitBooking. Add service select + price handling.
- `apps/carehub/sql/20260811_business_wallets_and_booking_payments.sql` -- Contains booking payment settlement RPCs (reference).
- `apps/carehub/src/modules/appointments/Appointments.jsx:1` -- Owner view of bookings, should show service name.

## Tasks & Acceptance

**Execution:**
- [x] `apps/carehub/sql/20260828_business_services.sql` -- Migration: create business_services and service_availability tables, RLS, indexes.
- [x] `apps/carehub/src/modules/settings/repositories/index.js` -- Add service repo methods: getServices, createService, updateService, deleteService, getAvailability, saveAvailability.
- [x] `apps/carehub/src/modules/settings/Settings.jsx` -- Add Services management UI (list, add/edit modal, delete confirm, price/duration), plus date-specific slots UI per service.
- [x] `apps/carefind/src/modules/business-profiles-reviews/BusinessProfile.jsx` -- Update BookingCard to fetch services, render service picker, show per-service price, filter slots, handle advance payment correctly, show booked slots as disabled.
- [x] `apps/carefind/api/_handlers/booking.js` -- Ensure clash check includes service and payment fix; verify booking_slots parsing handles both array and string.

**Acceptance:**
- Given owner in Settings, when they create a service with price, then it appears in list and is fetchable via business_services.
- Given customer on BusinessProfile, when they select a service, then available dates/times for that service appear and booked slots are unavailable.
- Given customer books with advance pay, when Paystack confirms, then appointment payment_status=paid and business wallet credited (via existing settlement).

## Spec Change Log

## Design Notes

Services are separate from products; they live in their own table to allow booking-specific fields (duration, service fee). Daily slots remain in businesses.booking_slots for backward compat; date-specific overrides in service_availability allow per-service scheduling.

## Verification

- `npm run build` -- clean
- `npm test run` -- existing tests pass
- Manual: Create service → appears → book → slot unavailable → pay → confirmation

## Suggested Review Order

**Services & availability**

- Migration creates business_services with RLS
  [`20260828_business_services.sql:1`](../../apps/carehub/sql/20260828_business_services.sql#L1)

- Repository adds service CRUD and availability helpers
  [`repositories/index.js:100`](../../apps/carehub/src/modules/settings/repositories/index.js#L100)

- Settings adds Services UI and date/slot manager
  [`Settings.jsx:327`](../../apps/carehub/src/modules/settings/Settings.jsx#L327)

**Customer booking**

- BookingCard fetches services, selects, filters slots, advance pay
  [`BusinessProfile.jsx:21`](../../apps/carefind/src/modules/business-profiles-reviews/BusinessProfile.jsx#L21)

- Booking handler clash + payment fix handles array/string slots
  [`booking.js:73`](../../apps/carefind/api/_handlers/booking.js#L73)
