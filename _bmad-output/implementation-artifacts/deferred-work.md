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
