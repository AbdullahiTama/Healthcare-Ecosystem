# Financial eligibility: wallet and KYC by business type

Verified 2026-10-21 against source and the live database (`szdybxmgmhndoytqanfb`). Code: `apps/carehub/src/lib/financialEligibility.js`; tests: `src/lib/__tests__/financialEligibility.test.js`.

## Finding

The reported restriction ("full KYC and wallet only for Importers/Manufacturers") is **not present in the source or the database**:

- `wallet` is in the module registry's `ALL_TYPES` (`lib/permissions.js`), so every owner of every business type has it.
- No wallet or KYC function in the live database reads `business_type`. Policies on `business_wallets` and `business_wallet_transactions` are tenancy-based (`business_id IN current_business_ids()`).
- No API handler for top-up, withdrawal, payout accounts, KYC or PIN references business type (guard test enforces this).
- Identity verification (KYC) is **off by owner decision H06** (`financial_config.kyc_enabled = 0`) and is per person, not per business type. It is never a prerequisite for payments or withdrawals (H02).

If a business sees no Wallet it is more likely an older deployed build, a staff role without the Wallet module, or a missing wallet row (a row is created by the first credit). Which build is live is unverified.

## Matrix (all registered types: pharmacy, hospital, clinic, laboratory, aesthetic, spa, cosmetics, haircare, other, plus legacy skincare, dental, optical, wellness, manufacturer_importer, wholesale)

| Capability | Owner | Staff with Wallet module (custom role) | Staff without |
|---|---|---|---|
| See Wallet, balance, transactions, history | yes | yes, read-only | no |
| Top up | yes | no | no |
| Withdraw (PIN + emailed code) | yes | no | no |
| Add or manage payout accounts | yes | no | no |
| Identity (KYC) card | only if `kyc_enabled=1`, then every type | no | no |

Intentionally not extended: withdrawals stay owner-only and KYC stays off. Changing either is an owner decision, not an eligibility fix.

## Ambiguity left open

If the requirement is "turn KYC on for everyone", that reverses H06 and needs Dojah credentials and `KYC_HASH_SECRET` (see `Payout-Accounts-and-KYC.md`). No code change is needed to make it available to all types.
