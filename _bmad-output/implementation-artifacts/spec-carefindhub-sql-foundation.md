---
title: 'CareFindHub SQL foundation: agents, tiers, earnings, admin roles, applications, payouts'
type: 'feature'
created: '2026-09-05'
status: 'done'
baseline_commit: '5cd7e90b1d3d25f39a5708ccff0f915003b0f608'
review_loop_iteration: 0
context:
  - 'apps/carehub/src/services/supabase.js'
  - 'apps/carefind/sql/20260822_credentials_bucket_hardening.sql'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** CareFindHub panel upgrade requires 7 new tables and supporting logic, but current `platform_team_members` vs `admin_team_members` naming conflicts and missing `businesses` columns block all Dashboard/Businesses/Team/Applications/Ledger/Payouts work.

**Approach:** Create SQL/schema foundation first: resolve Team table naming, ensure `businesses` has `name,owner_name,owner_email,category,state,plan,status(pending/active/suspended/revoked),ecommerce_enabled`, create `agent_tiers`/`agents`/`agent_referrals`/`agent_earnings`/`agent_transfers`, `admin_roles`/`admin_team_members`, `applications`, `payout_requests` with FKs/indexes, RLS `Allow all` where appropriate and lockdown where required, before any UI.

## Boundaries & Constraints

**Always:** Use shared Supabase project `szdybxmgmhndoytqanfb`; use CareHub custom email/password `password_hash` (no Supabase Auth unless required); create policy `Allow all` on [table] for all using (true) with check (true) where spec says, lockdown sensitive; reuse CareHub `credit_wallet`/`send_gift` security-definer atomic pattern for earnings/payouts; keep existing CareFind/CareHub workflows intact.

**Ask First:** Hard vs soft delete for `businesses` (preserve ledger); XLSX vs CSV for business export; Ledger bulk ZIP vs sheet; `platform_team_members` vs `admin_team_members` final name.

**Never:** Silently create two competing team tables; calculate earnings client-side; allow webhook retries to duplicate earnings (must be idempotent).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Team naming | Dashboard says `platform_team_members`, schema says `admin_team_members` | Single `admin_team_members` table, Dashboard stats count it; no duplicate | Migration checks `information_schema` before create, does not create second |
| Businesses | `businesses` missing `owner_name` etc. | Alter adds columns, `status` check `pending/active/suspended/revoked`, `ecommerce_enabled` bool | Existing rows default `pending`/`false` |
| Agent register | `full_name,email,password,state` | Row `tier=unplaced,status=pending`, `referral_code` unique `CF-` + alphanum | Email/referral_code unique violation → 23505 |
| Agent referral | Business signup with `referral_code` | `agent_referrals` inserted | Invalid code → no referral |
| Earnings | Business pays `plan_value`, `commission_pct` | `agent_earnings.amount_owed = plan_value×pct` for direct, then parent, then state coordinator via security-definer, idempotent | Webhook retry → no duplicate (idempotent key) |
| 20-cap | Assign 21st to community coordinator | Server-side 42501, not just UI | UI shows 20/20 |
| Transfer | Reassign `agent_referrals`/`agent_earnings` | New owner, `agent_transfers` audit row | Requires confirmation |

</frozen-after-approval>

## Code Map

- `apps/carehub/src/services/supabase.js:72` -- `BUSINESS_PUBLIC_COLUMNS` and `businesses` reads; ensure new columns `owner_name,owner_email,category,state,plan,status,ecommerce_enabled` exist for Dashboard/Businesses.
- `apps/carefind/sql/*` -- existing migrations `20260822_*`, `20260815_admin_rls_hardening`; new migration `20260906_carefindhub_foundation.sql` must check `information_schema.tables` for `platform_team_members` existence before creating `admin_team_members`, add `IF NOT EXISTS` everywhere.
- `apps/carehub/src/lib/permissions.js:213` -- `navCatalogueFor` pattern to reuse for `admin_roles.permissions` checklist (Dashboard,Businesses,Team–Agents,Team–Platform,Applications,Ledger,Payouts,Coverage) — no duplicate system.
- `apps/carefind/api/_handlers/admin-auth.js:283` -- `schedule_show` pattern for service-role writes; reuse for `agent_tiers` etc. if needed.

## Tasks & Acceptance

