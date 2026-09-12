---
title: 'CareFind Appointment Booking — Atomic Booking, Wallet and Service Hardening'
type: 'feature'
created: '2026-08-29'
status: 'done'
baseline_commit: '36e88c01e75db7e44a6b4722c63492931c5c1dca'
review_loop_iteration: 1
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** CareFind appointment booking lacks enterprise correctness: services need reusable per-business catalog with soft-delete, time slots must be date-specific and prevent overlaps/past booking, concurrent booking attempts can double-book a single slot, and appointment revenue must be held pending until owner confirmation releases it to available balance.

**Approach:** Harden existing business_services/service_availability and appointments/wallet plumbing into a complete end-to-end workflow reusing CareHub ownership, Paystack verification and wallet ledger: owner manages services and date-specific slots, patient selects active service + available slot + pays, backend atomically creates appointment and marks slot booked with row-level locking, payment creates pending wallet entry, owner confirm flips to available.

## Boundaries & Constraints

**Always:** All business-owner endpoints verify ownership via current_business_ids() or is_platform_admin(); patient endpoints scope to own appointments only. Never trust frontend price — read service price server-side and snapshot fee_amount. Verify payment server-side before paid status. Derive pending/available balances from ledger, not cached field. Use DB transactions + row-level locking or unique constraints to prevent double-booking. Keep audit trail — never delete financial transactions. Validate name non-empty, price >=0, end > start, no overlapping slots for same business/service. Block past dates.

**Ask First:** Cancellation/refund/no-show/rescheduling automation requires product approval before wiring — keep model extensible but don't automate deductions until policy decided. Platform fee/commission handling.

**Never:** Physically delete services referenced by appointments — soft-deactivate only. Don't rely only on frontend availability checks. Don't mark paid from frontend callback. Don't delete wallet transactions. Don't use single-slot hard-coded sample data — all lists from real backend.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|---------------|----------------------------|----------------|
| Create service | Owner POST name+price to business_services | Row created with business_id, is_active true, price_kobo in kobo | 400 if name empty or price <0 |
| Edit service price | PATCH price | Future bookings use new price; historical appointments keep fee_amount snapshot | Validate non-negative; log change |
| Deactivate service | PATCH is_active false / soft-delete | Inactive not returned to patients, historical appointments unchanged | Block hard DELETE if referenced; return 409 |
| Create slot | Owner adds date+start+end for service | Slot created if no overlap, date >= today, end>start | 400 overlap/past/invalid times |
| List active services | Patient GET /businesses/:id/services | Only is_active true services | Empty state if none |
| List available slots | Patient GET services/:id/timeslots/available?date= | Only available slots where service active and date >= today | Exclude booked, past |
| Concurrent booking | Two patients pay same slot simultaneously | Only one succeeds; second gets 409 "already taken" | Transaction + SELECT FOR UPDATE + unique constraint |
| Pay booking | Patient POST pay with Paystack ref | Server verifies with Paystack, creates appointment pending + wallet pending | 400 if verify fails; idempotent on duplicate webhook |
| Confirm appointment | Owner POST appointments/:id/confirm | Appointment pending→confirmed, wallet pending→confirmed, released_at set | 403 if not owner; 400 if not eligible; atomic |
| Wallet balances | Ledger with pending+confirmed | pending = sum pending credits, available = sum confirmed - refunds - withdrawals | Derived, not cached |

</frozen-after-approval>

## Code Map

- `apps/carehub/sql/20260828_business_services.sql:1` -- Migration NOT YET APPLIED for business_services + service_availability; harden with constraints and indexes.
- `apps/carehub/src/modules/settings/repositories/index.js:100` -- settingsRepository service/availability methods; add soft-delete, validation, overlap guard.
- `apps/carehub/src/modules/settings/Settings.jsx:330` -- Services + availability UI; add loading/error/empty/a11y, validation.
- `apps/carefind/src/modules/business-profiles-reviews/BusinessProfile.jsx:21` -- BookingCard patient flow; filter active services/available slots, review screen.
- `apps/carefind/api/_handlers/booking.js:1` -- Booking handler; needs atomic RPC, price snapshot, slot lock, idempotency.
- `apps/carefind/api/_handlers/verify-booking-payment.js:1` -- Paystack verify + settle_card_booking; ensure idempotency.
- `apps/carehub/src/modules/appointments/Appointments.jsx:14` -- Owner list + confirm; wire pending→confirmed wallet release.
- `apps/carehub/sql/20260811_business_wallets_and_booking_payments.sql:1` -- Wallet ledger held/available + trigger; pending→available logic.
- `apps/carehub/src/modules/appointments/repositories/index.js:1` -- Tenant-scoped appointmentRepository.
- `apps/carehub/src/modules/wallet/Wallet.jsx:1` -- Wallet dashboard pending/available.

## Tasks & Acceptance

