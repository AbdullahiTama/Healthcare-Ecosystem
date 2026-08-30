---
title: 'Shop Pricing Engine — Commission, Fulfilment, Delivery'
type: 'feature'
created: '2026-08-30'
status: 'done'
baseline_commit: '02dae39'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Shop checkout needs to calculate three fees (vendor commission, customer fulfilment fee, customer delivery fee) based on segment, order total, and distance — but no pricing logic exists yet, so cart/checkout (Goal 3) cannot proceed without it.

**Approach:** Build pure, testable pricing engine functions: `calculateCommission(segment, orderTotal)`, `calculateFulfilmentFee(segment, orderTotal)`, `calculateDeliveryFee(distanceKm, segment)` with exact formulas from spec (commission 10%/5%/2.5%, fulfilment MAX(₦600,3%)/MAX(₦1500,2%)/MAX(₦350,1%), delivery FREE≤3km else ₦600/3km bracket). All functions pure (no side effects, no DB), fully unit-tested, ready for checkout wiring in Goal 3.

## Boundaries & Constraints

**Always:** All functions pure — no DB, no side effects, no async. Input validation (segment ∈ {retail,wholesale,distributor}, orderTotal ≥ 0, distanceKm ≥ 0). All amounts in kobo (integer). Handle edge cases: 0 order, 0 distance, invalid segment. 100% test coverage for all branches.

**Ask First:** If distance calculation uses Google Maps API (Goal 3 checkout), should pricing engine accept distanceKm as input or should it call Maps directly? Recommend: accept distanceKm as input (pure), let checkout handle Maps call.

**Never:** Don't mix pricing logic with checkout UI. Don't hardcode currency (assume NGN/₦, kobo). Don't round mid-calculation (only at final output).

## I/O & Edge-Case Matrix

| Scenario | Input | Expected Output | Error Handling |
|----------|-------|-----------------|----------------|
| Retail commission | segment='retail', orderTotal=350000 (₦3500) | 35000 (10% = ₦350) | Throw if segment invalid |
| Wholesale commission | segment='wholesale', orderTotal=1000000 (₦10000) | 50000 (5% = ₦500) | Throw if segment invalid |
| Distributor commission | segment='distributor', orderTotal=5000000 (₦50000) | 125000 (2.5% = ₦1250) | Throw if segment invalid |
| Retail fulfilment | segment='retail', orderTotal=350000 (₦3500) | 60000 (MAX(₦600, 3% of ₦3500=₦105) = ₦600) | Throw if segment invalid |
| Retail fulfilment high order | segment='retail', orderTotal=10000000 (₦100000) | 300000 (MAX(₦600, 3% of ₦100000=₦3000) = ₦3000) | Throw if segment invalid |
| Wholesale fulfilment | segment='wholesale', orderTotal=1000000 (₦10000) | 150000 (MAX(₦1500, 2% of ₦10000=₦200) = ₦1500) | Throw if segment invalid |
| Distributor fulfilment | segment='distributor', orderTotal=5000000 (₦50000) | 350000 (MAX(₦350, 1% of ₦50000=₦500) = ₦500) | Throw if segment invalid |
| Delivery ≤3km | distanceKm=2, segment='retail' | 0 (FREE) | Throw if distanceKm < 0 |
| Delivery 4-6km | distanceKm=5, segment='retail' | 60000 (₦600) | Throw if distanceKm < 0 |
| Delivery 7-9km | distanceKm=8, segment='retail' | 120000 (₦1200) | Throw if distanceKm < 0 |
| Delivery 10-12km | distanceKm=11, segment='retail' | 180000 (₦1800) | Throw if distanceKm < 0 |
| Delivery >12km | distanceKm=15, segment='retail' | 240000 (₦2400, 4 brackets) | Throw if distanceKm < 0 |
| Zero order | segment='retail', orderTotal=0 | commission=0, fulfilment=MAX(₦600,0)=₦600 | No error, valid edge case |
| Zero distance | distanceKm=0, segment='retail' | 0 (FREE) | No error, valid edge case |
| Invalid segment | segment='invalid', orderTotal=100000 | Throw Error('Invalid segment') | Throw immediately |
| Negative order | segment='retail', orderTotal=-1000 | Throw Error('Order total must be ≥ 0') | Throw immediately |
| Negative distance | distanceKm=-1, segment='retail' | Throw Error('Distance must be ≥ 0') | Throw immediately |