**Execution:**
- [x] `apps/carefind/sql/20260906_carefindhub_foundation.sql` (new) -- resolve Team naming: `select from information_schema.tables where table_name='platform_team_members'` → if exists, `alter table platform_team_members rename to admin_team_members` else create `admin_team_members`; ensure `admin_roles` with `permissions jsonb`; add `businesses` columns `owner_name,owner_email,category,state,plan,status check, ecommerce_enabled bool` + indexes; create `agent_tiers` (agent/community_coordinator/state_coordinator, max_children), `agents` (full_name,email unique,password_hash,referral_code unique CF-...,tier,parent_agent_id FK,state,commission_pct,status,created_at), `agent_referrals`, `agent_earnings` (amount_owed/paid, period), `agent_transfers` audit, `applications` (type,applicant_ref,status,reviewed_*), `payout_requests` (requester_type,amount,status) with FKs/indexes; RLS `Allow all` where spec says + lockdown `agents` self-service `auth.uid()` or `password_hash` check via service-role.
- [x] `apps/carefind/sql/20260906_carefindhub_foundation.sql` -- add atomic `security-definer` function `calculate_agent_earnings(business_id uuid, plan_value numeric)` that inserts `agent_earnings` for direct→parent→state, idempotent via `payment_id` unique or `WHERE NOT EXISTS`, following `credit_wallet` pattern.
- [x] `apps/carefind/src/lib/permissions.test.js` (or new `adminRoles.test.js`) -- test `platform_team_members` vs `admin_team_members` single table, `businesses` status check, `agents` referral_code unique.

**Acceptance Criteria:**
- Given Dashboard, when counting, then `platform_team_members` and `admin_team_members` are same table (no duplicate) and stats count correctly
- Given `businesses`, when inserted, then `status` only allows `pending/active/suspended/revoked` and `ecommerce_enabled` defaults false
- Given agent registers with `state`, when inserted, then `tier=unplaced`, `status=pending`, `referral_code` unique `CF-…`
- Given business pays with referral, when webhook fires twice, then `agent_earnings` has one `amount_owed` (idempotent) for each tier level
- Given community coordinator at 20 children, when assigning 21st, then server rejects 42501 and UI shows 20/20

## Spec Change Log

## Design Notes

Migration first per Build Order §10. `agent_tiers.max_children` for community coordinator =20 enforced via `CHECK`/`trigger` counting `agents where parent_agent_id=X`. `agent_transfers` columns `from_agent_id,to_agent_id,by_admin_id,at`. Keep `businesses` hard vs soft delete open — add `deleted_at` nullable column now, decision later.

## Verification

**Commands:**
- `supabase advisors` security/performance -- expected: no new RLS `Allow all` on sensitive `agents.password_hash`, FK indexes present
- `npm run build` (apps/carefind, apps/carehub) -- expected: vite build clean

## Suggested Review Order

**Team naming — single table**

- Check `information_schema` before create, rename if `platform_team_members` exists
  [`20260906_carefindhub_foundation.sql:45`](../../apps/carefind/sql/20260906_carefindhub_foundation.sql#L45)

- `admin_roles` permissions jsonb for 8 sections
  [`20260906_carefindhub_foundation.sql:65`](../../apps/carefind/sql/20260906_carefindhub_foundation.sql#L65)

**Businesses**

- Add `owner_name,owner_email,category,state,plan,status check, ecommerce_enabled`
  [`20260906_carefindhub_foundation.sql:156`](../../apps/carefind/sql/20260906_carefindhub_foundation.sql#L156)

**Agents & earnings**

- `agent_tiers` 20 cap + `agents` `CF-` code + `agent_referrals/earnings/transfers`
  [`20260906_carefindhub_foundation.sql:193`](../../apps/carefind/sql/20260906_carefindhub_foundation.sql#L193)

- `calculate_agent_earnings` security-definer idempotent via `payment_reference`
  [`20260906_carefindhub_foundation.sql:625`](../../apps/carefind/sql/20260906_carefindhub_foundation.sql#L625)

**RLS**

- `Allow all` for 8 tables, lockdown `agents` own row + admin manage
  [`20260906_carefindhub_foundation.sql:448`](../../apps/carefind/sql/20260906_carefindhub_foundation.sql#L448)
