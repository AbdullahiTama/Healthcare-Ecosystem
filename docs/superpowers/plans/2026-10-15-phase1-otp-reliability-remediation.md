# Phase 01 — OTP reliability & withdrawal session (remediation of 2026-10-15)

**Status:** IMPLEMENTED AND TESTED — NOT DEPLOYED. No migration was needed or applied.

This entry supersedes the two stale claims in the 2026-10-13 plan, which the 2026-10-15 forensic audit found were
never shipped to the client:

| 2026-10-13 plan claimed | Reality found in the audit | Now |
|---|---|---|
| `GET /api/withdrawal-pin/draft` restores amount + masked destination | It was `POST`, and the client read only the timestamps — `draft.amount` and `draft.destination_mask` were returned and thrown away | `POST` (kept; the router is a single POST catch-all) and the client now rebuilds the form from the draft |
| `resendAvailableAt` returned by the RPC | Never existed | The 409 body and the draft response now carry `otpIssuedAt` + `expiresInSeconds` |
| Rollout "staged (no execution)" | Confirmed — and the symptom is still reachable from HEAD | Fixed in code; **needs a deploy** |

---

## 1. Root causes addressed

### 1.1 A resumed verification session was destroyed by rebuilding the form (the reported failure)

`WithdrawalOtpField` compared `[amount, payoutAccountId, bankCode, accountNumber]` against the previous value and, on any
change, wiped the session: `sent=false`, the stored countdown deleted, the typed code cleared.

The router keys `<Routes key={location.key}>` (`apps/carefind/src/main.jsx:109`), so **any** in-app navigation remounts the
whole routed subtree, and `vite:preloadError` (`main.jsx:23-30`) forces a document reload when a deploy lands while the
user is in their mail app. After that remount the amount field is empty and the saved account is re-selected — so the
**first keystroke changed the key and threw away the code the user had just read**, while the server draft stayed live for
ten minutes. The server then refused the submit with `draft_mismatch`, which cleared the code again.

A second loop compounded it: `409 draft_active` carried no issue time, so the resend countdown rendered as `0` and "Send a
new code" was enabled immediately. One tap issued a *new* code, which `issue_otp` makes supersede the old one — so the code
already in the inbox became unusable and the next submit could only answer `otp_superseded`.

**Fix.** The field now distinguishes *a code was issued for this exact form* from *a code was resumed and the form is still
being rebuilt*. Only the former may be invalidated. `onResume` hands the draft to the wallet, which restores the amount and
re-selects the saved account, so no retyping is needed at all. The 409 body carries the live code's issue time and expiry,
so the cooldown renders truthfully.

### 1.2 The countdown promised up to five minutes the code did not have

A draft lives `now() + interval '10 minutes'` (`carefind_20261104_withdrawal_drafts.sql:12`); a code lives
`OTP_TTL_SECONDS = 300` (`packages/shared-payments/src/otp.js:14`). The resume path painted the **draft** expiry, so a
resumed user saw time remaining and then got `otp_expired`. The server now computes `otpExpiresAt = min(draft_expires_at,
otp_issued_at + OTP_TTL)` and the client counts down to that.

### 1.3 A stale draft deadlocked the user for ten minutes

`draft_mismatch` deliberately kept the draft, so the next request came straight back as `409 draft_active`. It now voids
the draft (`p_reason: 'submit_mismatch'`). Voiding only stamps `voided_at`, moves no money, and is idempotent; the OTP is
still **not** burned (`checkOtp` is never reached) and no funds are reserved.

---

## 2. Files changed

**Shared (one definition, both apps):**
- `packages/shared-payout-ui/src/otpInput.js` *(new)* — `cleanOtp`, `isCompleteOtp`, `readClipboardOtp`
- `packages/shared-payout-ui/src/index.js` — export them
- `packages/shared-payments/src/withdrawalDrafts.js` — `draftOtpExpiresAt`, `describeWithdrawalDraft`
- `packages/shared-payments/src/index.js` — export them
- `packages/design-system/src/components/ui/Form.jsx` — `aria-describedby` is now **merged**, not replaced

**CareFind:** `api/_handlers/withdrawal-pin.js`, `api/_handlers/initiate-withdrawal.js`,
`src/modules/wallet-payments/{WithdrawalOtpField,Wallet,WithdrawalPinModal,AddPayoutAccountModal}.jsx`

