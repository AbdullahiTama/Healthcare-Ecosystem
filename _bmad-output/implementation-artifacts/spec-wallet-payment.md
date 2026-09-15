---
title: 'Wallet & Payment — Business Wallet Section'
type: 'feature'
created: '2026-08-28'
status: 'done'
baseline_commit: 'e0485273aab3c22499cf0264c2595b3212a8cc6a'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** No dedicated Wallet section; business owners cannot view payments received, transaction history, available balance, or withdraw. Payment options not clearly displayed.

**Approach:** Add Wallet module (separate nav entry) showing available/held balances, transaction history, withdrawal, and export. Reuse business_wallets migration; connect appointment payments to wallet via existing settlement RPCs.

## Boundaries & Constraints

**Always:** Wallet is owner-only, tenant-scoped via RLS, uses sbFetch. Withdraw via /api/initiate-business-withdrawal with bearer token. Never expose Paystack secret client-side.

**Never:** Do not duplicate wallet logic; do not weaken RLS.

## I/O & Edge-Case Matrix

| Scenario | Input | Expected Output | Error |
|----------|-------|-----------------|-------|
| View wallet | Owner opens Wallet | Shows available, held, total, transactions, withdrawals | Loading/empty/error states |
| Withdraw | Valid amount + bank details | Calls API, deducts available, shows pending | Insufficient → error toast |
| Transaction history | Filter by type | DataTable filters correctly | — |

</frozen-after-approval>

## Code Map

- `apps/carehub/src/modules/wallet/Wallet.jsx:1` -- New module
- `apps/carehub/src/lib/permissions.js:219` -- Added wallet to MODULES and NAV_ORDER
- `apps/carehub/src/pages/dashboard/BusinessDashboard.jsx:1` -- Added wallet route

## Tasks & Acceptance

**Execution:**
- [x] Create Wallet.jsx with balances, history, withdrawal, export
- [x] Add wallet to permissions/nav
- [x] Wire route in BusinessDashboard

**Acceptance:**
- Given owner, when Wallet opened, then balances and history shown; withdraw works; non-owner sees restricted message.

## Spec Change Log

## Design Notes

Uses existing business_wallets tables; if not yet migrated, shows empty state with 0 balances.

## Verification

- `npm run build` -- clean (288 modules)
- Manual: open Wallet, see balances, export CSV, withdraw

## Suggested Review Order

- Wallet module
  [`Wallet.jsx:1`](../../apps/carehub/src/modules/wallet/Wallet.jsx#L1)

- Permissions/nav
  [`permissions.js:219`](../../apps/carehub/src/lib/permissions.js#L219)
