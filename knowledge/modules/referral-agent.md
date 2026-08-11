# Referral Agent Program — CareHub

## Purpose
Recruit a field force of referral agents who own a `city + area`, bring healthcare businesses onto CareHub through a personal referral code, and earn a commission on every payment those businesses make. Momentum model: **40% of the business's first payment, 5% of every subsequent payment**, computed on the actual Naira charged. Money transfer stays manual at v1 — the system records the payout ledger, CareHub pays.

## Files
- `apps/carehub/sql/20260802_referral_agent_program.sql` — migration (tables, trigger, RLS). **NOT YET APPLIED** — run via Supabase SQL editor after code review.
- `apps/carehub/api/_lib/commissions.js` — **the money path** (`computeCommission`), service-role only.
- `apps/carehub/api/verify-plan-payment.js` — calls `computeCommission` after a confirmed `plan_payments` insert; is the single trust anchor (Paystack verification).
- `apps/carehub/src/lib/referral_program.js` — single source of truth for rates + the inactive-agent flag (`REFERRAL_RATES`, `ACCRUED_WHILE_INACTIVE`), and `generateReferralCode()`.
- `apps/carehub/src/services/supabase.js` — "REFERRAL AGENT PROGRAM" block: agent queries, application form, admin ledger/payout/coverage functions.
- `apps/carehub/src/lib/email.js` — `emailAgentApproved` / `emailAgentRejected` templates.
- `apps/carehub/src/App.jsx` — agent identity state (`carehub_agent_auth` localStorage), routes `apply-agent`, `agent/login`, `agent/*`.
- `apps/carehub/src/pages/agent/AgentLogin.jsx` — real Supabase Auth sign-in, gated to `active` agents.
- `apps/carehub/src/pages/agent/ApplyAgent.jsx` — public application form (incl. city/area + motivation/experience).
- `apps/carehub/src/modules/referral-agent/AgentDashboard.jsx` — tabbed agent UI (Overview, Referrals, Commissions, Payouts, Support Log, Activity).
- `apps/carehub/src/pages/admin/referral/AdminReferralPanels.jsx` — admin panels: Applications / Agents / Ledger / Payouts / Coverage.
- `apps/carehub/src/pages/admin/AdminDashboard.jsx` — hosts the five referral tabs.
- `apps/carehub/src/pages/auth/Register.jsx` — `?ref=CODE` cause cap to apply `referral_code_used`.
- `apps/carehub/src/pages/Landing.jsx` — "Become a Referral Agent" section linking `/apply-agent`.

## Components
- `AgentDashboard.jsx` (default export in `modules/referral-agent/`): six tabs, per-tab subcomponents (`ReferralList`, `CommissionsView`, `PayoutsView`, `SupportLogView`, `ActivityFeed`).
- `AdminReferralPanels.jsx`: five named exports wired to AdminDashboard tabs. Self-contained `useApi(fn)` fetch hook per panel.

## Services
- Client (`supabase.js`): `getAgentByEmail`, `getAgentCommissions(id)`, `getAgentPayouts(id)`, `getAgentSupportLogs(id)`, `addAgentSupportLog`, `submitAgentApplication`, admin: `getAgentApplications`, `reviewAgentApplication`, `getAgents`, `addAgentRow`, `updateAgentRow`, `getCommissionsLedger`, `updateCommission`, `getCommissionReviewFlags`, `getPayouts`, `createPayout`, `updatePayout`. `getAgentPortfolio()` goes **only** through the `rpc/get_agent_portfolio` database function (the `businesses` table carries plaintext password columns and must never be reachable from an agent session).

## Server money path
`verify-plan-payment.js` (service-role) → `computeCommission(supabase, { ·payment_id, businessId, nairaCharged, isFirstPayment })`:
1. Read the agent via `businesses.referring_agent_id`.
2. No agent → no-op. Agent `active`? create `commissions` row (type `referral_bonus` rate 0.40 on first payment, else `residual` 0.05). UNIQUE(`payment_id`) is the double-charge guard.
3. Agent not active → **no commission**; insert a `commission_review_flags` row (reason) so an admin reconciles it.

Constraints:
- `Raw commission must never fail a customer's confirmed plan` — any commission error is swallowed and leaves a legacy-flag, never a 500.
- Naira is computed as `amount / 100` (Paystack `amount` is in kobo).
- Client never passes an agent id. The DB trigger resolves `referral_code_used` to a live (`active`) agent, and self-referral (agent email == business email) silently voids attribution.
- Agent status lifecycle: `approved_pending_onboarding` (created on approve) → `active` (after training), or `suspended`. Only `active` codes resolve.

## Database Tables
`agents` (city+area, status, referral_code unique), `agent_applications`, `commissions` (agent_id, business_id, payment_id, type, amount, rate, status accrued/payable/paid/void), `commission_review_flags`, `payouts` (commission_ids jsonb, status pending/processed/failed), `agent_support_logs`. `businesses.referring_agent_id` + `referral_code_used`; `plan_payments.is_first_payment`.

## Current State
Implemented per `planning/20260802_referral_agent_program_plan.md`; `npm run build` passes. SQL not yet applied. No test runner; the plan (§11) lists manual server/RLS probes to run after the migration is applied live.

## Missing Documentation
Agent authentication relies on the same "email row owned by Supabase Auth session" RLS model as businesses — `auth.users` must exist for each agent row the program creates (login fails for a pure `agents` row). Confirm the account provisioning step for agents before going live.