---
title: 'CareFindHub Team Agents: registration, approval, referrals, earnings, transfer, self-service'
type: 'feature'
created: '2026-09-05'
status: 'in-progress'
baseline_commit: '3fb2685b1dd8af14cd225045c291690bbd99a86b'
review_loop_iteration: 0
context:
  - 'apps/carefind/sql/20260906_carefindhub_foundation.sql'
  - 'apps/carehub/src/services/supabase.js'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Agents need self-registration with `CF-` referral code, admin review/placement (tier/parent/commission), referral tracking on business signup, earnings via `plan_value×commission_pct` across tier hierarchy (direct→community→state), 20-agent cap for community coordinator, transfer audit, and secure self-service portal.

**Approach:** Build `agents` registration (`tier=unplaced/status=pending` + unique `CF-` code), `Applications` review → set `tier/parent_agent_id/commission_pct` → `approved`, `agent_referrals` on business `referral_code` use, earnings via `security-definer` `calculate_agent_earnings` (idempotent, `plan_value×pct` for 3 tiers), enforce 20-cap via DB trigger, `agent_transfers` audit on reassignment, and `/agent-login` with `agents.email/password_hash` checking `own-record` RLS/service-role.

## Boundaries & Constraints

**Always:** Use `agents` table (`full_name,email unique,password_hash,referral_code unique CF-...,tier,parent_agent_id FK,state,commission_pct,status pending/approved`); use `agent_referrals`/`agent_earnings`/`agent_transfers`; earnings via `calculate_agent_earnings` `security-definer` following `credit_wallet` pattern, idempotent via `payment_reference` partial unique; `agent_tiers.max_children=20` enforced server-side via trigger, not UI only.

**Ask First:** Changing `commission_pct` calculation (flat vs tier-specific); adding new tier types.

**Never:** Calculate earnings client-side; allow webhook retries to duplicate earnings; allow non-owner to see other agent's referrals/earnings via UI hide only.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Register | `full_name,email,password,state` | Row `tier=unplaced,status=pending`, `referral_code` `CF-xxxxxx` unique | Email duplicate → 23505 |
| Referral code | Business signup with `referral_code` | `agent_referrals` inserted `agent_id, business_id` | Invalid code → no referral, no error |
| Approval | Admin sets `tier/parent/commission` → `approved` | `status=approved`, `parent_agent_id` set, commission set | 20-cap violation → 42501 |
| Earnings | Business pays `10000` with `10%` direct, `5%` parent, `3%` state | `agent_earnings` 3 rows `1000,500,300` via `calculate_agent_earnings` | Webhook retry → no duplicate (idempotent) |
| Transfer | Reassign `agent_referrals`/`agent_earnings` to another `agents.id` | New owner, `agent_transfers` audit `from/to/by/when` | Requires confirmation |
| Self-service | Agent logs in `/agent-login` | Sees only own `referral count, paid/unpaid earnings` | Other agent’s data 42501 |

</frozen-after-approval>

## Code Map

- `apps/carefind/sql/20260906_carefindhub_foundation.sql:238` -- `agents` table + `CF-` trigger `generate_agent_referral_code`, `agent_tiers` 20 cap, `enforce_agent_tier_limit` trigger, `calculate_agent_earnings` security-definer.
- `apps/carehub/src/services/supabase.js:72` -- `BUSINESS_PUBLIC_COLUMNS` + referral_code handling for `agent_referrals`.
- `apps/carefind/src/pages/` or `carefindhub` agent portal -- registration form, Applications review, earnings display.

## Tasks & Acceptance

**Execution:**
- [ ] `apps/carefind/src/modules/agents-hub/AgentRegistration.jsx` (new) -- form `full_name,email,password,state` → `insert agents` with `tier=unplaced,status=pending`, generate `CF-` code via trigger, show code.
- [ ] `apps/carefind/src/modules/agents-hub/AgentApproval.jsx` (new) -- admin `Applications` list `agents where status=pending`, set `tier/parent_agent_id/commission_pct` + `status=approved` via `update` with 20-cap check (server 42501), show `20/20` count.
- [ ] `apps/carefind/src/modules/agents-hub/AgentEarnings.jsx` (new) -- on business payment webhook, call `calculate_agent_earnings(business_id, plan_value, payment_reference)` for 3 tiers, idempotent.
- [ ] `apps/carefind/src/modules/agents-hub/AgentTransfer.jsx` (new) -- reassign `agent_referrals`/`agent_earnings` + insert `agent_transfers` audit, confirm.
- [ ] `apps/carefind/src/pages/AgentLogin.jsx` (new) -- `/agent-login` via `agents.email/password_hash` (check `crypt`), `own-record` RLS/service-role scoping, show only own referrals/earnings.

**Acceptance Criteria:**
- Given agent registers, when submitted, then `tier=unplaced/status=pending` and `referral_code` `CF-…` unique
- Given business signs up with `referral_code`, when completed, then `agent_referrals` inserted
- Given admin approves with `tier/parent/commission`, when saved, then `status=approved` and parent set, 21st to full coordinator rejected 42501
- Given business pays, when webhook fires twice, then `agent_earnings` has one set (idempotent) for each tier
- Given transfer, when reassigned, then new owner and audit row
- Given agent logs in, when viewing portal, then only own referrals/earnings visible

## Spec Change Log

## Design Notes

`CF-` code `6 hex` via `generate_agent_referral_code` trigger, `lower(email)` unique, `commission_pct` per agent or per tier default 10/5/3. Transfer audit `agent_transfers` columns `from_agent_id,to_agent_id,by_admin_id,at`.

## Verification

**Commands:**
- `npm test -- src/modules/agents-hub/` -- expected: registration, approval, 20-cap, earnings idempotent, transfer audit, self-service isolation
- `npm run build` (apps/carefind) -- expected: vite build clean
