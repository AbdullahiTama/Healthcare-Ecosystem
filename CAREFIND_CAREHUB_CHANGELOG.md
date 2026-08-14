# CareFind + CareHub — Changelog

Append-only log for the 5-feature full-stack production program.
Never erase historical entries.

---

## 2026-08-14 — Phase 0: Architecture audit

**What:** Mapped both applications and audited all 5 features end-to-end
(frontend + backend + database + authorization + integration) using parallel
read-only agents plus live-DB probes.

**Findings:**
- **Feature 1 (CareFind Appointment Payment):** Backend is complete and live
  (`booking.js` create/pay-credits, `verify-booking-payment.js`, Paystack
  webhook, `settle_card_booking`/`pay_booking_with_credits` SECURITY DEFINER
  RPCs, `business_wallets` + ledgers). **Root cause of "payment option not
  visible":** `BusinessProfile.jsx:256` fetches the business with a select that
  omits `online_consultation_fee`/`physical_consultation_fee`, so `feeKobo` is
  always undefined and the payment block (`:185–200`) never renders — the
  booking works, but no payment UI ever appears. Also: the Paystack webhook has
  no booking handler, so card-paid bookings settle only via the redirect
  verify path.
- **Feature 2 (CareHub Requisition Save):** DB layer is already fixed and
  verified live — `create_requisition` RPC exists (granted to `authenticated`,
  SECURITY INVOKER) and matches the frontend payload exactly; `requisition_items`
  has `quantity` as `text`; `requisitions` uses `note` (singular). The earlier
  `items`/`numeric quantity` drift was fixed by `20260805_requisition_lines_normalized.sql`
  + `20260811_requisition_items_quantity_text.sql`. Needs end-to-end verification.
- **Feature 3 (CareHub POS Edit Price):** `setPrice` override exists in
  `POS.jsx` (gated by `perms.canEditPrice` — Owner only by default), price
  stored per line in `sales.items` JSONB, receipt uses the stored sale-line
  price. **Gap:** no server-side price authorization — any authenticated
  business member could POST crafted `items` prices directly to `/rest/v1/sales`.
- **Feature 4 (CareHub Bulk Upload):** CSV import + template + batched
  `createMany` + phone dedupe already exist in `Clients.jsx`. Tenant isolation
  via RLS (`current_business_ids`) + repository scoping verified. Known gap:
  no DB unique constraint (dedupe is client-side); `global_client_id` exists
  but unused. Needs end-to-end verification.
- **Feature 5 (CareHub Receipt):** `printReceipt` in `POS.jsx` correctly uses
  the sale-line price. Gaps: no `@page`/print stylesheet/width config (58/80mm),
  no HTML escaping, reprint loses credit/split/cash data, date uses print time,
  `tax_rate` configured but never applied.

**Files created:** CAREFIND_CAREHUB_ARCHITECTURE.md, CAREFIND_CAREHUB_FEATURE_STATUS.md, this changelog.

---

## 2026-08-14 — Feature 1: CareFind Appointment Booking + Payment

**Issue:** "Payment option is not visible at CareFind.app" — clients could book
but never saw or paid the appointment fee.

**Root cause:** `BookingCard` (in `BusinessProfile.jsx`) computed the fee from
`biz.online_consultation_fee`/`biz.physical_consultation_fee`, but the business
`select` at `BusinessProfile.jsx:256` omitted both columns. `feeKobo` was always
undefined → the payment block (`:185–200`) never rendered. Backend (booking.js,
verify-booking-payment.js, settle_card_booking RPC, business_wallets) was
complete and live; only the frontend render path was broken.

**Frontend changes:**
- `apps/carefind/src/modules/business-profiles-reviews/BusinessProfile.jsx`
  - Added `online_consultation_fee, physical_consultation_fee` to the business select.
  - Added `useSearchParams` return handler in `BookingCard`: on Paystack
    redirect back with `reference`/`trxref`, calls `/api/verify-booking-payment`,
    shows confirmation only after the server verifies (never trusts the URL).
- `apps/carefind/api/_handlers/booking.js` — added `callback_url` back to
  `/business/:id?reference=<ref>` on Paystack initialize (amount stays
  server-set).

**Backend changes:**
- `apps/carefind/api/_handlers/paystack-webhook.js` — added `handleBooking()`
  for `charge.success` metadata with `appointment_id`: looks up the appointment,
  cross-checks the Paystack amount against the stored `fee_amount`, calls the
  idempotent `settle_card_booking` RPC, and notifies the business. Closes the
  gap where a client who paid but abandoned the return URL left the appointment
  unpaid.

**Database changes:** none (schema/RPCs already live and verified).

**Authentication/RLS:** unchanged. Booking stays a public form writing via
service-role server handler; verification trusts only the stored fee + Paystack
verify response; `settle_card_booking` is SECURITY DEFINER, service-role only.

**Tests:** full suite 256/257 pass (single failure is the pre-existing
VideoPlayer timing flake, passes in isolation). Production build clean.

