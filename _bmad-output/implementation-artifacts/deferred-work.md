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
  summary: FR-3 expiry alert dashboard (30/15/7/0-day horizons, per warehouse, expected loss).
  evidence: Split from P0 build — FEFO + batch block is the foundational first deliverable.
- source_spec: none
  summary: FR-4 dead-stock markdown suggestions.
  evidence: Split from P0 build — depends on expiry dashboard visibility.
- source_spec: none
  summary: FR-5 expiry variance reporting.
  evidence: Split from P0 build — depends on batch attribution landing first.
- source_spec: none
  summary: FR-8 signed audit trail export.
  evidence: Split from P0 build — depends on privileged actions (overrides) being recorded.
- source_spec: none
  summary: FR-26/27 owner digest + anomaly alerts.
  evidence: Split from P0 build — third unlock, independently shippable.
- source_spec: `_bmad-output/implementation-artifacts/spec-p0-fefo-expired-batch-block.md`
  summary: Timezone consistency between client and server expiry-date checks.
  evidence: todayDate() uses UTC (toISOString); the guard uses CURRENT_DATE (server-local). Under Supabase's default UTC server tz they agree; if the server tz were ever changed to Africa/Lagos, a near-midnight window would diverge. Both sides are fail-safe (server rejects more, never less) — deferring, not patching.
- source_spec: `_bmad-output/implementation-artifacts/spec-p0-fefo-expired-batch-block.md`
  summary: Add component-level test coverage for the POS add-gate and batch-decrement wiring after charge.
  evidence: The pure helpers are unit-tested; the add-gate and the post-charge setBatches wiring live in POS.jsx, and the repo has no component-test harness for modules (no @testing-library/react).
- source_spec: `_bmad-output/implementation-artifacts/spec-p0-fefo-expired-batch-block.md`
  summary: Add an automated SQL integration test for the two batch triggers (guard + movement).
  evidence: Proven by migration-header verify steps and manual checks; the repo has no SQL/trigger test harness (house rule — triggers are proven in migration headers).
- source_spec: `_bmad-output/implementation-artifacts/spec-p0-fefo-expired-batch-block.md`
  summary: Guard rejects an unattributed line whose product has only zero-quantity-but-unexpired batches? No — resolved as NOT a gap.
  evidence: A zero-quantity available batch is not sellable in either isSellableBatch (client) or the guard (available + unexpired). The guard's unattributed branch counts sellable (available + unexpired) batches regardless of quantity, matching the client's sellableBatches (which also requires qty>0). An unattributed line for a product with a zero-qty batch but one unexpired positive-qty batch passes — consistent with the client. A product whose batches are all zero-quantity and unexpired passes the guard unattributed, but the client-side sellableBatches blocks the add for a non-owner and allocation throws at charge — acceptable (recorded, not patched).
- source_spec: `_bmad-output/implementation-artifacts/spec-fr3-expiry-alert-dashboard.md`
  summary: Update EXPERIENCE.md's Reports Hub tab taxonomy (fixed six-tab structure) to account for the new expiry tab and its RBAC.
  evidence: Surfaces during blind-hunter review; the doc's fixed taxonomy predates FR-3 and the new tab was added without reconciling the docs/route-map.
- source_spec: `_bmad-output/implementation-artifacts/spec-fr3-expiry-alert-dashboard.md`
  summary: Add a knowledge/modules/expiry-alerts.md module doc covering horizon semantics, expected-loss valuation, RBAC, and repository reads.
  evidence: The repo keeps per-module knowledge docs (reports.md, adr-reporting.md, etc.) but the new module shipped without one.