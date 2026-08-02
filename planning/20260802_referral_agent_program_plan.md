# CareHub Referral Agent Program — Integration Plan

Status: **IMPLEMENTED** (build green; SQL migration NOT yet applied to Supabase — see §11 probes) · Date: 2026-08-02 · CareHub only
Source spec: "CareHub Referral Agent Program" (business strategy + developer specification).

This plan is the planning/handoff step *before* implementation. Nothing here is shipped.

---

## 0. Where this feature lands in the existing codebase

Ground truth checked this session, not assumed:

- **Stack**: Vite + React 18, no test runner. Data access is one hand-rolled PostgREST layer,
  `src/services/supabase.js` (~800 lines). UI kit in `components/ui/index.jsx` (Card, StatCard,
  Pill, Modal, Inp, Sel, TealBtn, GhostBtn, Loading, Empty, ErrorState, Toast…). Design tokens in
  `styles/theme`.
- **Auth**: real Supabase Auth session reconciled in `App.jsx`; identity resolved to a row by email
  (`resolveAccountByEmail` in `services/supabase.js`, RLS helpers `current_business_ids()` /
  `is_platform_admin()` in `sql/phase2_rls_pilot.sql`). Platform admin = a `businesses` row with
  `is_platform_admin=true`, surfaced at `/admin` (`AdminDashboard.jsx`).
- **Payments**: Paystack via Vercel functions `api/initiate-plan-payment.js` +
  `api/verify-plan-payment.js`. On success the latter inserts a `plan_payments` row and extends
  `businesses.plan_expires_at`. **This function is the single trust anchor where a real money event
  is confirmed — it is where commissions must be created**, never client-side.
- **Signup**: `Register.jsx` → `registerBusiness()` INSERT into `businesses` (status `pending`,
  plan `basic`), then best-effort Supabase Auth provisioning.
