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
  evidence: The pure classification is tested (velocity.test.js) and the NotificationBell is component-tested, but the effect wiring in DashboardHome.jsx (localStorage dedupe keys, markSent-after-await ordering) has no test - no module-level component harness exists (no @testing-library/react); same rationale as the Purchases save() entry above.
- source_spec: `_bmad-output/implementation-artifacts/spec-issues-1-to-8-batch-fixes.md`
  summary: Pre-existing advisor findings left untouched by this batch - SECURITY DEFINER views, mutable search_path, anon-executable definer RPCs, pg_trgm in public schema, leaked-password protection disabled.
  evidence: All present before this work; fixing them is a dedicated hardening pass, not a drive-by inside an issue-batch spec.
- source_spec: `_bmad-output/implementation-artifacts/spec-escpos-receipt-printing.md`
  summary: Support choosing among multiple paired USB printers instead of always using the first device.
  evidence: POS.jsx picks getPairedPrinters()[0] with no chooser.
- source_spec: `_bmad-output/implementation-artifacts/spec-escpos-receipt-printing.md`
  summary: Broaden WebUSB discovery to include vendor-specific (0xFF) printers so more thermal models are offered.
  evidence: escposUsb.js filters to classCode 7 only.
- source_spec: `_bmad-output/implementation-artifacts/spec-escpos-receipt-printing.md`
  summary: Add an automated parity check that HTML and ESC/POS receipt builders render the same business/items/totals/tax/payment/footer from one contract.
  evidence: Both builders consume { receipt, business, settings } but no test asserts identical output.
- source_spec: `_bmad-output/implementation-artifacts/spec-escpos-receipt-printing.md`
  summary: Add structured observability for direct-print success vs fallback vs mid-transfer failure.
  evidence: Current code logs only console.error and toasts.
- source_spec: `_bmad-output/implementation-artifacts/spec-escpos-receipt-printing.md`
  summary: Add timeout/abort handling for hanging USB operations (open/claim/transfer).
  evidence: printEscpos can hang indefinitely with no timeout.
- source_spec: `_bmad-output/implementation-artifacts/spec-escpos-receipt-printing.md`
  summary: Add component-level test harness and cover POS.jsx printReceipt branching.
  evidence: All 28 helper tests inject usb/device mocks and never drive POS.jsx.
- source_spec: `_bmad-output/implementation-artifacts/spec-carefind-appointment-booking-hardening.md`
  summary: Add rate limiting and bot protection to public booking endpoint.
  evidence: Public POST /api/booking has no throttle per IP/phone.
- source_spec: `_bmad-output/implementation-artifacts/spec-carefind-appointment-booking-hardening.md`
  summary: Implement TTL/expiry for unpaid pending appointments and held balance cleanup.
  evidence: Unpaid pending appointments block slots indefinitely with no timeout.
- source_spec: `_bmad-output/implementation-artifacts/spec-carefind-appointment-booking-hardening.md`
  summary: Implement wallet refund/reversal on appointment cancellation.
  evidence: free_slot_on_cancel frees service_availability but no wallet held refund movement.
- source_spec: `_bmad-output/implementation-artifacts/spec-carefind-appointment-booking-hardening.md`
  summary: Enforce strict appointment status transition state machine at DB level.
  evidence: Direct PATCH via appointmentRepository.update allows any status transition.
- source_spec: `_bmad-output/implementation-artifacts/spec-carefind-appointment-booking-hardening.md`
  summary: Add patient-facing booking confirmations and cancellation notifications.
  evidence: Business is notified on confirm, but patient receives no creation/cancel notification.
- source_spec: `_bmad-output/implementation-artifacts/spec-carefind-appointment-booking-hardening.md`
  summary: Add handler-level tests for booking service validation, fee snapshot, and concurrent 409.
  evidence: No executing test for POST /api/booking branches.
- source_spec: `_bmad-output/implementation-artifacts/spec-carefind-appointment-booking-hardening.md`
  summary: Add component tests for BookingCard availability filtering and review dialog.
  evidence: No BusinessProfile.test file exists.
- source_spec: none
  summary: Shop Goal 2 - Shop browse grid + product gallery.
  evidence: Split from Shop spec per SCOPE STANDARD.