**Manual verification:** live DB confirms fee-configured businesses
(AESTHETIC CLINIC, Test Hospital — QA) exist with booking enabled, so the
payment option renders after this fix. Card payment → Paystack → callback
verification → confirmed; CareCoins path (pay-credits) unchanged and still
verified.

**Known limitations:** Fee visibility still depends on a business having
configured fees; businesses with NULL fees are legitimately free and show no
payment option.

---

## 2026-08-14 — Feature 2: CareHub Requisition Save

**Root cause (pre-existing, DB-side):** earlier requisition saves failed with a
400 because `requisition_items.quantity` was `numeric` while the app posts free
text ("20 packs"), and there was no atomic save path. This was already fixed
live in prior work: `quantity` is now `text`, and `create_requisition` exists
(atomic parent + lines, SECURITY INVOKER, pinned `search_path`, granted to
`authenticated`). Verified the frontend posts the exact payload the RPC
expects, and the RPC executes atomically (transactional test + rollback left no
trace).

**Frontend changes:** none required — `Demand.jsx` `saveReqs()` → `addRequisition()`
calls the RPC with the correct body, shows the real server error, and reloads.

**Backend changes:**
- `apps/carehub/sql/20260814_requisition_preserve_requester.sql` (new, applied
  live) — the RPC now also sets `requisitions.created_by` from the logged-in
  staff member's `full_name` (via `auth.uid()` + `staff.auth_user_id`). Before
  this, every requisition's "Raised by" was empty despite the column existing.

**Database:** `create_requisition` recreated live with the requester lookup;
RLS on `requisitions`, `requisition_items` (via parent) and `staff` all
business-scoped — a member cannot create a requisition for another business.

**Authentication/RLS:** unchanged — SECURITY INVOKER, tenant checked by RLS on
both the parent and lines; the requester lookup is scoped to the caller's own
business.

**Tests:** CareHub suite 288/288 pass; production build clean.

---

## 2026-08-14 — Feature 3: CareHub POS Edit Price

**Issue (audit gap):** the POS UI gates price overrides behind
`perms.canEditPrice` (Owner only by default), but there was **no server-side
price authorization** — any authenticated business member could POST crafted
`items` prices straight to `/rest/v1/sales` and record a sale below catalog
price (or negative), bypassing the UI gate entirely.

**Database changes (new, applied live):**
- `apps/carehub/sql/20260814_guard_sale_item_prices.sql` — `guard_sale_item_prices()`
  (SECURITY INVOKER, pinned `search_path = public`) + `BEFORE INSERT` trigger
  on `sales`. Trusted roles pass through (`postgres`, `service_role`,
  `supabase_admin`, `supabase_auth_admin`, `is_platform_admin()`). For
  everyone else it resolves the caller exactly like the frontend: business
  owner by email → `'Owner'`; else active staff by `auth_user_id` OR email →
  `staff.role`; a custom `roles` row for that business
  (`permissions->>'canEditPrice' = 'true'`) wins, otherwise only
  `role = 'Owner'` may override the catalog price. Negative prices raise
  `check_violation`; unknown product ids are skipped (mirrors the stock
  trigger's never-lose-a-sale policy). Because the trigger is BEFORE INSERT,
  a rejected sale aborts before the AFTER INSERT stock trigger runs — blocked
  sales do not decrement inventory.

**Frontend changes:**
- `apps/carehub/src/modules/pos/repositories/index.js` — `isServerRejection(e)`
  matches `Supabase error (4xx)`; `create()` rethrows server rejections instead
  of silently queueing them; `syncQueued()` now returns `{ synced, rejected }`
  (was a count) so refused offline sales are visible.
- `apps/carehub/src/modules/pos/POS.jsx` — `cleanServerError` helper; `saveSale()`
  toasts the server message then rethrows; `charge()`/`chargeCredit()` save the
  sale BEFORE writing the receipt (previously the receipt rendered then the
  save could fail silently); `holdSale()` keeps the cart intact on rejection.
- `apps/carehub/src/pages/dashboard/BusinessDashboard.jsx` — both `syncQueued`
  callers use the new contract and warn when server-refused offline sales
  remain after a sync.

**Authentication/RLS:** trigger is SECURITY INVOKER — the PostgREST caller's
own RLS still governs row visibility; the trigger only adds per-line price
authorization. Trusted service roles are unaffected.

**Tests:** CareHub suite 291/291 pass (3 new: create rethrows 4xx without
queueing, syncQueued reports rejected, isServerRejection matching); production
build clean.

**Manual verification (live, rolled-back transactions):** (1) Pharmacist
(no canEditPrice) override price 50 vs catalog 10500 → rejected 42501
`Price override not allowed: "NAN 1  4OOG" is priced at 10500 but was recorded
at 50…`; (2) same Pharmacist at catalog price 10500 → allowed; (3) Owner
(`john71688@gmail.com`) override → allowed; (4) custom `roles` row named
`Pharmacist` with `canEditPrice: true` → override allowed (custom role
precedence proven); (5) negative price → rejected 23514 `Invalid sale price`;
(6) line with an unknown product id → allowed and skipped. No test rows left
behind; security advisors report no new findings (trigger absent from
`function_search_path_mutable` / SECURITY DEFINER lints).
