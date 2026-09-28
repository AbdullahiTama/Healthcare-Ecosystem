# Authentication — Care Ecosystem

Four authentication surfaces exist across the two products. CareFind consumer and admin access now use Supabase Auth; CareHub's business/staff path remains the documented legacy exception below.

---

## 1. CareHub business/staff login — plaintext, no session

**Where:** `lib/supabase.js` (`loginBusiness`, `loginStaff`) + `pages/auth/Login.jsx`.

Login is a raw PostgREST equality filter: `staff?email=eq.X&password=eq.Y`. Consequences:
- Passwords are stored **and compared** in plaintext in the `businesses`/`staff` tables (`Register.jsx` sends `password: data.password` straight to insert — no hashing client- or server-side observed anywhere).
- Credentials are sent as **URL query parameters** on every login attempt, meaning they can end up in server access logs, browser history, and any request-logging/proxy layer between client and Supabase.
- No session token or JWT is issued. "Login" returns a database row that gets cached to `localStorage['carehub_auth']` and trusted for the lifetime of the browser session.
- ~~A hardcoded super-admin credential lived directly in `Login.jsx`'s client source~~ — **fixed**: `admin@carehub.ng`/`Admin@2025` removed from source; platform-admin status is now a `businesses.is_platform_admin` flag checked against a real database row like any other login.
- Authorization for every subsequent request relies entirely on the public anon key plus a client-supplied `business_id` filter — see `Security-Risks.md` for the full implication.

**Migration to real sessions — code complete, in progress in practice.** `Login.jsx` now tries `authClient.auth.signInWithPassword()` (a real Supabase Auth session, via `lib/authClient.js`) first; only if that fails does it fall back to the legacy plaintext check above. On a successful legacy login, or a brand-new `Register.jsx` signup, it calls the shared `provisionRealAuthAccount()` helper (`lib/authClient.js`) — a best-effort, never-blocking `authClient.auth.signUp()` — to create a real Auth account for next time. No forced password reset for existing users; new signups get a real account from day one.

`App.jsx` now also reconciles `auth` state with a real Supabase session on mount (`authClient.auth.getSession()` → `resolveAccountByEmail()` → `login()`), not just the `localStorage['carehub_auth']` cache — this is what keeps a migrated account correctly logged in across reloads/new tabs, and is the only thing that actually populates `auth.uid()` for future RLS work (Phase 2). The legacy plaintext check remains the fallback source of truth until an account has logged in at least once post-migration.

**A direct consequence of adding a real session, fixed in the same change:** `AdminDashboard.jsx` had its own local `logout()` that cleared `localStorage['carehub_auth']` directly instead of calling the context's `logout()` — previously just duplication (`Technical-Debt.md` H2-adjacent), but now a genuine regression risk: a migrated SuperAdmin clicking "Sign Out" would clear the cache while leaving the real Supabase session alive, and the new bootstrap effect would silently log them back in on the next page load. `AdminDashboard.jsx` now calls the context's `logout()` (which signs out of `authClient` too) instead of managing `localStorage` itself.

**Incidental fix, same change:** `Register.jsx` previously stored `businesses.email` exactly as typed (no case normalization), while `Login.jsx`'s lookups always lowercase the email first. Since Postgres `=` is case-sensitive by default, a business registered with mixed-case email (e.g. `Chidinma@Gmail.com`) could very plausibly have been unable to log in at all — a latent, pre-existing bug directly adjacent to (and load-bearing for) this migration work, so fixed in the same pass: `Register.jsx` now lowercases the email before storing.

**Operational note:** this strategy depends on the Supabase project's "Confirm email" setting — if enabled, a silently-created account can't complete `signInWithPassword` until someone clicks a confirmation link nobody was shown, so the account would safely (harmlessly) keep falling back to the legacy path forever rather than actually migrating. Needs to be disabled (or a passwordless confirmation flow added) for the migration to actually complete for existing accounts, not just degrade safely.

