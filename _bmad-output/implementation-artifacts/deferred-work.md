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
  evidence: The pure classification is tested (velocity.test.js) and the NotificationBell is component-tested, but the effect wiring in DashboardHome.jsx (localStorage dedupe keys, markSent-after-await ordering) has no test — no module-level component harness exists (no @testing-library/react); same rationale as the Purchases save() entry above.
- source_spec: `_bmad-output/implementation-artifacts/spec-issues-1-to-8-batch-fixes.md`
  summary: Pre-existing advisor findings left untouched by this batch — SECURITY DEFINER views (staff_directory, professional_earnings), mutable search_path on legacy functions (handle_new_user, increment_*_view), anon-executable definer RPCs (register_business, attempt_staff_claim, etc.), pg_trgm in public schema, leaked-password protection disabled.
  evidence: All present before this work; fixing them is a dedicated hardening pass, not a drive-by inside an issue-batch spec.
- source_spec: _bmad-output/implementation-artifacts/spec-escpos-receipt-printing.md
  summary: Support choosing among multiple paired USB printers instead of always using the first device.
  evidence: POS.jsx picks getPairedPrinters()[0] with no chooser; a user with two thermal printers has no way to switch — surfaced in blind-hunter review of POS.jsx:444.
- source_spec: _bmad-output/implementation-artifacts/spec-escpos-receipt-printing.md
  summary: Broaden WebUSB discovery to include vendor-specific (0xFF) printers so more thermal models are offered.
  evidence: escposUsb.js filters to classCode 7 only; many ESC/POS thermals expose vendor class and are hidden from the picker — blind-hunter noted class-7 filter hides most hardware.
- source_spec: _bmad-output/implementation-artifacts/spec-escpos-receipt-printing.md
  summary: Add an automated parity check that HTML and ESC/POS receipt builders render the same business/items/totals/tax/payment/footer from one contract.
  evidence: Both builders consume { receipt, business, settings } but no test asserts identical output; drift could ship — blind-hunter flagged missing parity enforcement.
- source_spec: _bmad-output/implementation-artifacts/spec-escpos-receipt-printing.md
  summary: Add structured observability for direct-print success vs fallback vs mid-transfer failure to validate the faint/blurry fix.
  evidence: Current code logs only console.error and toasts; no counters or error codes to measure whether ESC/POS actually replaces rasterized prints — blind-hunter review.
- source_spec: _bmad-output/implementation-artifacts/spec-escpos-receipt-printing.md
  summary: Add timeout/abort handling for hanging USB operations (open/claim/transfer) to avoid a stuck Sending state.
  evidence: printEscpos can hang indefinitely with no timeout; printing flag stays true and both Print buttons remain disabled — blind-hunter review of escposUsb.js:63.
- source_spec: _bmad-output/implementation-artifacts/spec-escpos-receipt-printing.md
  summary: Add component-level test harness (@testing-library/react) and cover POS.jsx printReceipt branching plus Recent-sales reprint mapping.
  evidence: All 28 helper tests inject usb/device mocks and never drive POS.jsx; verification-gap review showed no test observes the WebUSB-first decision matrix, duplicate-receipt guard, printing lock, or the sales-row to receipt-object reconstruction — repo has no component test harness.
- source_spec: none
  summary: Pricing Structure update — Basic ₦60k/yr (2 locs/5 staff/5k products), Growth ₦100k/yr (5 locs), Premium ₦150k/yr (10 locs), Enterprise ₦250k/yr (30 locs), Custom; hospitals start at Growth.
  evidence: Split from CareFindHub Phase 2 Corrections mega-intent (5 goals) — pricing is isolated to planLimits + subscription enforcement + billing display, independently shippable from email/appointments/wallet/referrer.
- source_spec: none
  summary: Appointment & Service Booking — services CRUD, fees, dates/slots, customer selection, advance payment, slot unavailability, payment fix on business profile.
  evidence: Split from CareFindHub Phase 2 Corrections — appointment booking is isolated to Settings/services/booking domain, independently shippable from email/pricing/wallet/referrer.
- source_spec: none
  summary: Wallet & Payment — business wallet section (payments received, transaction history, available balance, withdrawal) + functional payment options + appointment payment connectivity.
  evidence: Split from CareFindHub Phase 2 Corrections — wallet/payments is isolated to finance/wallet domain, independently shippable from email/pricing/appointments/referrer.
- source_spec: none
  summary: Referrer System — unique referrer codes, Referrer Code/No Referrer field at registration, auto-link, referrer dashboard (referred businesses, earnings paid/outstanding), admin tracking/commissions.
  evidence: Split from CareFindHub Phase 2 Corrections — referral is isolated to registration/referral domain, independently shippable from email/pricing/appointments/wallet.
