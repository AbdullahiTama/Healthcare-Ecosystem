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
- source_spec: _bmad-output/implementation-artifacts/spec-carefind-appointment-booking-hardening.md
  summary: Add rate limiting and bot protection to public booking endpoint
  evidence: Public POST /api/booking has no throttle per IP/phone; blind-hunter flagged as abuse vector — pre-existing, not in spec acceptance criteria, requires infra decision (e.g., Upstash, Turnstile).

- source_spec: _bmad-output/implementation-artifacts/spec-carefind-appointment-booking-hardening.md
  summary: Implement TTL/expiry for unpaid pending appointments and held balance cleanup
  evidence: Unpaid pending appointments block slots indefinitely with no timeout; spec 10 defers cancellation policy to product — surfaced in blind-hunter review.

- source_spec: _bmad-output/implementation-artifacts/spec-carefind-appointment-booking-hardening.md
  summary: Implement wallet refund/reversal on appointment cancellation
  evidence: free_slot_on_cancel frees service_availability but no wallet held refund movement; spec 10 defers refund policy — blind-hunter flagged as missing reversal.

- source_spec: _bmad-output/implementation-artifacts/spec-carefind-appointment-booking-hardening.md
  summary: Enforce strict appointment status transition state machine at DB level
  evidence: Direct PATCH via appointmentRepository.update allows any status transition; confirm RPC guards pending confirmed but other paths do not — blind-hunter noted missing state machine, requires product-defined allowed transitions.

- source_spec: _bmad-output/implementation-artifacts/spec-carefind-appointment-booking-hardening.md
  summary: Add patient-facing booking confirmations and cancellation notifications
  evidence: Business is notified on confirm, but patient receives no creation/cancel notification; spec 11 says integrate where available — requires product channel decision.

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
  summary: Shop Goal 4 — Pickup-station pricing engine (commission 10/5/2.5, fulfilment MAX, delivery FREE =3km else 600/3km, Maps distance)
  evidence: Split from Shop spec per SCOPE STANDARD — pure engine testable before checkout wiring; deferred per user choice Pure engine first, but after Goal 1.
- source_spec: `_bmad-output/implementation-artifacts/spec-ecommerce-terms-mandatory-approval.md`
  summary: Integration test for RLS hard gate (unapproved POST via PostgREST rejected 42501) and DELETE gate for ecommerce_products/images
  evidence: In-memory adapter does not evaluate is_ecommerce_vendor_approved; blind-hunter and verification-gap flagged that dropping WITH CHECK would still pass all 41 unit tests — requires Supabase live/PostgREST integration harness not present.

- source_spec: `_bmad-output/implementation-artifacts/spec-ecommerce-terms-mandatory-approval.md`
  summary: Component test for Ecommerce.jsx mandatory gate (segment-specific terms, Apply disabled until checkbox, blocked banner and CTA scroll)
  evidence: Verification-gap found no render test for Ecommerce.jsx — retail 10% vs wholesale 5% vs distributor 2.5% disclosure, disabled Apply, and Setup Locked vs E_COMMERCE_NOT_APPROVED — repo has no component harness for CareHub modules beyond repository tests.

- source_spec: `_bmad-output/implementation-artifacts/spec-ecommerce-terms-mandatory-approval.md`
  summary: Backfill and NOT NULL hardening for existing ecommerce_applications after adding segment/terms_version_id/audit columns
  evidence: Migration adds nullable columns with no backfill; legacy rows remain ambiguous for is_ecommerce_vendor_approved and audit trail — requires data backfill decision and follow-up NOT NULL constraints per review defer.

- source_spec: `_bmad-output/implementation-artifacts/spec-ecommerce-terms-mandatory-approval.md`
  summary: Server-side audit enforcement (auth.uid() for applicant_user_id, commission_rate parity trigger, audit_metadata JSON schema)
  evidence: applicant_user_id and audit_metadata currently trusted from client getSession; blind-hunter flagged spoofable audit and commission drift between terms row and accepted rate — needs DB trigger/RPC to stamp auth.uid() and validate parity server-side.
- source_spec: none
  summary: Fix external sharing deep linking so WhatsApp preview card deep-links to original CareFind post (OG tags, preview)
  evidence: Split from CareFind QA compilation per SCOPE STANDARD — independently shippable OG/metadata concern; deferred to ship Drawing auto-publish fix first as recommended critical data-integrity goal.
- source_spec: none
  summary: Fix Health Facility search actions to View Profile/Book Appointment and add per-business profile product/service search
  evidence: Split from CareFind QA compilation per SCOPE STANDARD — facility search UX + booking integration; deferred to ship Drawing auto-publish first.
- source_spec: none
  summary: Preserve post/article rich-text colours/highlights and formatting parity from editor to published render
  evidence: Split from CareFind QA compilation per SCOPE STANDARD — rich-text pipeline editor→storage→renderer; deferred per recommended order.
- source_spec: none
  summary: Allow up to 5 images per post with multi-image layout/carousel and sixth-image guard
  evidence: Split from CareFind QA compilation per SCOPE STANDARD — media upload/storage concern; deferred per recommended order.
- source_spec: none
  summary: Increase video duration to 2 minutes and fix audio preservation/sync and playback controls
  evidence: Split from CareFind QA compilation per SCOPE STANDARD — video pipeline upload/transcode/storage/playback; deferred per recommended order (critical but after Drawing).
- source_spec: none
  summary: Fix News submission reaching Admin queue (pending → Admin review → Approve/Reject → publish) with count indicator
  evidence: Split from CareFind QA compilation per SCOPE STANDARD — news submission workflow API/DB/Admin UI; deferred per recommended order (critical).
- source_spec: none
  summary: Show News preview engagement controls (Like/Comment/Share/Repost) and fix comment save/display
  evidence: Split from CareFind QA compilation per SCOPE STANDARD — engagement row UI + API; deferred.
- source_spec: none
  summary: Make scheduled Live events manageable (edit title/reschedule/delete, lifecycle Scheduled→Upcoming→Live→Ended)
  evidence: Split from CareFind QA compilation per SCOPE STANDARD — live event lifecycle; deferred.
- source_spec: none
  summary: Make Stories discoverable across avatars with indicator ring, tap-to-open, engagement and owner analytics
  evidence: Split from CareFind QA compilation per SCOPE STANDARD — stories cross-surface ring + analytics; deferred.
- source_spec: `_bmad-output/implementation-artifacts/spec-withdrawal-validation-and-account-resolve-fix.md`
  summary: Extract shared useAccountResolve and useBanks hooks to eliminate duplicated account-resolution and bank-loading effects across CareFind Wallet, CareHub Wallet, and CareHub Appointments.
  evidence: Three components carry identical ~35-line debounced resolve useEffect and loadBanks useEffect; blind-hunter flagged drift surface — pre-existing duplication, not caused by this fix.
- source_spec: `_bmad-output/implementation-artifacts/spec-withdrawal-validation-and-account-resolve-fix.md`
  summary: Deduplicate disabled/opacity expressions in CareHub Wallet and Appointments withdraw buttons (same long condition repeated twice per file).
  evidence: The disabled prop and opacity ternary copy-paste the same guard; any future change must update both or they drift — pre-existing pattern, not caused by this fix.
- source_spec: `_bmad-output/implementation-artifacts/spec-withdrawal-validation-and-account-resolve-fix.md`
  summary: Align carehub paystack.js with carefind paystack.js by extracting shared paystackHeaders helper.
  evidence: carefind exports paystackHeaders(); carehub inlines the same header construction; documented as deliberate mirrors but have diverged — pre-existing.