- source_spec: none
  summary: Shop Goal 3 - Cart, Checkout, Orders + inventory sync.
  evidence: Split from Shop spec per SCOPE STANDARD.
- source_spec: none
  summary: Shop Goal 4 - Pickup-station pricing engine.
  evidence: Split from Shop spec per SCOPE STANDARD.
- source_spec: `_bmad-output/implementation-artifacts/spec-ecommerce-terms-mandatory-approval.md`
  summary: Integration test for RLS hard gate and DELETE gate for ecommerce_products/images.
  evidence: In-memory adapter does not evaluate is_ecommerce_vendor_approved.
- source_spec: `_bmad-output/implementation-artifacts/spec-ecommerce-terms-mandatory-approval.md`
  summary: Component test for Ecommerce.jsx mandatory gate.
  evidence: No render test for Ecommerce.jsx exists.
- source_spec: `_bmad-output/implementation-artifacts/spec-ecommerce-terms-mandatory-approval.md`
  summary: Backfill and NOT NULL hardening for existing ecommerce_applications.
  evidence: Migration adds nullable columns with no backfill.
- source_spec: `_bmad-output/implementation-artifacts/spec-ecommerce-terms-mandatory-approval.md`
  summary: Server-side audit enforcement (auth.uid() for applicant_user_id, commission_rate parity trigger).
  evidence: applicant_user_id and audit_metadata currently trusted from client getSession.
- source_spec: none
  summary: Fix external sharing deep linking so WhatsApp preview card deep-links to original CareFind post.
  evidence: Split from CareFind QA compilation per SCOPE STANDARD.
- source_spec: none
  summary: Fix Health Facility search actions to View Profile/Book Appointment.
  evidence: Split from CareFind QA compilation per SCOPE STANDARD.
- source_spec: none
  summary: Preserve post/article rich-text colours/highlights and formatting parity.
  evidence: Split from CareFind QA compilation per SCOPE STANDARD.
- source_spec: none
  summary: Allow up to 5 images per post with multi-image layout/carousel.
  evidence: Split from CareFind QA compilation per SCOPE STANDARD.
- source_spec: none
  summary: Increase video duration to 2 minutes and fix audio preservation/sync.
  evidence: Split from CareFind QA compilation per SCOPE STANDARD.
- source_spec: none
  summary: Fix News submission reaching Admin queue with count indicator.
  evidence: Split from CareFind QA compilation per SCOPE STANDARD.
- source_spec: none
  summary: Show News preview engagement controls and fix comment save/display.
  evidence: Split from CareFind QA compilation per SCOPE STANDARD.
- source_spec: none
  summary: Make scheduled Live events manageable.
  evidence: Split from CareFind QA compilation per SCOPE STANDARD.
- source_spec: none
  summary: Make Stories discoverable across avatars with indicator ring.
  evidence: Split from CareFind QA compilation per SCOPE STANDARD.
- source_spec: `_bmad-output/implementation-artifacts/spec-withdrawal-validation-and-account-resolve-fix.md`
  summary: Extract shared useAccountResolve and useBanks hooks.
  evidence: Three components carry identical debounced resolve useEffect.
- source_spec: `_bmad-output/implementation-artifacts/spec-withdrawal-validation-and-account-resolve-fix.md`
  summary: Deduplicate disabled/opacity expressions in withdraw buttons.
  evidence: Same long condition repeated twice per file.
- source_spec: `_bmad-output/implementation-artifacts/spec-withdrawal-validation-and-account-resolve-fix.md`
  summary: Align carehub paystack.js with carefind paystack.js.
  evidence: Documented as deliberate mirrors but have diverged.

## Deferred from: code review of spec-carefind-smart-facility-discovery (2026-09-05)

- source_spec: `_bmad-output/implementation-artifacts/spec-carefind-smart-facility-discovery.md`
  summary: dedupeFacilities O(n2) performance.
  evidence: Pre-existing algorithm choice.
- source_spec: `_bmad-output/implementation-artifacts/spec-carefind-smart-facility-discovery.md`
  summary: No LGA backfill.
  evidence: Requires data migration decision.
- source_spec: `_bmad-output/implementation-artifacts/spec-carefind-smart-facility-discovery.md`
  summary: SQL RLS column visibility.
  evidence: Need to verify actual RLS policies.
