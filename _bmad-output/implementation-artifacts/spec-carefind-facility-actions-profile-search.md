---
title: 'Fix facility actions to View Profile / Book Appointment and add per-business profile search'
type: 'bugfix'
created: '2026-09-04'
status: 'done'
baseline_commit: '9310e008881fdde52c71d178330ef52e73c6c11e'
review_loop_iteration: 0
context:
  - 'apps/carefind/src/modules/healthcare-discovery/Search.jsx'
  - 'apps/carefind/src/modules/business-profiles-reviews/BusinessProfile.jsx'
  - 'apps/carefind/api/_handlers/booking.js'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Facility cards show WhatsApp/Call as primary actions, but discovery intent is View Profile / Book Appointment via existing CareFind booking workflow; facility profiles lack internal search for that business’s products/services.

**Approach:** Replace facility card primary actions with View Profile + Book Appointment (existing workflow, with unavailable message + notification when not accepting), remove WhatsApp/Call from facility context, and add per-business search within View Profile covering that business’s products/services only.

## Boundaries & Constraints

**Always:** Reuse existing CareFind appointment workflow (`BusinessProfile.jsx:109 BookingCard`, `api/_handlers/booking.js:55` validation, `book_appointment_slot` RPC, `staff_notifications kind:booking_created`); keep `visible_on_carefind`/`status=active` gating; keep product `list_on_carefind` filtering.

**Ask First:** Adding new `staff_notifications` kind or `contact_leads` channel for booking-unavailable interest; changing `businesses.booking_enabled` default.

**Never:** Create separate appointment system; allow booking flow to proceed when `booking_enabled=false`; turn profile search into global CareFind search; expose WhatsApp/Call as facility discovery primary actions.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Facility with booking | `booking_enabled=true` | Card shows View Profile + Book Appointment enabled; tap Book opens existing booking flow (service/slot/date/time) and succeeds via `/api/booking` | Slot taken → 409 + refresh availability |
| Facility without booking | `booking_enabled=false` | Card shows View Profile + Book Appointment disabled; tap shows “This healthcare facility is not accepting appointments at the moment.” and notifies facility interest (non-blocking) | No booking form opened |
| View Profile | Tap View Profile | Navigate to `/business/:id` profile | N/A |
| Profile search | Type query in profile search | Filters only that business’s `products` (`name/generic_name`) and `business_services` (`name`) client-side; shows filtered count, empty state if none | No global results; no navigation away |
| Booking unavailable notification | User taps disabled Book | Facility receives `staff_notifications` (owner) `kind:booking_interest` | Never blocks UI; best-effort |

</frozen-after-approval>

## Code Map

- `apps/carefind/src/modules/healthcare-discovery/Search.jsx:125-132,522-545` -- `businessesQuery` selects `whatsapp,phone` but not `booking_enabled`; business card actions `(bizWa||bizCall)` at 541 render WhatsApp/Call + `recordContactLead`; must extend select to `booking_enabled`, replace actions with View Profile (`/business/:id`) + Book Appointment (enabled→navigate, disabled→toast + `booking_interest` notify).
- `apps/carefind/src/modules/business-profiles-reviews/BusinessProfile.jsx:535-594,651-741,856-901` -- `loadAll` fetches `products` (no search), `BookingCard:109` hidden when `!booking_enabled:856`; sidebar/mobile WhatsApp/Call at 708/813; must remove WhatsApp/Call from facility block, keep Directions, add profile search input above Available Products/Services, filter `products`/`business_services` locally, and show disabled Book + unavailable message + notify when not accepting.
- `apps/carefind/api/_handlers/booking.js:55-122,355-369` -- validates `booking_enabled` → 403, slot `availableTimes` vs `slots`, `notifyBusiness` inserts `staff_notifications kind:booking_created`; reuse for interest notification (new `kind:booking_interest` or `booking_unavailable`).
- `apps/carefind/src/modules/utils/marketplace.js:23` -- `whatsappLink/telLink` keep for CareHub but remove from facility cards; `contactLeads.js:16` `recordContactLead` becomes dead for facility context.

## Tasks & Acceptance

