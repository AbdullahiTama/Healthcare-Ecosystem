# Centralized Authorization / RBAC

**Date:** 2026-09-27
**Scope:** CareFind + CareHub API handlers
**Objective:** Separate authentication from authorization; every privileged operation protected by server-side permission checks

---

## Permission Matrix

### CareFind Admin Roles

| Permission | super_admin | moderator |
|------------|-------------|-----------|
| manage_withdrawals | Yes | No |
| manage_users | Yes | No |
| manage_businesses | Yes | No |
| manage_content | Yes | Yes |
| manage_admins | Yes | No |
| manage_promotions | Yes | No |
| manage_tasks | Yes | No |
| manage_ecommerce | Yes | No |
| manage_agents | Yes | No |
| manage_payouts | Yes | No |
| manage_live_shows | Yes | Yes |
| manage_stories | Yes | Yes |
| manage_news | Yes | Yes |
| manage_verifications | Yes | Yes |
| manage_reports | Yes | Yes |
| manage_transactions | Yes | No |

### CareHub Business Roles

| Permission | Business Owner | Platform Admin |
|------------|---------------|----------------|
| manage_own_business | Yes | Yes |
| manage_own_payments | Yes | Yes |
| manage_own_appointments | Yes | Yes |
| manage_ecommerce | No | Yes |
| manage_platform | No | Yes |

---

## Centralized Authorization Modules

### CareFind: `api/_lib/authorization.js`

```js
requireAdmin(req)        → validates token + admin_users lookup
requirePermission(req, p) → requireAdmin + role-permission check
requireRole(req, role)   → requireAdmin + exact role match
requireUser(req)         → validates token, returns user
requireOwnership(req, type, id) → requireUser + resource ownership
```

### CareHub: `api/_lib/authorization.js`

```js
requireBusiness(req)     → validates token + businesses lookup by email
requirePlatformAdmin(req) → requireBusiness + is_platform_admin check
requireBusinessOwnership(req, id) → requireBusiness + parent/branch check
```

---

## Handler Migration

### CareFind Handlers Updated

| Handler | Old Pattern | New Pattern |
|---------|-------------|-------------|
| admin-auth.js | requireAdmin + verifyToken | requirePermission per action |
| initiate-withdrawal.js | verifyUser | requireUser |
| charge-subscription.js | verifyUser | requireUser |
| email-templates.js | requireAdmin | requirePermission |

### CareHub Handlers Updated

| Handler | Old Pattern | New Pattern |
|---------|-------------|-------------|
| initiate-business-withdrawal.js | verifyBusiness | requireBusiness |
| initiate-plan-payment.js | verifyBusiness | requireBusiness |
| verify-plan-payment.js | verifyBusiness | requireBusiness |
| ecommerce-review.js | verifyBusiness + inline admin check | requirePlatformAdmin |
| initiate-appointment-payment.js | verifyBusiness | requireBusiness |
| verify-appointment-payment.js | verifyBusiness | requireBusiness |

---

## Security Properties

1. **Frontend role checks are never the only security control** — all authorization is server-side
2. **Each sensitive API operation enforces server-side authorization** — via centralized module
3. **Users only access resources they own** — requireOwnership checks resource ownership
4. **Privilege escalation is impossible through modified request data** — role/permission derived from database, not client
5. **Authorization logic is not duplicated** — single source of truth in `_lib/authorization.js`

---

## Test Cases

| Test | Expected |
|------|----------|
| Normal user calling admin endpoint | 403 |
| Regular admin calling super-admin action | 403 |
| Business A accessing business B | 403 |
| Provider A modifying provider B | 403 |
| Manipulated user/business IDs | 403 |
| Direct API invocation bypassing UI | 403 |

---

*Report generated: 2026-09-27*
