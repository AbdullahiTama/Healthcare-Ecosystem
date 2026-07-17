# Care Ecosystem Security/Auth Remediation — Status

Last updated: 2026-07-17. This tracks a multi-session engagement working through the phased plan approved for CareHub/CareFind's authentication, authorization, and schema documentation gaps. Read this first if picking the work back up — it's the fastest way back to full context without re-reading the whole conversation history.

**This session: H11 and C10 both fixed in code.** C10 (CareHub's data layer never forwarding the real login session, discovered while fixing H11) turned out to be a small, mechanical fix once the code was actually read — all ~90 data functions funnel through one shared `sbFetch()`, so one change covered everything, no per-call-site audit needed. One thing the fix can't self-verify is flagged below. See "Blocked on you" and `architecture/Technical-Debt.md` (H11, C10, and C1's corrected status) for full detail.

---

## Done

### Phase 0 — Containment (all 5 steps complete)
1. `ADMIN_SECRET_SALT` rotated in Vercel (you, manual).
2. `admin_users`/`admin_teams` RLS applied (you, manual) + `AdminLogin.jsx`/`AdminPanel.jsx` repointed at `api/admin-auth.js` instead of querying those tables directly with the anon key (code).
3. CareHub's hardcoded super-admin credential (`admin@carehub.ng`/`Admin@2025`) removed from `Login.jsx`; replaced with a `businesses.is_platform_admin` flag (you created the row manually with a new password).
4. `Locations.jsx`'s `setAuth` crash fixed — `setAuth` added to `AuthContext`'s provider value in `App.jsx`.

### Phase 1 — Real authentication for CareHub (all 4 sub-steps complete)
1a. `apps/carehub/src/lib/authClient.js` (new) — session-persisting Supabase Auth client, separate from `lib/realtime.js`'s deliberately-non-persisting one. Plus `getBusinessByEmail`/`getStaffByEmail`/`resolveAccountByEmail` added to `lib/supabase.js`.
1b. `Login.jsx` — tries real `signInWithPassword` first, falls back to the legacy plaintext check, silently provisions a real Supabase Auth account (`provisionRealAuthAccount`) on legacy success. **"Silent migration on next login" strategy — no forced password reset.**
1c. `Register.jsx` — new signups get a real Auth account from day one. Also fixed a latent email-casing bug (wasn't lowercasing before storing, while `Login.jsx` always lowercases before querying).
1d. `App.jsx` — bootstraps `auth` state from a real Supabase session on page load (`getSession()` → `resolveAccountByEmail` → `login()`), not just the `localStorage` cache. `logout()` now also calls `authClient.auth.signOut()`. Fixed `AdminDashboard.jsx`'s local logout bypass (was skipping the real signOut).

**Known-open item from Phase 1:** C2 in `Technical-Debt.md` isn't fully closed — plaintext passwords remain in `businesses.password`/`staff.password` even after an account migrates (nothing purges them), and there's no sweep for accounts that never log in again.

**Operational dependency you still need to check:** Supabase's "Confirm email" setting. If ON, silently-created accounts can't complete sign-in until someone clicks a confirmation link nobody was shown — migration degrades safely (falls back to legacy forever) but never actually completes. Check Authentication → Providers → Email in the Supabase dashboard.

### Phase 3 — Structural consolidation (all 4 items complete, both products)
- **H1**: 3 hospital pages' (Doctor/Lab/Imaging) hardcoded credentials + duplicated `sbFetch` consolidated into `lib/supabase.js` (10 functions moved, 2 were triplicated identically).
- **H3 (CareHub)**: `BusinessDashboard.jsx`'s 26 nested routes now individually enforce `lib/permissions.js`'s role/business-type matrix via a `guard()` wrapper (reuses `getNavItems()`).
- **H3 (CareFind)**: new `RequireAuth.jsx` wraps 16 of 27 routes needing a logged-in consumer session. Found and fixed two real crash risks in the process — `PlaylistCreate.jsx` and `ProfessionalMonetization.jsx` (`/earn`) used `user.id` with no null check at all.
- **H6/H9**: `architecture/Schema-Reference-CareHub.md` created (didn't exist before) — table-by-table for CareHub, confirmed vs. inferred columns. H9 resolved as a finding: CareHub genuinely has zero write path to CareFind's marketplace-specific product columns (confirmed via exhaustive grep, not just one file).

### Phase 2 — RLS (drafted, NOT applied)
`apps/carehub/sql/phase2_rls_pilot.sql` — **complete draft covering all 40 CareHub tables**, using three policy shapes (direct `business_id`, join-through-parent for FK-only child tables, `auth.uid()` for the two CareFind bridge tables). File is headed "DO NOT RUN AGAINST PRODUCTION YET."

**H11 — Fixed.** CareFind's `AdminPanel.jsx` `approveClaim()`/`rejectClaim()` wrote `business_claims` and `businesses.visible_on_carefind` directly from the browser with the plain anon key, no Supabase Auth session. Now routed through two new actions (`approve_claim`/`reject_claim`) on `api/admin-auth.js`, same service-role pattern already used for `admin_users`/`admin_teams` (C9). Verified with a clean `vite build` of the CareFind app. Scope correction from the original finding: `AdminPanel.jsx` never actually touched `staff_claims` — only `business_claims`/`businesses`. `staff_claims` approval is entirely CareHub-side (`Staff.jsx`) and turned out to have its own, separate version of this problem — see C10.

**C10 — Fixed.** Found while verifying H11's fix was complete: CareHub's `lib/supabase.js`/`sbFetch()` — the function behind every one of `phase2_rls_pilot.sql`'s 40 tables, including `approveStaffClaim`/`rejectStaffClaim` — hardcoded the anon key as its `Authorization` header on every request, unconditionally, never reading from `lib/authClient.js`'s real Phase 1 login session. Fix: `sbFetch()` plus the three storage-upload functions (which had the identical bug, independently, each hardcoding the anon key inline — consolidated into one shared `sbUpload()` helper while fixing it, removing a triplication) now call a shared `authToken()` that reads `authClient.auth.getSession()` and forwards the real token when one exists, anon key otherwise. Because all ~90 CareHub data functions already funneled through this one shared function, the fix needed no per-call-site changes and no separate audit of pre-login flows — they fall back to the exact same anon-key behavior they always had. Verified with a clean `vite build`. **What's not verified (can't be from source):** this switches logged-in users from Postgres role `anon` to `authenticated`. RLS isn't live yet, so today's access is gated purely by role grants — if `authenticated` doesn't carry the same grants as `anon` on these 40 tables (never directly inspected against the live project), logged-in users could hit failures immediately on deploy, independent of RLS. See "Blocked on you" below. Full writeup in `architecture/Technical-Debt.md` under C10 and the corrected C1; the SQL file's header comment carries the same note inline.

---

## Blocked on you (not code — needs your judgment/access)

1. **Verify Postgres role grants before/after deploying C10's fix** (new, most urgent) — confirm the `authenticated` role has equivalent grants to `anon` on CareHub's 40 tables in the live Supabase project. C10's fix moves logged-in users from the `anon` role to `authenticated`; if grants differ, logged-in users could see failures immediately on deploy, independent of RLS. A quick check in Database → Roles, or a post-deploy smoke test through a few core flows (login, add a sale, view patients) as a real logged-in user, would confirm this.
2. **Check real migration progress** — how many CareHub accounts have actually logged in since Phase 1 shipped. With C10 fixed, this is now the main remaining gate on RLS readiness alongside item 3.
3. **Confirm schema assumptions** against the live Supabase project before running `phase2_rls_pilot.sql` — column types (the file assumes `uuid` PKs, flagged inline), the `consultations` name-collision question (single highest-priority unresolved question in the whole ecosystem — see `architecture/Database.md`), and the multi-branch `parent_business_id` caveat on `enterprise_locations`.
4. **Check the Supabase "Confirm email" setting** (see Phase 1 note above).

---

## Not started yet

- **H7** — CareHub's enterprise vertical (6 files) never uses the shared `Modal` component.
- **H8** — Doctor's Disposition selector (Admit/Refer/Emergency Transfer) has no effect on `patients.status`.
- **H10** — `AdminPanel.jsx`'s `loadAll()` has a `Promise.all` destructuring bug (positions 8–12 don't match their variable names' apparent intent) — Withdrawals/Businesses/Task Submissions tabs and the "new consultation booking" notification are very likely showing wrong data. Needs a human to confirm intended behavior per tab before fixing.
- **CareFind schema documentation** — never got the `Schema-Reference-CareHub.md` treatment; still only has the older table-inventory-level summary in `Database.md`.

---

## Key files for picking this back up

- `architecture/Technical-Debt.md` — the master tracker, every item above has an entry there (C1–C10, H1–H11) with current status.
- `architecture/Security-Risks.md` — "What to do first" section has the live-priority list.
- `apps/carehub/sql/phase2_rls_pilot.sql` — the RLS draft, self-documenting.
- `architecture/Schema-Reference-CareHub.md` — column-level reference for CareHub.
- `architecture/Authentication.md`, `architecture/Routing.md` — updated throughout this engagement, reflect current (not historical) state.

## Suggested next step

Verify the Postgres grants question (Blocked-on-you #1) before or right after this session's changes ship — it's the one thing about C10's fix that couldn't be checked from source. After that, Phase 2 is gated only on migration progress and schema confirmation (items 2–3), both pre-existing. Everything else in "not started" (H7/H8/H10, CareFind schema docs) is independent and can proceed in parallel any time.