**Execution:**
- [x] `apps/carefind/src/modules/healthcare-discovery/Search.jsx` -- extend `businessesQuery:126` select to `booking_enabled`; replace business card `(bizWa||bizCall)` 541 with View Profile (`Link to /business/:id`) + Book Appointment button (if `b.booking_enabled` navigate to `/business/:id#booking` else toast “This healthcare facility is not accepting appointments at the moment.” + best-effort `staff_notifications` interest via `/api/booking-interest` or direct `contact_leads`); remove WhatsApp/Call imports/usages `17,522,541` from facility context; keep product cards similarly (View Profile of business).
- [x] `apps/carefind/src/modules/business-profiles-reviews/BusinessProfile.jsx` -- remove WhatsApp/Call anchors `651,708,813` from facility profile header/actions (keep Directions); make `BookingCard` always render but disabled when `!booking_enabled` with unavailable message + interest notify; add per-business search: state `query`, input `aria-label="Search products and services in this facility"` above products/services, filter `products.filter(p=> name|generic_name includes query)` and `services.filter(s=> name includes query)` client-side, show `Empty` with "No products/services found in this facility" and result count `aria-live`.
- [x] `apps/carefind/api/_handlers/booking-interest.js` (new) or reuse `notifyBusiness` -- endpoint to insert `staff_notifications {business_id, is_owner:true, kind:'booking_interest', title:'Booking interest', body: query/client info, link:'/dashboard/appointments'}` for unavailable case; rate-limit similar to `contactLeads.js:19`; never block booking UI.
- [x] `apps/carefind/src/modules/healthcare-discovery/Search.test.jsx` + `BusinessProfile.test.jsx` (new) -- tests: facility card shows View Profile + Book enabled/disabled; disabled Book shows unavailable toast and no navigation to booking; profile search filters only that business’s products/services and not global.

**Acceptance Criteria:**
- Given facility cards in Health Facilities, when viewed, then primary actions are View Profile and Book Appointment (no WhatsApp/Call as primaries)
- Given Book Appointment for facility with `booking_enabled=true`, when tapped, then existing booking workflow opens and can succeed
- Given facility with `booking_enabled=false`, when tapping Book, then message “This healthcare facility is not accepting appointments at the moment.” appears and no booking form proceeds, and facility owner receives interest notification
- Given View Profile of a facility and typing in profile search, when searching for known product/service, then only that facility’s matching offerings are returned (not global)

## Spec Change Log

## Design Notes

Reuse `BusinessProfile.jsx:856` `biz.booking_enabled` guard but invert: render disabled card instead of hiding. Interest notification is best-effort `staff_notifications` (service-role) similar to `booking.js:355`; do not use `contact_leads` WhatsApp channel for facility discovery.

## Verification

**Commands:**
- `npm test -- src/modules/healthcare-discovery/Search.test.jsx src/modules/business-profiles-reviews/BusinessProfile.test.jsx` -- expected: facility actions View Profile/Book, disabled unavailable message, profile search filters only business
- `npm run build` (apps/carefind) -- expected: vite build clean

## Suggested Review Order

**Facility card — primary actions**

- Extend `businessesQuery` to `booking_enabled` and replace WhatsApp/Call with View Profile + Book
  [`Search.jsx:125`](../../apps/carefind/src/modules/healthcare-discovery/Search.jsx#L125)

- Book enabled navigates to `#booking`, disabled toasts unavailable + notifies interest
  [`Search.jsx:521`](../../apps/carefind/src/modules/healthcare-discovery/Search.jsx#L521)

**Profile — booking and search**

- Remove WhatsApp/Call, keep Directions, BookingCard disabled with unavailable message
  [`BusinessProfile.jsx:708`](../../apps/carefind/src/modules/business-profiles-reviews/BusinessProfile.jsx#L708)

- Per-business search input filtering products/services client-side with `aria-live` count
  [`BusinessProfile.jsx:872`](../../apps/carefind/src/modules/business-profiles-reviews/BusinessProfile.jsx#L872)

**Interest notification**

- New `booking-interest` handler inserts `staff_notifications kind:booking_interest` best-effort
  [`booking-interest.js:1`](../../apps/carefind/api/_handlers/booking-interest.js#L1)

**Tests**

- Facility actions View Profile/Book enabled/disabled and profile search isolation
  [`Search.test.jsx:1`](../../apps/carefind/src/modules/healthcare-discovery/Search.test.jsx#L1)
