# Authentication — Business Domain

## Purpose
Identity verification and session establishment across both products. Not one system — four separate, mutually inconsistent implementations exist across CareHub and CareFind.

## Files
CareHub: `apps/carehub/src/App.jsx` (`AuthContext`), `pages/auth/Login.jsx`, `pages/auth/Register.jsx`, `lib/supabase.js` (`loginBusiness`, `loginStaff`). CareFind: `apps/carefind/carefind-main/src/lib/AuthContext.jsx`, `Login.jsx`, `AdminLogin.jsx`, `api/admin-auth.js`, `api/admin-setup.js` (both Vercel serverless functions).

## Components
CareHub's `Login.jsx`/`Register.jsx` are ordinary page components with no shared auth-form component. CareFind's `Login.jsx`/`AdminLogin.jsx` are similarly separate, unrelated components — CareFind's consumer login and admin login share no code.

## Services
CareHub: no real auth service — `loginBusiness`/`loginStaff` are plaintext-equality PostgREST filters (`staff?email=eq.X&password=eq.Y`), returning a row cached to `localStorage`, no session token issued. CareFind consumer: Supabase Auth (`signUp`/`signInWithPassword`/`signOut`) via `lib/AuthContext.jsx` — correctly implemented. CareFind admin: `api/admin-auth.js` hashes passwords as `` `cf_hashed_${password}` `` (string concatenation, not a hash) and issues an unsigned base64 token; `api/admin-setup.js` (a separate bootstrap endpoint) hashes with real SHA-256 — a different, incompatible scheme from the login handler.

## Dependencies
CareHub's `AuthContext` is consumed via `useAuth()` throughout the dashboard. CareFind's `AuthContext` is consumed similarly across its consumer screens. `api/admin-setup.js` depends on an `ADMIN_SECRET_SALT` environment variable, defaulting to a hardcoded literal if unset.

## Database Tables
CareHub: `businesses.password`, `staff.password` (both plaintext). CareFind: Supabase Auth's own user store (consumer accounts), `admin_users` (CareFind's separate admin roster).

## Current State
Only CareFind's consumer login meets a normal production baseline. CareHub's login has no session token and a hardcoded super-admin credential directly in client source. CareFind's admin login accepts a forgeable, unsigned token — any client can construct a valid "session" for any admin role without a real password. `api/admin-setup.js` is a live-looking endpoint capable of resetting the super-admin account, gated by a key that falls back to a hardcoded default, and returns the plaintext admin password in its response.

## Missing Documentation
No document anywhere states which of these four systems is authoritative, what "logged in" is supposed to mean across the two products, or why CareFind's own admin surface does not use the same Supabase Auth mechanism its consumer side uses correctly. No document confirms whether `api/admin-setup.js` is still reachable in the live deployment or whether `ADMIN_SECRET_SALT` has ever been set to a non-default value in production — this could not be determined from the repository.
