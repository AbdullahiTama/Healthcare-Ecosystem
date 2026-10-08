# The financial test suite (Phase 13)

Status: implemented. This phase did not add tests to reach a number; it asked, layer by layer, **would these tests notice if the money code were wrong?** and proved the answer with deliberate defects.

## 1. The layers

| Layer | What it proves | Where | Runs |
|---|---|---|---|
| Unit | one function's rules: provider adapter, retry, scheduler, effects, events, withdrawals, refunds helpers | `packages/shared-payments/src/__tests__` (323 tests, 97% line coverage) | `npm test` in the package |
| Handler | what each endpoint refuses, what it passes to the engine, what it never does (auth, validation, no database call on bad input) | `apps/carefind/api/**/*.test.js`, `src/test/payments/*Flow.test.js` | `npm run test:finance` |
| Database (real Postgres, PGlite) | every money migration replayed in order; the engines, their state machines, ACLs, immutability, reconciliation | `src/test/payments/*.db.test.js` | `npm run test:finance` |
| Concurrency (real Postgres server) | genuinely overlapping transactions: no double settlement, no lost update, no negative balance | `src/test/payments/*.pg.test.js` | `npm run test:finance:pg` (needs `PG_CONCURRENCY_URL`) |
| **Properties of the whole system** | after EVERY step of a seeded random program of real operations the books balance, and replaying every call twice ends in exactly the same books | `financialInvariants.db.test.js` | `npm run test:finance` |
| **Mutation** | the suite fails when the money code is deliberately broken | `src/test/payments/mutation` | `npm run test:mutation` |
| Scale | how the database behaves at 100x today's volume | `src/test/payments/bench` | `npm run bench:finance` (by hand) |

## 2. The invariants (`financialInvariants.db.test.js`)

A seeded random program (60 operations, four seeds) mixes top-ups, creator subscriptions, shop orders, card bookings, deliveries, the vendor release sweep, refunds that complete or fail (full and partial), and coin withdrawals that complete or fail, and runs them through the real engines. After every step: **I1** every coin wallet equals the sum of its ledger and the ledger chain is intact; **I2** nothing is negative; **I3** a business wallet equals the sum of its ledger (ignoring internal held-to-available moves). At the end: **I4** every card payment is split completely (shop total = vendor share + commission + fulfilment; booking = business share + commission); **I5** every settled payment has a provider transaction id and a paid entity; **I6** a refund never exceeds what was paid and the vendor recovery never exceeds the vendor's share; **I7** the database reconciliation finds nothing critical. **I8 (replay equivalence):** the same program with every engine call made twice ends in identical books (compared by name, not by generated id). A final test asserts that, across the seeds, every interesting behaviour really happened (completed and failed refunds, partial refunds, released and reversed credits, completed and refunded withdrawals, subscriptions), so the properties cannot pass vacuously. A failing seed replays exactly.

The properties found nothing in the engines as they stand. Their value is that the next change is held to them.

## 3. Mutation testing

`mutants.mjs` lists 25 deliberate defects (a check removed, a number changed, a guard disabled): the settlement amount check, the vendor credit amount, the replay guard on the booking credit, restoring a failed refund, marking a refunded order, the provider amount check on refunds, refunding on cancel, capping an approved return and a return request, the release sweep's live-refund guard, the withdrawal cap, the referral and shop commission rates, auto-resolving findings, the job gate, re-alerting an acknowledged finding, the vendor-credit reconciliation, tying a service-role return to its customer, and in Node: retrying business errors, the circuit breaker (never opening, opening on non-outages), the amount comparison with Paystack, releasing a failed alert, answering a settled intent from the database, treating a failed webhook event as handled. The runner applies each, runs the tests meant to catch it, requires a failure, and **always restores the file** (`finally`, SIGINT/SIGTERM, a backup directory that is restored first on the next start). A `find` that stops matching exactly once is reported INVALID, so a mutant cannot silently stop applying when the code moves.