- source_spec: `_bmad-output/implementation-artifacts/spec-carefind-smart-facility-discovery.md`
  summary: Google source inert.
  evidence: Requires infra/billing decision.
- source_spec: `_bmad-output/implementation-artifacts/spec-carefind-smart-facility-discovery.md`
  summary: Export doesn't enforce provider restrictions.
  evidence: Requires legal/ToS review.
- source_spec: `_bmad-output/implementation-artifacts/spec-carefind-smart-facility-discovery.md`
  summary: partitionBoundary inverted bbox edge case.
  evidence: Low probability.
- source_spec: `_bmad-output/implementation-artifacts/spec-carefind-smart-facility-discovery.md`
  summary: export.js division by zero edge case.
  evidence: Low probability.
- source_spec: `_bmad-output/implementation-artifacts/spec-carefind-smart-facility-discovery.md`
  summary: FacilityDiscovery.jsx stale page state.
  evidence: Low probability.
- source_spec: `_bmad-output/implementation-artifacts/spec-carefind-smart-facility-discovery.md`
  summary: normalizeFacility business_type non-string edge case.
  evidence: Low probability.
- source_spec: `_bmad-output/implementation-artifacts/spec-carefind-smart-facility-discovery.md`
  summary: nigeriaGeo Nominatim null address edge case.
  evidence: Low probability.
- source_spec: none
  summary: Build Dashboard stats-only view with pending business approvals and pending agent applications.
  evidence: Split from CareFindHub Super Admin Panel upgrade per SCOPE STANDARD.
- source_spec: none
  summary: Build Businesses management (search/paginate, detail, Suspend/Revoked/Delete, E-commerce sub-tab, Export).
  evidence: Split from CareFindHub upgrade per SCOPE STANDARD.
- source_spec: none
  summary: Build Team - Agents (registration, approval/placement, referral tracking, earnings atomic trigger).
  evidence: Split from CareFindHub upgrade per SCOPE STANDARD.
- source_spec: none
  summary: Build Team - Platform Admin Team (roles, hiring, permission-scoped login).
  evidence: Split from CareFindHub upgrade per SCOPE STANDARD.
- source_spec: none
  summary: Build Applications unified list (E-commerce/Agent/Team, none auto-approve).
  evidence: Split from CareFindHub upgrade per SCOPE STANDARD.
- source_spec: none
  summary: Build Ledger aggregation + Payouts (pending to processing to paid) + Coverage carry-over.
  evidence: Split from CareFindHub upgrade per SCOPE STANDARD.
- source_spec: none
  summary: Prevent duplicate product activation per vendor in CareFind Hub E-commerce.
  evidence: Split from Stock Validation + Duplicate Activation batch per SCOPE STANDARD.

## Deferred from: code review of spec-carefind-admin-upgrade-phase1 (2026-09-16)

- source_spec: spec-carefind-admin-upgrade-phase1.md
  summary: Add input length limits and character restrictions for admin API search parameters.
  evidence: Blind-hunter flagged no validation on ilike/or() filter inputs; Supabase parameterizes queries so no SQL injection risk, but length limits prevent abuse.
- source_spec: spec-carefind-admin-upgrade-phase1.md
  summary: Add audit logging for all admin API actions (list_posts, list_user_profiles, get_user_profile, get_user_posts).
  evidence: Blind-hunter flagged no server-side logging for sensitive data access; required for compliance and incident response.
- source_spec: spec-carefind-admin-upgrade-phase1.md
  summary: Add test coverage for adminHelpers (timeAgo, exportCSV) and new API actions.
  evidence: Blind-hunter and verification-gap flagged no tests for new code; shipping without tests increases regression risk.
- source_spec: spec-carefind-admin-upgrade-phase1.md
  summary: Consider standardizing exportCSV to produce RFC 4180-compliant CSV (proper double-quoting, newline escaping).
  evidence: Current JSON.stringify escaping works for most cases but does not handle embedded newlines or leading equals signs that could enable CSV injection.
- source_spec: spec-carefind-admin-upgrade-phase1.md
  summary: Consider lazy loading and placeholder skeletons for PostsTab media previews.
  evidence: Blind-hunter flagged missing loading states; images load asynchronously but show no skeleton during load.

