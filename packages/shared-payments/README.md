# @care-ecosystem/shared-payments

Server-side payment provider abstraction for CareFind + CareHub (Phase 03 of the financial program).
**Server only** — it reads secret keys. Never import it from browser code.

Status: built and tested; **not yet wired into either app** (existing `_lib/paystack*.js` calls are unchanged until Phase 04/06 migrate flows onto it).

```js
import { PaystackProvider } from '@care-ecosystem/shared-payments'

const paystack = new PaystackProvider({ getSecretKey: () => process.env.PAYSTACK_SECRET_KEY })
const tx = await paystack.verifyPayment({ reference })   // -> { status, amountKobo, currency, metadata, ... }
```

## Contract (`PROVIDER_METHODS`)
`initializePayment`, `verifyPayment`, `refundPayment`, `resolveAccount`, `createRecipient`, `initiateTransfer`, `verifyTransfer`, `getBalance`. Money is always an **integer number of kobo** (`amountKobo`); floats are rejected locally before any network call. Responses use provider-neutral statuses; an unrecognised provider status is an error (`verifyPayment`) or `'unknown'` (`verifyTransfer`) — never guessed.

## Resilience rules
| Situation | Behaviour |
|---|---|
| Timeout (default 8 s/attempt) | `ProviderError{code:'timeout'}` |
| **Read** (GET) timeout / network error / 500-504 | retried (max 3 attempts, jittered backoff, 15 s total budget) |
| **Write** (POST) timeout / network error / 5xx | **never retried**; error has `ambiguous: true` — look the operation up by reference before acting |
| 429 | retried for every method (the provider did not process it); honours `Retry-After`, capped |
| 401/403 | `auth`, generic message, never retried |
| 404 | `not_found` (unknown reference — distinct from "failed") |
| "duplicate reference" | `duplicate_reference` (callers verify, they do not re-send) |
| HTTP 200 with `status:false` | `provider_rejected` |

Every call carries a correlation id (`X-Correlation-Id`, in every log line and error). Logs never contain the Authorization header or query strings (account numbers). Secrets are scrubbed from every surfaced message, and the key lives in a private field (not printable, serialisable or enumerable).

## Errors
All failures are `ProviderError` with `code`, `retryable`, `ambiguous`, `httpStatus`, `attempts`, `correlationId`, `operation`.

## Out of scope here
Webhook signature verification (Phase 11), Flutterwave/Kora (not planned), persistence (payment intents / events live in the database, Phase 02).

## Tests
`npm test` — 105 tests: HTTP policy, Paystack request/response shapes, validation, secrecy.
