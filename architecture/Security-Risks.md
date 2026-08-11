# Security Risks — Care Ecosystem

**Read this document first, before any other in this folder.** Every other finding in this engagement is secondary to what's below — it affects both products, all ~76 tables between them, and every user of either application simultaneously.

---

## Critical

### 1. No server-side authorization can be confirmed anywhere in either product — and for CareHub specifically, meaningful RLS is structurally impossible as currently architected

**A note on framing, corrected after self-review:** the Supabase anon/publishable key being visible in client source is not itself the vulnerability — Supabase's model expects that key to be public, the same way a Firebase config object is public. Duplicating it across five-plus files (`architecture/Service-Catalog.md` §3.4) is a maintainability problem, not a security one. The real issue is what that public key is allowed to do, which is entirely a function of Row-Level Security (RLS) policy configuration living outside this repository.

**For CareHub, this isn't merely "unverified" — it's structurally incapable of working correctly even if RLS is configured.** CareHub never establishes a real Supabase Auth session (its login is a custom plaintext-equality check against the `businesses`/`staff` tables, not `supabase.auth.signIn`). This means `auth.uid()` is `null` on every single request CareHub's client ever makes. Any RLS policy that scopes a table by `auth.uid()` — the standard, idiomatic way to write one — would reject 100% of CareHub's legitimate traffic. For the application to function at all (which it evidently does), the tables it uses must either have RLS disabled, or have policies permissive enough to allow the anon role unconditionally (functionally equivalent to no isolation). **This is a confident architectural conclusion, not a hedge: real per-tenant RLS and CareHub's current authentication model are mutually exclusive.** Fixing this requires the authentication migration in `Authentication.md`, not just an RLS policy change.

**For CareFind, the situation is different and less severe**, verified via `lib/AuthContext.jsx`: its consumer-facing users do get a real Supabase Auth session, so `auth.uid()` is populated and RLS scoped to it is *architecturally possible* for CareFind's own tables. Whether it's actually configured that way could not be determined from source and should be verified directly — but unlike CareHub, there's no structural reason it couldn't be.

**Service-role keys are, as far as this review found, handled correctly.** `SUPABASE_SERVICE_ROLE_KEY` is read only via `process.env.*` inside CareFind's three Vercel serverless functions (`api/admin-auth.js`, `api/admin-setup.js`, and implicitly wherever else server-side privilege is needed) — never hardcoded, never shipped to either product's browser bundle. This is a genuine positive finding worth stating plainly rather than burying in a list of "hardcoded credential" issues.

**Practical consequence, either way:** if RLS is absent or permissive on any table — which for CareHub's tables is essentially guaranteed by the reasoning above — any caller with the public anon key can read or write any business's or any user's data by changing an ID in a hand-crafted request, including clinical patient records and payment/wallet data.

### 2. Three of four authentication systems in the ecosystem are broken
Full detail in `Authentication.md`. Summary: CareHub's login is plaintext-password equality matching with no session; CareFind's admin login (`api/admin-auth.js`) is a full authentication bypass (unsigned, forgeable tokens); CareFind's admin bootstrap (`api/admin-setup.js`) exists in source as an endpoint that can create/reset super-admin access, gated by a key that falls back to a hardcoded literal if unconfigured, and which returns the plaintext admin password in its response — whether it is currently reachable in the live production deployment could not be confirmed from source and needs direct verification, but the code as written contains no protection beyond that fallback key. Only CareFind's consumer-facing auth (real Supabase Auth) is built correctly.

**Corrected after self-review — `AdminPanel.jsx` is not undefended, it's defended by a check that doesn't matter.** It has a real `useEffect` guard: reads `admin_token`/`admin_user` from `localStorage`, decodes the token, and rejects it if malformed or older than 24 hours. But this validation happens **entirely client-side against the same unsigned token** `api/admin-auth.js` issues — it never calls the server to re-verify. Forging a token that passes this check is exactly as easy as forging one that passes login in the first place (§ finding above). The practical effect is the same as having no check, but the mechanism is different from what an earlier pass of this review stated, and the distinction matters for anyone trying to fix it: patching this requires fixing the token scheme (§2 above), not adding a guard that already, technically, exists.