</frozen-after-approval>

## Code Map

- `apps/carefind/src/modules/shop/pricing.js` -- Pure pricing functions: `calculateCommission`, `calculateFulfilmentFee`, `calculateDeliveryFee`, `calculateTotalFees`. All kobo, all pure, all validated.
- `apps/carefind/src/modules/shop/pricing.test.js` -- 100% branch coverage: all segments, all distance brackets, all edge cases (zero, negative, invalid).
- `apps/carefind/src/modules/shop/Shop.jsx:1` -- Future checkout integration point (Goal 3 will import pricing.js).
- `apps/carefind/src/modules/shop/shopRepository.js:1` -- Already built (Goal 2), pricing engine is independent.

## Tasks & Acceptance

**Execution:**
- [ ] `apps/carefind/src/modules/shop/pricing.js` -- Pure functions: `calculateCommission(segment, orderTotalKobo)`, `calculateFulfilmentFee(segment, orderTotalKobo)`, `calculateDeliveryFee(distanceKm, segment)`, `calculateTotalFees({segment, orderTotalKobo, distanceKm})`. All validate inputs, throw on invalid. All amounts in kobo (integer).
- [ ] `apps/carefind/src/modules/shop/pricing.test.js` -- Unit tests: all segments (retail/wholesale/distributor), all distance brackets (0-3km, 4-6km, 7-9km, 10-12km, >12km), edge cases (zero order, zero distance, negative inputs, invalid segment). 100% branch coverage.
- [ ] `apps/carefind/src/modules/shop/pricing.js` -- Export `SEGMENTS` constant, `COMMISSION_RATES`, `FULFILMENT_RATES`, `DELIVERY_BRACKETS` for reference.

**Acceptance Criteria:**
- Given retail order ₦3500, when calculateCommission then returns ₦350 (10%)
- Given wholesale order ₦10000, when calculateCommission then returns ₦500 (5%)
- Given distributor order ₦50000, when calculateCommission then returns ₦1250 (2.5%)
- Given retail order ₦3500, when calculateFulfilmentFee then returns ₦600 (MAX(₦600, 3% of ₦3500=₦105))
- Given retail order ₦100000, when calculateFulfilmentFee then returns ₦3000 (MAX(₦600, 3% of ₦100000=₦3000))
- Given distance 2km, when calculateDeliveryFee then returns 0 (FREE ≤3km)
- Given distance 5km, when calculateDeliveryFee then returns ₦600 (4-6km bracket)
- Given distance 8km, when calculateDeliveryFee then returns ₦1200 (7-9km bracket)
- Given distance 11km, when calculateDeliveryFee then returns ₦1800 (10-12km bracket)
- Given distance 15km, when calculateDeliveryFee then returns ₦2400 (4 brackets × ₦600)
- Given invalid segment, when any function then throws Error('Invalid segment')
- Given negative orderTotal, when any function then throws Error('Order total must be ≥ 0')
- Given negative distanceKm, when calculateDeliveryFee then throws Error('Distance must be ≥ 0')
- Given zero orderTotal, when calculateCommission then returns 0, when calculateFulfilmentFee then returns ₦600 (minimum)
- Given zero distanceKm, when calculateDeliveryFee then returns 0 (FREE)

## Spec Change Log


## Design Notes

Pure functions only — no DB, no async, no side effects. All amounts in kobo (integer). Input validation throws immediately on invalid input (no silent defaults). Distance brackets: 0-3km FREE, 4-6km ₦600, 7-9km ₦1200, 10-12km ₦1800, 13-15km ₦2400, etc. (each 3km bracket adds ₦600). Checkout (Goal 3) will call these functions and integrate with Google Maps for distance calculation.

## Verification

**Commands:**
- `npx vitest run src/modules/shop/pricing.test.js --reporter=verbose` -- expected: all tests pass, 100% branch coverage
- `npx vite build --workspace=apps/carefind` -- expected: clean (no new dependencies)

**Manual checks:**
- Import pricing.js in Node REPL, call calculateCommission('retail', 350000) → returns 35000
- Call calculateDeliveryFee(8, 'retail') → returns 120000
- Call calculateCommission('invalid', 100000) → throws Error
- Call calculateDeliveryFee(-1, 'retail') → throws Error
