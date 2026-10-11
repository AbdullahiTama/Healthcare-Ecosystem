# Payout accounts, identity verification and the withdrawal PIN

> **H06 update (2026-10-11, owner decisions D1 disable / D2 keep / D3 confirmed): identity verification is OFF.** Nothing about payments, withdrawals, refunds, limits or e-mail depends on it. It is one switch, `financial_config.kyc_enabled` (migration `carefind_20261102_kyc_switch`, **not applied yet**): off by default and when the row is missing; only the value exactly `1` turns it on. While off: `/api/kyc/verify` and `/api/kyc/selfie` answer 404 `kyc_disabled` and the Dojah provider is never constructed (no paid lookup is possible); `/api/kyc/status` answers `{enabled:false,...}` and reads no row; the trust-ladder limit helper never reads `kyc_verifications`, so a tier on an old row lifts no cap; `listPayoutAccounts` reports `kycEnabled:false` and no tier figures; both payout screens hide the identity card and never call `kyc/status`. The tables, the code and the existing rows (2 tier-0 rows in production) are kept, so re-enabling is one row. **Dojah variables (`DOJAH_APP_ID`, `DOJAH_SECRET_KEY`, `DOJAH_BASE_URL`) are not required** for any payment or withdrawal flow, and the rollout steps below that mention Dojah apply only if the owner switches it on. Guard: `packages/shared-payments/src/__tests__/kycIsolation.test.js` fails if a payment, withdrawal, refund, OTP, PIN or e-mail module mentions KYC, or if any module outside a short allowlist reads KYC data or builds the provider.
>
> **To re-enable later (owner action, with the paid provider contract in place):** (1) set `DOJAH_APP_ID` and `DOJAH_SECRET_KEY` (sandbox: `DOJAH_BASE_URL=https://sandbox.dojah.io`) and a dedicated **`KYC_HASH_SECRET`** on both Vercel projects: in production the identity hash no longer falls back to the one-time-code key or the service-role key, and refuses to run without it; (2) run the sandbox smoke test in section 5 step 4; (3) `update financial_config set value = 1 where key = 'kyc_enabled'`. Switching it off again is the reverse; people keep their stored verification. Re-enabling restores tier limits for verified people only, it never makes verification a prerequisite for withdrawing.