**Execution:**
- [x] `apps/carehub/sql/20260828_business_services.sql` -- Harden migration with price>=0, end>start, date>=today, unique (business_id,service_id,date,time) + RLS indexes, updated_at trigger.
- [x] `apps/carehub/src/modules/settings/repositories/index.js` -- Validate name/price, soft-delete via is_active, reject overlapping/past slots, add available-slots helper.
- [x] `apps/carehub/src/modules/settings/Settings.jsx` -- Add/form validation, loading/error/empty/a11y, inactive toggle, booked vs available distinction, responsive layout.
- [x] `apps/carefind/api/_handlers/booking.js` -- Atomic booking via SELECT FOR UPDATE or RPC: snapshot price server-side, check is_active, store fee_amount, mark slot booked, 409 on clash, idempotent ref.
- [x] `apps/carefind/src/modules/business-profiles-reviews/BusinessProfile.jsx` -- Only active services + available slots, review screen, Pay Now, disable booked/past, handle 409 refresh.
- [x] `apps/carehub/src/modules/appointments/Appointments.jsx` -- Confirm flips pending→confirmed and pending wallet→available atomically; show balances from ledger.
- [x] `apps/carehub/sql/20260811_business_wallets_and_booking_payments.sql` -- Ensure trigger moves held→available only on eligible confirm; add status if needed.

**Acceptance Criteria:**
- Given owner creates service with name and price, when saved, then service appears active and is fetchable as available to patients, and Given price is later changed, when viewing historical appointment then fee_amount remains original snapshot
- Given owner deactivates service, when patient lists services then inactive not shown, and historical appointments still reference original service
- Given two patients attempt to pay for same slot at same instant, when handlers run concurrently then only one appointment occupies the slot and the other receives 409, and no duplicate wallet credit occurs
- Given patient selects service and pays verified via Paystack, when verification succeeds then appointment created pending with payment_reference and wallet transaction pending (not withdrawable), and pending balance includes it
- Given owner confirms eligible pending appointment, when confirm succeeds then appointment status confirmed and linked wallet transaction moves to confirmed and amount becomes available for withdrawal, atomically
- Given owner tries to create overlapping slot or past date, when submitted then system rejects with validation error and no slot created
- Given patient views slots for service, when service inactive or slot booked/past then slot not selectable
- Given duplicate payment webhook with same reference, when processed then no duplicate appointment or wallet entry created (idempotent)

## Spec Change Log


## Design Notes

Reuse current_business_ids(), Paystack verify pattern, and wallet ledger (held/available). Composition: Settings=catalog, booking handler=atomic booking, Appointments=confirm, Wallet=balances.

## Verification

**Commands:**
- `npm run build --workspace=apps/carehub` -- clean
- `npm test --workspace=apps/carehub` -- all repo tests pass
- `npm run build --workspace=apps/carefind` -- clean
- `npm test --workspace=apps/carefind` -- pass

**Manual checks:**
- Create→deactivate service → patient hidden, history keeps price
- Overlapping/past slot rejected → concurrent booking 409
- Paid pending → confirm → available balance increases

## Suggested Review Order

**Atomic booking & wallet — the heart of the feature**

- RPC that locks service + slot and inserts appointment atomically, server price snapshot
  [`20260828_business_services.sql:200`](../../apps/carehub/sql/20260828_business_services.sql#L200)

- Public booking handler — validation, availability check, RPC with 409 mapping and idempotent reference
  [`booking.js:79`](../../apps/carefind/api/_handlers/booking.js#L79)

- Confirm RPC — pending→confirmed with held→available move and released_at guard
  [`20260828_business_services.sql:267`](../../apps/carehub/sql/20260828_business_services.sql#L267)

- Owner confirm UI — uses confirm RPC, refreshes wallet, shows revenue moved toast
  [`Appointments.jsx:108`](../../apps/carehub/src/modules/appointments/Appointments.jsx#L108)

**Validation & constraints**

- Service and availability validation — HH:MM hour/minute range, past-date local, end>start, duplicate guard
  [`repositories/index.js:183`](../../apps/carehub/src/modules/settings/repositories/index.js#L183)

- Migration constraints — price>=0, name not empty, overlap index, payment_reference unique, slot sync triggers
  [`20260828_business_services.sql:13`](../../apps/carehub/sql/20260828_business_services.sql#L13)

- Public RLS — services is_active=true, availability available-only
  [`20260828_business_services.sql:149`](../../apps/carehub/sql/20260828_business_services.sql#L149)

**Patient and owner UX**

- BookingCard — service availability fetch, effectiveSlotList, past filtering, review dialog with ESC/focus
  [`BusinessProfile.jsx:48`](../../apps/carefind/src/modules/business-profiles-reviews/BusinessProfile.jsx#L48)

- Settings Services — soft-deactivate, reactivation, booked vs available pills, error/empty states
  [`Settings.jsx:489`](../../apps/carehub/src/modules/settings/Settings.jsx#L489)

- Appointment repository — tenant-scoped confirm with RPC fallback
  [`repositories/index.js:42`](../../apps/carehub/src/modules/appointments/repositories/index.js#L42)

**Tests & supporting**

- Service repository tests — active filter, validation, soft-delete, overlap guards
  [`index.test.js:170`](../../apps/carehub/src/modules/settings/repositories/index.test.js#L170)

- Appointment repository tests — confirm RPC fallback, service/timeslot snapshot
  [`index.test.js:83`](../../apps/carehub/src/modules/appointments/repositories/index.test.js#L83)

- Nav counts — wallet + mastercatalog reflected in expected lengths
  [`permissions.test.js:241`](../../apps/carehub/src/lib/__tests__/permissions.test.js#L241)

