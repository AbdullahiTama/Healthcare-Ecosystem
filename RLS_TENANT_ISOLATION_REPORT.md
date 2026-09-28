# RLS Tenant Isolation — Access Model

**Date:** 2026-09-27
**Scope:** All tables in `public` schema shared by CareFind + CareHub
**Constraint:** Tenant isolation — one user/business cannot access another tenant's data

---

## Critical Tables — Access Model

### Financial Tables

| Table | SELECT | INSERT | UPDATE | DELETE |
|-------|--------|--------|--------|--------|
| `payout_requests` | Platform admin only | Platform admin only | Platform admin only | Platform admin only |
| `agent_earnings` | Agent (own rows only) | Agent (own rows only) | Agent (own rows only) | Agent (own rows only) |
| `agent_referrals` | Agent (own rows only) | Agent (own rows only) | Agent (own rows only) | Agent (own rows only) |
| `agent_transfers` | Agent (from or to) | Agent (from or to) | Agent (from or to) | Agent (from or to) |
| `agent_tiers` | Platform admin only | Platform admin only | Platform admin only | Platform admin only |
| `applications` | Platform admin only | Platform admin only | Platform admin only | Platform admin only |
| `transactions` | User (own rows) | User (own rows) | User (own rows) | User (own rows) |
| `wallet_transactions` | User (own or counterparty) | User (own rows) | User (own or counterparty) | User (own or counterparty) |
| `withdrawal_requests` | User (own rows) | User (own rows) | User (own rows) | User (own rows) |
| `business_wallets` | Business owner/staff | Business owner/staff | Business owner/staff | Platform admin |
| `business_wallet_transactions` | Business owner/staff | Business owner/staff | Business owner/staff | Platform admin |
| `business_withdrawal_requests` | Business owner/staff | Business owner/staff | Business owner/staff | Platform admin |

### Admin Tables

| Table | SELECT | INSERT | UPDATE | DELETE |
|-------|--------|--------|--------|--------|
| `admin_users` | Service role only | Service role only | Service role only | Service role only |
| `admin_roles` | Platform admin only | Platform admin only | Platform admin only | Platform admin only |
| `admin_team_members` | Platform admin only | Platform admin only | Platform admin only | Platform admin only |
| `admin_teams` | Platform admin only | Platform admin only | Platform admin only | Platform admin only |
| `admin_notifications` | Service role only | Service role only | Service role only | Service role only |

### Shop/Payment Tables

| Table | SELECT | INSERT | UPDATE | DELETE |
|-------|--------|--------|--------|--------|
| `shop_payments` | Customer, vendor, or platform admin | Service role only | Platform admin or customer | Platform admin |
| `shop_order_status_history` | Customer, vendor, or platform admin | Service role only | Service role only | Service role only |
| `shop_tracking_tokens` | Customer (own orders) | Customer (own orders) | — | — |

### Platform Configuration Tables

| Table | SELECT | INSERT | UPDATE | DELETE |
|-------|--------|--------|--------|--------|
| `promotions` | Public (active promotions) | Platform admin only | Platform admin only | Platform admin only |
| `tasks` | Platform admin only | — | — | — |

### Social/Content Tables (Public Read by Design)

| Table | SELECT | INSERT | UPDATE | DELETE |
|-------|--------|--------|--------|--------|
| `posts` | Public | Authenticated | Author or platform admin | Author or platform admin |
| `profiles` | Public | Authenticated (own) | User (own) | Platform admin |
| `live_gifts` | Public | Authenticated (sender = auth.uid()) | — | — |
| `live_comments` | Public | Authenticated | — | — |

---

## Tenant Isolation Verification

### Test Cases

1. **Cross-tenant business access:** User A cannot read/update/delete User B's business data
2. **Cross-tenant wallet access:** User A cannot read/update/delete User B's wallet transactions
3. **Cross-tenant order access:** User A cannot read/update/delete User B's orders
4. **Agent cross-tenant access:** Agent A cannot read Agent B's earnings/referrals/transfers
5. **Admin privilege escalation:** Non-admin cannot access admin-only tables
6. **Anon access:** Unauthenticated users cannot access protected tables

### Malicious ID Substitution Tests

| Attack Vector | Expected Result |
|---------------|-----------------|
| Forge `businessId` in request body | Rejected — RLS filters by session |
| Forge `userId` in request body | Rejected — RLS filters by auth.uid() |
| Forge `agentId` in request body | Rejected — RLS filters by auth.email() |
| Forge `orderId` in request body | Rejected — RLS filters by customer_id |
| Forge `payoutId` in request body | Rejected — platform admin only |

---

## Changes Applied

### Migration: `rls_tenant_isolation_hardening`

1. **Dropped over-broad "Allow all" policies** on:
   - `payout_requests`, `agent_earnings`, `agent_referrals`, `agent_transfers`, `agent_tiers`, `applications`
   - `admin_roles`, `admin_team_members`
   - `promotions`, `tasks`

2. **Fixed shop/payment INSERT policies** on:
   - `shop_payments`, `shop_order_status_history` — now service_role only

3. **Added missing policies** on:
   - `transactions` — UPDATE, DELETE
   - `wallet_transactions` — INSERT, UPDATE, DELETE
   - `withdrawal_requests` — INSERT, UPDATE, DELETE

4. **Removed anon access** on:
   - `live_gifts` — INSERT now requires authenticated sender
   - `shop_tracking_tokens` — now authenticated only

### Direct SQL Fixes

5. **Dropped `platform_team_members` view** — was exposing `admin_team_members` data (including password_hash)

6. **Revoked EXECUTE from anon** on critical SECURITY DEFINER functions:
   - `is_platform_admin()`, `get_my_admin_info()`, `mark_payout_paid()`
   - `claim_payment_event()`, `apply_promo_code_to_order()`
   - `generate_tracking_token()`, `get_expense_summary()`
   - `get_expense_totals()`, `get_expenses_page()`
   - `st_estimatedextent()` (all variants)

7. **Fixed mutable search_path** on 14 functions:
   - All updated to `SET search_path = public, extensions`

---

## Remaining Known Issues

| Issue | Severity | Status | Notes |
|-------|----------|--------|-------|
| `spatial_ref_sys` RLS disabled | CRITICAL | Not fixed | Owned by `supabase_admin` — requires superuser to enable |
| Breached password protection | HIGH | Not fixed | Dashboard setting — requires manual enable |
| 14 tables with RLS but no policies | HIGH | Intentional | Admin/email tables — deny-all is correct |
| 67 authenticated-executable SECURITY DEFINER functions | HIGH | Partial | Functions have internal authorization checks |

---

## Verification

All changes verified against live database:
- Policies applied correctly via `pg_policies` query
- No remaining `qual: true` or `with_check: true` on financial/admin tables
- Security advisors re-run — critical issues resolved except `spatial_ref_sys` (superuser required)

---

*Report generated: 2026-09-27*
*Migration: `rls_tenant_isolation_hardening`*
*Database: `szdybxmgmhndoytqanfb` (eu-west-1)*
