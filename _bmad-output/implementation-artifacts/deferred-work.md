- source_spec: `_bmad-output/implementation-artifacts/spec-purchase-expiry-live.md`
  summary: Add an index for products.expiry_date (migration comment claims one but none exists).
  evidence: The migration comment `-- Indexed for expiry queries` has no matching CREATE INDEX; surfaced during blind-hunter review. Stock expiry alerts query stock_batches, so this is optional.
- source_spec: `_bmad-output/implementation-artifacts/spec-purchase-expiry-live.md`
  summary: Add a trigger/backfill to keep products.expiry_date in sync with stock_batches as a denormalized quick reference.
  evidence: products.expiry_date is described as a quick-reference of batch expiry but nothing updates it when batches change; pre-existing committed design surfaced during review.
- source_spec: `_bmad-output/implementation-artifacts/spec-purchase-expiry-live.md`
  summary: Add component-level test coverage for the Purchases save() wiring (purchaseExpirySummary result -> create body).
  evidence: The helper and repository pass-through are unit-tested, but the save() handler in Purchases.jsx that wires them is not, and the repo has no component-test harness for modules (no @testing-library/react).
- source_spec: none
  summary: Fix staff login rejecting freshly created staff accounts with correct credentials (loginStaff validation path, atomic staff+password creation, clearer error messaging).
  evidence: Split from Sajel Pharma bug report so the ESC/POS receipt printing fix could ship independently; disjoint subsystems (auth vs printing).
- source_spec: `_bmad-output/implementation-artifacts/spec-issues-1-to-8-batch-fixes.md`
  summary: Component-level test for DashboardHome proactive-alert effects (daily dedupe, notify payloads, owner-only gate).
  evidence: The pure classification is tested (velocity.test.js) and the NotificationBell is component-tested, but the effect wiring in DashboardHome.jsx (localStorage dedupe keys, markSent-after-await ordering) has no test â€” no module-level component harness exists (no @testing-library/react); same rationale as the Purchases save() entry above.
- source_spec: `_bmad-output/implementation-artifacts/spec-issues-1-to-8-batch-fixes.md`
  summary: Pre-existing advisor findings left untouched by this batch â€” SECURITY DEFINER views (staff_directory, professional_earnings), mutable search_path on legacy functions (handle_new_user, increment_*_view), anon-executable definer RPCs (register_business, attempt_staff_claim, etc.), pg_trgm in public schema, leaked-password protection disabled.
  evidence: All present before this work; fixing them is a dedicated hardening pass, not a drive-by inside an issue-batch spec.
- source_spec: _bmad-output/implementation-artifacts/spec-escpos-receipt-printing.md
  summary: Support choosing among multiple paired USB printers instead of always using the first device.
  evidence: POS.jsx picks getPairedPrinters()[0] with no chooser; a user with two thermal printers has no way to switch â€” surfaced in blind-hunter review of POS.jsx:444.
- source_spec: _bmad-output/implementation-artifacts/spec-escpos-receipt-printing.md
  summary: Broaden WebUSB discovery to include vendor-specific (0xFF) printers so more thermal models are offered.
  evidence: escposUsb.js filters to classCode 7 only; many ESC/POS thermals expose vendor class and are hidden from the picker â€” blind-hunter noted class-7 filter hides most hardware.
- source_spec: _bmad-output/implementation-artifacts/spec-escpos-receipt-printing.md
  summary: Add an automated parity check that HTML and ESC/POS receipt builders render the same business/items/totals/tax/payment/footer from one contract.
  evidence: Both builders consume { receipt, business, settings } but no test asserts identical output; drift could ship â€” blind-hunter flagged missing parity enforcement.
- source_spec: _bmad-output/implementation-artifacts/spec-escpos-receipt-printing.md
  summary: Add structured observability for direct-print success vs fallback vs mid-transfer failure to validate the faint/blurry fix.
  evidence: Current code logs only console.error and toasts; no counters or error codes to measure whether ESC/POS actually replaces rasterized prints â€” blind-hunter review.
