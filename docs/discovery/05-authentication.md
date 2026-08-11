# 05 — Authentication

## What The Aspirational Documentation Claims

`docs/CARE_ECOSYSTEM_OPERATING_MANUAL/02-Domains/01-Identity-Domain.md` describes a single, centralized Identity Domain owning authentication, sessions, roles, permissions, and access control for the whole ecosystem, with explicit business rules including: *"Permissions are always evaluated before business logic executes,"* *"Users cannot access another organization's data,"* and *"Passwords are never stored in plain text."* It also honestly labels itself unfinished: *"Current State: (Custom Authentication — update after code audit)."*

## What Actually Exists

Four separate, mutually inconsistent authentication systems, none of which is the centralized service the manual describes.

### 1. CareHub business/staff login — plaintext, no session
`Login.jsx` + `lib/supabase.js`'s `loginBusiness`/`loginStaff`. Login is a raw PostgREST equality filter: `staff?email=eq.X&password=eq.Y`. Passwords are stored **and compared** in plaintext — directly contradicting the manual's stated rule. Credentials travel as URL query parameters. No session token is issued; "logged in" is a plain object cached to `localStorage['carehub_auth']` that nothing ever re-verifies against the server. A hardcoded super-admin credential (`admin@carehub.ng` / `Admin@2025`) sits directly in `Login.jsx`'s client source.

### 2. CareFind admin login — full bypass
`api/admin-auth.js`. Password "hashing" is `` `cf_hashed_${password}` `` — string concatenation. Session tokens are `base64(adminId|role|timestamp)` — unsigned, meaning any client can forge a valid `super_admin` session without ever knowing a real password.

### 3. CareFind admin bootstrap — a exposure risk if reachable in production
`api/admin-setup.js`. An endpoint capable of creating/resetting the super-admin account, gated by a query-string key that falls back to a hardcoded literal if unconfigured, and which returns the plaintext admin password in its JSON response. It also hashes with real SHA-256 — **incompatible** with `admin-auth.js`'s fake scheme, meaning an account created here likely cannot log in there. This mismatch is direct evidence the admin path has never been exercised end-to-end. Whether this function is actually deployed and reachable in the live Vercel environment (vs. present in source but unused/disabled) was not confirmed from source alone — worth checking directly before treating it as a live exposure.

### 4. CareFind consumer login — correct
`lib/AuthContext.jsx`. A thin, properly-built wrapper around real Supabase Auth (`signUp`/`signInWithPassword`/`signOut`, live session listener). The only one of the four that meets a normal production baseline, and proof the team building CareFind knows how to do this correctly — the gap is consistency, not capability.

### A note on `AdminPanel.jsx`'s route-level check
`AdminPanel.jsx` (lines 117-140) does run a `useEffect` guard on mount that reads `admin_token`/`admin_user` from `localStorage` and redirects if absent — this is a real check, not a missing one. But it never calls the server to verify the token; it only checks that *some* value is present client-side, so the same forgeable token described in system 2 above satisfies it. The practical effect is equivalent to no protection, but the mechanism is different from "no check exists" — the fix is to make the token verifiable server-side, not to add a guard that isn't there. The same file also drives a previously-undocumented **6-role admin RBAC model** (`super_admin`, `verification_officer`, `business_manager`, `moderator`/`content_manager`, `analytics_manager`) used to filter which notifications/sections a logged-in admin sees — entirely client-trusted, since the role comes from the same unverified `localStorage` object.

## Line-by-Line Contrast Against the Aspirational Rules

| Identity Domain claim | Verified reality |
|---|---|
| "Passwords are never stored in plain text" | False for CareHub (`businesses.password`, `staff.password`) |
| "Permissions are always evaluated before business logic executes" | False — nothing in either product's service layer re-checks a permission before a write; enforcement is UI-only |
| "Users cannot access another organization's data" | False for CareHub specifically, as an architectural conclusion rather than a hedge: CareHub issues no real auth session (no Supabase Auth, no JWT), so `auth.uid()` is always null on every CareHub request — meaningful per-tenant Row-Level Security is structurally impossible under the current auth model, not merely unconfirmed. Tenant isolation depends entirely on a client-supplied `business_id` that nothing server-side re-validates. CareFind is architecturally different — it issues real Supabase Auth sessions, so RLS is at least *possible* there; whether policies are actually configured could not be confirmed from source (RLS policies aren't visible in either repo) and should be checked directly against the live project. |
| "Every authenticated action requires a valid session" | False for CareHub (no session concept exists) and for CareFind's admin path (session is a forgeable token) |
| "No other domain may implement authentication or authorization independently" | Contradicted directly — CareHub and CareFind each independently built their own, and CareFind's admin path is a third, separate scheme from its own consumer path |

## How Auth Connects to Routing

CareHub: `App.jsx`'s `login()` writes the cached object and the calling component manually navigates to `/dashboard/dashboard`; the router's two guards (`/admin`, `/dashboard/*`) check only whether this cached object is truthy. CareFind: no router-level guard exists at all — `useAuth()`'s `user` becomes non-null reactively via Supabase's own session listener, and individual components decide independently whether to act on it. Full detail: `architecture/Routing.md` §4.

## What This Means Practically

Any engineer working on either product's authentication should treat CareFind's `lib/AuthContext.jsx` as the reference implementation for what "correct" looks like in this codebase, and should not assume the aspirational manual's RBAC/session/audit claims describe anything currently enforced. See `architecture/Security-Risks.md` for the full severity ranking and `architecture/Technical-Debt.md` items C2–C5, H5 for effort/risk estimates and suggested remediation order.
