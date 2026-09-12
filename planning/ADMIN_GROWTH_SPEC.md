# Admin Growth — Agents, Coverage, Performance Spec

**Status:** Draft for review — implements brainstorm 2026-09-08 (Growth P0, owner lens)
**Owner lens:** Growth is not “how many agents”. It’s “which agent, where, earns what, and where you’re blind”.
**Existing surface audited:** `pages/admin/AdminDashboard.jsx:649` TeamAgentsPanel (tiers, parent cap 20, transfer audited, earnings), `referral/AdminReferralPanels.jsx` Coverage, `services/supabase.js:544` agentTiers/agents/referrals/earnings/transfers, `knowledge/modules/referral-agent.md`, `sql/20260802_referral_agent_program.sql`.

---

## 1. Goal

As owner, I hire the admin to **see the field, pay the field, and where the field is thin**:
- **Field:** agent tree `state → community_coordinator (20 cap) → agent → referrals`
- **Pay:** `agent_earnings` → `payout_requests` → `paid` (Money already has payout guard)
- **Thin:** coverage gaps `state/LGA/city` vs agent density, `plan_payments.is_first_payment` conversion.

## 2. Invariants

1. **20 cap is law.** `community_coordinator` max 20 children enforced by DB trigger (or app check `updateAgentRow`  max children `TeamAgentsPanel:699`). Admin transfer must respect it.
2. **Commission is server-side.** `calculate_agent_earnings` RPC (paystack webhook) never client math — admin shows, never computes.
3. **Coverage is from `agent_referrals.business_id` → `businesses.state/LGA`.** Not agent self-reported `state` alone.

## 3. Data Model (existing + 1 view)

Existing: `agent_tiers`, `agents` (id, full_name, email, state, tier, parent_agent_id, commission_pct, referral_code, status), `agent_referrals` (agent_id, business_id), `agent_earnings` (agent_id, business_id, payment_reference, commission_pct, amount_owed, amount_paid, status), `agent_transfers`.

New view (security_invoker, admin-only read filtered by is_platform_admin):
```sql
create or replace view agent_performance with (security_invoker=true) as
  select a.id, a.full_name, a.state, a.tier, a.parent_agent_id,
         count(distinct ar.business_id) as referrals,
         count(distinct case when pp.is_first_payment then pp.id end) as converted,
         coalesce(sum(ae.amount_owed),0) as owed, coalesce(sum(ae.amount_paid),0) as paid,
         max(ae.created_at) as last_earning_at
  from agents a
  left join agent_referrals ar on ar.agent_id=a.id
  left join plan_payments pp on pp.business_id=ar.business_id
  left join agent_earnings ae on ae.agent_id=a.id
  group by a.id;
```

## 4. Screens (Growth) — what you click

### G1 — Hierarchy Tree
**File:** `pages/admin/growth/Hierarchy.jsx`
**Viz:** collapsible tree `state → state_coordinator → community_coordinator (cap 20 badge) → agents` — built from `agents` + `parent_agent_id`. Each node shows `referral_code`, `state`, `tier`, child count `3/20`. Click → agent drawer `TeamAgentsPanel:762` Manage (tier migration, transfer).
**Search:** `full_name/email/referral_code` ilike, filter `state`, `tier`.
**States:** loading skeleton, empty “No agents”, error Retry, responsive tree → list 768.

### G2 — Performance Board
**File:** `growth/Performance.jsx`
**Table 36px sticky:** `Agent | State | Tier | Referrals | Converted (is_first_payment) | Conv % | Owed ₦ | Paid ₦ | Last earning | Trend 7d` — sorts sortable, `owed` red if > `paid` + 30d overdue.
**Trend sparkline 7d from `agent_earnings.created_at`.**
**Click agent → Ledger `getLedgerForEntity:578` statement modal (already exists) + earnings drill `getAgentEarningsByAgent`.
**CSV export** with `export_logs` watermark (reuse Health export governance).

### G3 — Coverage Gaps
**File:** reuse `ReferralCoveragePanel` but enhanced: heatmap `state` choropleth + list `LGA: agent count / business count → gap score` (`businesses.state` vs `agents.state` density). “Thin” sorted top.

### G4 — Campaign (stub)
**File:** `growth/Campaign.jsx` — promo code + referral link generator (reuses `agents.referral_code` CF-…), next slice.

## 5. Security & Correctness

- `agent_performance` is `security_invoker` so RLS still scopes — admin reads via `is_platform_admin()`, tenant never.
- Transfer `transferAgentAccount:557` is audited `agent_transfers` + respects 20 cap (server check, client pre-check `TeamAgentsPanel:699`).
- Advisors: no new ERROR.

## 6. States, Responsive, A11y

- Loading skeleton, error Retry, empty “No agents for filter”, 36px → card, aria-label, reduced-motion.

## 7. Slices

1. **G1 Tree read-only** (no new table, just `agents` hierarchy)
2. G2 Performance (view `agent_performance` + `agent_earnings`)
3. G3 Coverage heatmap (join `businesses` + `agents`)
4. G4 Campaign

Each: repo seam, RLS probe, 5 tests, build clean.

## 8. DoD

- [ ] Repository injected
- [ ] RLS verified
- [ ] Loading/error/empty + responsive
- [ ] No alert
- [ ] Tests
- [ ] Audit every write

---
*Next: implement G1 → G2 → …*
