---
title: 'Referrer System — Code, Linkage, Earnings'
type: 'feature'
created: '2026-08-28'
status: 'done'
baseline_commit: 'e0485273aab3c22499cf0264c2595b3212a8cc6a'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Referral tracking was only via URL ?ref=CODE, no explicit field, no No Referrer option, and referrer earnings visibility incomplete.

**Approach:** Add Referrer Code input + No Referrer checkbox on Register (step 4), auto-link via referral_code_used, ensure every referrer has unique code, show referred businesses and earnings (total/paid/outstanding) in AgentDashboard, admin tracks via existing ledger.

## Boundaries & Constraints

**Always:** Code is unique, generated via generateReferralCode, link via apply_referring_agent trigger. No manual tracking. No Referrer sends null. UI respects ?ref param prefill.

**Never:** Do not duplicate referral logic; do not weaken RLS.

## I/O & Edge-Case Matrix

| Scenario | Input | Expected Output | Error |
|----------|-------|-----------------|-------|
| Manual code | Enter CH-XXXX, submit | referral_code_used = uppercased code | Trim, upper |
| No Referrer | Check box | referral_code_used = null regardless of input | — |
| URL prefill | /register?ref=CH-ABC | Field prefilled, banner shows invited | — |
| Agent earnings | Agent views dashboard | Shows total/paid/outstanding, pending | — |

</frozen-after-approval>

## Code Map

- `apps/carehub/src/pages/auth/Register.jsx:1` -- Added referrer field + No Referrer + referralInput logic
- `apps/carehub/src/modules/referral-agent/AgentDashboard.jsx:1` -- Added paid/outstanding calc and Clock stat
- `apps/carehub/src/lib/referral_program.js:1` -- Existing rates (40%/5%)

## Tasks & Acceptance

**Execution:**
- [x] Register: referrer Code input + No Referrer toggle + referralInput handling
- [x] AgentDashboard: total/paid/outstanding stats with Clock icon
- [x] Verify unique code generation and admin ledger remains

**Acceptance:**
- Given Register with manual code, when submit, then referral_code_used = code uppercased; No Referrer → null; URL ?ref prefilled.
- Given agent with commissions, when overview opened, then Total/Paid/Outstanding shown correctly.

## Spec Change Log

## Design Notes

Leverages existing agents/commissions tables; No Referrer is explicit null to distinguish from missing.

## Verification

- `npm run build` -- clean
- Manual: register with code → agent portfolio shows business; agent sees earnings breakdown

## Suggested Review Order

- Register referrer field
  [`Register.jsx:245`](../../apps/carehub/src/pages/auth/Register.jsx#L245)

- Agent earnings
  [`AgentDashboard.jsx:62`](../../apps/carehub/src/modules/referral-agent/AgentDashboard.jsx#L62)
