---
title: 'Pricing Structure Update — Affordable Adoption'
type: 'feature'
created: '2026-08-28'
status: 'done'
baseline_commit: 'c96f769d759157dfa6189dbe449659ff0f67b2fc'
review_loop_iteration: 0
context:
  - 'docs/PROJECT_OVERVIEW.md'
  - 'architecture/Current-Architecture.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Current CareHub plans (Basic 10k/mo, Growth 25k/mo, Hospital 35k/mo, Enterprise 60k/mo) are monthly and misaligned with the requested affordable yearly pricing that encourages adoption. Limits are single-location for Basic and no product cap, and Hospital has its own plan — diverging from the market requirement.

**Approach:** Replace plan catalog with Basic ₦60k/yr (2 locs/5 staff/5k products, no hospitals), Growth ₦100k/yr (5 locs, unlimited, hospitals start here), Premium ₦150k/yr (10 locs), Enterprise ₦250k/yr (30 locs), Custom (bespoke). Enforce limits client-side and server-price via yearly lookup; keep monthly math for backward compat but derive from yearly.

## Boundaries & Constraints

**Always:** Single source of truth remains `src/lib/planLimits.js`. Server (`api/initiate-plan-payment.js`) looks up price, never trusts client. Yearly price is canonical; monthly derived as `Math.round(yearly/12)`. Enforce product cap for Basic (5,000). Hospitals blocked from Basic at registration and plan-change. Use shared UI, loading/error states, responsive/a11y. Existing `plan='basic'` rows remain valid; migration not needed (column holds string).

**Ask First:** Whether to add DB check constraint for maxProducts. Whether Custom pricing is negotiated offline (no Paystack price).

**Never:** Do not duplicate plan constants across files. Do not weaken staff/location enforcement. Do not change wallet/referral/email logic.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output | Error Handling |
|----------|--------------|----------------|----------------|
| Basic limits | Basic plan, try add 3rd location or 6th staff or 5001st product | Blocked with “Basic allows 2 locations / 5 staff / 5,000 products — upgrade” toast | No DB write, show upgrade CTA to Settings |
| Hospital gate | Hospital business_type with plan=basic | Registration and Settings show “Hospitals start from Growth — ₦100k/yr” and block selection | Reject at validate, keep plan as growth minimum |
| Yearly billing display | Any plan in Settings/Landing | Shows ₦60k/100k/150k/250k per year and derived per-month | — |
| Renewal | Owner clicks Renew 12 months | Paystack charged yearly price (not monthly*10) | Server validates months=12 against yearly table |
| Custom | Enterprise/Custom inquiry | “Talk to us” CTA, no Paystack price, contact support | Show info, not error |

</frozen-after-approval>

## Code Map

- `apps/carehub/src/lib/planLimits.js:1` -- Single source of truth (limits, labels, monthly). Expand to yearly, new limits, hospital gate helper.
- `apps/carehub/src/pages/Landing.jsx:31` -- PLANS array (4 cards, monthly, hospital). Replace with 5 cards yearly.
- `apps/carehub/src/modules/settings/Settings.jsx:223` -- Billing card uses PLAN_MONTHLY_NAIRA + monthly*10 for 12mo. Switch to yearly.
- `apps/carehub/api/initiate-plan-payment.js:5` -- Imports PLAN_MONTHLY_NAIRA, computes naira = monthly*(months==12?10:1). Update to yearly lookup.
- `apps/carehub/src/modules/locations/Locations.jsx:1` -- Checks maxLocations via planLimitsFor. Needs updated limits (2 for Basic).
- `apps/carehub/src/modules/staff/Staff.jsx:1` -- Checks maxStaff. Needs 5 cap for Basic.
- `apps/carehub/src/modules/inventory/Inventory.jsx:1` -- No product cap today. Add 5k guard for Basic.
- `apps/carehub/src/pages/auth/Register.jsx:1` -- No hospital gate. Add validation “Hospitals start from Growth”.
- `apps/carehub/src/lib/__tests__/planLimits.test.js:1` -- Tests for old limits/pricing. Update to new expectations.

## Tasks & Acceptance

**Execution:**
- [ ] `apps/carehub/src/lib/planLimits.js` -- Redefine PLAN_LIMITS/LABELS, add PLAN_YEARLY_NAIRA {basic:60000,growth:100000,premium:150000,enterprise:250000,custom:null}, add maxProducts, add hospital gate helper `isPlanAllowedForBusinessType(plan,businessType)`, keep PLAN_MONTHLY_NAIRA derived for compat.
- [ ] `apps/carehub/src/pages/Landing.jsx` -- Replace PLANS with yearly cards: Basic ₦60k/yr (2 locs/5 staff/5k products), Growth ₦100k/yr (5 locs), Premium ₦150k/yr (10 locs), Enterprise ₦250k/yr (30 locs), Custom (bespoke) — keep 5-column grid responsive, Most Popular on Growth.
- [ ] `apps/carehub/src/modules/settings/Settings.jsx` -- Show yearly price + per-month equivalent, list limits, fix Renew buttons to yearly amounts, block hospital+Basic with message.
- [ ] `apps/carehub/api/initiate-plan-payment.js` -- Switch to PLAN_YEARLY_NAIRA lookup, handle Custom rejection, compute naira = yearly for 12mo else monthly derived.
- [ ] `apps/carehub/src/modules/locations/Locations.jsx` + `Staff.jsx` + `Inventory.jsx` -- Enforce new limits with upgrade toast; Inventory adds product count guard.
- [ ] `apps/carehub/src/pages/auth/Register.jsx` -- Add hospital→Growth validation and plan initial assignment (hospitals forced to growth).
- [ ] `apps/carehub/src/lib/__tests__/planLimits.test.js` -- Update tests to new caps/prices and add hospital gate cases.

**Acceptance Criteria:**
- Given Basic plan, when try add 3rd location/6th staff/5001st product, then blocked and upgrade prompt shown.
- Given business_type=hospital, when Register or Settings tries Basic, then blocked with “Hospitals start from Growth” and plan auto-upgraded to growth.
- Given Landing visited, when pricing grid rendered, then 5 cards shown with yearly prices ₦60k,100k,150k,250k,Custom and correct limits.
- Given Settings billing, when viewing plan, then yearly price displayed and Renew 12 months charges yearly amount (e.g. Basic ₦60k).
- Given initiate-plan-payment called with months=12 for Basic, when business.plan=basic, then Paystack amount = 60000*100 kobo (not 10000*10).
- Given Custom plan, when Renew attempted, then API returns 400 “Contact sales — custom pricing”.

## Spec Change Log

## Design Notes

Yearly is canonical to match market brief; monthly kept derived to avoid breaking existing monthly renew paths. Premium/Enterprise extra features are label only today. Custom has no price — sales handles offline.

## Verification

**Commands:**
- `npm run build` in `apps/carehub` -- expected clean
- `npm test run` -- expected planLimits tests pass + no regressions
- Manual: Register hospital → forced Growth; add limits → blocked.