## Deferred from: code review of spec-carefind-admin-upgrade-phase2 (2026-09-16)

- source_spec: spec-carefind-admin-upgrade-phase2.md
  summary: Add class-based dark mode toggle support ([data-theme="dark"] selector) for manual theme switching.
  evidence: adminMetaStore stores theme preference but only prefers-color-scheme is implemented; manual toggle deferred per spec.
- source_spec: spec-carefind-admin-upgrade-phase2.md
  summary: Add shadow, radius, spacing, and typography tokens to tokens.css for complete design system coverage.
  evidence: tokens.css only defines color variables; elevation, radius, spacing remain hardcoded in components.
- source_spec: spec-carefind-admin-upgrade-phase2.md
  summary: Add pagination support to usersStore for server-paginated user lists.
  evidence: postsStore has pagination but usersStore does not; currently fetches all users with limit: 100.
- source_spec: spec-carefind-admin-upgrade-phase2.md
  summary: Add reconnection/retry logic to useRealtimeChannel after CHANNEL_ERROR/TIMED_OUT.
  evidence: Current implementation starts polling on error but never retries Realtime; stays degraded permanently.
- source_spec: spec-carefind-admin-upgrade-phase2.md
  summary: Add test coverage for useRealtimeChannel hook and Zustand stores.
  evidence: No test harness exists for hooks/stores; verification-gap flagged untested fallback behavior.
- source_spec: spec-carefind-admin-upgrade-phase2.md
  summary: Add automated dark mode contrast ratio verification (WCAG AA 4.5:1).
  evidence: Dark mode colors defined but no test verifies contrast compliance; manual check only.
- source_spec: spec-carefind-admin-upgrade-phase2.md
  summary: Add transition for prefers-color-scheme changes to prevent abrupt color flip.
  evidence: No transition defined on :root; jarring visual change when OS theme toggles.
- source_spec: spec-carefind-admin-upgrade-phase2.md
  summary: Migrate AdminPanel.jsx useState to Zustand stores for shared state.
  evidence: Spec says "create stores and migrate PostsTab/UsersTab first" as next step; stores created but adoption deferred.

## Deferred from: code review of spec-carefind-admin-upgrade-phase3 (2026-09-16)

- source_spec: spec-carefind-admin-upgrade-phase3.md
  summary: Make bulk operations atomic using database transactions with rollback on partial failure.
  evidence: Current implementation processes items sequentially; partial failures leave committed state. Spec requires all-or-nothing.
- source_spec: spec-carefind-admin-upgrade-phase3.md
  summary: Migrate moderationStore from React Context to Zustand to avoid unnecessary re-renders across all tabs.
  evidence: React Context causes all consumers to re-render on selection changes; Zustand supports selector-based subscriptions.
- source_spec: spec-carefind-admin-upgrade-phase3.md
  summary: Add Realtime subscription for reports table to ensure new reports appear in queue within 2 seconds.
  evidence: Added in patch but verify it works with existing Realtime infrastructure.
- source_spec: spec-carefind-admin-upgrade-phase3.md
  summary: Fix AI copilot moderation queries to use service-role API instead of anon-key Supabase client.
  evidence: adminAiQuery.js queries reports/posts tables directly; RLS blocks anon-key access.
- source_spec: spec-carefind-admin-upgrade-phase3.md
  summary: Optimize Realtime handlers to diff-update only affected data source instead of full loadAll().
  evidence: Single new verification triggers ~12 API calls; should only refresh affected data.
- source_spec: spec-carefind-admin-upgrade-phase3.md
  summary: Add pagination to audit log viewer for continuously growing audit trail.
  evidence: Current implementation loads hardcoded 200 entries with no offset or cursor.
- source_spec: spec-carefind-admin-upgrade-phase3.md
  summary: Add test coverage for priorityScoring.js, bulk operations, and moderation/audit AI query patterns.
  evidence: No tests exist for any new Phase 3 functionality.
- source_spec: spec-carefind-admin-upgrade-phase3.md
  summary: Add filtering support to AI copilot audit log queries (by action, actor, date range).
  evidence: Current audit handler returns unfiltered entries; no way to query specific admin actions.