**Also newly confirmed:** CareFind's admin surface has a real 6-role RBAC concept (`super_admin`, `verification_officer`, `business_manager`, `moderator`/`content_manager`, `analytics_manager`) driving per-role notification filtering in `AdminPanel.jsx`. This role value is read directly from the same client-trusted `localStorage['admin_user']` object the forged token would control — so the RBAC model, while real and more developed than initially documented, inherits the exact same forgeability as the authentication underneath it.

**A more severe variant of this finding, discovered during implementation and now partially remediated:** `api/admin-auth.js`/`api/admin-setup.js` were never actually called by the real admin UI. Grepping `src/` for `admin-auth`/`admin-setup` returned zero matches — `AdminLogin.jsx` and `AdminPanel.jsx`'s `createStaff()`/`createTeam()` instead queried the `admin_users`/`admin_teams` tables **directly from the browser using the public anon key**, replicating the fake-hash login check and staff/team creation client-side with no server-side role check at all. This meant the `admin_users` table (including `password_hash`) had to be readable via the anon key with no RLS blocking it for the app to function — i.e., before RLS is applied (see `Database.md`/this doc's "What to do first" below), the table is very likely readable/writable by anyone with devtools open, no login required. **Fixed in code**: `AdminLogin.jsx` and `AdminPanel.jsx` now call `api/admin-auth.js` (extended with `list_teams`/`create_team` actions) exclusively; no client file queries `admin_users`/`admin_teams` directly anymore. This code fix is a prerequisite for, but does not replace, applying RLS to lock the tables down at the database level — see below. Separately, the standalone `AdminStaff.jsx`/`AdminTeams.jsx` files contain the same insecure direct-query pattern but are **dead code**, never imported by any reachable route or component — confirmed via grep, not just absence of a route — so they don't need fixing to close this hole, though they should eventually be deleted (see `Technical-Debt.md`).

### 3. Passwords are stored and handled in plaintext across CareHub
`businesses.password` and `staff.password` are plaintext (confirmed: `Register.jsx`/`Staff.jsx` send the raw password field to insert; login compares via `password=eq.X`). `lib/email.js`'s `emailStaffWelcome()` then **emails that plaintext password** to every new hire, compounding storage-at-rest exposure with exposure-in-transit and exposure-in-inbox.

### 4. A hardcoded super-admin credential ships in CareHub's public JS bundle
`admin@carehub.ng` / `Admin@2025`, embedded directly in `Login.jsx`, visible to anyone who inspects the client bundle.

### 5. `consultations` naming collision could mean clinical and payment data share a table
See `Database.md`/`Shared-Services.md`. Unverified but high-stakes — if CareHub's clinical consultation notes and CareFind's paid-booking records resolve to the same physical table, this is both a data-integrity and a confidentiality problem (payment/booking metadata and clinical notes visible through the same access path).

---

## High

### 6. Storage buckets are public
Every file uploaded by CareHub (`message-files`, `order-files`, `activity-voice` buckets) is served from `/storage/v1/object/public/<bucket>/<path>` — no authentication required to view a file once its URL is known, protected only by a non-cryptographic filename pattern (`timestamp-random-originalname`).

### 7. No input sanitization beyond partial `encodeURIComponent` usage in CareHub
Most PostgREST filter values in `lib/supabase.js` are raw string-concatenated into query strings. Exploitability depends on which values ever flow from user input into a filter position — not confirmed exploitable, but not confirmed safe either, and worth a dedicated audit.

### 8. CareHub's own internal admin data (`admin_team`) sits behind the identical anon-key posture as tenant data
The platform's own back-office access is only as protected as any pharmacy's product catalog — `AdminDashboard.jsx`'s client-side `isAdmin` check gates the *page*, not the underlying table.

### 9. `lib/reviewAI.js` (CareFind) calls a paid third-party LLM API directly from the browser
If this call is functional (its missing auth headers suggest it may not be — see `Service-Catalog.md`), whatever credential authorizes it would be exposed in the client bundle. **Unlike the Supabase anon key (§ correction to finding 1), this would be a genuine secret-leakage risk** — Anthropic API keys are not designed to be public the way Supabase's anon key is, so if a real key is ever wired into this file, it should be treated as a credential leak, not compared to the Supabase situation.

