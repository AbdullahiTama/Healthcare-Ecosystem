---
title: 'CareFind Admin Authentication Hardening'
type: 'bugfix'
created: '2026-09-26'
status: 'in-review'
review_loop_iteration: 0
baseline_commit: '07d2e1f3d9acf76f762d8c3903560c324a23bffc'
context:
  - '{project-root}/architecture/Authentication.md'
  - '{project-root}/planning/CODE_AUDIT.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** CareFind admin login already establishes a Supabase Auth session, but then reads the deny-all `admin_users` table from the browser and falls back to a forgeable Base64 token. The server accepts that unsigned token for privileged actions, and a public setup route has a hardcoded fallback key and returns a fixed super-admin password.

**Approach:** Use the existing Supabase Auth session as the only admin credential, validate it server-side for every privileged admin API action, and derive the active admin identity and role from the service-role-only `admin_users` table. Remove the public bootstrap endpoint and its fixed credentials.

## Boundaries & Constraints

**Always:** Preserve the current Supabase Auth login/session lifecycle; reject missing, expired, forged, inactive, and non-admin identities; derive authorization from the current database admin row rather than client data or JWT role claims; keep `admin_users` deny-all for direct anon/authenticated table access; report auth/provisioning failures explicitly and avoid logging credentials or tokens.

**Ask First:** Changes that enable a public admin bootstrap/recovery route, weaken `admin_users` RLS, or change the CareHub authentication model.

**Never:** Trust Base64/localStorage role values for server authorization; return fixed credentials; silently treat failed auth/database checks as success; access production or rotate live credentials from this implementation task.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Active admin login | Valid Supabase email/password and active matching admin row | Navigate to the admin panel using the Supabase session; server returns database-backed admin identity/permissions | On verification failure, sign out the Supabase session and show an error |
| Invalid or expired session | Missing, forged, or expired bearer token | Protected API rejects request; no privileged operation runs | Return 401 without exposing token or account details |
| Non-admin or inactive user | Valid Supabase session but no active admin row | Admin access is denied | Return 403/401; clear the session from the admin login flow |
| Forged client role | Valid session with modified localStorage admin role | API uses the current `admin_users` role and enforces its permissions | Ignore client role; return 403 for disallowed actions |
| Admin setup request | Request to former public setup path | No setup handler or bootstrap credential is exposed | Route returns not found |
| Admin staff provisioning | Authorized super-admin creates staff account | Create Supabase Auth identity and admin record without using a reusable plaintext/fake-hash login path | Report failure; clean up a newly-created Auth user if the admin record cannot be created |

</frozen-after-approval>

## Code Map

- `apps/carefind/src/config/supabaseClient.js` -- existing persistent Supabase Auth client; reuse its signed session and refresh lifecycle.
- `apps/carefind/src/modules/admin/AdminLogin.jsx` -- already signs in with Supabase Auth, but reads `admin_users` directly and falls back to a Base64 token; route successful sign-in through server verification and sign out non-admin users.
- `apps/carefind/src/modules/admin/adminApi.js` -- central `/api/admin-auth` fetch helper; send the current access token only in the HTTP Authorization header, never in the JSON body.
- `apps/carefind/src/modules/admin/AdminPanel.jsx` -- bootstrap, cached admin UI state, and logout; initialize from and clear the Supabase session consistently.
- `apps/carefind/api/_lib/requireAdmin.js` -- shared verified-session gate for service-role admin APIs.
- `apps/carefind/api/_handlers/admin-auth.js` and `apps/carefind/api/_handlers/email-templates.js` -- privileged service-role APIs; validate Supabase Auth and resolve active admin identity and role from database state.
- `apps/carefind/api/router.js` and `apps/carefind/api/_handlers/admin-setup.js` -- publicly route and implement the fixed-key bootstrap; remove the handler from the router and delete the obsolete endpoint.
- `apps/carefind/sql/20260815_admin_rls_hardening.sql` -- establishes deny-all direct access to admin tables; preserve this boundary.
- `apps/carefind/sql/20260926_admin_users_auth_only.sql` and `supabase/migrations/carefind_20260926_admin_users_auth_only.sql` -- remove legacy admin password hashes and permit Supabase-Auth-only staff rows; operator application is a deployment prerequisite.
- `apps/carefind/package.json` -- Vitest and production build commands.
- `architecture/Authentication.md` and `planning/CODE_AUDIT.md` -- document the corrected CareFind admin auth posture, residual operational credential rotation, and verification.

## Tasks & Acceptance

**Execution:**
- [x] `apps/carefind/src/modules/admin/AdminLogin.jsx`, `apps/carefind/src/modules/admin/adminApi.js`, `apps/carefind/src/modules/admin/AdminPanel.jsx` -- remove direct admin-table lookup and the Base64/localStorage-token fallback; send only the current Supabase access token to server verification; fail closed and clear sessions for non-admin/inactive users.
- [x] `apps/carefind/api/_handlers/admin-auth.js` -- validate each protected request against Supabase Auth, resolve active admin and role from the service-role database query, and preserve per-action authorization using that server-resolved role; provision created staff through Supabase Auth.
- [x] `apps/carefind/api/_lib/requireAdmin.js`, `apps/carefind/api/_handlers/email-templates.js`, `apps/carefind/src/modules/admin/tabs/EmailTemplatesTab.jsx` -- share the Supabase Auth verification gate with the separate privileged email-template endpoint, closing its legacy unsigned-token path too.
- [x] `apps/carefind/api/router.js`, `apps/carefind/api/_handlers/admin-setup.js` -- unroute and remove the public fixed-key setup endpoint.
- [x] `apps/carefind/api/_handlers/admin-auth.test.js`, `apps/carefind/src/modules/admin/AdminLogin.test.jsx` -- cover forged/expired tokens, valid and inactive/non-admin identities, role tampering, failed login cleanup, and absence of the Base64 fallback.
- [x] `apps/carefind/sql/20260926_admin_users_auth_only.sql`, `supabase/migrations/carefind_20260926_admin_users_auth_only.sql` -- clear legacy stored custom hashes and allow admin rows to rely only on Supabase Auth.
- [x] `architecture/Authentication.md`, `planning/CODE_AUDIT.md` -- update the security record and note that any previously exposed admin credentials require operator-led rotation before deployment.

**Acceptance Criteria:**
- Given a missing, expired, or fabricated bearer token, when any privileged admin API action is requested, then the server rejects it before performing a database or external side effect.
- Given a valid Supabase Auth session for an active admin, when an admin action is requested, then the server resolves the current admin row and role and applies the existing action-level permission rules.
- Given an authenticated non-admin or inactive admin, when the admin panel or API is accessed, then access is denied and the login flow clears the session.
- Given a client edits its cached admin role or ID, when it calls a privileged action, then authorization remains determined by the authenticated identity and current `admin_users` row.
- Given any request to the former setup endpoint, when deployed, then no account is created/reset and no fixed credential is returned.
- Given the implementation, when CareFind tests and production build run, then both pass without weakening the admin-table RLS boundary.

## Spec Change Log

## Verification

**Commands:**
- `npm test -- --run` from `apps/carefind` -- expected: relevant security and admin tests pass.
- `npm run build` from `apps/carefind` -- expected: production bundle builds successfully.

**Manual checks:**
- Confirm `router.js` no longer maps `/api/admin-setup`, no handler contains the fallback key or fixed setup password, and old forged tokens fail server verification.
- Confirm the only admin identity/role used by privileged handlers comes from Supabase Auth validation plus the active database row.
