# Payout accounts, identity verification and the withdrawal PIN

Status: **code complete and tested; database APPLIED to production 2026-10-09; app code NOT yet deployed.** Identity checks need Dojah credentials and have not been run against the live Dojah API (see section 6).

## 1. What this protects against

| Threat | Control |
|---|---|
| Stolen session sets its own withdrawal PIN, then withdraws (F-32) | Setting/replacing the PIN needs an emailed one-time code, plus the current PIN unless "forgot PIN" |
| Stolen session withdraws to the thief's own bank account | Withdrawals go to a **saved payout account** whose holder was verified (BVN + NIN + name match + emailed code), and still need the PIN |
| Someone adds their own account to a victim's wallet | An account can only be saved if the bank-reported name matches the **verified legal name** of the signed-in person (a business may also match its registered name) |
| One person's identity used on many accounts | One BVN and one NIN per person, enforced by keyed hashes |
| Probing other people's BVNs / running up Dojah costs | 5 identity attempts per person per 24 h (database, atomic) |
| Mining `/api/resolve-account` | Signed-in users only, 10 a minute |

## 2. The flow

```
 identity (once)         POST /api/kyc/verify {bvn, nin}      Dojah: BVN + NIN -> names; both must be the same person
                                                              store: legal name, last4, keyed hash. Raw numbers never stored/logged.
 add an account          POST /api/payout-accounts/otp        email a 6-digit code (purpose payout_account)
                         POST /api/payout-accounts/add        {bankCode, accountNumber, otp}
                           1 identity verified?   2 resolve at the bank (Paystack)   3 name matches?   4 code valid?   -> payout_account_add
 withdraw                POST /api/initiate-withdrawal | /api/initiate-business-withdrawal   {amount, pin, payoutAccountId}
                           destination read from the database; bank re-resolved; PIN checked; then the existing withdrawal engine
 manage                  /api/payout-accounts/{list,default,remove}   remove needs the PIN; add/remove send an alert email
 PIN                     /api/withdrawal-pin/{status,otp,set}
```

CareFind: the person owns their accounts. CareHub: the verified **owner** manages the business's accounts (owner_type `business`, owner_id = parent business); branches withdraw to them. The *person* is what gets KYC'd, receives codes and holds the PIN (one login, one PIN, one KYC across both apps).

## 3. Name matching (`shared-payments/src/kyc/nameMatch.js`)

Order-independent; titles (MR, ALHAJI...) ignored; compound names matched joined or split ("Ade-Bayo"); one typo tolerated only in names of 6+ letters; middle names optional (an initial counts). **First and last name must both be present.** Joint accounts (`&`, `AND`, `/`) never match; more than two unexplained extra words are refused. Business accounts: the bank name must equal the registered business name ignoring LTD / LIMITED / ENTERPRISES etc., with at most one extra word.

## 4. Data and privacy (NDPA)

* Raw BVN/NIN: request memory only. Never stored, logged (the HTTP layer never logs query strings or bodies; provider messages are scrubbed of 11-digit runs), or returned.
* Stored per person (`kyc_verifications`): legal name, last 4 digits, HMAC-SHA256 of each number (`KYC_HASH_SECRET`, falling back to `OTP_HMAC_SECRET` then the service-role key). Dojah's photo, phone and date of birth are discarded in `DojahProvider`.
* `kyc_verifications`, `payout_accounts`, `otp_challenges`: RLS on, **no policies, no client grants, and no direct writes even for service_role**; only the SECURITY DEFINER functions write. Accounts are never deleted (disabled instead).
* The browser only ever sees account numbers masked to the last four digits.

## 5. Rollout (order matters)

1. **Done:** migrations applied to production: `otp_challenges`, `issue_otp`/`verify_otp`, `kyc_verifications`, `payout_accounts` and their functions, `financial_config.payout_account_required = 0`. Files: `apps/carefind/sql/carefind_20261024_otp_challenges.sql`, `carefind_20261025_payout_accounts_and_kyc.sql`. (A stray `reject_business_withdrawal` function from an earlier attempt is still in production, unused and service-role only; the migration file drops it, but the SQL tool stalls on `drop`. Drop it from the SQL editor.)
2. Set on **both** Vercel projects: `DOJAH_APP_ID`, `DOJAH_SECRET_KEY`, and for testing `DOJAH_BASE_URL=https://sandbox.dojah.io`; optional `KYC_HASH_SECRET`, `OTP_HMAC_SECRET`. Emails use the existing Resend setup and verified senders (`support@mail.carefind.app`, `support@mail.carefindhub.com`).
3. Deploy CareFind and CareHub together.
4. Smoke test (Paystack test mode + Dojah sandbox, sandbox BVN `22222222222`): set a PIN via the emailed code; verify identity; add an account in your own name; withdraw to it.
5. Leave `payout_account_required` at 0 while people save accounts. Then set it to 1 (`update financial_config set value = 1 where key = 'payout_account_required'`); withdrawals to typed-in details are then refused.

## 6. Known limits

* **Dojah NIN and selfie endpoints/field names are not verified against the live API.** The BVN endpoint and auth headers follow Dojah's published reference; the rest is read defensively and fails closed (an unrecognised response is an error). Run the sandbox before relying on it. The selfie check (tier 2) has a backend (`/api/kyc/selfie`) but **no screen yet** and tier 2 does not change any limit until Phase 4.
* The CareHub **Appointments** withdraw dialog still uses typed bank details (the Wallet screen has the saved-account flow). With `payout_account_required = 1` it is refused by the server with a clear message; move it onto the shared form before flipping the flag.
* The resolve-account and OTP resend limits: the in-memory limiter is per serverless instance (best effort); the OTP and KYC limits are in the database and exact.
* A business account matching only the registered business name relies on the name the business typed when registering; CAC verification would strengthen it.
* `BankPicker`, `PayoutAccountsPanel` and `AddPayoutAccountModal` exist once per app (different design systems). The logic is shared (`packages/shared-payout-ui`, `packages/shared-payments`).
* Phase 4 (not built): daily limits by KYC tier, a cooling-off period for new accounts, withdrawal alerts.

## 7. Code map

`packages/shared-payments/src`: `otp.js`, `pin.js` (`setWithdrawalPin`), `kyc/{DojahProvider,nameMatch,identity}.js`, `payoutAccounts.js`, `payoutHandlers.js` (HTTP layer mounted by both apps), `rateLimit.js`, `banks.js` (`createBankDirectory`).
`packages/shared-email/src/securityEmails.js`: the code and alert emails (sent directly, never through the outbox, so a live code is never stored).
`packages/shared-payout-ui`: bank ranking/search and the framework-free state machines behind the screens.
Apps: `api/_handlers/{kyc,payout-accounts,withdrawal-pin,resolve-account,initiate-*withdrawal}.js`; screens in `wallet-payments/` (CareFind) and `wallet/` (CareHub).