### 10. No audit trail for read access anywhere in either product
CareHub's `patient_messages` records who *wrote* something; nothing in either schema, as observed, records who *viewed* a patient chart, a lab result, a financial record, or another user's wallet — a thin audit surface given the sensitivity of the data involved.

---

## Medium

11. No file-type/size validation before upload on any of CareHub's three Storage-writing flows (message attachments, order files, activity voice notes).
12. No CAPTCHA/rate-limiting evidenced on either product's public account-creation endpoints (`Register.jsx`, CareFind's signup via Supabase Auth — the latter may be mitigated by Supabase's own defaults, not independently confirmable from source).
13. ~~No route-level access control on ~25 of CareHub's dashboard routes or any of CareFind's 29 routes~~ — **Fixed, both products**, see `Technical-Debt.md` H3 and `Routing.md`. CareHub's 26 nested routes now enforce `lib/permissions.js`'s role/business-type matrix; CareFind's 16 login-requiring routes now redirect via a new `RequireAuth.jsx`. **Unchanged by this fix, still worth restating**: this is client-side routing enforcement only — the underlying data-access functions in both products still have no server-side permission check of their own (§1, still Critical/C1 for CareHub until real RLS lands), so this closes the "type a URL" gap, not the "call the API directly" one.

---

## What to do first

1. **Verify RLS policy state on the live Supabase project for every table in `Database.md`.** This is the single action that would most change the actual (as opposed to theoretical) severity of every finding in this document.
2. **Resolve the `consultations` collision** — five minutes of checking the live schema, potentially the highest-consequence unknown in the whole ecosystem.
3. **Take `api/admin-setup.js` out of production** (or verify `ADMIN_SECRET_SALT` is genuinely set to a strong, non-default value) — confirmed via `vercel.json` that `api/*.js` is reachable under Vercel's default routing, so this is a live, deployed, exploitable endpoint, not a theoretical weakness.
4. **Move CareHub's authentication onto Supabase Auth**, matching what CareFind's consumer side already does correctly. This single change also makes real RLS possible ecosystem-wide, which resolves #1 as a structural matter rather than a policy afterthought.
5. **Enable RLS on `admin_users` and `admin_teams`, restricted to `service_role` only** — `AdminLogin.jsx`/`AdminPanel.jsx` were repointed at `api/admin-auth.js` in code (see Finding #2 above) specifically so this can be done safely; until the RLS policy is actually applied on the live project, the tables remain readable/writable by the anon key at the database level regardless of what the client code does.
6. **CareHub tenant-data RLS — draft complete for all 40 tables, not yet applied.** `apps/carehub/sql/phase2_rls_pilot.sql` covers every table referenced in CareHub's data-access layer, including `staff_claims`/`business_claims` — their real column names (`user_id`, a genuine Supabase Auth UUID from CareFind's consumer session, not a CareHub email) were confirmed directly from CareFind's `ClaimStaffPosition.jsx`/`ClaimBusiness.jsx` rather than left as a guess. **A significant finding surfaced while designing those two policies, and it applies to the already-drafted `businesses` policy too**: CareFind's `AdminPanel.jsx` approves/rejects claims — including writing `businesses.visible_on_carefind` directly — using the plain anon key with no Supabase Auth session at all. Once RLS is live on `businesses`/`business_claims`/`staff_claims`, this CareFind admin flow will be silently rejected, because CareFind admins have no identity Postgres can recognize under this file's policies (CareHub's `is_platform_admin()` only matches CareHub platform admins, a different identity entirely). The real fix is moving `AdminPanel.jsx`'s claim approval behind a service-role-backed endpoint — the same pattern already used for `admin_users` lockdown (Finding #2, C9) — and it needs to happen at the same time as or before those three tables' RLS goes live, not after. **Do not run any of this** until (a) enough real accounts have migrated via Phase 1 that locking out unmigrated ones isn't an outage, (b) the schema assumptions documented at the top of that file (column types, the `businesses` INSERT-before-session gap for `Register.jsx`, the `consultations` collision, and the multi-branch `parent_business_id` caveat on `enterprise_locations`) are confirmed against the live project, and (c) the CareFind admin claim-approval flow has a service-role path.
5. Stop emailing plaintext passwords (`lib/email.js`); switch to a one-time setup-link pattern.