- source_spec: _bmad-output/implementation-artifacts/spec-escpos-receipt-printing.md
  summary: Add timeout/abort handling for hanging USB operations (open/claim/transfer) to avoid a stuck Sending state.
  evidence: printEscpos can hang indefinitely with no timeout; printing flag stays true and both Print buttons remain disabled â€” blind-hunter review of escposUsb.js:63.
- source_spec: _bmad-output/implementation-artifacts/spec-escpos-receipt-printing.md
  summary: Add component-level test harness (@testing-library/react) and cover POS.jsx printReceipt branching plus Recent-sales reprint mapping.
  evidence: All 28 helper tests inject usb/device mocks and never drive POS.jsx; verification-gap review showed no test observes the WebUSB-first decision matrix, duplicate-receipt guard, printing lock, or the sales-row to receipt-object reconstruction â€” repo has no component test harness.
- source_spec: _bmad-output/implementation-artifacts/spec-carefind-appointment-booking-hardening.md
  summary: Add rate limiting and bot protection to public booking endpoint
  evidence: Public POST /api/booking has no throttle per IP/phone; blind-hunter flagged as abuse vector — pre-existing, not in spec acceptance criteria, requires infra decision (e.g., Upstash, Turnstile).

- source_spec: _bmad-output/implementation-artifacts/spec-carefind-appointment-booking-hardening.md
  summary: Implement TTL/expiry for unpaid pending appointments and held balance cleanup
  evidence: Unpaid pending appointments block slots indefinitely with no timeout; spec §10 defers cancellation policy to product — surfaced in blind-hunter review.

- source_spec: _bmad-output/implementation-artifacts/spec-carefind-appointment-booking-hardening.md
  summary: Implement wallet refund/reversal on appointment cancellation
  evidence: free_slot_on_cancel frees service_availability but no wallet held?refund movement; spec §10 defers refund policy — blind-hunter flagged as missing reversal.

- source_spec: _bmad-output/implementation-artifacts/spec-carefind-appointment-booking-hardening.md
  summary: Enforce strict appointment status transition state machine at DB level
  evidence: Direct PATCH via appointmentRepository.update allows any status transition; confirm RPC guards pending?confirmed but other paths do not — blind-hunter noted missing state machine, requires product-defined allowed transitions.

- source_spec: _bmad-output/implementation-artifacts/spec-carefind-appointment-booking-hardening.md
  summary: Add patient-facing booking confirmations and cancellation notifications
  evidence: Business is notified on confirm, but patient receives no creation/cancel notification; spec §11 says integrate where available — requires product channel decision.

- source_spec: _bmad-output/implementation-artifacts/spec-carefind-appointment-booking-hardening.md
  summary: Add handler-level tests for booking service validation, fee snapshot, and concurrent 409
  evidence: Verification-gap review found POST /api/booking service active/fee/availableTimes branches and double-book 409 have no executing test — requires api test harness not present in repo.

- source_spec: _bmad-output/implementation-artifacts/spec-carefind-appointment-booking-hardening.md
  summary: Add component tests for BookingCard availability filtering and review dialog
  evidence: BusinessProfile BookingCard per-service availability filtering, past-time drop, and review dialog 409 refresh have no observable test — verification-gap noted no BusinessProfile.test file.
- source_spec: none
  summary: Shop Goal 2 — Shop browse grid + product gallery (MedMarket 4th tab Shop, 2-per-row catalog + featured row, multi-photo swipe gallery)
  evidence: Split from Shop spec per SCOPE STANDARD — independently shippable browse without checkout; deferred to keep Goal 1 (onboarding+activation) as single 900-1600 token spec.

- source_spec: none
  summary: Shop Goal 3 — Cart, Checkout, Orders + inventory sync (cart, stock re-check, order creation with price snapshot, vendor notification, order management)
  evidence: Split from Shop spec per SCOPE STANDARD — requires Goal 1 tables (ecommerce_products) but shippable after; deferred.

- source_spec: none
  summary: Shop Goal 4 — Pickup-station pricing engine (commission 10/5/2.5, fulfilment MAX, delivery FREE =3km else ?600/3km, Maps distance)
  evidence: Split from Shop spec per SCOPE STANDARD — pure engine testable before checkout wiring; deferred per user choice Pure engine first, but after Goal 1.
