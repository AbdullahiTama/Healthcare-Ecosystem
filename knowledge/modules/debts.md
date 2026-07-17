# Debts — Business Domain

## Purpose
A bidirectional ledger of money owed — both what customers owe the business (`owes_us`, generated automatically from underpaid/credit POS sales) and what the business owes suppliers (`we_owe`, generated automatically from underpaid Purchases). Functions as the reconciliation hub between the Point of Sale and Purchases domains.

## Files
`apps/carehub/src/pages/dashboard/Debts.jsx` (the module and its own manual-entry UI), `pages/dashboard/POS.jsx` and `pages/dashboard/Purchases.jsx` (both write to this domain's table directly, each independently).

## Components
Single default-exported component in `Debts.jsx`; no sub-components. The debt-creation logic itself lives inside `POS.jsx` and `Purchases.jsx`, not in this file.

## Services
`lib/supabase.js`: `getDebts`, `addDebt`, `updateDebt`, `recordUnderpayment`. Debt *creation* now goes through one shared function — `recordUnderpayment({ businessId, direction, partyName, amount, amountPaid, dueDate, description, source, sourceRef })`, called from POS.jsx's `charge()` and `chargeCredit()` (`direction: 'owes_us'`) and Purchases.jsx's `save()` (`direction: 'we_owe'`). It owns the "only create a debt if underpaid" check and never throws, so a failed debt write can't undo an already-completed sale or purchase. `Debts.jsx`'s manual entry form still calls `addDebt` directly — a deliberately different case, not underpayment-on-a-transaction. Debt *settlement* (marking a debt paid once the source is paid off) is still written independently in three places — `Purchases.jsx`'s `markPaid()`, `Debts.jsx`'s own settle action, and POS.jsx's partial-payment settle path — and was out of scope for this pass.

## Dependencies
`lib/utils.js` (`fmt`, `todayDate`). Structurally dependent on POS and Purchases as its two upstream writers, and on `debts.source`/`source_ref` fields to trace a debt back to the sale or purchase that generated it.

## Database Tables
`debts` (`id, business_id, direction ('owes_us'/'we_owe'), party_name, amount, amount_paid, balance, due_date, status, description, source, source_ref`).

## Current State
Manual debt entry, viewing, and update are implemented in `Debts.jsx`. Automatic debt *creation* from POS and Purchases now shares one function (`recordUnderpayment`, see Services above) — a change to that rule propagates to both callers. Reconciliation (matching a debt back to its source and settling it) is still three independent implementations; a change to that rule does not propagate.

## Missing Documentation
No document specifies the debt-*reconciliation* contract (`source`/`source_ref` matching rules) as a single source of truth — it still exists as three independently-written, potentially divergent implementations (Purchases.jsx, Debts.jsx, POS.jsx). Debt *creation*'s contract is now the `recordUnderpayment` function signature itself, which is self-documenting.
