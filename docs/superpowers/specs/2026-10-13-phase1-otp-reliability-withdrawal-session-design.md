# Phase 1 Design — OTP Reliability & Withdrawal Session (Approach 2)

Status: **design approved section-by-section (2026-10-13); awaiting spec review before implementation plan.**
Scope: Phase 1 only (brief §4). No money state-machine, settlement, fee, or release-trigger changes.

## 0. Evidence this design answers

Live read-only diagnostics on project `szdybxmgmhndoytqanfb` (2026-10-13, authorised):

- `otp_challenges`: 6 rows ever, all `purpose=withdrawal`, 0 live. User 1: 2 codes 83s apart, 0 attempts (re-request burned the inbox code Sight-unseen). User 2: 4 codes over ~2h, max 2 attempts. **Supersede (A-H1) is the confirmed live mechanism** behind "Incorrect verification code".
- Both users subsequently passed OTP (matching `withdrawal_requests` reservations + `reconcile:not_found` refunds Oct 12–13) — the OTP symptom and the provider-balance symptom are sequential, not the same defect.
- `issue_otp` live is the 5-arg hardened version; `financial_config` matches code (`coin_value_kobo=20000`, `withdrawal_fee_rate=0.20`, `kyc_enabled=0`, `payout_account_required=0`); `reconcile_coin_wallets()` and `verify_coin_ledger_chain()` return 0 rows.
- `carefind_20261020_wallet_spend_part1..7` ARE applied — the Phase 16 "NOT applied" header is stale (docs fix, no action).
- Flagged for Phase 2 (out of scope): request `13cec8dd` (25 coins) stuck `processing` since 2026-10-11 — a marked attempt never resolved, consistent with the sweep not running (cron Vault secrets unset).

## 1. OTP verification semantics (`superseded` branch) — APPROVED

Today every hash mismatch on the live row returns `invalid`, including a previously-valid code burned by re-request; 5 such retries lock the unseen new code via the live row's attempt counter.

Changes (additive migration + `packages/shared-payments/src/otp.js`; handlers already propagate `code`):

1. New nullable column `otp_challenges.consumed_reason` (`superseded|used|expired|locked`, else null). `issue_otp` stamps `superseded` on priors it burns; `verify_otp` stamps `used`/`expired`/`locked`. Legacy nulls behave exactly as today.
2. `verify_otp` order: `none` → `expired` → `locked` → `ok` → **new: hash matches an older `superseded` row while a newer live row exists → `superseded`** → else `invalid` + attempt.
3. `superseded` does NOT increment live attempts. Bounding unchanged: issuance caps (3/hr, IP/global ceilings) + 5-attempt live lock; the signal requires possessing a previously-valid code and yields nothing usable.
4. JS: `VERIFY_FAILURES.superseded` = 400 `otp_superseded` / "A newer code was issued — please use the latest email." Frontend clears the dead value, keeps the draft, shows sent/cooldown state.

Compatibility: no signature changes; old code ignores the column; nulls behave as today. Mirror copy in `apps/carefind/sql/` (release gate).

## 2. Server-backed withdrawal draft — APPROVED

Reload / return-from-email wipes the form and `sent` flag; the re-request burns the inbox code (the A-H1 loop).

1. At OTP-request time (`POST /api/withdrawal-pin/otp {purpose:withdrawal, amount, destination}`; purpose allowlist unchanged) the server validates amount + payout-account binding (no reservation, no money movement) and stores one live draft per (user, purpose): `{user, app, amount+unit, destination fingerprint (saved id or bankCode+accountNumber hash — never full number), purpose, draft_expires_at (10 min), otp_issued_at}`. Service-role-only posture mirroring `otp_challenges`. A new request voids the prior draft.
2. Reload resume: `GET /api/withdrawal-pin/draft` restores amount + masked destination (`••••1234`) + "code sent HH:MM · expires in M:SS · resend in N s". PIN/OTP fields always start empty. **No PIN/OTP/raw account numbers in browser storage or the draft, ever.**
3. Immutability: any amount/destination/purpose edit voids the draft and forces a fresh OTP. Submit re-validates payload against the live draft and refuses mismatches before `checkOtp`.
4. Cross-surface guard: Wallet ↔ Appointments, CareFind ↔ CareHub share the (user, purpose) draft lock; a second request with a live draft answers `409 draft_active` instead of burning the first code. New draft only after expiry or explicit void-and-reissue (with cooldown).
5. Boundary: drafts cover pre-reservation only. Any non-terminal `withdrawal_requests`/`business_withdrawal_requests` row → draft endpoint refuses resume and points at status (engine/sweep own it — Phase 2).

## 3. Resend discipline — APPROVED

Server 60s gap / 3-per-hour unchanged (no new rate logic). Client `WithdrawalOtpField` (both apps + Appointments dialog): countdown from server `resend_available_at` (`otp_issued_at + 60s`); live-draft state reads "Code sent · check your email (expires M:SS)"; explicit "Send a new code" only after cooldown with a voids-prior-code warning. Only new browser-persisted value: draft id + timestamps (non-sensitive, display-only; server re-validates on submit).

## 4. Input behaviour — APPROVED

`autocomplete="one-time-code"` + `inputMode="numeric"` + 6-digit strip already correct; manual entry is the fallback (email autofill best-effort, never guaranteed). Single fix: sanitize-then-truncate ordering so pasted `123 456`/`123-456` lands as `123456` (today `maxLength={6}` truncates first → 5 digits + disabled submit). Add the same transform on `onPaste`. Keep single-box input (no split-box rebuild). Clear dead values on `otp_superseded`/failure; existing clear-on-success stays.

## 5. Responses, logging, invariants — APPROVED

Public: `otp_invalid/expired/locked/missing` unchanged + new 400 `otp_superseded`; initiators map all five to 400; nothing secret leaves the server. Logging: existing `otp.*` events unchanged; add `otp.superseded_typed` (proves A-H1 is shrinking) and `draft.voided {reason}`. H-10 ordering kept deliberately (OTP before bank/limits/reservation; full reorder deferred). Auth/CSRF posture unchanged; draft endpoints reuse `/api/withdrawal-pin/otp` gates.

## 6. Tests, rollout, non-goals — APPROVED

Tests: PGlite migration cases (superseded match, null-reason legacy rows, no-live-row→`none`, attempts untouched, replayed-`used` stays `invalid`); real-Postgres concurrency (`PG_CONCURRENCY_URL`: 30 racing verifies → 1 `ok`, supersede-typing storm burns no live attempts); draft/resend races (`draft_active`, void-on-edit, expiry); both apps' handler suites (draft mismatch refused before `checkOtp`, five codes propagate); UI cases (server-driven countdown, paste, dead-code clear, reload-restore with empty code). Commands per README (`npm test` per workspace, `test:finance`, `test:finance:pg`, builds, lint 0 errors) + mutation sense-check on the new branch.

Rollout: additive migration first (safe pre-deploy) → deploy both apps together → confirm `OTP_HMAC_SECRET` (open owner action) → watch `otp.superseded_typed` decay + `otp.verify_rejected{invalid}` drop. No Vault-secret dependency.

Non-goals: H-10 reorder/request-bound OTP; money/settlement/refund changes; fee/rate/unit changes; pickup-station/release-trigger work (decision gate pending); stuck `…3cec8dd` (Phase 2); KYC (stays OFF); any production writes, deploys, or real-money ops without separate authorisation.