> **H02 update (2026-10-10, owner decisions D1a / D2 / D3):** identity verification is **no longer required** to save a payout account or to withdraw, and the account name is **not** matched against a legal name (the bank's own name is stored and shown). The protection is the emailed code on adding, the PIN **and** a fresh code on every withdrawal, an owner alert on every change (add, remove, set-default, PIN change, PIN lock), and a cooling-off cap that follows the **destination** and the **PIN age** (section 7). The KYC tables, endpoints and tier limits below still exist and are untouched until H06 decides their fate; where this document describes a KYC or name-match gate for saving accounts (sections 1, 2 and 3) it describes the behaviour before H02.

Status: **phases 1-4 code complete and tested; database APPLIED to production (2026-10-09 and 2026-10-10); app code NOT yet deployed.** Identity checks are switched OFF (H06, see the note above); if re-enabled they need Dojah credentials and have not been run against the live Dojah API (see section 6).

## Withdrawal code (third factor)

Every withdrawal, from either app and from CareHub Appointments, needs the PIN **and** a one-time code emailed to the account (`otp` purpose `withdrawal`, same service and limits as the other codes: HMAC only, 5 tries, 5-minute TTL, 60 s resend gap, 3 an hour, counted per purpose). The handler checks the PIN first, then the code (single use), and only then resolves the bank account and reserves money, so a wrong PIN never burns a code. The person asks for it with `POST /api/withdrawal-pin/otp {"purpose":"withdrawal"}`; any other purpose is refused (400) so this endpoint cannot mint codes for the others. Needs migration `carefind_20261027_withdrawal_otp_purpose` (widens `issue_otp`; **not applied to production yet**: apply it before deploying this code). Origin: commit `5b090a6` on `main` required a code on every withdrawal using its own `withdrawal_email_otps` table; that table and endpoint were not taken, this rebuilds the same requirement on `otp_challenges`.

## 1. What this protects against

| Threat | Control |
|---|---|
| Stolen session sets its own withdrawal PIN, then withdraws (F-32) | Setting/replacing the PIN needs an emailed one-time code, plus the current PIN unless "forgot PIN" |
| Stolen session withdraws to the thief's own bank account | Withdrawals go to a **saved payout account** whose holder was verified (BVN + NIN + name match + emailed code), and still need the PIN **and a fresh emailed code** |
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
 PIN                     /api/withdrawal-pin/{status,otp,set}   (otp takes { purpose: 'pin_set' (default) | 'withdrawal' })
 withdraw                /api/initiate-withdrawal, /api/initiate-business-withdrawal   { amount, payoutAccountId, pin, otp }
```

CareFind: the person owns their accounts. CareHub: the verified **owner** manages the business's accounts (owner_type `business`, owner_id = parent business); branches withdraw to them. The *person* is what gets KYC'd, receives codes and holds the PIN (one login, one PIN, one KYC across both apps).

## 3. Name matching (`shared-payments/src/kyc/nameMatch.js`)

Order-independent; titles (MR, ALHAJI...) ignored; compound names matched joined or split ("Ade-Bayo"); one typo tolerated only in names of 6+ letters; middle names optional (an initial counts). **First and last name must both be present.** Joint accounts (`&`, `AND`, `/`) never match; more than two unexplained extra words are refused. Business accounts: the bank name must equal the registered business name ignoring LTD / LIMITED / ENTERPRISES etc., with at most one extra word.

## 4. Data and privacy (NDPA)

* Raw BVN/NIN: request memory only. Never stored, logged (the HTTP layer never logs query strings or bodies; provider messages are scrubbed of 11-digit runs), or returned.
* Stored per person (`kyc_verifications`): legal name, last 4 digits, HMAC-SHA256 of each number (`KYC_HASH_SECRET`; **required in production** since H06, and outside production falling back to `OTP_HMAC_SECRET` then the service-role key). Dojah's photo, phone and date of birth are discarded in `DojahProvider`.
* `kyc_verifications`, `payout_accounts`, `otp_challenges`: RLS on, **no policies, no client grants, and no direct writes even for service_role**; only the SECURITY DEFINER functions write. Accounts are never deleted (disabled instead).
* The browser only ever sees account numbers masked to the last four digits.

## 5. Rollout (order matters)

1. **Done:** migrations applied to production: `otp_challenges`, `issue_otp`/`verify_otp`, `kyc_verifications`, `payout_accounts` and their functions, `financial_config.payout_account_required = 0`. Files: `apps/carefind/sql/carefind_20261024_otp_challenges.sql`, `carefind_20261025_payout_accounts_and_kyc.sql`. (A stray `reject_business_withdrawal` function from an earlier attempt is still in production, unused and service-role only; the migration file drops it, but the SQL tool stalls on `drop`. Drop it from the SQL editor.)
2. (Only if identity verification is switched on, H06.) Set on **both** Vercel projects: `DOJAH_APP_ID`, `DOJAH_SECRET_KEY`, and for testing `DOJAH_BASE_URL=https://sandbox.dojah.io`; required `KYC_HASH_SECRET`; **`OTP_HMAC_SECRET` is REQUIRED in production** (H01: with `NODE_ENV=production` the one-time-code code refuses to fall back to the service-role key and answers 503 until it is set; set it BEFORE deploying, and use a value that is not the service-role key). Emails use the existing Resend setup and verified senders (`support@mail.carefind.app`, `support@mail.carefindhub.com`).
3. Deploy CareFind and CareHub together.
4. Smoke test (Paystack test mode + Dojah sandbox, sandbox BVN `22222222222`): set a PIN via the emailed code; verify identity; add an account in your own name; withdraw to it.
5. Leave `payout_account_required` at 0 while people save accounts. Then set it to 1 (`update financial_config set value = 1 where key = 'payout_account_required'`); withdrawals to typed-in details are then refused.

## 6. Known limits

* **Dojah NIN and selfie endpoints/field names are not verified against the live API.** The BVN endpoint and auth headers follow Dojah's published reference; the rest is read defensively and fails closed (an unrecognised response is an error). Run the sandbox before relying on it. The selfie check (tier 2) has a screen on the CareFind wallet (camera/photo, downscaled in the browser to a small JPEG, sent once, never kept).
* The CareHub **Appointments** withdraw dialog still uses typed bank details (the Wallet screen has the saved-account flow). With `payout_account_required = 1` it is refused by the server with a clear message; move it onto the shared form before flipping the flag.
* The resolve-account and OTP resend limits: the in-memory limiter is per serverless instance (best effort); the OTP and KYC limits are in the database and exact.
* One-time code limits (H01, migration `carefind_20261028_otp_hardening`): 60 s gap and 3 an hour per user and purpose (fixed in SQL), plus `financial_config.otp_ip_hourly_cap` (default 10, per keyed client-IP hash, all accounts and purposes) and `otp_global_hourly_cap` (default 500, whole platform). All exact (advisory locks). Codes older than a day are deleted by the cron step `otp_purge` (hourly). Log events: `otp.issued`, `otp.rate_limited`, `otp.verify_rejected`, `otp.delivery_failed`, `otp.misconfigured`; they carry the purpose and a keyed user reference, never a code, address or IP.
* A business account matching only the registered business name relies on the name the business typed when registering; CAC verification would strengthen it.
* `BankPicker`, `PayoutAccountsPanel` and `AddPayoutAccountModal` exist once per app (different design systems). The logic is shared (`packages/shared-payout-ui`, `packages/shared-payments`).

## 7. Code map

`packages/shared-payments/src`: `otp.js`, `pin.js` (`setWithdrawalPin`), `kyc/{DojahProvider,nameMatch,identity}.js`, `payoutAccounts.js`, `payoutHandlers.js` (HTTP layer mounted by both apps), `rateLimit.js`, `banks.js` (`createBankDirectory`).
`packages/shared-email/src/securityEmails.js`: the code and alert emails (sent directly, never through the outbox, so a live code is never stored).
`packages/shared-payout-ui`: bank ranking/search and the framework-free state machines behind the screens.
Apps: `api/_handlers/{kyc,payout-accounts,withdrawal-pin,resolve-account,initiate-*withdrawal}.js`; screens in `wallet-payments/` (CareFind) and `wallet/` (CareHub).

## 8. Phase 4: limits and alerts

Configuration in `financial_config` (changes apply within a minute, no deploy; migration `carefind_20261026_withdrawal_limits.sql`, APPLIED):

| Key | Default | Meaning |
|---|---|---|
| `kyc_tier1_daily_cap_kobo` | 5,000,000 (N50,000) | guaranteed rolling-24h limit for a person at tier 1 (BVN + NIN) withdrawing to a saved account |
| `kyc_tier2_daily_cap_kobo` | 50,000,000 (N500,000) | same at tier 2 (+ selfie) |
| `payout_account_cooloff_hours` | 24 | how long a newly saved account is in cooling-off (0 = off) |
| `payout_account_cooloff_daily_cap_kobo` | 2,000,000 (N20,000) | rolling-24h total allowed during cooling-off (people and businesses) |

How it is combined (`applyLimits`, CareFind): **a verified identity lifts the trust ladder** (owner decision 2026-10-10). The cap is the *higher* of the person's trust-level cap and their tier limit, then a new account *lowers* it to the cooling-off cap:

| Person | Trust cap (before) | Tier 0 (typed-in / unverified) | Tier 1 | Tier 2 |
|---|---|---|---|---|
| new | 50 coins = N10,000 | 50 | **250 = N50,000** | **2,500 = N500,000** |
| trusted | 200 = N40,000 | 200 | **250 = N50,000** | **2,500** |
| veteran | 1,000 = N200,000 | 1,000 | 1,000 (never lowered) | **2,500** |

Inside the cooling-off window every one of them is held to N20,000 (100 coins) per 24 h, whatever their tier. The result is handed to the engine as its own per-call cap (`create_withdrawal.p_daily_cap_coins`, `create_business_withdrawal.p_daily_cap_kobo`), which checks it atomically under the wallet lock with balance and its own cap, so concurrent requests cannot slip past it. A business's cooling-off cap can only lower the engine's business ceiling, never raise it. When the engine answers `daily_limit` because of one of these, the person is told which limit and until when (`limitReason`, `coolingEndsAt`).

Alerts (all best effort, never block or change the answer): payout account added/removed (with last four digits only), PIN changed, **PIN locked** (the wrong attempt that triggers the 15-minute lock emails the owner that someone may be guessing), and the withdrawal-requested email now shows the destination as `••••1234` instead of the full account number.

**Lifting applies only to withdrawals to a saved, verified account.** Typed-in (legacy) destinations keep the trust-level cap unchanged until `payout_account_required` is set to 1, so verification is rewarded rather than bypassed.

Not covered by tier limits: businesses (their engine cap is N1,000,000 a day; only the cooling-off cap applies to a new account).

## 7. Cooling-off caps (H02): the cap follows the destination and the PIN

All three numbers are `financial_config` rows (no deploy to change; 0 disables the rule they belong to):

| Row | Default | Meaning |
|---|---|---|
| `payout_account_cooloff_daily_cap_kobo` | 2,000,000 (N20,000) | the cap itself: rolling 24 h total, for a person's coins and a business's wallet alike (a business is further held under `business_withdrawal_daily_cap_kobo`) |
| `payout_account_cooloff_hours` | 24 | how long a newly SAVED account is "new". 0 turns the new-destination rule off |
| `pin_change_cooloff_hours` | 24 | after the PIN is set or reset (`withdrawal_pins.pin_set_at`) every withdrawal is capped. 0 turns it off |

**Rule A, new destination.** A destination is *known* when it is a saved account older than the cooling-off window, or when the owner already has a **completed** withdrawal to the same bank code and account number (a person's own history, or the business's). Everything else is capped until the first withdrawal to it completes: a new saved account, **any typed-in destination**, and a destination whose bank could not confirm the account name (typed name accepted, logged as `withdrawal.unverified_destination`, always treated as new). Before H02 the cap applied to saved accounts only, so typing the destination skipped it.

**Rule B, PIN change.** For `pin_change_cooloff_hours` after a PIN is set or reset, every withdrawal is capped whatever the destination. PINs that existed before the migration have `pin_set_at = null` and are not treated as recent.

The most restrictive rule wins and the cap goes to the engine as its own per-call rolling-24 h limit (`create_withdrawal.p_daily_cap_coins`, `create_business_withdrawal.p_daily_cap_kobo`), so it is enforced atomically under the wallet lock like every other limit. A KYC tier ceiling can only LIFT the trust ladder for a saved account of a person (unchanged); the cooling-off cap is applied last and only lowers.

If the limits cannot be decided (configuration unreadable) CareFind answers 503 `limits_unavailable` and reserves nothing: it fails closed, never open.

The person is told which rule bound: `limitReason` is `new_account`, `new_destination` or `pin_changed` (with `coolingEndsAt` when it has an end) in the 429 `daily_limit` answer.

Changing the **default** payout account only changes what the app preselects (the server takes the destination from the `payoutAccountId` of each withdrawal request); it needs a session, sends the owner an alert email, and is not PIN-protected.

Alert delivery: the owner alerts (PIN changed, PIN locked, account added, removed, default changed) are still sent directly, best effort, but a failure is now logged as `alert.failed` (event name and an address-free reason). The retrying outbox for them is H05.
