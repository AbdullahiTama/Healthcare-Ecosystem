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

## Deferred from: spec-auth-email-links-work split (2026-09-19)

- source_spec: `_bmad-output/implementation-artifacts/spec-auth-email-links-work.md`
  summary: Harden CareFind ResetPassword.jsx to perform a PKCE `?code=` exchange (mirroring CareHub's ResetPassword.jsx) so the reset link also works under PKCE flow, not only implicit hash flow.
  evidence: Split from the auth-email-links-work spec per SCOPE STANDARD so the verify-email landing page could ship independently; reset page works today under implicit flow (project's current/assumed flow), so the PKCE path is a robustness enhancement, not a blocker.
## Deferred from: spec-payments-end-to-end-hardening split (2026-09-19)

- source_spec: _bmad-output/implementation-artifacts/spec-payments-end-to-end-hardening.md
  summary: CareFind commerce payments - business-profile bookings and shop order Paystack flows (booking.js, verify-booking-payment, initiate/verify-shop-payment, consultation payments).
  evidence: Split from end-to-end payments spec per SCOPE STANDARD to keep wallet lifecycle (top-up, subscriptions, withdrawals) as first shippable deliverable; commerce flows touch shop_orders/appointments but not wallet top-up keys.

- source_spec: _bmad-output/implementation-artifacts/spec-payments-end-to-end-hardening.md
  summary: CareHub payments - plan renewals, CareHub appointment payments, and business wallet withdrawals plus shared Paystack secret/env and 20260903 payments migration.
  evidence: Split per SCOPE STANDARD - CareHub is separate Vercel deployment and business_wallets vs CareFind wallets; can be reviewed/tested independently from CareFind wallet lifecycle.


## Deferred from: spec-auth-email-links-work review (2026-09-19)

- source_spec: _bmad-output/implementation-artifacts/spec-auth-email-links-work.md
  summary: Add a resend-verification-email action so users with a dead/expired verify link can request a fresh one without re-registering (needs a new /api/auth-email action pattern, not client-side generateLink which the spec forbids).
  evidence: Blind-hunter review: expired/info copy currently tells users to "sign up again to receive a fresh link"; no resend path exists, forcing account recreation.

- source_spec: _bmad-output/implementation-artifacts/spec-auth-email-links-work.md
  summary: Distinguish a transient network/server failure (exchange or getSession throws) from a genuinely stale link, instead of collapsing both into the "expired" state.
  evidence: Edge-case review: a fresh PKCE link opened on a device without the stored code_verifier (or during an outage) reports "Link expired" - functionally true but misleading about cause; project runs PKCE-default Supabase config.

- source_spec: _bmad-output/implementation-artifacts/spec-auth-email-links-work.md
  summary: Add a loading timeout/abort so a hung exchange or getSession cannot leave the verify page stuck on "Verifying your email..." indefinitely.
  evidence: Blind-hunter review: no timeout/abort around exchangeCodeForSession/getSession; an unresponsive network leaves the page in the loading phase forever.
  status: PROMOTED to spec-auth-email-links-work.md review_loop_iteration 2 (bad_spec B1) - bounded settlement/timeout is now a hard requirement of that spec's Task #1 and only supersedes this entry for VerifyEmail.jsx; keep the guidance for other supabase-dependent CareFind pages.

### review_loop_iteration 2 (2026-09-19)

- source_spec: _bmad-output/implementation-artifacts/spec-auth-email-links-work.md
  summary: Add a route-table smoke test that exercises the app's real route wiring (public-ness of /verify-email outside RequireAuth, lazy import resolves) instead of hand-declared routes in the page test.
  evidence: Verification-gap review: VerifyEmail.test.jsx declares its own `<Route>`; nothing asserts /verify-email sits beside /login in the real route table, so a future drift into RequireAuth or a broken lazy import would pass CI silently. Repo-wide harness gap (BackgroundRoutes.test.jsx deliberately avoids importing main.jsx).
  notes: Deliberately split from auto-fix - adding this for a single route requires deciding a repo-wide route-table test convention, not a VerifyEmail-specific change.

- source_spec: _bmad-output/implementation-artifacts/spec-auth-email-links-work.md
  summary: Add a server-boundary test asserting the client-injected `redirectTo` from AuthContext reaches `sendAuthEmail`/`generateLink` in apps/carefind/api/_handlers/auth-email.js (and thus lands in the minted verify link).
  evidence: Verification-gap review: the redirectTo contract behind the spec's central AC ("minted link's redirect = client origin + /verify-email") is only exercised client-side at the request producer edge; the read-only handler's pass-through is uncommitted pre-existing code from the parallel email-overhaul effort, so no test asserts it. Vitest config already includes `api/**/*.test.{js,jsx}` and testTimeout 15000, so the harness exists; the test needs SUPABASE_URL/SERVICE_ROLE mocks.
  notes: Files are Read-only per this spec; testing them belongs with the email-overhaul/supabase-surface testing effort.

### review_loop_iteration 3 (2026-09-21)

- source_spec: _bmad-output/implementation-artifacts/spec-auth-email-links-work.md
  summary: Make AuthContext's email-send failure observable (currently `.catch(() => {})` silently swallows every /api/auth-email POST failure).
  evidence: Blind-hunter review (feedback iteration 2): the `.catch(() => {})` predates this change (unchanged context line in the diff), so a failed verification email is invisible to ops and the user; capturing/forwarding the error belongs to a shared auth-context effort, not the page story.
  notes: Pre-existing behavior, surfaced incidentally; do not fold into this story's loopback.

- source_spec: _bmad-output/implementation-artifacts/spec-auth-email-links-work.md
  summary: The story's server boundary (apps/carefind/api/_handlers/auth-email.js, packages/shared-email/src/authEmail.js, and the `/api/auth-email` route in apps/carefind/api/router.js) exists only in the uncommitted working tree of the parallel email-overhaul effort; the feature is inert at HEAD until those files are committed together.
  evidence: Verification-gap review (feedback iteration 2): `git cat-file -e HEAD:apps/carefind/api/_handlers/auth-email.js` fails and `git show HEAD:apps/carefind/api/router.js` has no auth-email route, so at HEAD `/api/auth-email` does not exist and nothing consumes the newly added `redirectTo`.
  notes: Integration/coordination state with the parallel email-overhaul workflow, not a defect of this story's diff; verify the wiring lands together at integration time.

## Deferred from: code review of spec-business-directory-phase1 (2026-09-21)

- source_spec: `_bmad-output/implementation-artifacts/spec-business-directory-phase1.md`
  summary: Location-based search drops text/state/LGA filters when using RPC - by design but limits functionality.
  evidence: When latitude/longitude are provided, the code takes an early return via RPC call. Text search, state, and LGA filters are discarded. The RPC only accepts p_category_id, so text search and state/LGA filters are completely ignored in proximity mode.
- source_spec: `_bmad-output/implementation-artifacts/spec-business-directory-phase1.md`
  summary: business_directory table lacks an updated_at trigger for non-location column changes.
  evidence: The update_business_location() trigger only fires on location changes. Other column updates (name, phone, status, etc.) won't trigger updated_at.
- source_spec: `_bmad-output/implementation-artifacts/spec-business-directory-phase1.md`
  summary: search_nearby_businesses RPC is granted only to authenticated, not anon - may need public access.
  evidence: CareFind is a public-facing app. If unauthenticated users can search businesses, this RPC will fail for them. The business_directory table allows public read via RLS, but the RPC is gated behind auth.
- source_spec: `_bmad-output/implementation-artifacts/spec-business-directory-phase1.md`
  summary: No index on business_directory.phone or business_directory.email for ilike searches.
  evidence: The repository performs ilike searches on phone and address, but there's no supporting index for phone-based lookups.
- source_spec: `_bmad-output/implementation-artifacts/spec-business-directory-phase1.md`
  summary: No empty state for the categories grid when categories array is empty.
  evidence: When categories is an empty array (not loading), the grid renders nothing - no message telling the user there are no categories yet.
- source_spec: `_bmad-output/implementation-artifacts/spec-business-directory-phase1.md`
  summary: Inline styles used for everything, including interactive states - no :hover or :focus styles on icon buttons.
  evidence: Blind-hunter review: keyboard navigation and mouse hover visually non-responsive on icon buttons.
- source_spec: `_bmad-output/implementation-artifacts/spec-business-directory-phase1.md`
  summary: Client-side distance calculation in ResultsList.jsx inconsistent with server-computed distance_km.
  evidence: ResultsList.jsx:53 recalculates distance client-side using Haversine when the server already returns distance_km, creating potential inconsistency between displayed distance and sort order.

## Deferred from: spec-auth-email-links-work review, iteration 4 (2026-09-22)

- source_spec: `_bmad-output/implementation-artifacts/spec-auth-email-links-work.md`
  summary: Add a resend-verification-email action (or a clearer "or open the fresh link from your email" path) so users landing on the info/non-signup page with a recovery/magiclink token are not told to re-register.
  evidence: Blind-hunter review (feedback iteration 4): non-verification link types render the info card whose copy implies the only path forward is a new signup; the refused-token UX was intentionally generic this iteration. Resend needs the server-side /api/auth-email pattern (already deferred iteration 1); copy-only polish acceptable later.
- source_spec: `_bmad-output/implementation-artifacts/spec-auth-email-links-work.md`
  summary: Revisit the info-state copy for delivery-failure verifications so an "open the link in your email" instruction is not shown for `send email failed` pages.
  evidence: Blind-hunter review (feedback iteration 4): two distinct producers collapse into one info card; deferred as session-level UX, not verification-correctness.
- source_spec: `_bmad-output/implementation-artifacts/spec-auth-email-links-work.md`
  summary: Recorded as deeply-from-auth-js design: stripConsumedTokenFromUrl only ever strips on a genuinely `verified` outcome, because GoTrueClient strips the callback URL only after a successful exchange (`window.location.hash=''` on implicit success; `?code=` removal after PKCE success), and never on error. confirmed via GoTrueClient.js L3246-3330 during iteration-4 triage.
  evidence: Blind-hunter findings #3 (consumed-form replay trusts a non-verified landing) and #4 (exact-string consumed-form equality is brittle to normalization differences) reviewed and accepted: the replay path is grounded in auth-js' strip-only-on-success contract and the to-string normalization matches the library's own URL writes.
- source_spec: `_bmad-output/implementation-artifacts/spec-auth-email-links-work.md`
  summary: Bound the StrictMode dev double-exchange of a single-use PKCE code at the side-effect level (arm an in-flight guard before the async exchange), or accept the double call as dev-only noise.
  evidence: Blind-hunter review feedback iteration 4: the adjudication effect is not idempotent at the side-effect level; verdict replay hides the second failed exchange, but the second `exchangeCodeForSession` call still fires in dev. Prod (no StrictMode) unaffected.
- source_spec: `_bmad-output/implementation-artifacts/spec-auth-email-links-work.md`
  summary: Decide product behavior for "dead PKCE code + held login session": today the boot-consumed branch replays `verified` for any held session, which is a designed-but-ambiguous false-success for that exact combination.
  evidence: Blind-hunter review feedback iteration 4: frozen I/O matrix row 3 authorizes already-verified + session -> verified; the dead-code + held-session combination cannot be disambiguated client-side; kept as designed, flagged for a product/spec decision.
- source_spec: `_bmad-output/implementation-artifacts/spec-auth-email-links-work.md`
  summary: Document the verify-email feature in module docs/README/CODE_AUDIT/CHANGELOG per the repo quality bar (outstanding documentation delta from this loop).
  evidence: Blind-hunter review feedback iteration 4; must land when the loop terminates instead of shipping with the working-tree delta.

## Cross-app email branding fix (2026-09-23)

- summary: Fixed shared-email package so CareHub and CareFind each render their OWN branded templates (logo, footer domain, sender identity) across ALL transactional emails — not just auth flows.
- changes:
  - Brand-aware registry (`getTemplate(key, app)`) with per-app key tables; `EmailService.processBatch` resolves app from `from_email` (CareHub prefix → carehub, else carefind).
  - CareHub `fromEmail` corrected from CareFind's mail domain to `CareHub <support@mail.carefindhub.com>`; defaults use `process.env.APP_URL`.
  - Welcome subject per-app (`Welcome to CareHub!` / `Welcome to CareFind!`).
  - Auth handlers' `redirectTo` default → `process.env.APP_URL`.
  - Transactional email header now uses real `logo-wordmark.png` per app (icon + brand name).
  - CareHub footer domain fixed `carehub.ng` → `carefindhub.com`; in-body `support@carehub.ng` → `support@mail.carefindhub.com`.
  - `.env.example` files aligned to working `.env` sender/URL values; CareHub `.env` stale comment fixed.
  - Shared-email fallback defaults updated to CareHub verified domain.
- verification:
  - 11 new shared-email vitest tests pass (registry brand resolution, rendered HTML brand checks, sender→app resolver).
  - CareHub email tests 3/3 pass.
  - CareFind full suite 97 files / 1168 tests pass.
  - CareFind build clean.
