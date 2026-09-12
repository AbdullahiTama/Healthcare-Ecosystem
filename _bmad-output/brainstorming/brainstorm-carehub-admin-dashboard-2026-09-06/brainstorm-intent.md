# Brainstorm Intent — CareHub Super Admin Dashboard UI/UX Redesign

**Source:** `_bmad-output/brainstorming/brainstorm-carehub-admin-dashboard-2026-09-06/.memlog.md` (102 ideas, 7 techniques)  
**Mode:** Ideate for me (autonomous) | **Date:** 2026-09-06 | **Keepsake:** `brainstorm.html`

## Intent (one line)
Rebuild `carefindhub.com/admin` (apps/carehub 1,023-line panel) into a dark-first, keyboard-first **owner command center** that lets you know in 10s if today is okay and approve/pay with one keystroke — by stealing the spine of **Linear (quiet chrome + Cmd+K)** and **Stripe (job nav + tables as product)** and adding an Attio-grade **Daily Brief**.

## Context
- Current: 7 equal top tabs (Dashboard/Businesses/Team-Agents/Team-Platform/Applications/Ledger/Payouts/Coverage), 4 KPI cards, card lists, modals, 30s poll, light-only, 30s poll Refresh button. Functional (`c3ded50`) but not world-class for daily ops at scale.
- Platform: shared Supabase `szdybxmgmhndoytqanfb`, RLS `Allow all` + `agents own row`, `enforce_agent_tier_limit` 20-cap (42501), `calculate_agent_earnings` SECURITY DEFINER idempotent, `mark_payout_paid` atomic.
- Reference set 2026: Linear, Stripe, Vercel, Attio, Supabase, Mercury, Plausible, PostHog, Hex, Retool — patterns: 256px sidebar → 64px rail, 12-col grid, 36px rows, tabular money, color=state only, skeleton/empty design, AI summary on inspectable data.

## Users (owner only)
- **Primary:** You (owner) — hours/day in panel, phone + desktop, approve/revoke/pay, trust decisions (<5s to judge legitimacy).
- **Secondary:** Platform Team Members (scoped by 8 perms: Dashboard,Businesses,Team-Agents,Team-Platform,Applications,Ledger,Payouts,Coverage) — see only their matrix.

## Goals (ranked)
1. **Scale ops:** 10 → 1000+ businesses without scroll fatigue or 1000-row clamp misses.
2. **Demo trust:** one number leads, statement PDF is the product — investor-ready in one click.
3. **Speed:** Cmd+K + single-letter shortcuts (A/R/P) + optimistic UI + realtime pulse, not poll.

## Chosen Direction — 7 Pillars (from 102 ideas)
1. **Job Nav + Cmd+K spine:** Replace 7 equal tabs with 5 jobs: **Command Center** (Dashboard+queue), **Businesses** (table), **Money** (Ledger+Payouts tabs), **People** (Agents/Platform/Coverage map), **Review Queue** (Applications). 256px sidebar → 64px rail + `Cmd+K` (`cmdk` + `command-score`, <5ms) global across businesses/agents/applications/payouts.
2. **Table as product:** Stripe dense table (sticky header, 36px rows, right-aligned mono ₦, status dot, hover inline Approve/Suspend/Revoke + bulk bar). Cards only on mobile fallback.
3. **Timeline lifecycle:** Business is not a pill — show `pending → active → suspended (temp, data retained) → revoked (withdrawal, must reapply)` as vertical timeline with tooltip distinction.
4. **6-cap KPIs + sparkline:** Hero `Pending Approvals` + 5 secondary with delta + tiny sparkline (Stripe style). Only chart: onboarding 30d trend (Plausible restraint).
5. **Sheet over modal:** Business drill = Linear slide-over sheet (40% width, drag handle) → mobile bottom sheet 50%, keeps context.
6. **Matrix perms + vault:** 8-perm matrix (roles × perms) + templates (Supabase), dual-control payouts: Approve (any) → Mark Paid (different role) + audit `agent_transfers`.
7. **Statement as product + Daily Brief AI:** Ledger is Mercury statement (large balance, serif heading, running balance, PDF primary, CSV debug, ZIP bulk). Top Attio card: “3 pending, Lagos at 20, 2 payouts ₦180k ready — Approve Acme next” on inspectable data.

## Scope
**In (P0):** Rail + table + sheet + Cmd+K (biggest time win).  
**In (P1):** Timeline + KPI cap + matrix/vault + dark-first tokens (`:root` CSS vars, OS `prefers-color-scheme`, WCAG AA).  
**In (P2):** Daily Brief AI + coverage map + referral graph (beehive comb, 20-cell).  
**Out:** Chat widget AI (rejected), 5 decorative charts, poll Refresh (replaced by Realtime `supabase.realtime` pulse dot).

## Constraints & Principles
- **Color = state only** (amber pending, green active, red suspended, gray revoked) — Vercel restraint; monochrome elsewhere.
- **Density is feature:** 13px body, tabular numbers, quiet chrome (Linear).
- **Progressive disclosure:** summary first, drill on demand; empty states are onboarding with illustration + one CTA.
- **Mobile:** sheet not modal, thumb-reach; approve from phone.
- **Security:** hide ≠ permission — show locked card with `Requires X permission` for scoped roles; column-level hash protection for `admin_team_members.password_hash`.

## Success Metrics
- Time to approve pending <10s and <2 clicks (currently 3 pages scroll).
- No 1000-row clamp misses (pagedQuery + limit/offset verified).
- Owner quote passes: “I open it, I know in 10s if today is okay, I approve the right 3 things without scrolling, and I trust the money is right.”
- Lighthouse a11y ≥95 (keyboard, aria-labels, focus trap in Cmd+K).

## Risks → Mitigations
- 1,023-line file → split to `modules/carefindhub/panels/` with repository seam (`createCarefindhubRepository({request})`).
- Hard-delete risk → soft-default + type business name to confirm hard.
- View RLS leak (`platform_team_members` view) → `security_invoker=true` + test anon cannot read hash.

## Handoff
- Direct input to `bmad-prd` / `bmad-spec` / `bmad-architecture` (spec §10 build order preserved: schema→dashboard→businesses→applications→agents→platform→ledger→payouts).
- Keepsake: `brainstorm.html` (visual spec, no template). This intent doc is token-tight for downstream skills.

**Next:** Run `bmad-spec` to distill pillars into SPEC kernel + companions, or `bmad-architecture` for spine (tokens, grid, RLS, realtime).