- **Existing "territories"** (`territories` / `rep_territories`) are *enterprise-tenant* sales
  territories (a business's own reps). They are unrelated to this program's platform-level, area
  owned by a CareHub referral agent. Do not reuse them — free-text `city + area` on the agent row
  is the right v1 (spec 1.3's recommendation).

The feature is greenfield: no `agent`/`commission`/`payout`/`referral` code exists anywhere in
CareHub today.

---

## 1. Principles adopted for this build

1. **The commission logic is a server-side money path.** Agents earn real money; nothing client-side
   may compute, mutate, or trust commission state. `verify-plan-payment.js` is the only writer.
2. **Referral-code attribution only at v1** (spec §6 TBD #2). A business gets an agent only when it
   signs up *through* that agent's code/link, and the agent must be `active` for the code to resolve.
   No area-blind attribution that the payout math has not been agreed on yet.
3. **Product rules live in config, not hardcoded** (spec §6 closing note): commission rates in one
   immutable config module shared by server + client; agent/commission semantics (what blocks a
   payout) expressed as status values, never `if` branches scattered across screens.
4. **Every multi-status decision the spec marked TBD gets a rule that is safe by default and
   structurally changeable** (a config column / lookup), so the real answer can be dropped in
   without a schema change.
5. No security regression (AGENTS.md): agents get a real Supabase Auth account; self-referral is
   blocked at the database; codes resolve server-side, not by trusting the client.

---

## 2. Product rules — decided now vs deferred (spec §6)

| # | Rule | Decision for v1 | Mechanism if it must change later |
|---|---|---|---|
| 1 | Commission while agent `inactive`/`suspended` | **Pause.** Payment still recorded, no commission created, row flagged for review (spec's "default safe behavior"). | Toggle in `lib/referralProgram.js` (`ACCURED_WHILE_INACTIVE`, default false) |
| 2 | Area-based attribution (no referral code) | **Off.** Explicit-code only at v1 | A config flag; would additionally need the Territory table |
| 3 | What makes an agent `inactive` | **Manual only** (admin marks it). No automatic inactivity job at v1 | `agents.status` is a plain enum — an hourly job can set it later without schema change |
| 4 | Payout cadence & method | **Manual/exported batch.** Admin opens a payout run, marks commissions `paid`, no money transfer automation at v1 | `payouts.status` state machine; an automation can insert payouts later |
| 5 | Accrued-but-unpaid when agent leaves | **Void** accrued commissions on `suspended` (permanent); explicit, logged admin action | status transitions in the ledger |
| 6 | What is "first payment" | First successful `plan_payments` row for that business | `plan_payments.is_first_payment` bool, computed once at insert, server-side |
| 7 | Self-referral / fraud | Blocked: agent's own email used as business owner email → attribution rejected at insert (server trigger). No refund/void button at v1 | `commissions.status = 'void'` exists from day one |
| 8 | Overlapping/contested areas | Not a data-model problem at v1 — admin checks existing coverage in the review UI before approving | none (application is already reviewed per territory) |

Rates (spec §3): **40% referral bonus on first payment, 5% residual on every subsequent payment**,
computed on the actual Naira charged (`payment.amount * rate`). Billing-cycle agnostic by design.

**Open item to verify before writing the commission math:** `verify-plan-payment.js` stores
`naira_amount: amount`, but Paystack's `amount` is in **kobo** (the same value `initiate` multiplied
by 100). Confirm whether the live `plan_payments.naira_amount` is Naira or kobo, and compute the
commission on the true Naira charged.

---

## 3. Data model — `apps/carehub/sql/20260802_referral_agent_program.sql`

Follows the repo's migration style: idempotent (`IF NOT EXISTS`), RLS enabled per table, policy named
and DROPPed before CREATE. Uses the existing `is_platform_admin()` helper (already live).

```sql
-- ============================================================================
-- CareHub Referral Agent Program (spec §"Core Entities")
-- Status: NOT YET APPLIED — run via Supabase SQL editor after code review.
-- ============================================================================

create table if not exists public.agents (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  contact_email text not null unique,
  contact_phone text not null default '',
  city text not null,
  area text not null,
  status text not null default 'pending_review',
    -- pending_review | approved_pending_onboarding | active | inactive | suspended
  referral_code text unique,                       -- generated when approved; only usable once active
  onboarding_completed_at timestamptz,
  payout_details jsonb not null default '{}',      -- bank/wallet details for payout processing
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.agent_applications (
  id uuid primary key default gen_random_uuid(),
  applicant_name text not null,
  contact_email text not null,
  contact_phone text not null default '',
  requested_city text not null,
  requested_area text not null,                    -- applicant's proposed boundary/description
  applicant_details jsonb not null default '{}',   -- experience, references, motivation, etc.
  status text not null default 'submitted',
    -- submitted | under_review | approved | rejected
  reviewed_by uuid,                                -- admin_team.id (nullable)
  review_notes text,
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz
);

-- Business attribution (spec §1.4) — set ONCE at signup, immutable thereafter.
alter table public.businesses add column if not exists referring_agent_id uuid references public.agents(id);
alter table public.businesses add column if not exists referral_code_used text;

-- Payment flip (spec §1.5): computed once, server-side, at payment time.
alter table public.plan_payments add column if not exists is_first_payment boolean default false;

-- Commission ledger (spec §1.6). payment_id is UNIQUE → the double-charge safety net.
create table if not exists public.commissions (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.agents(id),
  business_id uuid not null references public.businesses(id),
  payment_id uuid not null unique references public.plan_payments(id),
  type text not null,                             -- referral_bonus | residual
  amount numeric not null,                        -- commissionable amount * rate (naira)
  rate numeric not null,                          -- snapshot of the rate applied
  status text not null default 'accrued',
    -- accrued | payable | paid | void
  created_at timestamptz not null default now()
);

-- Payout batch (spec §1.7). Money transfer stays manual at v1; this records the ledger.
create table if not exists public.payouts (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.agents(id),
  commission_ids jsonb not null default '[]',
  total_amount numeric not null,
  method text not null default 'bank_transfer',   -- bank_transfer | wallet | mobile_money | other
  status text not null default 'pending',         -- pending | processed | failed
  notes text,
  processed_at timestamptz,
  created_at timestamptz not null default now()
);

-- Agent's per-business support trail (spec §4: "active agent" proof + agent feedback loop).
create table if not exists public.agent_support_logs (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.agents(id),
  business_id uuid not null references public.businesses(id),
  kind text not null default 'followup',          -- followup | training | feedback
  details text not null default '',
  created_at timestamptz not null default now()
);

alter table public.agents enable row level security;
alter table public.agent_applications enable row level security;
alter table public.commissions enable row level security;
alter table public.payouts enable row level security;
alter table public.agent_support_logs enable row level security;
```

### Referral-attribution trigger (server-authoritative, fires for every INSERT)

```sql
-- Resolves a signup's referral code to the referring agent at insert time.
-- Trusted *generously*: the client may send referring_agent_id / referral_code —
-- only the agent determined by the code+status wins. Self-referral (agent's own
-- email as the business email) silently disqualifies the referral.
create or replace function public.apply_referring_agent() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_agent public.agents%rowtype;
begin
  if new.referral_code_used is not null then
    select * into v_agent from public.agents
      where lower(referral_code) = lower(new.referral_code_used)
        and status = 'active'
      limit 1;
    -- no active agent = no referral; never guesses.
    if v_agent.id is not null and lower(v_agent.contact_email) <> lower(new.email) then
      new.referring_agent_id := v_agent.id;
    else
      new.referring_agent_id := null;
      new.referral_code_used := null;
    end if;
  else
    new.referring_agent_id := null;   -- organic signup, no code
  end if;
  return new;
end $$;

drop trigger if exists resolve_referring_agent on public.businesses;
create trigger resolve_referring_agent
  before insert on public.businesses
  for each row execute function public.apply_referring_agent();
```

(syntax checked below is intentional: `referral_code` case-insensitive match, business `email` is
the owner email from Register.jsx.)

### RLS policies

Identity model for the agent actor: **the agent's own row is addressable by their Supabase Auth
email** (`lower(contact_email) = lower(auth.email())`), the same pattern the rest of the app uses.

- `agents`: agent = SELECT own + UPDATE own (profile/payout details); platform admin = all.
- `agent_applications`: anon INSERT (public application form); platform admin SELECT/UPDATE all.
- `commissions`: SELECT own (agent) + platform admin; **no client INSERT/UPDATE** (server function only).
- `payouts`: SELECT own + platform admin; platform UPDATE; no client INSERT.
- `agent_support_logs`: agent SELECT own + INSERT own; platform all.
- Each SELECT policy is additive: `is_platform_admin() OR lower(contact_email) = lower(auth.email())`.

(Full `DROP POLICY IF EXISTS` per table, matching the existing style so re-runs are clean.)

---

## 4. Commission job — server-side, in the payment success path

### `api/_lib/commissions.js` (new, service-role)

```js
export async function computeCommission(supabase, { payment, business }) { … }
```

Runs a single path:
1. Read agent by `referred_agent_id = business.referring_agent_id`.
2. If no agent → return (no commission; nothing logged).
3. If `agent.status !== 'active'` → insert a row into `review_flag`? No — log to
   `supabase.from('commissions')` nothing; instead record a `commissions` row with
   `status='void'` + note? Decision §2 #1 says "record, no commission, flag". Implement:
   `commission_flagged` via a dedicated `flag_payment_commission_review(payment)` — a tiny
   `commission_review_flags` table (payment_id, reason). Cleaner than status abuse.
   → Per-spec "flag it", we add `public.commission_review_flags(id, payment_id, reason, created_at)`.
4. Determine `is_first_payment`: `select count(*) from plan_payments where business_id = ...` before
   the new row is inserted.
5. rate = first ? 0.40 (referral_bonus) : 0.05 (residual).
6. `insert commissions(agent_id, business_id, payment_id, type, amount, rate, status='accrued')`.
   `participating in UNIQUE(payment_id)` makes the whole thing idempotent — a re-run errors harmlessly.
7. Update `plan_payments.set is_first_payment` accordingly (from step 4).

Where to call it: **inside `verify-plan-payment.js`**, after the `plan_payments` insert, in the same
try block (rollback risk: both writes are Supabase HTTP calls, order comment makes it clear that if
the commission write fails, the true remains — that is a recoverable ledger inconsistency, flagged
for monitoring; do NOT fail a customer's confirmed plan over a commission write).

Rates + flags live in `src/lib/referral_program.js` (new):

```js
export const REFERRAL_RATES = { referral_bonus: 0.40, residual: 0.05 }
export const ACCRUED_WHILE_INACTIVE = false   // §2 #1 — change here, nowhere else
```

Mirroring `planLimits.js`, which `initiate-plan-payment.js` already imports — the API can reuse the
same module.

---

## 5. Service layer — `src/services/supabase.js` additions

New "AGENTS / COMMISSIONS / PAYOUTS" block, same `sbFetch` idiom:

- `getAgentByEmail(email)` — resolve agent row by email (login bridge)
- `getAgentByCode(code)` — check that a referral code belongs to an active agent
- `getActiveAgentForBusiness(businessId)` — join via `businesses.referring_agent_id`
- `getAgentReferrals(agentId)` — `businesses?referring_agent_id=eq.<id>&select=*`
- `getAgentCommissions(agentId)` — with an optional status filter
- `getAgentPayouts(agentId)`
- `getAgentSupportLogs(agentId)`
- `addAgentSupportLog(data)`
- `submitAgentApplication(data)` (used by the public form)
- Admin: `getAgentApplications()`, `getAgents()`, `updateAgentStatus(id, status)`,
  `reviewAgentApplication(id, {status, notes, reviewed_by})`, `getCommissionsLedger(filters)`,
  `createPayout(agentId, commissionIds)`, `updatePayoutStatus(id, status)`
- `getTerritoryCoverage()` — aggregated: agent per `city + area` → vacant/assigned view (admin)

No change to `resolveAccountByEmail` — agents are a separate surface (see §6).

---

## 6. Agent auth + routing

- New surface, separate from business/staff: `App.jsx` gains an agent context state
  (`carehub_agent_auth` in localStorage, same save/load). Route `/agent/*` is gated on it, mirroring
  the admin route.
- `AgentLogin` (reads email/password via `authClient.auth.signInWithPassword`, then
  `getAgentByEmail`); blocked unless `agent.status === 'active'` (like business status).
- Status lifecycle enforced: `approved_pending_onboarding` → admin flips
  `onboarding_completed_at`+`status=active` from the admin panel (Onboarding tracker); only then is
  the referral code surfaced/usable — both lookup (`getAgentByRef`) and UI only honour `active`.
- New routes registered in `App.jsx`:
  - `/agent/login` → `pages/agent/AgentLogin.jsx`
  - `/agent` → `pages/agent/AgentDashboard.jsx` (own tabbed shell — domain is not
    business-sidebar; reuse `TopBar`/cards but no `Sidebar`/`permissions`)
  - `/apply-agent` → public application page (landing link)
- Referral code is shown in the agent dashboard (copyable links: `…/register?ref=CODE`).

---

## 7. Agent-facing UI — `src/modules/referral-agent/`

One self-contained module (no business-permission system), tabbed, all states covered
(Loading/Error/Empty per repo quality bar):

| Tab | Source data |
|---|---|
| **Overview** | `getAgentReferrals` → territory totals + counts by `business_type`; residual run-rate = count × plan price × 5%? — no, compute from actual payments to stay truthful; show lifetime earnings (commissions, sum) + pending (status in `accrued/payable`) |
| **My referrals** | businesses list, subscription status (active/lapsed from `plan_expires_at`), plan, onboarded date |
| **Commissionns** | ledger with type pill (referral bonus / residual), amount, related payment date, status |
| **Payouts** | payout history + pending accrued balance (payable+accrued, not yet in a payout) |
| **Support log** | per-business rows (followup/training/feedback), add-entry form — the "active agent" evidence |
| **Activity feed** | derived from the two read queries: commission rows (new signup) + business `plan_expires_at` near-expiry (at-risk). v1 = client-computed, no new table |

---

## 8. Admin UI — extend `AdminDashboard.jsx`

Add outer tabs (alongside existing `businesses` / `team`): **Agents · Applications · Ledger ·
Payouts · Coverage**. Each a self-contained subcomponent in `pages/admin/…` or kept in one file if
small. Uses existing kit (`StatCard`, `Pill`, `Modal`, `Inp`, `Sel`). Flows:

- Review application modal → approve/reject (sets status + `reviewed_by`/`review_notes`, creates the
  `agents` row + generates a referral code; triggers `emailAgentApproved()` / `emailAgentRejected()`
  from `lib/email.js`, new templates).
- Approve creates the agent in `approved_pending_onboarding`, not `active` (training gate).
- Mark training complete → flips to `active`, code live.
- Coverage view: `getTerritoryCoverage()` — area per city, vacant/assigned (frequency map).
- Ledger view: all `commissions` filterable, totals owed vs paid per agent + system.
- Payout run: select payable commissions → `createPayout` (manual bank transfer at v1).
- Suspension → sets status; per §1 Rule #1 the job is gated off inactive agents (and accrued
  commissions are voided per Rule #5, explicit click).
- Performance: conversion/retention/revenue per area → computed aggregations over `commissions` +
  `plan_payments` (client-side shrink + counts; a real SQL view is a Phase++ cost).

---

## 9. Attribution UX — `Register.jsx`

- Accept `?ref=CODE` query param; prefill small "Referring offer" read-only step "invited by CAREHUB
  (code CARE-…)"; API; submit passes `referral_code_used`.
- The `before insert` trigger does the secure resolution (§2) — the client never passes an
  `agent_id`.
- Landing page: add a "Become a Referral Agent" section linking `/apply-agent` (recruiting narrative
  from spec Part 1).

---

## 10. Files touched

| Path | Change |
|---|---|
| `apps/carehub/sql/20260802_referral_agent_program.sql` | NEW — tables, trigger, indexes, RLS |
| `apps/carehub/api/_lib/commissions.js` | NEW — the money path |
| `apps/carehub/api/verify-plan-payment.js` | call `computeCommission` after `plan_payments` insert |
| `apps/carehub/src/lib/referral_program.js` | NEW — rates + inactive-flag (single source) |
| `apps/carehub/src/lib/email.js` | NEW section: agent approved/rejected emails |
| `apps/carehub/src/services/supabase.js` | agents/referral/commission/payout/admin block |
| `apps/carehub/src/pages/agent/AgentLogin.jsx` | NEW |
| `apps/carehub/src/modules/referral-agent/AgentDashboard.jsx` | NEW — tabbed agent UI |
| `apps/carehub/templates-ish `/apply` | NEW public apply page (`src/pages/agent/ApplyAgent.jsx`) |
| `apps/carehub/src/pages/admin/AdminDashboard.jsx` | NEW tabs: Agents / Ledger / Payouts / Coverage |
| `apps/carehub/src/App.jsx` | agent routes + auth gate |
| `apps/carehub/src/pages/auth/Register.jsx` | `?ref=` capture, chip, `referral_code_used` |
| `apps/carehub/src/pages/Landing.jsx` | "Become a Referral Agent" CTA |
| `knowledge/modules/referral-agent.md` | NEW module doc (per conventions) |
| `planning/remediation…` | status + CODE_AUDIT note + REMEDIATION-STATUS |
| **This plan file** | → "IMPLEMENTED" once shipped |

---

## 11. Quality standard & test plan

- **States**: every view Loading / Error / Empty; responsive; accessible (labels, aria on pills);
  console.error + toast on failures (module conventions).
- **Build**: `npm run build` clean (only CI check available; no test runner in repo).
- **Server logic** (manual, verified in the field):
  - Payment for a referral-code business creates one bonus then residuals; referral→first payment
    correct; monthly vs yearly both work (5% vs 5%·12)
  - No code → no commission ever; inactive agent → no commission + flag; duplicate charge →
    `UNIQUE(payment_id)` guard; self-signup with agent email → no attribution.
- **RLS probes** (as `agent` / as `anon` / as unrelated biz): agent sees only own ledger; anon cannot
  INSERT commissions; admin overrides; `agent_applications` anon-insert allowed.
- **Migration** idempotent re-run; verify `plan_payments` naira salient unit before live.

---

## 12. Decisions you need to confirm (recommendations in brackets)

1. **Commission rates confirmed?** 40%/5% as constants via `lib/referral_program.js`.
   [Recommended; any future rate change is a one-line change.]
2. **Explicit-code attribution only at v1** (no area-wide attribution). [Recommended — matches spec
   §6 default and keeps truth of payout math until "ownership" is answered.]
3. **Agent authentication** — real Supabase Auth account per agent + `/agent` shell.
   [Recommended; aligns with the migration already in progress. The alt — plaintext agent passwords —
   is disallowed by AGENTS.md.]
4. **Inactive-agent behavior** — pause (record, flag, don't accrue). [Recommended per spec.]
5. **When does the code go live** — only at `active`. [In spec, keep.]
6. **Manual payout only** at v1? [Recommended; automation later ($)]
7. **Referral registration entry route** — `?ref=` on the existing Register flow. [Recommended,
   no extra page.]

These are the "open questions that materially change the money math" — the parts of §6 that must be
answered **before code**, everything else builds as spec.