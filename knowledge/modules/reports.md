# Reports — Business Domain

## Purpose
Cross-domain financial summary — aggregates Sales, Expenses, and Purchases into a single reporting view for business owners/managers.

## Files
`apps/carehub/src/pages/dashboard/Reports.jsx` (the entire module).

## Components
Single default-exported component. No sub-component decomposition.

## Services
`lib/supabase.js`: `getSales`, `getExpenses`, `getPurchases` — all read-only, no report-specific service functions. All aggregation (totals, sums) is computed client-side in JavaScript after each full, unbounded fetch.

## Dependencies
`lib/utils.js` (`fmt`, `currentMonth`). Depends entirely on the Point of Sale, Expenses, and Purchases domains' tables; has no data of its own.

## Database Tables
Reads `sales`, `expenses`, `purchases` — writes nothing. No server-side aggregation (`count`/`sum`) is used anywhere; every total shown is computed by downloading the complete relevant row set and summing in the browser.

## Current State
Renders combined financial totals across the three source domains. `perms.canViewReports`/`canExportReports` gate the page's *visibility in navigation* but the route itself has no independent guard — a role for which the permission matrix sets `canViewReports: false` (Pharmacist, Cashier, Nurse, Doctor, Receptionist, Lab Technician) can still reach this route by URL; whether the page's data-fetch is itself unconditional was not confirmed in prior review passes and would need direct verification.

## Missing Documentation
No document defines what reports this domain is ultimately meant to produce beyond the three current sources — nothing states whether Inventory valuation, Debts aging, or hospital-domain financials (insurance/HMO payment status) were intended to appear here eventually. No document confirms whether `canViewReports: false` roles are actually blocked from this page's data or only from its nav link — this needs direct verification against `Reports.jsx`'s own internal logic.