**CareHub:** `api/_handlers/withdrawal-pin.js`, `api/_handlers/initiate-business-withdrawal.js`,
`src/modules/wallet/{WithdrawalOtpField,Wallet,WithdrawalPinField}.jsx`

**SQL migrations / functions / RLS:** none. No schema change was required or made.

---

## 3. Security and accounting implications

| Property | Effect |
|---|---|
| OTP stored | Unchanged — HMAC only, TTL 300 s, 5 attempts, single use, purpose+user bound |
| PIN / code in browser storage | **Unchanged: still never.** `sessionStorage` holds only `{draftId, otpIssuedAt, otpExpiresAt}` — asserted by a test |
| `destination_fp` | Still **never** leaves the server. The client gets `destinationKind` + `savedAccountId` (an id it already owns) + the already-masked digits |
| Purpose / user / draft binding | **Strengthened at the server gate, not weakened at the client.** The resume path is presentation only; `initiate-withdrawal.js` still recomputes `destinationFingerprint` and refuses any mismatch before `checkOtp` |
| Consumption order | Unchanged — PIN → draft → OTP → account resolution → reservation. Nothing was moved earlier |
| Money | **No money path touched.** No fee, rate, unit or limit changed. `coin_value_kobo=20000`, `withdrawal_fee_rate=0.20` untouched |
| New attack surface | None. The 409 body adds only timestamps and an id the caller owns |

`maxLength` is deliberately **not** set on the code inputs: a browser applies it to the raw value before our cleanup runs, so
pasting `123 456` would be truncated to five digits and leave the submit button disabled. `cleanOtp` strips first, slices second.

### Autofill — what is and is not guaranteed

- `autocomplete="one-time-code"` is kept. For **SMS** it is well supported (iOS Safari, Android Chrome). For an
  **email-delivered** code support is partial and varies by mail client and OS. It is a best-effort hint, never a promise,
  and the UI says so.
- The **WebOTP API is deliberately not used**: it is Chrome/Android only and reads SMS-delivered codes only. It cannot read
  an emailed code.
- **Clipboard paste** (user-gesture gated, refuses any clipboard holding more than six digits) is the mechanism that actually
  works for email codes. Manual typing always remains available.

---

## 4. Tests

| Suite | Result |
|---|---|
| `packages/shared-payout-ui` | 51 passed (39 + 12 new) |
| `packages/shared-payments` | 631 passed (623 + 8 new) |
| `apps/carefind` — `api` + `src/modules/wallet-payments` | 47 files / 437 passed |
| `apps/carehub` — `api` + wallet + appointments | 28 files / 330 passed |
| `apps/carefind` build | exit 0 |
| `apps/carehub` build | exit 0 |

New coverage includes: a resumed session surviving a rebuild in one step and in stages; a genuine edit still resetting after
the form matches; the 409 painting a real cooldown; the countdown bounded by the code; clipboard paste accepted/refused;
`maxLength` absent; `aria-describedby` linked to the live countdown; and a storage assertion that the code, the PIN and the
account number never reach `sessionStorage`.

Three defects were found by the tests while writing them, not after: `readClipboardOtp` refused a grouped `123 456`;
`isCompleteOtp` truncated before deciding, so a seven-digit paste read as complete; and the shared `Input` discarded a
caller-supplied `aria-describedby`.

---

## 5. Deployment prerequisites

1. **No migration.** Safe to deploy as-is, both apps together (they share the endpoint contract).
2. **Deploy both apps together** — the 409/draft response shape is consumed by both clients.
3. **Backfill-free.** `withdrawal_drafts` already exists in production (`carefind_20261104_withdrawal_drafts` applied).
4. **Rollback:** revert the deploy. The server changes are additive response fields plus an extra idempotent draft void; an
   older client ignores the new fields and keeps its current behaviour.

## 6. Remaining risks

- **The reported symptom cannot be reproduced from HEAD + production.** `otp_challenges` holds 2 rows, both
  `consumed_reason='used'`, zero failed attempts, last on 2026-10-14. The string *"Incorrect verification code"* exists
  nowhere in the repository. The fix removes every mechanism that produces the *experience*; if the message persists after
  this deploy, the serving CareFind build is older than `main` and that must be checked first.
- `<Routes key={location.key}>` is unchanged. It is the reason remounts happen, but changing global routing has a blast
  radius well beyond this phase; with the server-draft resume a remount is now harmless.
- A **typed** (non-saved) destination cannot be reconstructed from an HMAC, so that path still needs the bank fields
  re-entered. The server's `draft_mismatch` is the authority and now clears the deadlock.