## 2. CareFind admin login — Supabase Auth session with server-side RBAC

**Where:** `src/config/supabaseClient.js`, `src/modules/admin/AdminLogin.jsx`, `src/modules/admin/adminApi.js`, `api/_handlers/admin-auth.js`, and `api/_handlers/email-templates.js`.

The admin login uses Supabase Auth's persistent, refreshable session. Every privileged request sends only the current signed access token in the `Authorization` header. Both the admin gateway and email-template API call `auth.getUser` and resolve an active `admin_users` row through its unique `auth_user_id` foreign key using a service-role client. Email is profile data, not the authorization key. The database row is the sole source of the admin id and role; client storage is only a cache for display/bootstrap and cannot grant access. Missing, expired, forged, non-admin, or inactive sessions fail closed. Staff provisioning stores the newly-created Auth user's id on its admin row and removes the Auth user if the row cannot be created.

The source migration `apps/carefind/sql/20260926_admin_users_auth_only.sql` links existing admin rows to exactly one matching Supabase Auth identity, verifies that every admin has a unique link, adds a unique index and foreign key, and only then clears legacy custom password hashes and permits rows without them. It aborts without clearing credentials if identity matching is missing or ambiguous. Create and verify Supabase Auth identities for every existing admin before applying it; then verify the links and schema before deploying the updated admin gateway, email-template API, or staff provisioning. The QA seed requires this migration and creates a Supabase Auth identity for its test admin. The legacy SQL helper in `apps/carefind/sql/20260917_migrate_admin_auth.sql` is restricted to database operators and assigns unguessable temporary credentials; if an older version of that helper was run, rotate its shared temporary password before rollout.

## 3. CareFind admin bootstrap — removed

The public setup handler and router mapping were deleted. Admin accounts must be provisioned through an operator-controlled Supabase Auth workflow; no bootstrap key or reusable credential is exposed. Any credentials previously exposed by the former endpoint require operator-led rotation before deployment.

## 4. CareFind consumer auth — the one system built correctly

**Where:** `lib/AuthContext.jsx`.

A thin, correct wrapper around real `supabase.auth.signUp` / `signInWithPassword` / `signOut`, with a live session listener (`onAuthStateChange`). Passwords are never handled directly by application code — Supabase Auth owns that entirely. This is the only auth path in either product that meets a normal baseline for a production application.

---

## 5. A fifth, informal layer: CareFind's "active identity"

**Where:** `lib/activeIdentity.js`.

Not authentication, but adjacent and worth noting here: once a user is authenticated via #4, CareFind layers a `localStorage`-based "posting identity" switcher on top (personal / claimed business / claimed staff position), toggled via `staff_claims`/`business_claims` approval (see `Shared-Services.md`). This is well-built and correctly scoped — it never bypasses #4, it only changes what a genuinely authenticated user is attributed as when posting.

---

## Cross-Ecosystem Summary

| System | Mechanism | Status |
|---|---|---|
| CareHub business/staff | Plaintext DB match, `localStorage` cache | **Broken** — no hashing, no session, hardcoded super-admin |
| CareFind admin | Supabase Auth bearer session + server-resolved active admin role | **Hardened in source 2026-09-26** — deployment and credential rotation still require operator verification |
| CareFind admin bootstrap | No public bootstrap route | **Removed in source 2026-09-26** — provision admins through an operator-controlled Supabase Auth workflow |
| CareFind consumer | Real Supabase Auth | **Correct** |

CareHub's business/staff login remains the known authentication weakness; see §1 and the CareHub security-risk documentation. CareFind admin API sessions are checked against Supabase Auth and an active database admin row on every request. These source changes do not establish which environment variables, Supabase Auth users, or deployment version are live; operators must rotate any previously exposed admin credentials and verify production configuration before rollout.

Production RLS state must still be verified behaviorally against the live project; this source review does not alter or certify deployed database policies.
