# Debts — Business Domain

## Purpose
A bidirectional ledger of money owed — both what customers owe the business (`owes_us`, generated automatically from underpaid/credit POS sales) and what the business owes suppliers (`we_owe`, generated automatically from underpaid Purchases). Functions as the reconciliation hub between the Point of Sale and Purchases domains.

## Files
`apps/carehub/src/pages/dashboard/Debts.jsx` (the module and its own manual-entry UI), `pages/dashboard/POS.jsx` and `pages/dashboard/Purchases.jsx` (both write to this domain's table directly, each independently).

## Components
Single default-exported component in `Debts.jsx`; no sub-components. The debt-creation logic itself lives inside `POS.jsx` and `Purchases.jsx`, not in this file.

## Services
`lib/supabase.js`: `getDebts`, `addDebt`, `updateDebt`. Both `POS.jsx` (on a credit/underpaid sale) and `Purchases.jsx` (on an underpaid purchase, plus its own "find matching debt and mark paid" reconciliation) call these directly — there is no single shared "create/reconcile a debt" function; the matching logic is written twice, independently, in the two calling domains.

## Dependencies
`lib/utils.js` (`fmt`, `todayDate`). Structurally dependent on POS and Purchases as its two upstream writers, and on `debts.source`/`source_ref` fields to trace a debt back to the sale or purchase that generated it.

## Database Tables
`debts` (`id, business_id, direction ('owes_us'/'we_owe'), party_name, amount, amount_paid, balance, due_date, status, description, source, source_ref`).

## Current State
Manual debt entry, viewing, and update are implemented in `Debts.jsx`. The automatic-creation and reconciliation paths from POS and Purchases both work but are implemented as two independent copies of similar logic rather than one shared function — a change to the reconciliation rule in one location does not propagate to the other.

## Missing Documentation
No document specifies the debt-reconciliation contract (`source`/`source_ref` matching rules) as a single source of truth — it currently exists as two independently-written, potentially divergent implementations inside POS and Purchases, and this entry's description of "how it works" had to be assembled from both call sites rather than one authoritative definition.
