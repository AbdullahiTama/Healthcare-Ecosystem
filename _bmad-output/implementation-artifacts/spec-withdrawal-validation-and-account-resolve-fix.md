---
title: 'Withdrawal Validation and Account Resolution Fix'
type: 'bugfix'
created: '2026-09-05'
status: 'done'
route: 'one-shot'
---

## Intent

**Problem:** Wallet withdrawals were broken in two ways: (1) the Paystack `/bank/resolve` endpoint was called with POST + JSON body instead of GET + query params, causing Paystack to return an empty response and `response.json()` to throw "Unexpected end of JSON input"; (2) the withdrawal amount validation used a falsy check (`wallet?.available_balance && ...`) that silently skipped validation when balance was 0, and had no `max` attribute or visual error on the input.

**Approach:** Fix the API call to use GET with query params per Paystack docs. Add defensive response parsing in `paystackFetch`. Fix balance validation across all three withdrawal forms (CareFind Wallet, CareHub Wallet, CareHub Appointments). Add visual error messages, proper `max` attributes, and disabled submit buttons when amount exceeds balance.

## Suggested Review Order

**API Fix (Root Cause)**

- Paystack /bank/resolve changed from POST to GET with query params
  [`paystackTransfer.js:64`](../../../apps/carefind/api/_lib/paystackTransfer.js#L64)

- Same fix mirrored in CareHub paystackTransfer lib
  [`paystackTransfer.js:68`](../../../apps/carehub/api/_lib/paystackTransfer.js#L68)

**Defensive Response Parsing**

- paystackFetch now reads text first, checks empty, parses safely
  [`paystack.js:38`](../../../apps/carefind/api/_lib/paystack.js#L38)

- Same defensive parsing in CareHub paystack lib
  [`paystack.js:29`](../../../apps/carehub/api/_lib/paystack.js#L29)

**Amount Validation**

- Falsy balance check fixed: `amountKobo > (wallet?.available_balance || 0)`
  [`Wallet.jsx:103`](../../../apps/carehub/src/modules/wallet/Wallet.jsx#L103)

- Same fix in Appointments withdrawal
  [`Appointments.jsx:280`](../../../apps/carehub/src/modules/appointments/Appointments.jsx#L280)

- Early-return guard in CareFind handleWithdraw
  [`Wallet.jsx:213`](../../../apps/carefind/src/modules/wallet-payments/Wallet.jsx#L213)

**UI Guards**

- Visual error + max attribute + disabled button when amount exceeds balance
  [`Wallet.jsx:225-228`](../../../apps/carehub/src/modules/wallet/Wallet.jsx#L225)

- Same pattern in Appointments modal
  [`Appointments.jsx:540-543`](../../../apps/carehub/src/modules/appointments/Appointments.jsx#L540)

- CareFind: visual error, max attr, Number() coercion fix
  [`Wallet.jsx:485-497`](../../../apps/carefind/src/modules/wallet-payments/Wallet.jsx#L485)

**Incidental Fixes**

- Missing setWithdrawing(false) on null session in Appointments
  [`Appointments.jsx:286`](../../../apps/carehub/src/modules/appointments/Appointments.jsx#L286)

- Missing setWdAccountResolved(false) after successful withdrawal
  [`Wallet.jsx:250`](../../../apps/carefind/src/modules/wallet-payments/Wallet.jsx#L250)

- Account number input sanitized to digits-only, 10 chars max
  [`Wallet.jsx:523`](../../../apps/carefind/src/modules/wallet-payments/Wallet.jsx#L523)