**First run: 21 of 24 killed; the 3 survivors were real holes, now closed:**
* the shop-return amount cap: the mutant targeted a migration a later one had replaced (the test was right; the mutant was stale), now aimed at the live definition and killed;
* the vendor-credit reconciliation `credit_amount_mismatch` branch had **no test** (added);
* a webhook event that failed was not covered at the unit level (`events.js` had no tests of its own: added).
**Final: 25 of 25 killed.**

## 4. What the review found (beyond the tests)

1. **A regression I introduced: shop returns were broken in production.** `request_shop_return` was hardened to refuse a caller with no `auth.uid()`, but its only caller is the server endpoint, which uses the service-role key and so has no user session: **every customer return request failed with "Not authorized"** from the moment `carefind_20261013_shop_return_hardening` was applied until `carefind_20261018_shop_return_service_caller`. No return had been requested in that window, as far as the data shows (the table is empty). The function now acts for the customer NAMED by a service-role caller (and applies the ownership test to that id); a signed-in caller can never use the parameter; the endpoint passes the authenticated user's id. Applied to production; pinned by database tests (the production path, spoofing, anon) and a handler test; mutant M18 guards it.
2. **The refund engine's tests ran against code that is no longer live.** They loaded only the original migration, while production runs the later definitions of `request_refund` and `settle_refund` (shop orders, vendor recovery, timeouts). They now load the full chain.
3. **CI did not run the financial system.** It never ran the shared-payments package, never ran the real-Postgres concurrency suites (they skip without a database), and a change to a migration did not trigger it. A `finance-suite` job now runs all three against a Postgres service and is triggered by `supabase/**`.
4. `checkBalance` summed every currency's balance (the old F-26 suspicion, now confirmed in the code that the withdrawal path still uses): only NGN counts, with a test.
5. Gaps in handler coverage closed with tests: `request-shop-return`, `resolve-account`, `lookup-appointment`, `withdrawal-trust`, the retired `create-subaccount`, booking by CareCoins and the create-form validation, the Paystack helper libraries, the settlement effects, webhook events.
6. **Two exposures for Phase 14 (not fixed here):** `lookup-appointment` returns a patient's appointments (name, date, fee, payment status) to **anyone who knows a phone number and a business id**, with no sign-in and no rate limit; `resolve-account` is unauthenticated and returns the account holder's name for any bank account number (an enumeration oracle that also spends Paystack calls).

## 5. Coverage numbers (honest)

`shared-payments`: 97% of lines, 86% of branches. CareFind API money handlers: the card flows, webhook, withdrawal initiation, refunds, shop payment are 85-100%; `admin-auth.js` is 23% only because most of it is unrelated admin CMS actions (its money actions are tested); `booking.js` was 58% and is now covered through the credit path and validation. Coverage is a map of what is NOT tested, not a measure of quality; the mutation run is the measure.

## 6. How to run it

```
cd apps/carefind
npm run test:finance        # handlers + PGlite migrations/engines + the invariant suite (about 15-20 minutes on a laptop)
PG_CONCURRENCY_URL=postgres://postgres:pw@127.0.0.1:5432/postgres npm run test:finance:pg   # real concurrency, sequential
npm run test:mutation       # all mutants (about 40 minutes); or: node src/test/payments/mutation/run.mjs M02 N05
cd ../../packages/shared-payments && npm test
```

## 7. Not done

* The migrations are tested on PGlite and on a real Postgres 16-class server, never on Supabase's own stack (GoTrue roles, extensions): production catalog checks after every apply remain the last line.
* Mutants exist for the highest-value defects; the list should grow with every bug found (add the mutant that would have caught it).
* No end-to-end browser test of a payment (Paystack sandbox); the provider contract is tested with recorded-shape fakes.
* CareHub's API handlers were not re-audited in this phase (its suite is unchanged and passing).
