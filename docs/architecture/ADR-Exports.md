# ADR Exports (Phase 7)

## What changed

Export coverage for both ADR surfaces, built only from already-authorized
rows. No migration, no backend change in this phase.

- `exports.js`: `E2B_FORMAT_NOTE` (embedded as an XML comment in every E2B
  download); `buildAdrCsv(rows, {includeReporter})` with RFC escaping;
  `csvRowsFromCases` (one row per reaction, blank-reaction fallback);
  `caseBodyHtml` extract (`buildPdfHtml` output unchanged — existing tests
  pass unmodified); `buildBulkPdfHtml` (cover: org, timestamp, selected/total,
  filters, truncation note; per-case source headers; explicit empty state);
  `buildAnalyticsHtml` (disclaimer, period, filters, n, suppression states);
  `BULK_PDF_CAP = 200`.
- UI: Tracker ExportBar (filtered CSV masked / combined PDF / analytics
  report); case CaseExportBar (CSV masked, print, E2B prep-only);
  Hub list CSV + bulk PDF (own rows, reporter context included);
  Hub detail CSV + E2B relabeled preparation-only.
- Audit: per-report `exported` events sharing a bulk batch id via
  `logBulkExport` (explicit partial-failure counts; UI toasts them).

## Export matrix

| Surface | CSV | Bulk PDF | Analytics report | E2B |
|---|---|---|---|---|
| Hub list/detail | own rows, reporter incl. | own rows, cap 200 | — | prep-only download |
| Tracker list/detail | masked (no reporter/identifier) | masked, cap 200 | masked figures + caveats | prep-only download |

## E2B status (explicit)

`buildE2bXml` emits ICH E2B(R3)-flavoured elements (`messageformatversion 3.0`,
`receiveridentifier NAFDAC`). It is NOT schema-validated and there is NO
submission gateway: every button, tooltip, XML comment and this doc call it
regulatory preparation. The supported-version confirmation and submission
workflow remain blocked on the PV/regulatory lead — nothing here may be
represented as a filing.

## Caps, failures, XLSX

- Bulk PDF caps at 200 with an on-page truncation note; CSV (Blob download)
  has no cap but bulk audit events scale linearly — partial failures are
  counted and toasted, never silent.
- Empty selections produce explicit empty documents, never crashes.
- XLSX deferred: the repo's `xlsx` dependency carries a flagged CVE
  (see `docs/architecture/Linting.md`); CSV opens in Excel and covers the
  analysis need until a safe writer is approved.

## Status: no migration in this phase; Phases 1–8 migrations APPLIED live 2026-10-15 and verified (see phase notes)

## Test evidence

- New: 6 builder tests + 3 mapper/logger tests + 3 export-bar tests — RED
  observed before GREEN throughout.
- Full CareHub ADR + permissions: 11 files / 196 tests PASS post-change.
- ESLint on touched files: 0 errors (2 remaining warnings pre-existing).
- Fixes during review: duplicate import merged, dead props removed, two
  self-inflicted edit slips (deleted neighbors) caught and repaired pre-run.

## Rollback

Builders/UI only: revert the commits. No data or policy changed.
