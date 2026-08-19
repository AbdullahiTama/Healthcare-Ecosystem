- source_spec: `_bmad-output/implementation-artifacts/spec-purchase-expiry-live.md`
  summary: Add an index for products.expiry_date (migration comment claims one but none exists).
  evidence: The migration comment `-- Indexed for expiry queries` has no matching CREATE INDEX; surfaced during blind-hunter review. Stock expiry alerts query stock_batches, so this is optional.
- source_spec: `_bmad-output/implementation-artifacts/spec-purchase-expiry-live.md`
  summary: Add a trigger/backfill to keep products.expiry_date in sync with stock_batches as a denormalized quick reference.
  evidence: products.expiry_date is described as a quick-reference of batch expiry but nothing updates it when batches change; pre-existing committed design surfaced during review.
- source_spec: `_bmad-output/implementation-artifacts/spec-purchase-expiry-live.md`
  summary: Add component-level test coverage for the Purchases save() wiring (purchaseExpirySummary result -> create body).
  evidence: The helper and repository pass-through are unit-tested, but the save() handler in Purchases.jsx that wires them is not, and the repo has no component-test harness for modules (no @testing-library/react).