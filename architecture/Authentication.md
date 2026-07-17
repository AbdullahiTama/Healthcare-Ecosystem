# Authentication — Care Ecosystem

Four separate, mutually inconsistent authentication systems exist across the two products. One meets baseline standards. The other three are broken in ways ranging from "weak" to "full bypass."

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

## 2. CareFind admin login — fully forgeable

**Where:** `api/admin-auth.js` (Vercel function).

- `hashPassword()` is `` `cf_hashed_${password}` `` — string concatenation, not a cryptographic hash. Trivially reversible.
- `generateToken()` is `base64(adminId|role|timestamp)` — **not signed** (no HMAC, no JWT). `verifyToken()` only checks the base64 decodes into three parts and the timestamp is under 24 hours old — it performs no authenticity check at all.
- **This is a complete authentication bypass.** Any client can construct a valid "session" for any admin ID and any role — including `super_admin` — by base64-encoding a string themselves, with no need to ever know a real password.
- **Verified this same weakness on the consuming side too:** `AdminPanel.jsx` (the screen this token is meant to protect) re-validates the token entirely client-side — decoding it and checking its shape/age in a `useEffect`, with no round trip to the server. A forged token that satisfies `admin-auth.js`'s (nonexistent) verification also satisfies this page's own gate, since both are checking the same unsigned string the same way.
- **CareFind's admin surface has a real, more developed RBAC model than a first pass of this review credited it with:** six roles are used to filter admin notifications in `AdminPanel.jsx` — `super_admin`, `verification_officer`, `business_manager`, `moderator`/`content_manager`, `analytics_manager`. This is genuine role granularity, not just a binary admin flag. It inherits the same forgeability as everything else here, though, since the role value is read from the same client-trusted, server-unverified `localStorage['admin_user']` object.

## 3. CareFind admin bootstrap — a live, deployed skeleton-key endpoint

**Where:** `api/admin-setup.js` (Vercel function).

- A deployed endpoint that creates or resets the super-admin account, gated only by a query-string key checked against `process.env.ADMIN_SECRET_SALT`, which **falls back to the hardcoded literal `'carefind_admin_2024_secure'`** if the env var was never set.
- Returns the plaintext admin password (`CareFind@Admin2024!`) in its JSON response.
- **Uses a different, correctly-implemented hash** (real SHA-256 + salt via `crypto.subtle.digest`) than `admin-auth.js`'s login handler (`cf_hashed_` fake scheme) — meaning an account created via this endpoint will almost certainly fail to authenticate through the normal login path. This is direct evidence the admin auth path has never been exercised end-to-end.
- If this endpoint is still deployed and the environment variable was never overridden in production, **anyone who finds the URL can create or reset super-admin access to CareFind.**

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
| CareFind admin | Fake hash + unsigned token | **Critically broken** — full bypass possible |
| CareFind admin bootstrap | Query-string key with hardcoded fallback | **Critically broken** — live skeleton key, plaintext password in response |
| CareFind consumer | Real Supabase Auth | **Correct** |

Three of four authentication systems in this ecosystem are broken as of this review — two of them (CareFind's) to the point of a complete bypass. The one correct implementation (CareFind consumer auth) proves the team building CareFind knows how to do this properly; the fact that CareFind's *own* admin surface doesn't use the same mechanism is the clearest evidence in the whole ecosystem that these were built by different people, at different times, without a shared authentication standard — exactly the kind of gap `Missing-Documentation.md`'s call for a documented auth/security model would have caught.

**No RLS (Row-Level Security) policy can be confirmed to exist for any table in either product from source code alone** — every finding above compounds with that unknown. See `Security-Risks.md`.
